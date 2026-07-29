//! CYBER-CAT 桌面宠物。
//!
//! 这一层只负责窗口、托盘、存档读写与平台适配。猫的状态与外观分别由世界层与
//! 渲染层（TypeScript 侧）负责，两者都是平台无关的纯逻辑。
//!
//! 特别是：**世界的演化一步都不在 Rust 里发生。** 托盘上的「喂食」也只是往前端
//! 发一个事件，由它作为一次用户动作走进同一个 `step`。多一条改状态的路，
//! 离线推演的等价性就没法再保证了（ADR 0001）。

mod adopt;
mod diary;
mod farewell;
mod notify;
mod platform;
mod save;
mod tray;

use tauri::{AppHandle, Manager, WebviewWindow};

/// 前端渲染出第一帧后调用，此时才显示窗口。
///
/// **这是防止启动白闪的唯一手段，不是可选的优化。**
/// Tauri 2.11.5 既没有 `noRedirectionBitmap` 配置项也没有对应的构建器方法
/// （底层 tao 有 `with_no_redirection_bitmap`，但 tauri-runtime-wry 没有透传）。
/// 所以只能靠「窗口以 visible: false 启动、内容就绪后才 show」这条框架无关的路子 -
/// 窗口在有内容之前根本不存在，也就无从闪烁。
///
/// 显示的是**调用方自己那个窗口**，所以四个窗口（宠物、领养、日记、告别）共用这一个命令。
/// 领养窗口尤其需要它：那一页是深色的雨夜，白底闪一下比在透明窗口上更显眼。
/// 都必须**同步画完第一帧再调**，不能放进 requestAnimationFrame -
/// rAF 对隐藏窗口不触发，那样会死锁在「窗口永远不显示」上（踩过）。
///
/// 如果哪天改掉这个流程，Windows 上的启动白闪会立刻回来。
///
/// `focus` 决定显示之后要不要抢焦点并置前，**由调用方自己声明**：
/// - 宠物窗口传 false。它是桌面宠物，抢焦点等于打断用户正在做的事。
/// - 领养、日记、告别页传 true。它们是用户主动打开的一页，不在前面等于没打开。
///
/// **建窗时的 `.focused(true)` 对这条路径无效**，这是踩过的坑：窗口是以
/// `visible: false` 建的（防白闪），等第一屏画完才 show，而那时 build 时的
/// 聚焦意图早就过期了，`show()` 本身既不聚焦也不置前。
/// 症状是「点了托盘的日记，什么都没出现」- 窗口其实开在了别的窗口后面。
#[tauri::command]
fn content_ready(window: WebviewWindow, focus: bool) {
    if let Err(e) = window.show() {
        eprintln!("[cyber-cat] 显示窗口 {} 失败：{e}", window.label());
    }
    if !focus {
        return;
    }
    if let Err(e) = window.set_focus() {
        eprintln!("[cyber-cat] 聚焦窗口 {} 失败：{e}", window.label());
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

/// 舞台窗口的几何与桌面工作区，逻辑像素。见 `platform::stage_metrics`。
#[tauri::command]
fn stage_metrics(window: WebviewWindow) -> Result<platform::StageMetrics, String> {
    platform::stage_metrics(&window)
}

/// 当前前台窗口的可见矩形，逻辑像素。见 `platform::foreground_window`。
///
/// 前端每 100ms（猫在动时）到 500ms（猫趴着时）问一次，睡眠与锁屏时不问 -
/// 轮询由帧循环驱动，而 rAF 对隐藏窗口不触发（见 src/app/foreground.ts）。
#[tauri::command]
fn foreground_window(
    window: WebviewWindow,
) -> Result<Option<platform::ForegroundWindow>, String> {
    platform::foreground_window(&window)
}

/// 把舞台挪到桌面上的某个位置。**只在猫走到舞台边缘时调**，见 `platform::move_window`。
#[tauri::command]
fn move_stage(window: WebviewWindow, x: f64, y: f64) -> Result<(), String> {
    platform::move_window(&window, x, y)
}

// --- 桌面挂件（ticket 08）------------------------------------------------
//
// 三个命令都由前端驱动：摆放存档在前端（屏幕坐标不能进世界存档），
// 世界状态也只有宠物窗口持有。这一层只负责动窗口。

/// 挂件窗口的标签。**必须与 tauri.conf.json 里的 label 及前端的 propWindowLabel 一致。**
fn prop_label(kind: &str) -> String {
    format!("prop-{kind}")
}

/// 摆放一个挂件窗口：挪到位并决定显示还是隐藏。见 `platform::place_prop`。
///
/// 挂件的拖动**不走系统的拖拽循环**，也是经这条命令一步步挪的：挂件只允许横向
/// 移动（它是放在地上的东西，纵向由地面线决定），而系统拖拽两个方向都自由。
#[tauri::command]
fn place_prop(app: AppHandle, kind: String, x: f64, y: f64, visible: bool) -> Result<(), String> {
    let label = prop_label(&kind);
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("找不到挂件窗口 {label}"))?;
    platform::place_prop(&window, x, y, visible)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 唯一的插件。**只有生病这一级会发通知**（issue #13），理由见 notify.rs
        // 与 Cargo.toml 里那段被否决的自己实现。
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            content_ready,
            cursor_probe,
            set_pass_through,
            stage_metrics,
            move_stage,
            foreground_window,
            adopt::open_adoption,
            adopt::close_adoption,
            farewell::open_farewell,
            farewell::close_farewell,
            notify::notify,
            diary::open_diary,
            diary::close_diary,
            place_prop,
            save::save_world,
            save::load_world,
            save::save_props,
            save::load_props,
            save::save_memorial,
            save::load_memorial,
            tray::update_tray,
            tray::update_prop_menu
        ])
        .setup(|app| {
            platform::configure_app(app);
            // 领养是否走完的标记。窗口被销毁时靠它区分「选完了」与「被关掉了」。
            app.manage(adopt::AdoptionDone::default());
            // 放弃领养时该不该退出应用。首次启动该退，告别页之后再领养不该退。
            app.manage(adopt::ExitOnCancel::default());

            match app.get_webview_window("pet") {
                Some(pet) => platform::configure_pet_window(&pet),
                // 配置里写死了 label=pet，取不到说明配置被改坏了，
                // 此时窗口永远不会显示，必须让它可见地失败而不是静默。
                None => eprintln!("[cyber-cat] 严重：找不到 label=pet 的窗口，猫不会出现"),
            }

            // 两个挂件窗口同样以 visible: false 启动，由前端读完摆放存档后
            // 通过 place_prop 摆好位置再显示。取不到不阻止启动 - 没有食盆的话
            // 托盘菜单里的「喂食」仍然可用，猫照样能活。
            for kind in ["bowl", "bed"] {
                let label = prop_label(kind);
                match app.get_webview_window(&label) {
                    Some(prop) => platform::configure_prop_window(&prop),
                    None => eprintln!("[cyber-cat] 找不到挂件窗口 {label}，该挂件不会出现"),
                }
            }

            tray::build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("启动 CYBER-CAT 失败");
}
