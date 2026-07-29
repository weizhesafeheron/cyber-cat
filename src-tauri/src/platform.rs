//! 平台差异 shim。
//!
//! 所有 `#[cfg(target_os = ...)]` 都关在这一个模块里 - 世界层与渲染层看不到
//! 平台条件编译（见 mvp-scope 的架构分层）。
//!
//! 已实测的平台事实见：
//! - docs/research/2026-07-29-macos-hit-test/report.md
//! - docs/research/2026-07-29-windows-transparent-window/report.md

use tauri::{App, LogicalPosition, LogicalSize, WebviewWindow};

/// 一个窗口的几何读数，全部是**逻辑像素**（点）。
///
/// 一次 IPC 把窗口位置、尺寸与桌面工作区一起给出去：前端要用它们做减法
/// （猫的屏幕位置 = 舞台位置 + 舞台内位置），分几次取会拿到不同时刻的值。
///
/// 挂件窗口也用同一个读数（回读自己被拖到哪儿了），所以字段名不带 stage。
#[derive(serde::Serialize)]
pub struct StageMetrics {
    /// 客户区原点，桌面坐标。
    pub x: f64,
    pub y: f64,
    /// 客户区尺寸。
    pub w: f64,
    pub h: f64,
    /// 当前显示器的可用区（避开程序坞/任务栏）。
    pub work_x: f64,
    pub work_y: f64,
    pub work_w: f64,
    pub work_h: f64,
}

/// 前台窗口的一次读数（ticket 12，特效 3.1）。
///
/// 坐标一律是**逻辑像素**（点），与 `StageMetrics` 同一个坐标系 - 前端要拿它和
/// 舞台、猫的位置做减法，混单位会让猫整体错位。两个平台的换算差异全部关在本模块里：
/// - macOS：`kCGWindowBounds` 本来就是点（主显示器左上角为原点、Y 向下，
///   与 tao 的 `LogicalPosition` 同一套），原样返回。
/// - Windows：DWM 的矩形是物理像素，按 `GetDpiForWindow` 给的**目标窗口所在显示器**
///   的 DPI 换算。用宠物窗口自己的 DPI 会在混合 DPI 多屏上整体错位。
#[derive(serde::Serialize, Clone, Copy)]
pub struct ForegroundWindow {
    /// macOS 的 `kCGWindowNumber` / Windows 的 HWND。前端只用它判断「还是同一个窗口吗」。
    pub id: u64,
    /// 拥有者进程。宠物自身的窗口已在这一层排除，返回它只为排查问题。
    pub pid: i32,
    /// 可见矩形。**不含** Windows 的不可见拖拽边框。
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    /// 目标窗口所在显示器的缩放。前端用它挡住跨 DPI 的情况（见 src/app/perch.ts）。
    pub scale: f64,
}

/// 当前前台窗口的可见矩形。`None` = 此刻没有可用的目标。
///
/// **两个平台都不需要任何用户授权**，这是 ADR 0005 的核心结论，也是这里没有任何
/// 权限探测或引导代码的原因。实测证据见 docs/research/2026-07-29-window-position-apis.md。
///
/// 失效方向一律是 `None`：读不到就等于「没有窗口可爬」，猫留在桌面上。
/// 前端（app/perch.ts）还会再过一遍能不能站的闸门，这一层只负责给出一个诚实的矩形。
pub fn foreground_window(window: &WebviewWindow) -> Result<Option<ForegroundWindow>, String> {
    #[cfg(target_os = "macos")]
    {
        mac::foreground(window)
    }
    #[cfg(target_os = "windows")]
    {
        win::foreground(window)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        // Linux 上没有统一的窗口几何接口（X11 与各 Wayland 合成器各不相同），
        // 而 MVP 只验收 macOS 与 Windows。返回 None 的后果是猫只在桌面上活动。
        let _ = window;
        Ok(None)
    }
}

