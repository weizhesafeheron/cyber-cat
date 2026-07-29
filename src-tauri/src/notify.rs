//! 系统通知。
//!
//! **只有生病这一级会发**（issue #13）。什么时候发、说什么，全部在前端决定
//! （src/app/notify.ts 的 sicknessNotice，有测试）- 这一层只把标题与正文交给系统。
//!
//! 为什么由前端调一个自己的命令、而不是直接用插件的 JS API：
//! 那样要给 webview 配 notification 的 ACL 权限，并多一个 npm 依赖；
//! 而 Rust 侧本来就要 init 这个插件。少一条路径就少一处会漏配的地方。

use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

/// 发一条系统通知。
///
/// 通知发不出去**不该是个错误**：用户可能在系统设置里关掉了本应用的通知，
/// 那是他的选择。所以这里只在失败时打印一行，命令本身照样返回成功 -
/// 前端拿到错误也做不了任何有意义的事，只会在控制台里刷屏。
#[tauri::command]
pub fn notify(app: AppHandle, title: String, body: String) {
    if let Err(e) = app.notification().builder().title(title).body(body).show() {
        eprintln!("[cyber-cat] 发送系统通知失败（可能是用户关掉了通知权限）：{e}");
    }
}
