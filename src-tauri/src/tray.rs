//! 托盘：状态与信息的唯一常驻出口。
//!
//! 菜单里的文案由前端推过来（`update_tray`），因为四条需求的数值只有世界层
//! 知道，而世界层在 TypeScript 侧。这一层只负责把字符串塞进菜单项。
//!
//! 菜单点击不在这里做业务，只往前端发一个事件 - 「添粮」「喂药」都是世界层的
//! 用户动作，必须走同一个 `step`，不能在 Rust 里另开一条改状态的路。

use std::sync::Mutex;

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::{App, AppHandle, Emitter, Manager, Runtime, State};

/// 前端点了托盘菜单里的动作项时发出的事件名。
pub const TRAY_ACTION_EVENT: &str = "tray-action";

/// 需要随猫的状态改写的菜单项。
struct TrayItems<R: Runtime> {
    summary: MenuItem<R>,
    hunger: MenuItem<R>,
    energy: MenuItem<R>,
    mood: MenuItem<R>,
    bond: MenuItem<R>,
    medicate: MenuItem<R>,
    /// 告别与档案。只有猫离开之后才可用。
    memorial: MenuItem<R>,
    /// 两个挂件的显示开关。勾选状态由前端推过来（摆放存档在那边）。
    prop_bowl: CheckMenuItem<R>,
    prop_bed: CheckMenuItem<R>,
    /// 安静模式。勾选状态由前端推过来（settings.json 在那边）。
    quiet: CheckMenuItem<R>,
}

/// 托盘菜单项的句柄。Mutex 只护一个 Option，锁的持有时间极短。
#[derive(Default)]
pub struct TrayHandles(Mutex<Option<TrayItems<tauri::Wry>>>);