/// macOS：`NSWorkspace.frontmostApplication` + `CGWindowListCopyWindowInfo`。
///
/// 免授权的那条路径（ADR 0005）。**不要迁移到 ScreenCaptureKit** -
/// `SCShareableContent` 强制要屏幕录制授权，那会把一个零摩擦的特性变成需要用户去
/// 系统设置手动勾选并重启应用的特性。Apple 废弃的是**读像素**
/// （`CGWindowListCreateImage`，macOS 14 弃用、15 废除），不是读几何：
/// `CGWindowListCopyWindowInfo` 在最新 SDK 里只有 `API_AVAILABLE`，没有任何
/// deprecation 注解。
#[cfg(target_os = "macos")]
mod mac {
    use super::ForegroundWindow;
    use core_foundation::array::CFArray;
    use core_foundation::base::{CFType, TCFType};
    use core_foundation::dictionary::{CFDictionary, CFDictionaryRef};
    use core_foundation::number::CFNumber;
    use core_foundation::string::{CFString, CFStringRef};
    use core_graphics::window::{
        kCGNullWindowID, kCGWindowBounds, kCGWindowLayer, kCGWindowListExcludeDesktopElements,
        kCGWindowListOptionOnScreenOnly, kCGWindowNumber, kCGWindowOwnerPID,
        create_description_from_array, CGWindowID, CGWindowListCopyWindowInfo,
    };
    use objc2_app_kit::NSWorkspace;
    use std::sync::Mutex;
    use tauri::WebviewWindow;

    /// 一个窗口的信息字典。
    type Info = CFDictionary<CFString, CFType>;

    /// 上一次锁定的前台窗口：`(拥有者 PID, windowID)`。
    ///
    /// 有它才谈得上「稳态下不做全量枚举」（验收项）：实测全量枚举 0.369 ms，
    /// 而 `CGWindowListCreateDescriptionFromArray([id])` 只要 0.072 ms，快五倍。
    /// 10 Hz 下这是 3.7 ms/s 与 0.7 ms/s 的差别 - 对一只 24 小时常驻的挂件值得区分。
    ///
    /// 放模块级 static 而不是 Tauri 的 managed state：它是**这条平台路径的实现细节**，
    /// 命令签名与前端都不该知道有这么一个缓存。
    static LOCKED: Mutex<Option<(i32, CGWindowID)>> = Mutex::new(None);

    /// 读一个数值字段。`key` 是 CoreGraphics 导出的常量字符串，只借不放（get rule）。
    fn number(info: &Info, key: CFStringRef) -> Option<f64> {
        let key = unsafe { CFString::wrap_under_get_rule(key) };
        info.find(&key)?.downcast::<CFNumber>()?.to_f64()
    }

