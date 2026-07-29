import {
  PET_WINDOW_LABEL,
  PROP_DRAG_THRESHOLD_PX,
  PROP_EVENT_CLICKED,
  PROP_EVENT_DRAG,
  PROP_EVENT_MOVED,
  PROP_EVENT_READY,
  PROP_EVENT_SYNC,
  PROP_HIT_MARGIN_SPRITE,
  PROP_KINDS,
  PROP_POLL_MS,
  PROP_POSITION_WATCH_MS,
  PROP_SCALE,
  PROP_SPRITE,
  propCssSize,
  propDeviceScale,
  propSprite,
} from '../props/index.js';
import type { PropKind, PropSprite, PropSyncPayload } from '../props/index.js';
import { CursorTracker } from './cursor.js';
import type { HitConfig } from './hit.js';
import {
  emitToWindow,
  inTauri,
  listenEvent,
  probeCursor,
  probeSelf,
  setPassThrough,
} from './ipc.js';
import { PollingPassthrough } from './passthrough.js';

/**
 * 挂件窗口的入口。
 *
 * 一个页面服务两个挂件，靠 `?kind=` 区分 - 两个挂件的行为完全一样（画一张静止的
 * 贴图、可拖、可点、逐像素穿透），分成两个页面只会让同一份逻辑维护两遍。
 *
 * 职责边界：**这里没有任何猫的状态。** 挂件窗口不知道饱食度、不知道猫在哪，
 * 它只知道「碗里有几份粮」这一个数，而那是宠物窗口推过来的投影。
 * 点食盆只发一个事件出去，添粮仍然作为一次 `UserAction` 走进同一个 `step`
 * （与托盘菜单同理）- 多一条改状态的路，离线推演的等价性就没法再保证了（ADR 0001）。
 *
 * 三件事必须做对，否则挂件会变成用户桌面上的一块死区或者一个甩不掉的窗口：
 * 1. **逐像素穿透**（ADR 0006）。窗口是贴图的包围盒，四角是透明的；
 *    透明像素不会自动穿透，不判定就等于在桌面上挖了一块矩形死区。
 * 2. **拖拽与点击要分得开。** 判反了的代价不对称，见 PROP_DRAG_THRESHOLD_PX。
 * 3. **位置要回读。** 拖拽由操作系统的循环执行，前端拿不到「拖完了」的回调。
 */

function kindFromUrl(): PropKind {
  const raw = new URLSearchParams(location.search).get('kind');
  const kind = PROP_KINDS.find((k) => k === raw);
  // 取不到就当食盆：挂件窗口的 url 写死在 tauri.conf.json 里，走到这里说明配置
  // 被改坏了。可见地报出来，但仍然画点东西 - 一个空白的置顶窗口更难查。
  if (!kind) {
    console.error(`[cyber-cat] 挂件窗口的 kind 参数无效：${JSON.stringify(raw)}，按食盆处理`);
    return 'bowl';
  }
  return kind;
}

const kind = kindFromUrl();
const sprite = PROP_SPRITE[kind];
const canvas = document.getElementById('prop') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const buffer = document.createElement('canvas');
buffer.width = sprite.w;
buffer.height = sprite.h;
const bufferCtx = buffer.getContext('2d')!;
const image = bufferCtx.createImageData(sprite.w, sprite.h);

/** 当前画着的贴图。命中判定要用它 - 掩膜必须与画出去的那一帧同源（ADR 0006）。 */
let current: PropSprite = propSprite(kind, 0);
let deviceScale = 1;

/**
 * 按 dpr 重算画布尺寸。
 *
 * 与猫的画布同一条约束：每个源像素必须占整数个物理像素，否则像素风破功
 * （见 src/props/layout.ts 的 propDeviceScale）。
 */
function applyScale(): void {
  const dpr = window.devicePixelRatio || 1;
  deviceScale = propDeviceScale(sprite, PROP_SCALE, dpr, {
    w: window.innerWidth,
    h: window.innerHeight,
  });
  const css = propCssSize(sprite, deviceScale, dpr);
  canvas.width = sprite.w * deviceScale;
  canvas.height = sprite.h * deviceScale;
  canvas.style.width = `${css.w}px`;
  canvas.style.height = `${css.h}px`;
  ctx.imageSmoothingEnabled = false;
}

