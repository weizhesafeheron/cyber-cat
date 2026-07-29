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
 * 默认摆放的横向位置，占工作区宽度的比例。
 *
 * 取比例而不是固定像素：13 寸笔记本与 4K 显示器上都要落在屏幕内，
 * 固定像素在小屏上会被钳到一起、两个挂件叠在一块。
 * 食盆偏右、猫窝偏左，中间留出一大段给猫走 - **那段路本身就是内容**（ADR 0004）。
 */
export const PROP_DEFAULT_X_RATIO: Readonly<Record<PropKind, number>> = {
  bowl: 0.68,
  bed: 0.28,
};

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
