//! CYBER-CAT 桌面宠物。
//!
//! 这一层只负责窗口、托盘、存档读写与平台适配。猫的状态与外观分别由世界层与
//! 渲染层（TypeScript 侧）负责，两者都是平台无关的纯逻辑。
//!
//! 特别是：**世界的演化一步都不在 Rust 里发生。** 托盘上的「喂食」也只是往前端
//! 发一个事件，由它作为一次用户动作走进同一个 `step`。多一条改状态的路，
//! 离线推演的等价性就没法再保证了（ADR 0001）。

mod platform;
mod save;
mod tray;

use tauri::{Manager, WebviewWindow};

/// 前端渲染出第一帧后调用，此时才显示窗口。
///
/// **这是防止启动白闪的唯一手段，不是可选的优化。**
/// Tauri 2.11.5 既没有 `noRedirectionBitmap` 配置项也没有对应的构建器方法
/// （底层 tao 有 `with_no_redirection_bitmap`，但 tauri-runtime-wry 没有透传）。
/// 所以只能靠「窗口以 visible: false 启动、内容就绪后才 show」这条框架无关的路子 -
/// 窗口在有内容之前根本不存在，也就无从闪烁。
///
/// 如果哪天改掉这个流程，Windows 上的启动白闪会立刻回来。
#[tauri::command]
fn pet_ready(window: WebviewWindow) {
    if let Err(e) = window.show() {
        eprintln!("[cyber-cat] 显示宠物窗口失败：{e}");
    }
}

/// 光标相对宠物窗口客户区左上角的位置，逻辑像素。返回 `[x, y]`。
///
/// 前端每 16 到 64ms 调一次（见 src/app/cursor.ts）。**穿透开启期间 webview
/// 收不到任何鼠标事件**，所以这是那段时间里唯一的光标位置来源。
#[tauri::command]
fn cursor_probe(window: WebviewWindow) -> Result<(f64, f64), String> {
    platform::cursor_in_window(&window)
}

/// 切换整窗点击穿透。语义与约束见 `platform::set_pass_through`。
#[tauri::command]
fn set_pass_through(window: WebviewWindow, on: bool) -> Result<(), String> {
    platform::set_pass_through(&window, on)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            pet_ready,
            cursor_probe,
            set_pass_through,
            save::save_world,
            save::load_world,
            tray::update_tray
        ])
        .setup(|app| {
            platform::configure_app(app);

            match app.get_webview_window("pet") {
                Some(pet) => platform::configure_pet_window(&pet),
                // 配置里写死了 label=pet，取不到说明配置被改坏了，
                // 此时窗口永远不会显示，必须让它可见地失败而不是静默。
                None => eprintln!("[cyber-cat] 严重：找不到 label=pet 的窗口，猫不会出现"),
            }

            tray::build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("启动 CYBER-CAT 失败");
}
