import type { PropKind } from './types.js';

/**
 * 桌面挂件的全部可调数值。
 *
 * 与世界层的 constants.ts 同一条硬要求：**数值集中在一个文件里**。
 * 散成字面量之后「猫站在食盆哪一侧、离多远」这类手感参数就只能靠全文搜索猜，
 * 而它们是真机调优时改得最勤的一批。
 */

/**
 * 挂件贴图的目标逻辑放大倍数。
 *
 * **必须与猫的 `TARGET_SCALE` 相同。** 挂件和猫是同一套像素美术，放大倍数一旦
 * 不同，同一个源像素在两个窗口里就是不同大小的方块，一眼能看出不是一套东西。
 * 实际设备缩放仍要按 dpr 取整（见 propDeviceScale），这只是目标值。
 */
export const PROP_SCALE = 3;

/** 一个挂件贴图的尺寸，精灵像素。 */
export interface PropSize {
  readonly w: number;
  readonly h: number;
}

/**
 * 两个挂件的贴图尺寸，精灵像素。
 *
 * **都刻意做得矮。** 挂件与猫是两个独立的置顶窗口，而两个同层级的置顶窗口谁盖谁
 * 是平台行为、我们控制不了（macOS 的窗口层级要动 objc，属于 ticket 14）。
 * 高帮的藤编猫窝在「窝盖住猫」的那种叠放下会把蜷睡的猫挡掉大半；
 * 矮的坐垫无论谁在上面，重叠区都只有底部几个精灵像素，看不出问题。
 * 这是一条被 z 序不确定性逼出来的美术决定，不是随手定的尺寸。
 */
export const PROP_SPRITE: Readonly<Record<PropKind, PropSize>> = {
  bowl: { w: 26, h: 12 },
  bed: { w: 44, h: 10 },
};

/**
 * 挂件窗口的客户区尺寸，CSS 逻辑像素。
 *
 * **这两个值必须与 src-tauri/tauri.conf.json 里 prop-bowl / prop-bed 窗口的
 * width/height 一致**，JSON 没法 import 常量，由 test/props/layout.test.ts
 * 直接读那个文件守着（与 stage.ts 的做法相同）。
 */
export function propWindowSize(kind: PropKind): PropSize {
  const s = PROP_SPRITE[kind];
  return { w: s.w * PROP_SCALE, h: s.h * PROP_SCALE };
}

/** 食盆容量上限对应的粮堆层数。与世界层的 BOWL_MAX_PORTIONS 一致，由测试守着。 */
export const KIBBLE_MAX_ROWS = 3;

/**
 * 猫要站到挂件中心多远处才算「到了」，精灵像素。
 *
 * 食盆 18 是从原型里量出来的：那时食盆画在精灵缓冲的 `34 + bodyRW + 8`、
 * 猫的锚点在 36，两者相差 16 到 20.5（bodyRW 在 10 到 14.5 之间）。
 * 取中间值，于是猫低头时鼻子正好落在盆口上。
 *
 * 猫窝是 0：猫要睡在垫子**中间**，不是站在旁边。
 */
export const PROP_REACH_SPRITE: Readonly<Record<PropKind, number>> = {
  bowl: 18,
  bed: 0,
};

/**
 * 默认摆放：两件家具并排贴在工作区右下角，从右往左依次排开。
 *
 * 产品负责人的要求原话是「饭盆和床最好放在一起，稍作间隔，都放在屏幕最右侧贴边」，
 * 理由是**挂件是常驻在桌面上的，摆在中间会挡住屏幕内容**。
 *
 * 被否决的前任方案：食盆放在 68% 处、猫窝放在 28% 处，中间留一大段给猫走，
 * 理由是「那段路本身就是内容」（ADR 0004）。真机上看这个理由不成立 -
 * 猫的活动范围是整个工作区，它从任何地方走到右下角都是一段长路，
 * 而两件家具分踞屏幕两侧只是同时挡了两处内容。
 *
 * 顺序：猫窝在最外侧（休息的角落），食盆在它左边。
 * 排在最右的是猫窝而不是食盆，是因为食盆要点、要看份数，别贴到屏幕边上去。
 */
export const PROP_RIGHT_TO_LEFT: readonly PropKind[] = ['bed', 'bowl'];

/** 最外侧那件家具离工作区右边缘留多少 CSS 像素。 */
export const PROP_EDGE_MARGIN_PX = 12;

