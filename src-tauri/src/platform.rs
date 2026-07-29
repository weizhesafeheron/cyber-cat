//! 平台差异 shim。
//!
//! 所有 `#[cfg(target_os = ...)]` 都关在这一个模块里 - 世界层与渲染层看不到
//! 平台条件编译（见 mvp-scope 的架构分层）。
//!
//! 已实测的平台事实见：
//! - docs/research/2026-07-29-macos-hit-test/report.md
//! - docs/research/2026-07-29-windows-transparent-window/report.md

use tauri::{App, LogicalPosition, WebviewWindow};

/// 舞台窗口的几何读数，全部是**逻辑像素**（点）。
///
/// 一次 IPC 把窗口位置、尺寸与桌面工作区一起给出去：前端要用它们做减法
/// （猫的屏幕位置 = 舞台位置 + 舞台内位置），分几次取会拿到不同时刻的值。
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

/// 读舞台窗口的几何与桌面工作区。
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

/// 把舞台窗口的**客户区原点**挪到桌面上的某个逻辑坐标。
///
/// 前端只在猫走到舞台边缘时才调（带滞后，见 src/app/motion.ts）。
/// 窗口位置变更是跨进程的窗口服务器操作，每帧调既贵又会与合成不同步产生抖动。
///
/// `set_position` 设的是**外框**原点，所以要减掉客户区相对外框的偏移。
/// 无边框窗口下两者通常相同，但这条不保证 - 差一次就会让猫和光标的换算整体偏移。
pub fn move_stage(window: &WebviewWindow, x: f64, y: f64) -> Result<(), String> {
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let inner = window.inner_position().map_err(|e| e.to_string())?;
    let outer = window.outer_position().map_err(|e| e.to_string())?;
    let inset_x = f64::from(inner.x - outer.x) / scale;
    let inset_y = f64::from(inner.y - outer.y) / scale;
    window
        .set_position(LogicalPosition::new(x - inset_x, y - inset_y))
        .map_err(|e| e.to_string())
}