    /// `kCGWindowBounds` 是个内嵌字典（X / Y / Width / Height），单位是点。
    ///
    /// 这里不能用 `downcast`：那个方法要求 `ConcreteCFType`，而泛型的
    /// `CFDictionary<K, V>` 没有（也不该有）这个实现 - 它无法保证键值的实际类型。
    /// 所以自己比一次 CFTypeID 再按 get rule 包装，语义等价而且检查一样严。
    fn bounds(info: &Info) -> Option<(f64, f64, f64, f64)> {
        let key = unsafe { CFString::wrap_under_get_rule(kCGWindowBounds) };
        let value = info.find(&key)?;
        if value.type_of() != <Info as TCFType>::type_id() {
            return None;
        }
        let rect: Info =
            unsafe { Info::wrap_under_get_rule(value.as_CFTypeRef() as CFDictionaryRef) };
        let get = |name: &'static str| -> Option<f64> {
            let k = CFString::from_static_string(name);
            rect.find(&k)?.downcast::<CFNumber>()?.to_f64()
        };
        Some((get("X")?, get("Y")?, get("Width")?, get("Height")?))
    }

    /// 一条窗口信息 → 读数。**`kCGWindowLayer != 0` 一律拒绝**。
    ///
    /// 层级不为 0 的是菜单栏图标、Dock、输入法候选框这类浮层（实测 layer 24 / 25）。
    /// 猫爬到输入法候选框上是个很好笑但完全不能接受的画面：那东西一敲键盘就消失。
    fn read(info: &Info, scale: f64) -> Option<ForegroundWindow> {
        if number(info, unsafe { kCGWindowLayer })? as i64 != 0 {
            return None;
        }
        let pid = number(info, unsafe { kCGWindowOwnerPID })? as i32;
        let id = number(info, unsafe { kCGWindowNumber })? as u64;
        let (x, y, w, h) = bounds(info)?;
        Some(ForegroundWindow {
            id,
            pid,
            x,
            y,
            w,
            h,
            scale,
        })
    }

    /// 只查一个已知的 windowID。窗口已关闭或已最小化时返回 None。
    fn describe(id: CGWindowID) -> Option<Info> {
        let list = create_description_from_array(CFArray::from_copyable(&[id]))?;
        let item = list.get(0)?;
        Some((*item).clone())
    }

    /// 全量枚举一次，取属于 `pid` 的、z 序最前的那个普通窗口。
    ///
    /// 列表本身就是从前到后排序的，所以「第一个命中的」就是最前面那个。
    /// 用 `OnScreenOnly | ExcludeDesktopElements` 而不是 `optionAll`：后者慢 3.2 倍，
    /// 还会把大量离屏窗口与桌面元素混进来。
    fn find_front(pid: i32, own: i32, scale: f64) -> Option<ForegroundWindow> {
        let list: CFArray<Info> = unsafe {
            let raw = CGWindowListCopyWindowInfo(
                kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
                kCGNullWindowID,
            );
            if raw.is_null() {
                return None;
            }
            TCFType::wrap_under_create_rule(raw)
        };
        for item in list.iter() {
            let win = match read(&item, scale) {
                Some(w) => w,
                None => continue,
            };
            // 排除宠物自己：否则猫会试图趴到自己头上。
            if win.pid == own || win.pid != pid {
                continue;
            }
            return Some(win);
        }
        None
    }

    fn frontmost_pid() -> Option<i32> {
        let app = NSWorkspace::sharedWorkspace().frontmostApplication()?;
        Some(app.processIdentifier())
    }

    pub fn foreground(window: &WebviewWindow) -> Result<Option<ForegroundWindow>, String> {
        // 用宠物窗口自己那块屏的缩放。
        //
        // macOS 上这个值只用于前端的跨 DPI 闸门，**不参与坐标换算** -
        // kCGWindowBounds 已经是点，与 tao 的逻辑坐标同一套单位（这一点在
        // 4K@2x 屏上实测过：全屏窗口是 1920x1002 而不是 3840x2004）。
        // 代价是目标窗口在另一块**不同缩放**的屏上时这个值会偏乐观；那种情况由前端
        // 的「表面必须与猫的工作区相交」挡住（跨屏漫游是 MVP 之后的事，
        // mvp-scope 第 10 节）。届时这里要改成查目标屏的 backingScaleFactor。
        let scale = window.scale_factor().map_err(|e| e.to_string())?;
        let own = std::process::id() as i32;
        let front = frontmost_pid();

        // 前台是宠物自己时**不换目标**（`None` 表示「不知道该跟谁」）。
        // 用户点一下猫就可能把我们变成前台 app，那时清掉目标等于每摸一次猫
        // 就把它从窗口上赶下来。
        let target = match front {
            Some(pid) if pid != own => Some(pid),
            _ => None,
        };

        let mut locked = LOCKED.lock().map_err(|_| "前台窗口缓存被污染".to_string())?;

        // 稳态：只刷新已锁定的那一个 windowID。
        if let Some((pid, id)) = *locked {
            if target.is_none() || target == Some(pid) {
                if let Some(info) = describe(id) {
                    if let Some(win) = read(&info, scale) {
                        return Ok(Some(win));
                    }
                }
            }
        }

        // 前台换了 app、或者锁定的窗口没了（关闭 / 最小化）：全量枚举一次。
        let pid = match target {
            Some(pid) => pid,
            None => {
                *locked = None;
                return Ok(None);
            }
        };
        match find_front(pid, own, scale) {
            Some(win) => {
                *locked = Some((pid, win.id as CGWindowID));
                Ok(Some(win))
            }
            None => {
                // 前台 app 没有普通窗口（只有菜单栏图标、或全屏在别的 Space）。
                *locked = None;
                Ok(None)
            }
        }
    }
}

