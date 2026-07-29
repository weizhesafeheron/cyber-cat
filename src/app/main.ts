/**
 * 宠物窗口的入口。
 *
 * ticket 03（骨架）的范围：让一只写死品种与 Seed 的猫出现在桌面上并呼吸。
 * 真正的领养流程见 ticket 07，自主行为见 ticket 06，状态演化见 ticket 05。
 */
import { ACTIONS, CatRenderer, makeCat, makeMicro, stepMicro } from '../render/index.js';
import { CatDisplay } from './display.js';

/** 骨架阶段写死的猫。ticket 07 的领养流程会替换掉它。 */
const PLACEHOLDER_BREED = 'orange' as const;
const PLACEHOLDER_SEED = 20260728;

/** 目标逻辑放大倍数。实际设备缩放会取整，见 display.ts。 */
const TARGET_SCALE = 3;

const canvas = document.getElementById('cat') as HTMLCanvasElement;
const display = new CatDisplay(canvas, TARGET_SCALE);

const renderer = new CatRenderer();
const cat = makeCat(PLACEHOLDER_BREED, PLACEHOLDER_SEED);
const micro = makeMicro(PLACEHOLDER_SEED);

let t = 0;
let last = performance.now();

/**
 * 通知 Rust 侧显示窗口。
 *
 * 窗口以 visible: false 启动 - 先显示再等前端就绪会露出一帧空白，
 * 在透明置顶窗口上就是一次可见的闪烁。
 */
/** 是否跑在 Tauri 里。直接用浏览器打开这个页面调试时为 false。 */
const inTauri = '__TAURI_INTERNALS__' in window;

async function signalReady(): Promise<void> {
  if (!inTauri) return; // 浏览器里单独调试，没有窗口需要显示
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('pet_ready');
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

  // 骨架阶段只有站立呼吸 + 微动作层
  const mi = stepMicro(micro, dt, { tilt: true });
  display.paint(renderer.render(cat, ACTIONS.idle.make(t, cat, mi)));
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
  requestAnimationFrame(frame);
}

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
display.paint(renderer.render(cat, ACTIONS.idle.make(0, cat, stepMicro(micro, 0, { tilt: true }))));
void signalReady().then(startLoop);

// 兜底：窗口从隐藏变为可见时确保循环在跑（例如被系统遮挡后恢复）
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) startLoop();
});