/**
 * 两件家具之间的间隔，CSS 像素。
 *
 * 「稍作间隔」的落点：贴在一起会读成一件东西，隔太远又回到了「分踞两侧」。
 *
 * **下限由猫的身位定，不能随手拍。** 猫躺在垫子正中间时身体比垫子宽出
 * （半个精灵宽 - 半个垫子宽）= 108 - 66 = 42 CSS 像素，间隔小于这个数，
 * 睡着的猫就会压在食盆上。取 48 留一点余量。
 * 这条由 test/props/layout.test.ts 按几何算一遍守着，改猫或垫子的尺寸都会触发。
 */
export const PROP_GAP_PX = 48;

/** 默认是否显示。首次启动就该看见领地里的两件家具，不然「点食盆添粮」没有入口。 */
export const PROP_DEFAULT_VISIBLE = true;

/**
 * 按下之后移动超过这么多 CSS 像素才算拖拽，否则算点击。
 *
 * 6 px 的取法：比手指在触控板上按下时的抖动大，比用户有意拖动的第一段位移小。
 * 判反了的代价不对称 - 把点击误判成拖拽只是没喂到粮（再点一次即可），
 * 把拖拽误判成点击会在用户想挪食盆时白喂一份粮，所以宁可偏向拖拽。
 */
export const PROP_DRAG_THRESHOLD_PX = 6;

/**
 * 挂件命中判定的外扩边距，精灵像素。
 *
 * 比猫那套（hit.ts 的 baseMargin + 按速度前探）简单得多，因为**挂件是静止的**：
 * 猫的掩膜每帧都在变、位置也在动，所以那边要沿运动方向前探来抵掉传播延迟；
 * 挂件的掩膜是固定的，光标从哪个方向靠近都会先穿过这条 2 像素的窄带，
 * 前探带来的提前量在这里由「边距本身」提供。
 */
export const PROP_HIT_MARGIN_SPRITE = 2;

/**
 * 挂件窗口的光标轮询间隔，毫秒。
 *
 * 比猫那边（16ms）慢得多是有意的：挂件不动，判定结果只在光标进出那一刻改变，
 * 而且判错的后果是「点不到食盆」而不是「桌面被挡住」（失效方向偏向穿透）。
 * 两个挂件窗口各跑一条轮询，节流在这里是实打实的省电。
 */
export const PROP_POLL_MS = 48;

/**
 * 挂件窗口位置的回读间隔，毫秒。
 *
 * 用户拖窗口是操作系统的拖拽循环在动窗口，前端既收不到 pointermove 也没有
 * 「拖完了」的回调，所以只能回读位置。500ms 的延迟只影响存档写入时机，
 * 而摆放位置本来就不需要实时。
 */
export const PROP_POSITION_WATCH_MS = 500;

/** 挂件摆放的存档格式版本。结构变更时递增。 */
export const PROPS_SAVE_VERSION = 1;

// ---------------------------------------------------------------------------
// 窗口标签与事件名
// ---------------------------------------------------------------------------

/**
 * 挂件窗口的标签。
 *
 * **必须与 src-tauri/tauri.conf.json 里的 label 一致**，由
 * test/props/layout.test.ts 直接读那个文件守着 - 不一致的症状是「挂件永远不出现」，
 * 而且没有任何报错（Rust 侧找不到窗口，前端也就收不到回音）。
 */
export function propWindowLabel(kind: PropKind): string {
  return `prop-${kind}`;
}

/** 宠物（舞台）窗口的标签。挂件要往它发事件。 */
export const PET_WINDOW_LABEL = 'pet';

/** 挂件窗口起来了，请宠物窗口把摆放与碗里的份数告诉它。 */
export const PROP_EVENT_READY = 'prop-ready';
/** 用户点了挂件。食盆 = 添粮。 */
export const PROP_EVENT_CLICKED = 'prop-clicked';
/** 用户把挂件拖到了新位置。 */
export const PROP_EVENT_MOVED = 'prop-moved';
/** 宠物窗口下发给挂件的视图状态（目前只有碗里的份数）。 */
export const PROP_EVENT_SYNC = 'prop-sync';

/** `PROP_EVENT_MOVED` 的载荷。坐标是窗口客户区左上角的屏幕逻辑坐标。 */
export interface PropMovedPayload {
  readonly kind: PropKind;
  readonly x: number;
  readonly y: number;
}

/** `PROP_EVENT_SYNC` 的载荷。 */
export interface PropSyncPayload {
  /** 食盆里剩余的份数，直接来自 `world.bowl`。猫窝忽略它。 */
  readonly portions: number;
  /**
   * 这个挂件此刻是否显示。
   *
   * 窗口的显示隐藏由 Rust 侧执行，挂件窗口自己看不出来，但它需要知道 -
   * 藏起来的挂件不该继续每 48ms 探一次光标做命中判定，那是白烧电。
   */
  readonly visible: boolean;
}