/// Windows：`GetForegroundWindow` + `DwmGetWindowAttribute(DWMWA_EXTENDED_FRAME_BOUNDS)`。
///
/// **未在真机验证过**（本项目的开发机是 macOS）。写法逐条照着实机调研的结论来：
/// docs/research/2026-07-29-window-position-apis.md 的 2.3 / 2.4。
///
/// 三条硬结论：
/// 1. **不能用 `GetWindowRect`。** 它对最大化窗口的顶边偏差 11 像素（Windows 11
///    25H2 实测），而顶边正是猫要站的那条线 - 猫会浮空 11 像素。只在 DWM 调用
///    失败时才退回它（社区做法，也是 active-win-pos-rs 的写法）。
/// 2. **必须过滤 `DWMWA_CLOAKED != 0`。** 「设置」应用同时存在一个 cloaked 的
///    `SystemSettings` 窗口与一个可见的 `ApplicationFrameHost` 窗口。主路径用
///    `GetForegroundWindow` 通常拿到可见的那个，但这道过滤是免费的保险。
/// 3. **坐标按 `GetDpiForWindow` 换算。** DWM 返回的永远是物理像素
///    （文档原话 "not adjusted for DPI"），而 Tauri 默认已经是 Per-Monitor-V2，
///    所以物理像素是跨屏统一的（左侧屏为负值）。**不要关掉 tao 的 dpi_aware**，
///    否则这里所有坐标结论失效。
#[cfg(target_os = "windows")]
mod win {
    use super::ForegroundWindow;
    use tauri::WebviewWindow;
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::Graphics::Dwm::{
        DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS,
    };
    use windows::Win32::UI::HiDpi::GetDpiForWindow;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowRect, GetWindowThreadProcessId, IsIconic, IsWindowVisible,
    };

    /// DWM 把这个窗口藏起来了吗。读不到属性时当作「没藏」- 失效方向是继续用它，
    /// 而顶边偏差比「猫完全不爬窗口」轻。
    fn cloaked(hwnd: HWND) -> bool {
        let mut flag: u32 = 0;
        let ok = unsafe {
            DwmGetWindowAttribute(
                hwnd,
                DWMWA_CLOAKED,
                (&mut flag as *mut u32).cast(),
                std::mem::size_of::<u32>() as u32,
            )
        };
        ok.is_ok() && flag != 0
    }

    /// 可见矩形，物理像素。先试 DWM，失败退回 GetWindowRect。
    fn frame(hwnd: HWND) -> Option<RECT> {
        let mut r = RECT::default();
        let ok = unsafe {
            DwmGetWindowAttribute(
                hwnd,
                DWMWA_EXTENDED_FRAME_BOUNDS,
                (&mut r as *mut RECT).cast(),
                std::mem::size_of::<RECT>() as u32,
            )
        };
        if ok.is_ok() {
            return Some(r);
        }
        let mut fallback = RECT::default();
        if unsafe { GetWindowRect(hwnd, &mut fallback) }.is_ok() {
            return Some(fallback);
        }
        None
    }

    pub fn foreground(window: &WebviewWindow) -> Result<Option<ForegroundWindow>, String> {
        let hwnd = unsafe { GetForegroundWindow() };
        if hwnd.is_invalid() {
            return Ok(None);
        }
        let mut pid: u32 = 0;
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
        // 排除宠物自己：否则猫会试图趴到自己头上。
        if pid == 0 || pid == std::process::id() {
            return Ok(None);
        }
        if !unsafe { IsWindowVisible(hwnd) }.as_bool() {
            return Ok(None);
        }
        // 最小化的窗口仍然是「前台」，但它的矩形在屏幕外。
        if unsafe { IsIconic(hwnd) }.as_bool() {
            return Ok(None);
        }
        if cloaked(hwnd) {
            return Ok(None);
        }
        let rect = match frame(hwnd) {
            Some(r) => r,
            None => return Ok(None),
        };
        // 目标窗口所在显示器的 DPI。跨屏时它会跟着变（实测 144 → 96），
        // 而窗口的**逻辑**尺寸不变 - 猫与窗口的比例就是靠这一步对上的。
        let dpi = unsafe { GetDpiForWindow(hwnd) };
        let scale = if dpi == 0 {
            window.scale_factor().map_err(|e| e.to_string())?
        } else {
            f64::from(dpi) / 96.0
        };
        Ok(Some(ForegroundWindow {
            id: hwnd.0 as usize as u64,
            pid: pid as i32,
            x: f64::from(rect.left) / scale,
            y: f64::from(rect.top) / scale,
            w: f64::from(rect.right - rect.left) / scale,
            h: f64::from(rect.bottom - rect.top) / scale,
            scale,
        }))
    }
}

