//! 平台差异 shim。
//!
//! 所有 `#[cfg(target_os = ...)]` 都关在这一个模块里 - 世界层与渲染层看不到
//! 平台条件编译（见 mvp-scope 的架构分层）。
//!
//! 已实测的平台事实见：
//! - docs/research/2026-07-29-macos-hit-test/report.md
//! - docs/research/2026-07-29-windows-transparent-window/report.md

use tauri::{App, WebviewWindow};

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

/// 宠物窗口创建后的平台设置。
pub fn configure_pet_window(window: &WebviewWindow) {
    // 阴影已在配置里关掉，这里再显式设一次以防配置被改动。
    // Windows 11 对无边框窗口可能强制圆角，但透明窗口的外框不可见，
    // 实测无从观测、也不构成问题。
    let _ = window.set_shadow(false);

    // 待办（ticket 14 让开规则）：
    // macOS 上还应设置 NSWindowCollectionBehavior 让猫跟随用户切换 Space，
    // 以及调整窗口层级以决定要不要盖在全屏应用之上。
    // 这两项需要 objc2-app-kit，与「让开规则」是同一件事的两面，一起做更合适。
}
