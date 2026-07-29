import { ZERO_VELOCITY, velocityOf } from './hit.js';
import type { CursorSample, Velocity } from './hit.js';

/**
 * 光标追踪。
 *
 * **穿透开启期间 webview 收不到任何鼠标事件** - 整窗 `WS_EX_TRANSPARENT` /
 * `ignoresMouseEvents` 意味着连 `pointermove` 都不会来（Windows 实测：
 * Electron 的 `{forward:true}` 是唯一能保留 mousemove 的选项，Tauri 没有对应开关）。
 * 也就是说 DOM 事件只在「猫已经可点」时才有数据，恰好是最不需要它的时候。
 * 所以光标位置必须从 Rust 侧取全局坐标。
 *
 * DOM 事件仍然接进来（observe），因为它在穿透关闭时是免费且更精确的采样源。
 */

/** 探测光标：返回相对宠物窗口客户区左上角的位置，单位是逻辑像素（CSS 像素）。null = 位置未知。 */
export type CursorProbe = () => Promise<{ x: number; y: number } | null>;

/** 客户区逻辑坐标 → 精灵像素坐标。 */
export type ToSprite = (clientX: number, clientY: number) => { x: number; y: number };

/**
 * 移动中的轮询间隔，毫秒。
 *
 * 对齐 60fps 的一帧。再密没有意义 - 决策发生在帧循环里（掩膜必须是当前帧的），
 * 比一帧更细的采样在下一次决策前就被新采样覆盖了。
 */
export const POLL_MOVING_MS = 16;

/**
 * 静止时的轮询间隔，毫秒。
 *
 * 光标不动时窗口状态不需要改变，继续 16ms 轮询纯属白烧电。
 * 不降到更低是因为从静止到高速移动的那一下只能靠轮询发现：64ms 的最坏发现
 * 延迟已经是「快速掠过时可能漏判一次抚摸」的量级，再慢就会开始漏点击。
 */
export const POLL_STILL_MS = 64;

/** 连续多久没位移就算静止，毫秒。 */
export const STILL_AFTER_MS = 500;

/** 探测连续失败后的退避间隔，毫秒。 */
export const POLL_BACKOFF_MS = 1000;

export class CursorTracker {
  private sample: CursorSample | null = null;
  /**
   * 最近一次采样的**客户区**坐标，CSS 像素。
   *
   * `sample` 是精灵坐标（命中判定要的），但逗猫的运动特征闸门要的是屏幕坐标 -
   * 客户区加上舞台原点就是屏幕坐标，而精灵坐标反推回去要重新知道画布的布局矩形。
   * 两条采样路（DOM 事件与 Rust 轮询）都会更新它，**这一点是必需的**：
   * 穿透开着时 webview 收不到任何鼠标事件，而那正是逗猫开始的时刻 - 猫在远处。
   */
  private client: { x: number; y: number } | null = null;
  private vel: Velocity = ZERO_VELOCITY;
  private lastMoveAt: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private failures = 0;

  constructor(
    private readonly probe: CursorProbe,
    private readonly toSprite: ToSprite,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** 最近一次采样。null = 位置未知，判定层会据此走向穿透。 */
  get latest(): CursorSample | null {
    return this.sample;
  }

  /** 最近两次采样估出的速度。 */
  get velocity(): Velocity {
    return this.vel;
  }

  /** 最近一次采样的客户区坐标，CSS 像素。null = 位置未知。 */
  get latestClient(): { x: number; y: number } | null {
    return this.client;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer != null) clearTimeout(this.timer);
    this.timer = null;
  }

  /** 接受一个来自 DOM 事件的采样。坐标是客户区 CSS 像素，与探测结果同一坐标系。 */
  observe(clientX: number, clientY: number): void {
    this.client = { x: clientX, y: clientY };
    const s = this.toSprite(clientX, clientY);
    this.push(s.x, s.y, this.now());
  }

  private push(x: number, y: number, t: number): void {
    const prev = this.sample;
    // 位置没变时不刷新 lastMoveAt - 降频判断依赖它。时间戳照常前进，
    // 于是速度自然算成 0，这与「确实静止」一致。
    if (!prev || prev.x !== x || prev.y !== y) this.lastMoveAt = t;
    const cur: CursorSample = { x, y, t };
    this.vel = velocityOf(prev, cur);
    this.sample = cur;
  }

  /** 位置未知。速度一并清掉 - 拿失效前的速度去前探等于凭空猜测。 */
  private forget(): void {
    this.sample = null;
    this.client = null;
    this.vel = ZERO_VELOCITY;
  }

  private readonly tick = async (): Promise<void> => {
    this.timer = null;
    let interval = POLL_MOVING_MS;
    try {
      const p = await this.probe();
      const t = this.now();
      if (p) {
        this.client = { x: p.x, y: p.y };
        const s = this.toSprite(p.x, p.y);
        this.push(s.x, s.y, t);
      } else {
        this.forget();
      }
      this.failures = 0;
      const still = this.lastMoveAt == null || t - this.lastMoveAt >= STILL_AFTER_MS;
      interval = still ? POLL_STILL_MS : POLL_MOVING_MS;
    } catch (err) {
      this.failures++;
      // 只报第一次：这个循环每秒跑几十次，每次都打日志会把控制台淹掉。
      if (this.failures === 1) {
        console.error('[cyber-cat] 光标探测失败，猫将暂时不可点（点击全部穿透）：', err);
      }
      this.forget();
      interval = POLL_BACKOFF_MS;
    }
    if (this.running) this.timer = setTimeout(this.tick, interval);
  };
}