/// 应用启动时的一次性平台设置。
///
/// 取 `&mut App` 是因为 macOS 的激活策略需要可变借用。
pub fn configure_app(app: &mut App) {
    #[cfg(target_os = "macos")]
    {
        // macOS 上 skipTaskbar 无效（实测确认），隐藏程序坞图标要靠激活策略。
        // Accessory 表示这是个附属工具：不出现在程序坞，也不出现在 Cmd-Tab 里。
        app.set_activation_policy(tauri::ActivationPolicy::Accessory);
    }
    #[cfg(not(target_os = "macos"))]
    {
        // Windows 与 Linux 由 tauri.conf.json 的 skipTaskbar 处理。
        // Windows 侧已实测确认 skipTaskbar 能同时从任务栏、Alt+Tab、Win+Tab 移除。
        let _ = app;
    }
}

/// 让应用临时变成「普通应用」，或切回附属模式。
///
/// 只有 macOS 需要：平时用 `Accessory` 把图标从程序坞里去掉（见 configure_app），
/// 但附属应用的窗口拿键盘焦点是不可靠的，而**领养要打字**。所以领养期间切成
/// `Regular`，结束后切回来 - 代价是程序坞里短暂出现一个图标，只在首次启动的
/// 那一次领养流程里可见。
///
/// Windows 与 Linux 不需要这套：那边 skipTaskbar 只作用在宠物窗口上，
/// 领养窗口本来就是个正常的、能拿焦点的窗口。
pub fn set_foreground_app(app: &tauri::AppHandle, foreground: bool) {
    #[cfg(target_os = "macos")]
    {
        let policy = if foreground {
            tauri::ActivationPolicy::Regular
        } else {
            tauri::ActivationPolicy::Accessory
        };
        if let Err(e) = app.set_activation_policy(policy) {
            // 失败的后果是「程序坞里多/少一个图标」或「领养窗口要点一下才能打字」，
            // 都不该阻断领养流程本身，所以只报不抛。
            eprintln!("[cyber-cat] 切换激活策略失败：{e}");
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, foreground);
    }
}

/// 宠物窗口创建后的平台设置。
pub fn configure_pet_window(window: &WebviewWindow) {
    // 阴影已在配置里关掉，这里再显式设一次以防配置被改动。
    // Windows 11 对无边框窗口可能强制圆角，但透明窗口的外框不可见，
    // 实测无从观测、也不构成问题。
    let _ = window.set_shadow(false);

    // 穿透的初值必须是「开」。
    //
    // 窗口在前端做出第一次命中判定之前不该截获桌面上的点击 - 那等于在用户桌面上
    // 挖了一块 216x168 的死区，是 ADR 0006 明确不接受的。前端的
    // PollingPassthrough 也把这个初值写进了它的去重逻辑，两处必须一致。
    // 顺带保证了失效方向：前端挂掉的后果是「猫点不动」，而不是「桌面被挡住」。
    if let Err(e) = set_pass_through(window, true) {
        eprintln!("[cyber-cat] 初始化点击穿透失败，宠物窗口可能挡住桌面的点击：{e}");
    }

    // 待办（ticket 14 让开规则）：
    // macOS 上还应设置 NSWindowCollectionBehavior 让猫跟随用户切换 Space，
    // 以及调整窗口层级以决定要不要盖在全屏应用之上。
    // 这两项需要 objc2-app-kit，与「让开规则」是同一件事的两面，一起做更合适。
}

