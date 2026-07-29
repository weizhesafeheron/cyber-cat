//! 告别页窗口。
//!
//! 与领养窗口同构（adopt.rs）：**小尺寸、居中、用完即关、不常驻**
//! （mvp-scope 第 7 节）。所以它也不写在 tauri.conf.json 的 windows 里 -
//! 配置里声明的窗口每次启动都会建出来，而绝大多数启动的猫都活得好好的。
//!
//! 这一层不认识告别的内容：陪伴记录、一生日记、猫的档案全在 TypeScript 侧
//! （src/farewell/ 与 src/memorial/），页面自己去读 memorial.json。
//! Rust 只管窗口生命周期。
//!
//! **与领养窗口有一处刻意的不同：关掉告别页不退出应用。**
//! 领养没走完就没有猫可养，留一个空进程只会让人以为应用坏了；
//! 而告别页关掉之后应用仍然有事可做（托盘里还能再打开它、还能领养新猫），
//! 而且猫已经死了，退出应用等于把「再养一只」这条路也一起关掉。

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

use crate::adopt::ADOPT_LABEL;
use crate::platform;

/// 告别页窗口的 label。capabilities/farewell.json 里也列着它，两处必须一致。
pub const FAREWELL_LABEL: &str = "farewell";

/// 打开告别页。尺寸由前端给（src/farewell/constants.ts），这里只负责居中建窗。
///
/// 幂等：已经开着就把它带到前面。宠物窗口在两条路上都会调它 -
/// 刚发现猫死了，以及用户从托盘再打开一次。
#[tauri::command]
pub fn open_farewell(app: AppHandle, width: f64, height: f64) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window(FAREWELL_LABEL) {
        let _ = existing.set_focus();
        return Ok(());
    }

    // macOS 上应用平时是附属模式（不进程序坞、不进 Cmd-Tab）。告别页要能被点、
    // 能滚动日记，而附属应用的窗口拿焦点不可靠 - 与领养窗口同一条理由。
    platform::set_foreground_app(&app, true);

    let window = WebviewWindowBuilder::new(
        &app,
        FAREWELL_LABEL,
        WebviewUrl::App("farewell.html".into()),
    )
    .title("它离开了")
    .inner_size(width, height)
    .center()
    // 不可缩放：里面两块列表各自滚动，窗口尺寸是按内容排好的（见 constants.ts）。
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .focused(true)
    // 与另外两种窗口同一条防白闪的路子：先隐藏，前端画完第一帧再由 content_ready
    // 显示（ADR 0003）。告别页是深色的，白底闪一下格外突兀。
    .visible(false)
    .build()
    .map_err(|e| format!("创建告别页窗口失败：{e}"))?;

    let handle = app.clone();
    window.on_window_event(move |event| {
        if !matches!(event, WindowEvent::Destroyed) {
            return;
        }
        // 切回附属模式，但**领养窗口已经开着时不要切**。
        //
        // 「再养一只」这条路上两件事几乎同时发生：告别页关掉，领养窗口打开。
        // 顺序取决于事件送达的时机，而领养要打字 - 在领养窗口之后把激活策略切回
        // 附属模式，会让输入框拿不到键盘焦点，症状是「名字打不进去」。
        // 判断一次窗口是否存在比排顺序可靠：这里是唯一切回附属模式的地方，
        // 不管用户是自己关掉窗口还是点了「再养一只」，都会走到。
        if handle.get_webview_window(ADOPT_LABEL).is_none() {
            platform::set_foreground_app(&handle, false);
        }
    });

    Ok(())
}

/// 关掉告别页。由告别页在报出「再养一只」之后调用，用户也可以自己关窗。
///
/// **不在这里切激活策略** - 那件事交给 Destroyed 处理器，见上面的注释：
/// 只有一处切换才不会与领养窗口打架。
#[tauri::command]
pub fn close_farewell(app: AppHandle) -> Result<(), String> {
    match app.get_webview_window(FAREWELL_LABEL) {
        Some(window) => window.close().map_err(|e| format!("关闭告别页失败：{e}")),
        // 已经关了：不算错误。
        None => Ok(()),
    }
}