/// 建托盘图标与菜单。
pub fn build(app: &App) -> tauri::Result<()> {
    // 四条需求的详情放进子菜单里「展开看」，不平铺在一级菜单上 -
    // 一级菜单要留给能点的东西。
    let hunger = MenuItem::with_id(app, "st-hunger", "饱食度 --", false, None::<&str>)?;
    let energy = MenuItem::with_id(app, "st-energy", "精力 --", false, None::<&str>)?;
    let mood = MenuItem::with_id(app, "st-mood", "心情 --", false, None::<&str>)?;
    let bond = MenuItem::with_id(app, "st-bond", "亲密度 --", false, None::<&str>)?;
    let details = Submenu::with_items(app, "状态详情", true, &[&hunger, &energy, &mood, &bond])?;

    let summary = MenuItem::with_id(app, "summary", "读取存档中……", false, None::<&str>)?;
    // 猫咪日记排在最前（CONTEXT.md 的托盘菜单顺序）：它是「我不在时它也在过日子」
    // 的唯一常驻出口，比喂食这类操作项更该先被看到。
    let diary = MenuItem::with_id(app, "diary", "猫咪日记", true, None::<&str>)?;
    let feed = MenuItem::with_id(app, "feed", "喂食", true, None::<&str>)?;
    // 喂药只在生病时可用（mvp-scope 4）：界面不该常年挂一个用不到的入口。
    // 这里的 false 只是初值（托盘在 setup 里建，那时前端还没起来）；
    // 什么时候亮由前端算，见 src/app/status.ts 的 trayStatus。
    let medicate = MenuItem::with_id(app, "medicate", "喂药", false, None::<&str>)?;
    // 告别与档案。同样是初值为灰：绝大多数启动的猫都活着。
    //
    // **这个入口不是可选的。** 告别页是个能关掉的窗口，而它同时是「无惩罚地领养
    // 新猫」的唯一入口 - 没有这一项，用户关掉告别页之后就困在一个空桌面上了。
    let memorial = MenuItem::with_id(app, "memorial", "告别与档案", false, None::<&str>)?;

    // 挂件是可隐藏的（CONTEXT.md），但藏了要能再拿回来，所以用勾选项而不是
    // 一个「隐藏」动作。初值先按默认摆放（显示），前端读完摆放存档会立刻纠正 -
    // 菜单在 setup 里建，那时前端还没起来，拿不到真正的状态。
    let prop_bowl = CheckMenuItem::with_id(app, "prop-bowl", "食盆", true, true, None::<&str>)?;
    let prop_bed = CheckMenuItem::with_id(app, "prop-bed", "猫窝", true, true, None::<&str>)?;
    let props = Submenu::with_items(app, "桌面挂件", true, &[&prop_bowl, &prop_bed])?;

    // 安静模式。用勾选项而不是两个互斥的动作项：它是一个持续的状态
    // （跨重启保持），菜单上必须一眼看出现在开着还是关着。
    // 初值 false 是因为菜单在 setup 里建，那时前端还没读到 settings.json；
    // 读完会立刻由 update_quiet_menu 纠正。
    let quiet = CheckMenuItem::with_id(app, "quiet", "安静模式", true, false, None::<&str>)?;

    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &summary,
            &diary,
            &details,
            &PredefinedMenuItem::separator(app)?,
            &feed,
            &medicate,
            &memorial,
            &props,
            &PredefinedMenuItem::separator(app)?,
            &quiet,
            &quit,
        ],
    )?;

    app.manage(TrayHandles(Mutex::new(Some(TrayItems {
        summary,
        hunger,
        energy,
        mood,
        bond,
        medicate,
        memorial,
        prop_bowl,
        prop_bed,
        quiet,
    }))));

    TrayIconBuilder::with_id("tray")
        .icon(
            app.default_window_icon()
                .expect("bundle 里应当有图标")
                .clone(),
        )
        .tooltip("CyberCat")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "quit" => {
                #[cfg(target_os = "windows")]
                {
                    // Windows 上从托盘回调里调用 `AppHandle::exit` 只会把退出请求
                    // 投递回 tao 事件循环；实机上菜单已经关闭，但请求偶尔不会被消费，
                    // 表现为点「退出」完全没反应。先让 Tauri 释放托盘、窗口与 WebView，
                    // 再结束进程，既不会留下托盘幽灵图标，也不依赖下一轮事件循环。
                    app.cleanup_before_exit();
                    std::process::exit(0);
                }
                #[cfg(not(target_os = "windows"))]
                app.exit(0);
            }
            // 挂件的显示开关也交回前端：摆放存档在那边，而且勾选状态必须与它
            // 记的那份保持一致 - 在这里直接 show/hide 会让两边漂移。
            // 日记与告别页也交回前端：窗口尺寸是呈现层的判断，而且日记还有第二个
            // 入口（猫头顶的气泡），两个入口走同一条路才不会出现两套窗口生命周期。
            // 安静模式也交回前端：它要写 settings.json、要把勾选状态推回来，
            // 而且「安静时猫做什么」全在呈现层（src/app/restraint.ts）。
            // 在这里直接记一个布尔量会让两边漂移。
            id @ ("feed" | "medicate" | "memorial" | "prop-bowl" | "prop-bed" | "diary"
            | "quiet") => {
                // 交回前端，由它作为一次 UserAction 走进 step。
                if let Err(e) = app.emit(TRAY_ACTION_EVENT, id) {
                    eprintln!("[cyber-cat] 发送托盘动作 {id} 失败：{e}");
                }
            }
            _ => {}
        })
        .build(app)?;

    Ok(())
}