/// 整窗点击穿透开关。true = 点击落到下层窗口。
///
/// **这个开关是整窗一刀切的，没有区域粒度** - 两个平台都已实机确认
/// （macOS 的 `NSWindow.ignoresMouseEvents`、Windows 的 `WS_EX_TRANSPARENT`）。
/// 「猫身上可点、其余穿透」是靠前端逐帧对 alpha 掩膜做命中测试、再调用这里实现的。
///
/// **调用方必须提前于光标抵达切换。** macOS 上赋值不是同步生效的，实测有最长约
/// 5ms 的传播延迟；在光标压到边界的那一刻才切，窗口服务器可能仍在用旧状态处理
/// 这次点击。前端的 hit.ts 用「按速度沿运动方向前探的外扩边距」来满足这一点。
///
/// 目前两个平台的实现相同，所以没有条件编译。**后续替换点在这里**：
/// Windows 上更稳的做法是原生 `WM_NCHITTEST` 或 `SetWindowRgn`，由系统逐次回调
/// 命中测试，彻底消除轮询竞争。届时在本模块里加 `set_hit_mask(window, mask)`
/// 把掩膜下推，前端只需换掉 `PassthroughController` 的实现，
/// 判定逻辑（hit.ts）与帧循环都不用动。
pub fn set_pass_through(window: &WebviewWindow, on: bool) -> Result<(), String> {
    window
        .set_ignore_cursor_events(on)
        .map_err(|e| e.to_string())
}

/// 光标相对宠物窗口客户区左上角的位置，单位是**逻辑像素**（点）。
///
/// 相减在 Rust 侧做完，不让前端分两次 IPC 各取一半：两次调用之间窗口可能已经
/// 移动（猫会自己走，用户也会拖），错位会让命中判定整体偏移。
///
/// 返回逻辑像素而不是物理像素，是为了让前端能直接跟 canvas 的 CSS 尺寸做换算 -
/// 那是同一个坐标系。走物理像素就得让前端再乘一次 `devicePixelRatio`，
/// 而 webview 的 dpr 与窗口的 `scale_factor` 并不保证相等（混合 DPI 多屏尤其）。
///
/// `cursor_position()` 给的确实是**物理像素**（等于「桌面左上角为原点的逻辑坐标」
/// 乘 scale_factor），所以这里除以 scale_factor 才对。这一点在 macOS 15.5、
/// 单屏 1920x1080@2x 上用独立的 AppKit 读数（`NSEvent.mouseLocation`）逐点对照
/// 过，两者按位相等；不要凭 `PhysicalPosition` 这个类型名想当然。
pub fn cursor_in_window(window: &WebviewWindow) -> Result<(f64, f64), String> {
    let cursor = window.cursor_position().map_err(|e| e.to_string())?;
    // inner_position 是客户区原点，也就是 webview 的 (0, 0)。无边框窗口下它通常
    // 与 outer_position 相同，但不保证，所以不能用后者。
    let origin = window.inner_position().map_err(|e| e.to_string())?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    Ok((
        (cursor.x - f64::from(origin.x)) / scale,
        (cursor.y - f64::from(origin.y)) / scale,
    ))
}

/// 挂件窗口创建后的平台设置。
///
/// 与宠物窗口同样的两条：关阴影、穿透初值为「开」。
/// 穿透初值尤其不能省 - 挂件窗口是贴图的包围盒，四角是透明的，
/// 前端做出第一次命中判定之前不该截获桌面上的点击（ADR 0006）。
/// 前端挂掉的后果是「挂件点不动」，而不是「桌面上多了两块死区」。
pub fn configure_prop_window(window: &WebviewWindow) {
    let _ = window.set_shadow(false);
    if let Err(e) = set_pass_through(window, true) {
        eprintln!("[cyber-cat] 初始化挂件穿透失败，它可能挡住桌面的点击：{e}");
    }
}

