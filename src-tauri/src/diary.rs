//! 猫咪日记窗口。
//!
//! 和领养窗口一样是**按需建、用完即关**（mvp-scope 第 7 节），所以不写在
//! tauri.conf.json 的 windows 里 - 配置里声明的窗口每次启动都会建出来（哪怕
//! visible: false，webview 也已经加载），而绝大多数启动根本不会打开日记。
//!
//! 这一层不认识日记的内容：文案渲染、分组、性格分岔全在 TypeScript 侧
//! （src/diary/）。日记窗口自己去读存档文件，宠物窗口不需要把状态推给它 -
//! 日记是**只读**的一页，多一条状态通路只会多一处能不一致的地方。

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

use crate::platform;

/// 日记窗口的 label。capabilities/default.json 里也列着它，两处必须一致。
pub const DIARY_LABEL: &str = "diary";

/// 打开日记窗口。
///
/// 尺寸由前端给：窗口该多大取决于里面放什么，那是呈现层的判断
/// （src/diary/constants.ts）。这里只负责居中建窗。
///
/// **两个入口共用这一个命令**：托盘菜单的「猫咪日记」，以及猫头顶那个可点的
/// 回归气泡。两者点开的是同一页，不该有两套窗口生命周期。
#[tauri::command]
pub fn open_diary(app: AppHandle, width: f64, height: f64) -> Result<(), String> {
    // 已经开着就把它拿到前面来，不再建第二个。托盘与气泡可能被连着点两次。
    if let Some(existing) = app.get_webview_window(DIARY_LABEL) {
        let _ = existing.unminimize();
        let _ = existing.set_focus();
        return Ok(());
    }

    // macOS 上应用平时是附属模式（不进程序坞、不进 Cmd-Tab，见 platform::configure_app），
    // 而附属应用的窗口拿不到可靠的键盘焦点 - 日记要能滚动、要能按 Esc 关掉。
    // 所以打开期间临时切回普通应用，窗口销毁时切回来。
    platform::set_foreground_app(&app, true);

    let window = WebviewWindowBuilder::new(&app, DIARY_LABEL, WebviewUrl::App("diary.html".into()))
        .title("猫咪日记")
        .inner_size(width, height)
        .center()
        // 可缩放：日记是一列文字，用户想拉长看更多天是合理的。
        // 但给一个下限 - 再窄下去每行会断成两三截。
        .resizable(true)
        .min_inner_size(320.0, 320.0)
        .maximizable(false)
        .focused(true)
        // 不置顶。日记是一页可以慢慢看的东西，不是提示 - 压在用户所有窗口之上
        // 就成了另一种打断（ADR 0004 的「不打断用户」）。
        .always_on_top(false)
        // 与宠物窗口、领养窗口同一条防白闪的路子：先隐藏，前端画完第一屏
        // 再由 content_ready 显示（ADR 0003）。日记页是深色的。
        .visible(false)
        .build()
        .map_err(|e| format!("创建日记窗口失败：{e}"))?;

    let handle = app.clone();
    window.on_window_event(move |event| {
        if !matches!(event, WindowEvent::Destroyed) {
            return;
        }
        // 关掉日记就把 macOS 的激活策略切回附属模式，否则程序坞里会留下一个图标，
        // 而这个应用本该只在菜单栏出现。
        platform::set_foreground_app(&handle, false);
    });

    Ok(())
}

/// 关掉日记窗口。由日记页自己调（按 Esc）。
///
/// 走 Rust 而不是前端的 `getCurrentWindow().close()`：关窗需要额外的窗口权限，
/// 而销毁事件里那件事（切回附属模式）本来就在这一层。
/// 窗口已经没了不算错误 - 用户可能先点了标题栏的关闭按钮。
#[tauri::command]
pub fn close_diary(app: AppHandle) -> Result<(), String> {
    match app.get_webview_window(DIARY_LABEL) {
        Some(window) => window.close().map_err(|e| format!("关闭日记窗口失败：{e}")),
        None => Ok(()),
    }
}
