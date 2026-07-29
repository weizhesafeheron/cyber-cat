/**
 * 宠物窗口的入口。
 *
 * 职责边界：这个文件是平台层，负责取时钟、读写存档、驱动帧循环、刷新托盘、
 * 以及命中测试与点击穿透的编排。
 * **猫的状态一步都不在这里演化** - 全部经由世界层的 `step`（ADR 0001）。
 *
 * 领养流程见 ticket 07，自主行为与逗猫见 ticket 06，真正的抚摸见 ticket 10。
 */
import {
  ACTIONS,
  CatRenderer,
  H,
  W,
  hitTest,
  makeCat,
  makeMicro,
  stepMicro,
} from '../render/index.js';
import type { ActionKey, RenderResult } from '../render/index.js';
import { MS_PER_HOUR, createWorld, renderIntentOf, step, worldNow } from '../world/index.js';
import type { RenderIntent, UserAction, World } from '../world/index.js';
import { CursorTracker } from './cursor.js';
import { CatDisplay } from './display.js';
import { inTauri, petReady, probeCursor, setPassThrough } from './ipc.js';
import { PollingPassthrough } from './passthrough.js';
import { loadWorld, onTrayAction, pushTrayStatus, saveWorld } from './persist.js';
import { trayStatus } from './status.js';

/** 尚无领养流程（ticket 07），先写死品种与 Seed。 */
const PLACEHOLDER_BREED = 'orange' as const;
const PLACEHOLDER_SEED = 20260728;
const PLACEHOLDER_NAME = '小猫';

/** 目标逻辑放大倍数。实际设备缩放会取整并按窗口钳制，见 display.ts。 */
const TARGET_SCALE = 3;

/** 单帧用于推进动画相位的最大时长。掉帧时不要让动作跳一大段。 */
const MAX_ANIM_DT = 0.05;

/** 存档与托盘的刷新节流。 */
const SAVE_INTERVAL_MS = 30_000;
const TRAY_INTERVAL_MS = 5_000;

/**
 * 离线补算的时间上限。
 *
 * 世界层刻意不对 elapsedMs 设上限（那属于平台层的健壮性问题），所以在这里挡。
 * 超过这个量几乎只可能是系统时钟被改过或存档来自另一台机器 -
 * 真按几十年去补算只会白转几百万步，而猫早在第四天就死了。
 */
const MAX_CATCHUP_MS = 400 * 24 * MS_PER_HOUR;

/**
 * 点猫之后的即时视觉反馈。
 *
 * 为什么应用层要单独做一次：世界层的动作选择粒度是 30 分钟，抚摸带来的心情与
 * 亲密度变化不会立刻改变它选的动作 - 只靠世界层，点了猫看不到任何反应。
 * 所以点击既作为 `UserAction` 进世界层（亲密度、日记、睡着时的拒绝都在那边算），
 * 也在这里播一次短动作给出即时反馈。
 *
 * 这是占位：ticket 10 的抚摸才是真正的反应（表情、按性格分化的回应）。
 * 选伸懒腰是因为它形变最大、肉眼一望即知，顺带能验证命中形状确实跟着当前帧的
 * 掩膜变 - 伸懒腰时猫横向拉长，可点范围也该跟着变宽。
 */
const REACTION: ActionKey = 'stretch';
/** 播完整整一个周期。stretch 一个周期的首尾都是常态姿势，切回去不会跳。 */
const REACTION_MS = (ACTIONS[REACTION].period ?? 1) * 1000;

const canvas = document.getElementById('cat') as HTMLCanvasElement;
const display = new CatDisplay(canvas, TARGET_SCALE);
const renderer = new CatRenderer();

/** 本地时区偏移，分钟（东八区 = 480）。JS 的 getTimezoneOffset 符号相反。 */
const tzOffsetMinutes = (): number => -new Date().getTimezoneOffset();

let world: World = createWorld({
  breed: PLACEHOLDER_BREED,
  seed: PLACEHOLDER_SEED,
  name: PLACEHOLDER_NAME,
  bornAt: Date.now(),
  tzOffsetMinutes: tzOffsetMinutes(),
});

let cat = makeCat(world.identity.breed, world.identity.seed);
let micro = makeMicro(world.identity.seed);

/** 待结算的用户动作。托盘点击与鼠标点击都是异步来的，攒到下一帧一起交给 step。 */
let pending: UserAction[] = [];

function enqueue(action: UserAction): void {
  pending.push(action);
}

function drain(): UserAction[] {
  if (pending.length === 0) return [];
  const out = pending;
  pending = [];
  return out;
}