function paint(next: PropSprite): void {
  current = next;
  image.data.set(next.pixels);
  bufferCtx.putImageData(image, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(buffer, 0, 0, canvas.width, canvas.height);
}

applyScale();
paint(current);

// 跨屏拖动或系统缩放变化时重算，保持像素锐利。
window.addEventListener('resize', () => {
  applyScale();
  paint(current);
});
matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener('change', () => {
  applyScale();
  paint(current);
});

/**
 * 客户区 CSS 坐标 → 贴图像素坐标。
 *
 * 量的是 canvas 自己的布局矩形，所以 CSS 里的居中与贴底自动被吸收 -
 * 与 main.ts 里那个函数是同一个理由：位置只能有一个来源。
 */
function toSprite(clientX: number, clientY: number): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  return {
    x: ((clientX - r.left) / r.width) * sprite.w,
    y: ((clientY - r.top) / r.height) * sprite.h,
  };
}

/**
 * 挂件的命中配置。
 *
 * 与猫那套（DEFAULT_HIT_CONFIG）的差别只有一条：**不做按速度的前探。**
 * 猫要前探是因为它自己在动、掩膜每帧都变，命中区在光标抵达前就得算出来；
 * 挂件是静止的，光标从任何方向靠近都会先穿过这条固定的窄带，
 * 提前量由边距本身提供。前探在这里只会白白偷走用户的点击。
 */
const HIT: HitConfig = {
  baseMargin: PROP_HIT_MARGIN_SPRITE,
  leadTimeS: 0,
  maxLead: 0,
  exitExtra: 1,
  leaveDelayMs: 80,
};

const tracker = new CursorTracker(probeCursor, toSprite, () => performance.now());
const passthrough = new PollingPassthrough(tracker, setPassThrough, HIT);

/** 宠物窗口说的显示状态。窗口的显示隐藏在 Rust 侧执行，挂件自己看不出来。 */
let visible = true;

/**
 * 判定循环。
 *
 * 挂件不需要 requestAnimationFrame - 贴图是静止的，只有光标进出会改变判定，
 * 而且 rAF 对隐藏窗口根本不触发（挂件可以被用户藏起来）。定时器才是对的工具。
 */
function judge(): void {
  // 藏起来的挂件接不到点击，判定没有意义。不判定的话状态停在上一次的值，
  // 而失效方向是安全的：再显示出来时第一次判定就会纠回来。
  if (!visible) return;
  passthrough.update(current, performance.now());
}

window.addEventListener('pointermove', (e) => tracker.observe(e.clientX, e.clientY));

// ---------------------------------------------------------------------------
// 拖拽与点击
// ---------------------------------------------------------------------------

/**
 * 拖拽自己实现，**不用系统的 `start_dragging`**。
 *
 * 系统拖拽两个方向都自由，而挂件只允许横向移动 - 它是放在地上的东西，纵向位置
 * 由地面线决定（见 props/layout.ts 的 dragResult）。用系统拖拽再把 y 拽回来是
 * 和操作系统的拖拽循环打架，而且拖动过程中挂件会先浮起来再弹回去。
 *
 * 代价是每一次 pointermove 都要发一个事件出去。可以接受：拖动是低频操作，
 * 而且宠物窗口只在钳出来的位置真的变了之后才下发窗口移动。
 */
/** 按下的起点，CSS 客户区坐标。null = 当前没有按下。 */
let pressAt: { x: number; y: number } | null = null;
/** 已经越过阈值、进入拖拽。之后的 pointerup 不再算点击。 */
let dragging = false;
/**
 * 按下时「光标屏幕 x - 窗口屏幕 x」。
 *
 * 拖动时用它反推窗口该去哪：`窗口 x = 光标屏幕 x - 抓握偏移`。
 * 不用位移累加 - 窗口是被我们自己挪动的，累加会把每一次微小的取整误差攒起来，
 * 拖久了光标就跑到挂件外面去了。
 */
let grabOffset: number | null = null;

window.addEventListener('pointerdown', (e) => {
  // 落在贴图之外（包围盒的透明角落）不算按到挂件。这里能收到事件说明穿透已经
  // 关着，而穿透是整窗一刀切的，所以边距里的点击只能丢掉 - 与点猫同一条取舍。
  if (!hitsSprite(e.clientX, e.clientY)) return;
  pressAt = { x: e.clientX, y: e.clientY };
  dragging = false;
  grabOffset = null;
  // 窗口的屏幕 x 要现问一次：轮询到的那份可能已经过时（用户刚拖完又按下）。
  const wantScreenX = e.screenX;
  void probeSelf()
    .then((m) => {
      if (m) grabOffset = wantScreenX - m.x;
    })
    .catch(() => undefined);
});

