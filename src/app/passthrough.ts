import { DEFAULT_HIT_CONFIG, initialHitState, stepHit } from './hit.js';
import type { CursorSample, HitConfig, HitFrame, HitState, Velocity } from './hit.js';

/**
 * 穿透控制器。
 *
 * **这是留给原生命中测试的替换点。**
 * Windows 侧协作者建议生产实现改用原生 `WM_NCHITTEST` 或窗口 region：那样命中
 * 测试由系统逐次回调，不存在轮询竞争，前端也就不需要逐帧决策 - 只要把当前帧
 * 的掩膜推给 Rust。届时新增一个实现本接口的 `NativeHitRegion`（update 里
 * 把掩膜下推、不做任何判定），帧循环与 hit.ts 都不用改。
 *
 * 之所以现在先写轮询版：手上没有 Windows 机器，原生实现无法验证；
 * 轮询版已被两个平台的实测确认可用（macOS 报告第 3 节、Windows 报告 C3）。
 */
export interface PassthroughController {
  /**
   * 每帧调用一次。
   *
   * frame 必须是**当前帧**的掩膜，不能是上一帧的（ADR 0006）。
   */
  update(frame: HitFrame, now: number): void;
  /** 当前是否穿透。用于诊断与测试。 */
  readonly passThrough: boolean;
}

/** 光标来源。只读取，不驱动 - 采样节奏是 CursorTracker 自己的事。 */
export interface CursorSource {
  readonly latest: CursorSample | null;
  readonly velocity: Velocity;
}

/** 下发穿透状态。实现应当是「发出去就不管」的，帧循环不能等它。 */
export type ApplyPassThrough = (on: boolean) => void;

/**
 * 窗口创建后的穿透初值，必须与 Rust 侧 `platform::configure_pet_window` 保持一致。
 *
 * 是 true（穿透）而不是 false：前端还没做出第一次判定之前，窗口不该截获桌面上的点击。
 * 万一前端挂了，失效方向也是「猫点不动」而不是「桌面上多了一块死区」。
 */
const INITIAL_PASS_THROUGH = true;

/** 轮询版实现：前端逐帧用掩膜做判定，再整窗切换穿透。 */
export class PollingPassthrough implements PassthroughController {
  private state: HitState = initialHitState();
  private applied: boolean = INITIAL_PASS_THROUGH;
  /** 拖拽期间强制关闭穿透。见 hold()。 */
  private forced = false;

  constructor(
    private readonly cursor: CursorSource,
    private readonly apply: ApplyPassThrough,
    private readonly cfg: HitConfig = DEFAULT_HIT_CONFIG,
  ) {}

  get passThrough(): boolean {
    return this.state.passThrough;
  }

  /**
   * 强制关闭穿透，绕过掩膜判定。拖拽期间必须这样。
   *
   * 理由：拖拽时窗口跟着光标一起动，而掩膜判定看的是「光标此刻在不在猫身上」-
   * 快速拖动时窗口追不上光标，光标会短暂落到掩膜之外，判定于是打开穿透，
   * webview 立刻收不到鼠标事件，**拖拽在半路上断掉**。
   * 这不是可以靠调边距解决的：边距再宽也有拖得更快的时候。
   */
  hold(on: boolean): void {
    this.forced = on;
    if (!on) return;
    if (this.applied === false) return;
    this.applied = false;
    this.apply(false);
  }

  update(frame: HitFrame, now: number): void {
    // 被强制关着的时候仍然更新判定状态（松手后才不会跳一下），但不下发。
    if (this.forced) {
      this.state = stepHit(
        this.state,
        frame,
        { cursor: this.cursor.latest, velocity: this.cursor.velocity, now },
        this.cfg,
      );
      return;
    }
    this.state = stepHit(
      this.state,
      frame,
      { cursor: this.cursor.latest, velocity: this.cursor.velocity, now },
      this.cfg,
    );
    // 只在变化时下发。状态每秒最多变几次，但 update 每秒被调 60 次，
    // 每帧一次 IPC 是纯浪费，而且会让 Rust 侧的调用队列一直排满。
    if (this.applied === this.state.passThrough) return;
    this.applied = this.state.passThrough;
    this.apply(this.state.passThrough);
  }
}