/** 当前动作的局部时间。动作一换就归零，否则新动作会从中间开始播。 */
let animT = 0;
let currentAction: ActionKey | null = null;

let lastFrameMs = performance.now();
/** 世界时间跟真实时钟走，不跟帧走 - 窗口被遮挡时 rAF 会停，帧时间会漏掉那一段。 */
let lastWallMs = Date.now();
let lastSaveMs = 0;
let lastTrayMs = 0;

/** 最近画出去的那一帧。命中测试必须用当前帧的掩膜（ADR 0006）。 */
let lastFrame: RenderResult | null = null;
/** 即时反馈的截止时刻（performance.now 时间轴）。0 = 没在反应。 */
let reactionUntilMs = 0;

/**
 * 客户区 CSS 坐标 → 精灵像素坐标。
 *
 * 直接量 canvas 的布局矩形，不自己算缩放：猫是 flex 贴底居中的，canvas 的位置
 * 与尺寸由 CSS 和 display.ts 的取整规则共同决定，在这里重算一遍等于把布局规则
 * 抄第二份，两份一旦不同步命中区就会整体偏移。
 * 每次采样都读一次矩形是有意的 - 页面没有布局变动，读取走缓存；换来跨屏拖动、
 * 系统缩放变化后自动正确。
 */
function toSprite(clientX: number, clientY: number): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  return { x: ((clientX - r.left) / r.width) * W, y: ((clientY - r.top) / r.height) * H };
}

const tracker = new CursorTracker(probeCursor, toSprite);
const passthrough = new PollingPassthrough(tracker, setPassThrough);

/**
 * 按世界层的意图画一帧，返回画出去的那一帧供命中测试用。
 *
 * 猫已离开时返回 null 并清空画布 - 不能留着上一帧，那会变成一只不动的僵尸猫。
 * 告别页是 ticket 12 的事。
 */
function draw(intent: RenderIntent, animDt: number, nowMs: number): RenderResult | null {
  if (intent.action === null) {
    display.clear();
    lastFrame = null;
    return null;
  }
  const reacting = nowMs < reactionUntilMs;
  const action = reacting ? REACTION : intent.action;
  const localT = reacting ? (REACTION_MS - (reactionUntilMs - nowMs)) / 1000 : animT;

  const mi = stepMicro(micro, animDt, intent.micro);
  const base = ACTIONS[action].make(localT, cat, mi);
  // intent.pose 始终叠在最上面：生病、睡着这类状态覆盖不该被即时反馈吃掉。
  const res = renderer.render(cat, { ...base, ...intent.pose });
  lastFrame = res;
  display.paint(res);
  return res;
}

function frame(now: number): void {
  const animDt = Math.min(MAX_ANIM_DT, (now - lastFrameMs) / 1000);
  lastFrameMs = now;

  const wall = Date.now();
  const elapsed = Math.max(0, wall - lastWallMs);
  lastWallMs = wall;

  const r = step(world, elapsed, { actions: drain() });
  world = r.world;
  const intent = r.renderIntent;

  if (intent.action !== currentAction) {
    currentAction = intent.action;
    animT = 0;
  } else {
    animT += animDt * intent.timeScale;
  }

  const res = draw(intent, animDt, now);
  // 判定与渲染同一帧：掩膜是刚产出的那一份，不是上一帧的。
  if (res) passthrough.update(res, now);

  // 有事发生就立刻存一次，其余时候按节流存 - 生病、死亡这类事件不能因为
  // 恰好在两次定时保存之间关机而丢掉。
  if (r.events.length > 0 || wall - lastSaveMs > SAVE_INTERVAL_MS) {
    lastSaveMs = wall;
    void saveWorld(world);
  }
  if (wall - lastTrayMs > TRAY_INTERVAL_MS) {
    lastTrayMs = wall;
    void pushTrayStatus(trayStatus(world, intent.status));
  }

  requestAnimationFrame(frame);
}

let looping = false;

/**
 * 启动动画循环。
 *
 * **必须在窗口真正显示之后调用。**
 * requestAnimationFrame 对隐藏窗口不触发，在窗口还是 visible: false 时启动
 * 循环，回调会一直排队不执行；即使之后窗口显示了，画布上也只有一帧在隐藏期间
 * 画的内容，看起来就是「窗口在屏但完全透明」。
 */
function startLoop(): void {
  if (looping) return;
  looping = true;
  lastFrameMs = performance.now();
  lastWallMs = Date.now();
  // 浏览器里单独调试时没有光标探测命令，靠 pointermove 供样即可；
  // 真跑起轮询只会每 16ms 拿到一个 null 把 DOM 采样冲掉。
  if (inTauri) tracker.start();
  requestAnimationFrame(frame);
}