window.addEventListener('pointermove', (e) => {
  if (!pressAt) return;
  if (!dragging) {
    if (Math.hypot(e.clientX - pressAt.x, e.clientY - pressAt.y) < PROP_DRAG_THRESHOLD_PX) return;
    dragging = true;
  }
  if (grabOffset === null) return; // 还没问到窗口位置，这几帧先不动
  // 只报 x。钳制（工作区、与另一件挂件的关系）由宠物窗口做 - 它才知道兄弟在哪。
  void emitToWindow(PET_WINDOW_LABEL, PROP_EVENT_DRAG, { kind, x: e.screenX - grabOffset });
});

window.addEventListener('pointerup', (e) => {
  const start = pressAt;
  const wasDragging = dragging;
  pressAt = null;
  dragging = false;
  grabOffset = null;
  if (!start || wasDragging) return;
  if (Math.hypot(e.clientX - start.x, e.clientY - start.y) >= PROP_DRAG_THRESHOLD_PX) return;
  // 点了挂件。**只发一个事件**：添粮是世界层的用户动作，必须走同一个 step。
  void emitToWindow(PET_WINDOW_LABEL, PROP_EVENT_CLICKED, kind);
});

window.addEventListener('pointercancel', () => {
  pressAt = null;
  dragging = false;
  grabOffset = null;
});

function hitsSprite(clientX: number, clientY: number): boolean {
  const p = toSprite(clientX, clientY);
  const px = Math.floor(p.x);
  const py = Math.floor(p.y);
  if (px < 0 || py < 0 || px >= current.width || py >= current.height) return false;
  return current.alphaMask[py * current.width + px] === 255;
}

// ---------------------------------------------------------------------------
// 与宠物窗口的同步
// ---------------------------------------------------------------------------

/** 上一次报给宠物窗口的位置。用来只在真的挪过之后才报。 */
let reported: { x: number; y: number } | null = null;
let synced = false;

/**
 * 回读自己的位置，变了就报给宠物窗口。
 *
 * 拖拽是操作系统的循环在动窗口，前端既收不到 pointermove 也没有「拖完了」的回调，
 * 所以只能轮询。延迟只影响写盘时机 - 摆放本来不需要实时。
 *
 * **第一次只记基线，不上报。** 那时窗口还停在 Tauri 给的默认位置（屏幕正中），
 * 宠物窗口可能还没读完摆放存档；把这个位置报上去会被当成用户的摆放，
 * 连带触发一次写盘，正好覆盖掉还没读完的那份存档。
 */
async function watchPosition(): Promise<void> {
  const m = await probeSelf().catch(() => null);
  if (!m) return;
  if (reported === null) {
    reported = { x: m.x, y: m.y };
    return;
  }
  if (reported.x === m.x && reported.y === m.y) return;
  reported = { x: m.x, y: m.y };
  await emitToWindow(PET_WINDOW_LABEL, PROP_EVENT_MOVED, { kind, x: m.x, y: m.y });
}

void listenEvent<PropSyncPayload>(PROP_EVENT_SYNC, (payload) => {
  synced = true;
  visible = payload.visible;
  paint(propSprite(kind, payload.portions));
});

/**
 * 报到，直到宠物窗口回话。
 *
 * 三个 webview 各自加载，谁先起来没有保证：挂件先起来的话这一声会没人听见。
 * 宠物窗口那边也会主动下发一次，两条路任意一条通就够了，所以重试是有界的。
 */
function announce(attempt = 0): void {
  if (synced || attempt > 30) return;
  void emitToWindow(PET_WINDOW_LABEL, PROP_EVENT_READY, kind);
  setTimeout(() => announce(attempt + 1), 400);
}

if (inTauri) {
  tracker.start();
  setInterval(judge, PROP_POLL_MS);
  setInterval(() => void watchPosition(), PROP_POSITION_WATCH_MS);
  announce();
} else {
  // 直接用浏览器打开 /prop.html?kind=bed 调试贴图时走这里：没有 Rust 侧可问，
  // 画一张静止的图就够了。食盆默认画满，否则看不出粮长什么样。
  if (kind === 'bowl') paint(propSprite('bowl', 2));
}
