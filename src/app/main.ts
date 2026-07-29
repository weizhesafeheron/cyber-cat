/**
 * 宠物窗口的入口。
 *
 * ticket 03（骨架）的范围：让一只写死品种与 Seed 的猫出现在桌面上并呼吸。
 * ticket 04 在此之上接了选择性点击穿透：猫身上可点，其余落到下层窗口。
 * 真正的领养流程见 ticket 07，自主行为见 ticket 06，状态演化见 ticket 05。
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
import { CursorTracker } from './cursor.js';
import { CatDisplay } from './display.js';
import { inTauri, petReady, probeCursor, setPassThrough } from './ipc.js';
import { PollingPassthrough } from './passthrough.js';

/** 骨架阶段写死的猫。ticket 07 的领养流程会替换掉它。 */
const PLACEHOLDER_BREED = 'orange' as const;
const PLACEHOLDER_SEED = 20260728;

/** 目标逻辑放大倍数。实际设备缩放会取整，见 display.ts。 */
const TARGET_SCALE = 3;

/**
 * 点猫之后播的动作。
 *
 * 占位用：ticket 10 的抚摸才是真正的反应（表情、亲密度、状态影响都在那边）。
 * 这里只需要满足 ticket 04 的验收条件「点猫身上有可观察的反应」。
 * 选伸懒腰是因为它的形变最大，肉眼一望即知，而且顺带能验证命中形状确实跟着
 * 当前帧的掩膜变 - 伸懒腰时猫横向拉长，可点范围也该跟着变宽。
 */
const REACTION: ActionKey = 'stretch';
/** 播完整整一个周期再回到 idle。stretch 一个周期的首尾都是常态姿势，切回去不会跳。 */
const REACTION_S = ACTIONS[REACTION].period ?? 1;

const canvas = document.getElementById('cat') as HTMLCanvasElement;
const display = new CatDisplay(canvas, TARGET_SCALE);

const renderer = new CatRenderer();
const cat = makeCat(PLACEHOLDER_BREED, PLACEHOLDER_SEED);
const micro = makeMicro(PLACEHOLDER_SEED);

let t = 0;
let last = performance.now();
/** 最近画出去的那一帧。命中测试必须用当前帧的掩膜（ADR 0006）。 */
let lastFrame: RenderResult | null = null;
/** 反应开始的动画时刻；null = 没在反应。 */
let reactionStart: number | null = null;

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
 * 通知 Rust 侧显示窗口。
 *
 * 窗口以 visible: false 启动 - 先显示再等前端就绪会露出一帧空白，
 * 在透明置顶窗口上就是一次可见的闪烁。
 */
async function signalReady(): Promise<void> {
  if (!inTauri) return; // 浏览器里单独调试，没有窗口需要显示
  try {
    await petReady();
  } catch (err) {
    // 不要静默吞掉：这个调用是窗口能否显示的唯一途径，失败就意味着
    // 猫永远不出现。曾因 CSP 缺少 connect-src 而失败，被宽泛的 catch
    // 掩盖成「应用启动了但看不见窗口」，很难排查。
    console.error('[cyber-cat] pet_ready 调用失败，窗口不会显示：', err);
    throw err;
  }
}

function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  t += dt;

  // 骨架阶段只有站立呼吸 + 微动作层，外加被点到时的一次反应
  const mi = stepMicro(micro, dt, { tilt: true });
  const rt = reactionStart != null ? t - reactionStart : null;
  const pose =
    rt != null && rt < REACTION_S
      ? ACTIONS[REACTION].make(rt, cat, mi)
      : ACTIONS.idle.make(t, cat, mi);
  if (rt != null && rt >= REACTION_S) reactionStart = null;

  const res = renderer.render(cat, pose);
  lastFrame = res;
  display.paint(res);
  // 判定与渲染同一帧：掩膜是刚产出的那一份，不是上一帧的。
  passthrough.update(res, now);

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
  last = performance.now();
  // 浏览器里单独调试时没有光标探测命令，靠 pointermove 供样即可；
  // 真跑起轮询只会每 16ms 拿到一个 null 把 DOM 采样冲掉。
  if (inTauri) tracker.start();
  requestAnimationFrame(frame);
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
  reactionStart = t;
});

// 穿透关闭时 webview 能收到 pointermove，这是比轮询更精确、且免费的采样源。
// 穿透开启时收不到任何鼠标事件，那段时间只有 Rust 侧的轮询有数据。
window.addEventListener('pointermove', (e) => tracker.observe(e.clientX, e.clientY));

// 跨屏拖动或系统缩放变化时重算设备缩放，保持像素锐利
window.addEventListener('resize', () => display.applyScale());
matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener('change', () =>
  display.applyScale(),
);

// 启动顺序：同步画出第一帧 → 通知 Rust 显示窗口 → 窗口可见后才启动动画循环。
//
// **这三步的顺序不能变。** 窗口以 visible: false 启动，而 requestAnimationFrame
// 对隐藏窗口不触发。这个约束踩过两次坑：
//   1. 把「通知显示」放进 rAF 回调 → 死锁，窗口永远不出现（应用与托盘都正常）。
//   2. 在窗口显示前就启动循环 → 窗口出现了但完全透明，因为画布上只有一帧
//      在隐藏期间画的内容，循环的回调一直排队没执行。
lastFrame = renderer.render(cat, ACTIONS.idle.make(0, cat, stepMicro(micro, 0, { tilt: true })));
display.paint(lastFrame);
void signalReady().then(startLoop);

// 兜底：窗口从隐藏变为可见时确保循环在跑（例如被系统遮挡后恢复）
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) startLoop();
});
