//! 领养窗口。
//!
//! 一次性流程的小窗口：**居中、用完即关、不常驻**（mvp-scope 第 7 节）。
//! 所以它不写在 tauri.conf.json 的 windows 里 - 配置里声明的窗口每次启动都会
//! 建出来（哪怕 visible: false，webview 也已经加载），而有存档的启动根本不需要它。
//!
//! 这一层不认识领养的内容：挑猫、起名、身份载荷全在 TypeScript 侧
//! （src/adopt/），身份是通过一条事件通道交回宠物窗口的。Rust 只管窗口生命周期。

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder, WindowEvent};

use crate::platform;

/// 领养窗口的 label。capabilities/default.json 里也列着它，两处必须一致。
pub const ADOPT_LABEL: &str = "adopt";

/// 领养有没有走完。
///
/// 窗口被销毁时靠它区分两种情况：用户选完了（我们自己关的），
/// 还是用户把窗口关掉了（那就没有猫可养，应用该退出）。
#[derive(Default)]
pub struct AdoptionDone(AtomicBool);

/// 用户放弃领养时是否该退出应用。见 `open_adoption` 的 `exit_on_cancel`。
#[derive(Default)]
pub struct ExitOnCancel(AtomicBool);

/// 打开领养窗口。
///
/// 尺寸由前端给：窗口该多大取决于里面放什么，那是呈现层的判断
/// （src/adopt/constants.ts）。这里只负责居中建窗。
///
/// `exit_on_cancel` 是「用户关掉这个窗口时应用该不该退出」，由前端给，
/// 因为只有它知道**现在有没有别的路可走**：
/// - 首次启动：没有猫，宠物窗口还是隐藏的，留一个只有托盘的空进程会让人以为
///   应用坏了 → 退出。
/// - 告别页之后再领养：桌面上有托盘，托盘里还能再打开告别页 → 用户只是改了主意，
///   什么都不该发生。这条路上退出应用等于因为一次犹豫就把整个应用关掉。
// Windows 必须让命令先退出 WebView2 的 postMessage 回调再建第二个 WebView，
// 否则新窗口会卡在 about:blank。macOS 保持原来的同步命令路径。
#[cfg_attr(target_os = "windows", tauri::command(async))]
#[cfg_attr(not(target_os = "windows"), tauri::command)]
pub fn open_adoption(
    app: AppHandle,
    width: f64,
    height: f64,
    exit_on_cancel: bool,
) -> Result<(), String> {
    // 重复调用不再建一个：宠物窗口只会调一次，但让它幂等比让它出两个窗口好。
    if let Some(existing) = app.get_webview_window(ADOPT_LABEL) {
        let _ = existing.set_focus();
        return Ok(());
    }

    // 每次开窗都从「还没走完」开始。**告别页之后领养新猫会第二次走到这里**
    // （farewell.rs），那时残留的旗子会让「关掉窗口就退出」失效 -
    // 用户关掉第二次的领养窗口，应用会以为领养成功而留下来，但没有新猫。
    app.state::<AdoptionDone>().0.store(false, Ordering::SeqCst);
    app.state::<ExitOnCancel>()
        .0
        .store(exit_on_cancel, Ordering::SeqCst);

    // macOS 上应用平时是附属模式（不进程序坞、不进 Cmd-Tab），而领养要打字。
    // 附属应用的窗口拿键盘焦点是不可靠的，所以领养期间临时切回普通应用。
    platform::set_foreground_app(&app, true);

    let window = WebviewWindowBuilder::new(&app, ADOPT_LABEL, WebviewUrl::App("adopt.html".into()))
        .title("有猫停在你面前")
        .inner_size(width, height)
        .center()
        // 不可缩放：里面的雨夜画面按固定尺寸排的，拉大只会露出空白。
        .resizable(false)
        // 无边框：标题栏由页面自己画（src/chrome/）。见 docs/adr/0013-自绘标题栏.md。
        // 系统那条灰色渐变条压在深蓝雨夜上面，是这一页唯一一处与配色断开的地方。
        .decorations(false)
        .maximizable(false)
        .minimizable(false)
        .focused(true)
        // 与宠物窗口同一条防白闪的路子：先隐藏，前端画完第一帧再由 content_ready
        // 显示（ADR 0003）。领养页是深色雨夜，白底闪一下比在透明窗口上更显眼。
        .visible(false)
        .build()
        .map_err(|e| format!("创建领养窗口失败：{e}"))?;

    let handle = app.clone();
    window.on_window_event(move |event| {
        if !matches!(event, WindowEvent::Destroyed) {
            return;
        }
        if handle.state::<AdoptionDone>().0.load(Ordering::SeqCst) {
            return;
        }
        // 领养没走完就被关掉。切回附属模式一定要做（否则程序坞里留下一个图标），
        // 退不退出则看 exit_on_cancel。
        platform::set_foreground_app(&handle, false);
        if !handle.state::<ExitOnCancel>().0.load(Ordering::SeqCst) {
            eprintln!("[cyber-cat] 领养窗口被关掉了，保持运行 - 托盘里还能再打开告别页");
            return;
        }
        eprintln!("[cyber-cat] 领养窗口被关掉了，没有猫可养，退出");
        handle.exit(0);
    });

    Ok(())
}

/// 放弃领养：用户点了自绘标题栏上的关闭按钮。
///
/// 与 `close_adoption` 只差一件事：**不立 `AdoptionDone` 那面旗子**。
/// 旗子的含义是「领养走完了」，而这里恰恰是没走完，所以窗口销毁时的处理器要照常
/// 执行放弃该做的事 - 切回附属模式，首次启动还要退出应用。
///
/// 有了自绘标题栏之后这条路才需要一个命令：以前用户是点系统的交通灯关窗，
/// 那条路根本不经过前端。
#[tauri::command]
pub fn cancel_adoption(app: AppHandle) -> Result<(), String> {
    match app.get_webview_window(ADOPT_LABEL) {
        Some(window) => window.close().map_err(|e| format!("关闭领养窗口失败：{e}")),
        // 已经没有窗口了：用户可能同时按了别的什么。不算错误。
        None => Ok(()),
    }
}

/// 关掉领养窗口。由领养窗口在把身份交回宠物窗口之后调用。
///
/// 顺带把 macOS 的激活策略切回附属模式 - 这两件事必须一起做：
/// 只关窗口的话程序坞里会留下一个图标，而这个应用本该只在菜单栏出现。
#[tauri::command]
pub fn close_adoption(app: AppHandle, done: State<'_, AdoptionDone>) -> Result<(), String> {
    // 先立旗再关窗：关窗会同步触发 Destroyed，旗子立晚了应用就退出了。
    done.0.store(true, Ordering::SeqCst);
    platform::set_foreground_app(&app, false);
    match app.get_webview_window(ADOPT_LABEL) {
        Some(window) => window.close().map_err(|e| format!("关闭领养窗口失败：{e}")),
        // 已经没有窗口了（用户先关了它）：不算错误，身份已经交出去了。
        None => Ok(()),
    }
}