/// 读窗口自己的几何与桌面工作区。
///
/// **一律用窗口自己的 `scale_factor` 换算成逻辑像素**，而不是显示器的 -
/// 前端拿到的值要和 `window.innerWidth` / CSS 像素同一个坐标系，那个坐标系由
/// webview 所在窗口的缩放决定。混合 DPI 多屏下两者可能不同，跨屏漫游是 MVP 之后
/// 的事（mvp-scope 第 10 节），届时这里要改成按目标屏的 scale 换算。
///
/// 取不到显示器信息时用窗口自身矩形兜底：猫会只在当前窗口范围内活动，
/// 失效方向是「活动范围变小」而不是「走到屏幕外看不见」。
pub fn stage_metrics(window: &WebviewWindow) -> Result<StageMetrics, String> {
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let origin = window.inner_position().map_err(|e| e.to_string())?;
    let size = window.inner_size().map_err(|e| e.to_string())?;
    let x = f64::from(origin.x) / scale;
    let y = f64::from(origin.y) / scale;
    let w = f64::from(size.width) / scale;
    let h = f64::from(size.height) / scale;

    let (work_x, work_y, work_w, work_h) = match window.current_monitor() {
        Ok(Some(monitor)) => {
            let area = monitor.work_area();
            (
                f64::from(area.position.x) / scale,
                f64::from(area.position.y) / scale,
                f64::from(area.size.width) / scale,
                f64::from(area.size.height) / scale,
            )
        }
        _ => (x, y, w, h),
    };

    Ok(StageMetrics {
        x,
        y,
        w,
        h,
        work_x,
        work_y,
        work_w,
        work_h,
    })
}

/// 把窗口的**客户区原点**挪到桌面上的某个逻辑坐标。
///
/// 舞台窗口只在猫走到边缘时才调（带滞后，见 src/app/motion.ts）；
/// 挂件窗口只在摆放变化时调。窗口位置变更是跨进程的窗口服务器操作，
/// 每帧调既贵又会与合成不同步产生抖动。
///
/// `set_position` 设的是**外框**原点，所以要减掉客户区相对外框的偏移。
/// 无边框窗口下两者通常相同，但这条不保证 - 差一次就会让猫和光标的换算整体偏移。
pub fn move_window(window: &WebviewWindow, x: f64, y: f64) -> Result<(), String> {
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let inner = window.inner_position().map_err(|e| e.to_string())?;
    let outer = window.outer_position().map_err(|e| e.to_string())?;
    let inset_x = f64::from(inner.x - outer.x) / scale;
    let inset_y = f64::from(inner.y - outer.y) / scale;
    window
        .set_position(LogicalPosition::new(x - inset_x, y - inset_y))
        .map_err(|e| e.to_string())
}

/// 把窗口的客户区改成给定的逻辑尺寸。
///
/// 只有日记窗口用得到：它自绘了标题栏，于是**四边的系统缩放框在 Windows 上没了**
/// （tao 给无边框窗口摘掉 `WS_THICKFRAME`），右下角那个把手是唯一的缩放入口。
/// 由前端按指针位移算出尺寸再调这里 - 与挂件拖拽同一条做法（见 src/chrome/resize.ts）。
pub fn resize_window(window: &WebviewWindow, w: f64, h: f64) -> Result<(), String> {
    window
        .set_size(LogicalSize::new(w, h))
        .map_err(|e| e.to_string())
}