/// 刷新托盘上的状态显示。
///
/// 文案整条由前端给，Rust 侧不拼字符串 - 「饱食度 82%」这种表达属于呈现，
/// 和世界层的语义放在一起才不会两边漂移。
///
/// 两个布尔量同理，是**菜单项的可用性**而不是猫的状态：条件（「生病且没死」）
/// 由前端算好（src/app/status.ts），这里只 set_enabled。写在这里的话没有任何
/// 测试碰得到它，而「喂药入口仅在生病时出现」是一条验收项。
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn update_tray(
    app: AppHandle,
    handles: State<'_, TrayHandles>,
    summary: String,
    hunger: String,
    energy: String,
    mood: String,
    bond: String,
    medicate: bool,
    memorial: bool,
) -> Result<(), String> {
    let guard = handles
        .0
        .lock()
        .map_err(|_| "托盘状态锁已损坏".to_string())?;
    let items = guard.as_ref().ok_or("托盘尚未初始化")?;

    // set_text / set_enabled 内部会切到主线程执行，这里直接调是安全的。
    let set = |item: &MenuItem<tauri::Wry>, text: &str| -> Result<(), String> {
        item.set_text(text).map_err(|e| format!("改写菜单项失败：{e}"))
    };
    set(&items.summary, &summary)?;
    set(&items.hunger, &hunger)?;
    set(&items.energy, &energy)?;
    set(&items.mood, &mood)?;
    set(&items.bond, &bond)?;
    items
        .medicate
        .set_enabled(medicate)
        .map_err(|e| format!("切换喂药项失败：{e}"))?;
    items
        .memorial
        .set_enabled(memorial)
        .map_err(|e| format!("切换告别与档案项失败：{e}"))?;

    // 图标本身还没有分状态的美术（ticket 09），先让 tooltip 承担
    // 「不打开任何界面就知道猫怎么样了」。
    if let Some(tray) = app.tray_by_id("tray") {
        let _ = tray.set_tooltip(Some(&summary));
    }
    Ok(())
}

/// 换掉托盘图标本身。
///
/// **像素由前端画**（src/tray/icon.ts）：那张图是**这只猫**的配色，
/// 而品种调色板在渲染层，Rust 侧不认识它。把猫头画在这里等于把调色板抄一遍。
///
/// 传的是裸 RGBA 而不是 PNG：编码一次再解码一次纯属白费，而这条命令只在
/// 猫的总体状态变化时调（几分钟一次量级），一次 5KB 的 IPC 无关紧要。
#[tauri::command]
pub fn set_tray_icon(
    app: AppHandle,
    rgba: Vec<u8>,
    width: u32,
    height: u32,
) -> Result<(), String> {
    let expected = (width as usize) * (height as usize) * 4;
    if rgba.len() != expected {
        return Err(format!(
            "托盘图标像素数不对：{}×{} 应当是 {expected} 字节，收到 {}",
            width,
            height,
            rgba.len()
        ));
    }
    let tray = app.tray_by_id("tray").ok_or("托盘尚未初始化")?;
    tray.set_icon(Some(tauri::image::Image::new_owned(rgba, width, height)))
        .map_err(|e| format!("换托盘图标失败：{e}"))
}

/// 把托盘里安静模式的勾选状态对齐到前端记的那份开关。
///
/// 单独一个命令，理由同 update_prop_menu：它只在用户拨动开关与启动读档时变，
/// 而 update_tray 是每几秒一次的状态刷新。
#[tauri::command]
pub fn update_quiet_menu(handles: State<'_, TrayHandles>, quiet: bool) -> Result<(), String> {
    let guard = handles
        .0
        .lock()
        .map_err(|_| "托盘状态锁已损坏".to_string())?;
    let items = guard.as_ref().ok_or("托盘尚未初始化")?;
    items
        .quiet
        .set_checked(quiet)
        .map_err(|e| format!("勾选安静模式失败：{e}"))
}

/// 把托盘里两个挂件的勾选状态对齐到前端记的那份摆放。
///
/// 单独一个命令而不是塞进 `update_tray`：挂件的显示与猫的四条需求是两件事，
/// 刷新的时机也完全不同（需求每 5 秒推一次，挂件只在用户切换时变）。
#[tauri::command]
pub fn update_prop_menu(
    handles: State<'_, TrayHandles>,
    bowl: bool,
    bed: bool,
) -> Result<(), String> {
    let guard = handles
        .0
        .lock()
        .map_err(|_| "托盘状态锁已损坏".to_string())?;
    let items = guard.as_ref().ok_or("托盘尚未初始化")?;
    items
        .prop_bowl
        .set_checked(bowl)
        .map_err(|e| format!("勾选食盆项失败：{e}"))?;
    items
        .prop_bed
        .set_checked(bed)
        .map_err(|e| format!("勾选猫窝项失败：{e}"))?;
    Ok(())
}