/**
 * 读存档并补算离线时段。
 *
 * 补算与常驻运行调的是同一个 `step`，只是 elapsedMs 大得多 -
 * 不存在「离线版模拟器」（ADR 0001）。
 */
async function bootWorld(): Promise<void> {
  const saved = await loadWorld();
  if (saved) {
    // 时区跟随当前机器：用户换了时区（或过了夏令时），猫的作息该跟着用户的白天走。
    world = { ...saved, tzOffsetMinutes: tzOffsetMinutes() };
    cat = makeCat(world.identity.breed, world.identity.seed);
    micro = makeMicro(world.identity.seed);
  }

  const away = Math.min(MAX_CATCHUP_MS, Math.max(0, Date.now() - worldNow(world)));
  const r = step(world, away, {});
  world = r.world;
  lastWallMs = Date.now();
  lastSaveMs = lastWallMs;
  lastTrayMs = lastWallMs;

  if (away > 0) {
    console.info(
      `[cyber-cat] 补算了 ${(away / MS_PER_HOUR).toFixed(1)} 小时的离线时段，产出 ${r.events.length} 条事件`,
    );
  }
  await saveWorld(world);
  await pushTrayStatus(trayStatus(world, r.renderIntent.status));
  // 补算之后世界可能已经换了姿态，先把首帧重画一次再启动循环。
  currentAction = r.renderIntent.action;
  animT = 0;
  draw(r.renderIntent, 0, performance.now());
}

/**
 * 点猫。
 *
 * 用 lastFrame 的掩膜做精确判定：光标可能落在猫周围的外扩边距里 - 那个边距
 * 存在的目的是提前关闭穿透（ADR 0006），不代表点到了猫。
 * 落在边距里的点击只能被丢掉：穿透是整窗一刀切的，此刻已经关着，没有办法把
 * 这一次点击转交给下层窗口。这也是边距必须尽量窄的原因。
 *
 * 不在这里切换穿透状态 - macOS 上赋值有传播延迟，到 pointerdown 才切已经太晚。
 */
window.addEventListener('pointerdown', (e) => {
  if (!lastFrame) return;
  const p = toSprite(e.clientX, e.clientY);
  if (!hitTest(lastFrame, p.x, p.y)) return;
  // 两件事都要做，理由见 REACTION 的注释。
  enqueue({ type: 'pet' });
  reactionUntilMs = performance.now() + REACTION_MS;
});

// 穿透关闭时 webview 能收到 pointermove，这是比轮询更精确、且免费的采样源。
// 穿透开启时收不到任何鼠标事件，那段时间只有 Rust 侧的轮询有数据。
window.addEventListener('pointermove', (e) => tracker.observe(e.clientX, e.clientY));

// 跨屏拖动或系统缩放变化时重算设备缩放，保持像素锐利
window.addEventListener('resize', () => display.applyScale());
matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener('change', () =>
  display.applyScale(),
);

void onTrayAction((id) => {
  if (id === 'feed') enqueue({ type: 'fillBowl' });
  else if (id === 'medicate') enqueue({ type: 'medicate' });
});

// 启动顺序：同步画出第一帧 → 通知 Rust 显示窗口 → 读存档补算 → 启动动画循环。
//
// **前两步与最后一步的顺序不能变。** 窗口以 visible: false 启动，而
// requestAnimationFrame 对隐藏窗口不触发。这个约束踩过两次坑：
//   1. 把「通知显示」放进 rAF 回调 → 死锁，窗口永远不出现（应用与托盘都正常）。
//   2. 在窗口显示前就启动循环 → 窗口出现了但完全透明，因为画布上只有一帧
//      在隐藏期间画的内容，循环的回调一直排队没执行。
//
// 读存档必须放在「通知显示」之后：它是异步的，放在前面会把首帧连带窗口一起推迟。
// 代价是存档里如果是另一只猫，首帧会有一瞬间画的是占位猫 - ticket 07 落地后
// 占位猫消失，这个瞬间也随之消失。
{
  const intent = renderIntentOf(world);
  currentAction = intent.action;
  draw(intent, 0, performance.now());
}
void petReady()
  .then(bootWorld)
  .then(startLoop)
  .catch((err) => {
    console.error('[cyber-cat] 启动失败：', err);
  });

// 兜底：窗口从隐藏变为可见时确保循环在跑（例如被系统遮挡后恢复）。
// startLoop 自带幂等保护 - 不要直接 requestAnimationFrame，那会多起一条帧链。
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) startLoop();
});