/// 摆放一个挂件窗口：先挪到位，再决定显示还是隐藏。
///
/// **顺序不能颠倒。** 先显示后挪位置的话，用户会看到挂件在屏幕上跳一下 -
/// 与宠物窗口「摆好位置再 show」是同一条经验（见 pet_ready 的注释）。
///
/// 挪不动不阻止显示：挂件留在默认位置也比不出现好，但要报出来 -
/// 猫的落点是按前端记的位置算的，位置不对会出现「猫走到一个空地方吃饭」。
pub fn place_prop(window: &WebviewWindow, x: f64, y: f64, visible: bool) -> Result<(), String> {
    if let Err(e) = move_window(window, x, y) {
        eprintln!("[cyber-cat] 挪动挂件窗口失败，它会留在原处：{e}");
    }
    if visible {
        window.show().map_err(|e| e.to_string())
    } else {
        window.hide().map_err(|e| e.to_string())
    }
}


// ---------------------------------------------------------------------------
// 键盘活跃探测（逗猫棒的「打字免打扰」闸门，issue #11）
// ---------------------------------------------------------------------------

/// macOS：距上一次按键过了多少秒。
///
/// 用 `CGEventSourceSecondsSinceLastEventType` 而不是事件监听（CGEventTap）：
/// **这是查询，不需要辅助功能授权**，已实测确认（未签名的命令行程序也能拿到真实值）。
/// 事件监听那条路要授权，会破坏 ADR 0005 的「两个平台都不需要任何用户授权」。
///
/// 用裸 FFI 而不是引 `core-graphics` crate：只用一个函数，为它拖进一整棵依赖树不值得。
#[cfg(target_os = "macos")]
fn keyboard_idle_seconds() -> Option<f64> {
    /// kCGEventSourceStateCombinedSessionState = 0。整个登录会话的合并状态，
    /// 不是本进程的 - 我们要知道的是「用户在别的应用里打字」。
    const COMBINED_SESSION_STATE: u32 = 0;
    /// kCGEventKeyDown = 10。
    const EVENT_KEY_DOWN: u32 = 10;

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceSecondsSinceLastEventType(state: u32, event_type: u32) -> f64;
    }

    // SAFETY: 纯查询，两个参数都是常量枚举值，没有指针也没有所有权转移。
    let secs = unsafe { CGEventSourceSecondsSinceLastEventType(COMBINED_SESSION_STATE, EVENT_KEY_DOWN) };
    if secs.is_finite() && secs >= 0.0 {
        Some(secs)
    } else {
        None
    }
}

/// Windows：距上一次**任何输入**过了多少秒。
///
/// `GetLastInputInfo` 不区分键盘与鼠标，所以这边的语义比 macOS 粗：鼠标动了也算
/// 「用户在忙」。**失效方向是安全的** - 猫会更安静，而不是更烦人。
/// 想精确区分就得装键盘钩子，那属于「拦截键盘输入」，是 mvp-scope 第 9 节明确不做的事。
///
/// **未在真机验证**（开发机是 macOS）。
#[cfg(target_os = "windows")]
fn keyboard_idle_seconds() -> Option<f64> {
    #[repr(C)]
    struct LastInputInfo {
        cb_size: u32,
        d_w_time: u32,
    }

    #[link(name = "user32")]
    extern "system" {
        fn GetLastInputInfo(plii: *mut LastInputInfo) -> i32;
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GetTickCount() -> u32;
    }

    let mut info = LastInputInfo {
        cb_size: std::mem::size_of::<LastInputInfo>() as u32,
        d_w_time: 0,
    };
    // SAFETY: cb_size 按文档填好，指针指向栈上一个存活的结构体。
    let ok = unsafe { GetLastInputInfo(&mut info) };
    if ok == 0 {
        return None;
    }
    // SAFETY: 无参数查询。
    let now = unsafe { GetTickCount() };
    // 计数器 49.7 天回绕一次，用 wrapping_sub 才不会在回绕那一刻算出巨大值。
    Some(f64::from(now.wrapping_sub(info.d_w_time)) / 1000.0)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn keyboard_idle_seconds() -> Option<f64> {
    None
}

/// 距用户上一次按键多少秒。探测失败返回 None。
///
/// 调用方（前端）必须把 None 当成「用户正在打字」而不是「用户闲着」：
/// 探测不出来时宁可让猫安静，不要让它在用户打字时扑光标。
pub fn input_idle() -> Option<f64> {
    keyboard_idle_seconds()
}
