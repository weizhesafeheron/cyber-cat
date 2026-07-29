/**
 * 选择性点击穿透的判定逻辑（[ADR 0006](../../docs/adr/0006-alpha-mask-hit-testing.md)）。
 *
 * 纯逻辑：不碰 DOM、不碰 Tauri，因此可以在 node 里拿**真实掩膜**做单元测试。
 *
 * 坐标一律是**精灵像素空间** - 相对精灵左上角、单位是渲染缓冲的像素（72x56），
 * 与屏幕缩放和窗口位置无关。屏幕坐标到精灵坐标的换算只在 cursor.ts 做一次。
 *
 * 不变量：
 * - 判定只读传入的当前帧掩膜，自身不缓存任何掩膜。用上一帧的掩膜判当前帧
 *   会在动作快的时候（扑跳、伸懒腰）明显失准。
 * - 光标位置未知时判为「应该穿透」。宁可漏掉一次抚摸，也不能在用户桌面上
 *   挖出一块死区 - 后者是 ADR 0006 明确不接受的。
 */

/** 当前帧的命中掩膜。字段名与渲染层的 RenderResult 对齐，可以直接把渲染结果传进来。 */
export interface HitFrame {
  readonly width: number;
  readonly height: number;
  /** 每字节 255 或 0，只有猫本体（含描边）为 255。 */
  readonly alphaMask: Uint8Array;
}

/** 一次光标采样。x/y 是精灵像素坐标（可为小数、可越界），t 是毫秒时间戳。 */
export interface CursorSample {
  readonly x: number;
  readonly y: number;
  readonly t: number;
}

/** 光标速度。单位是精灵像素/秒。 */
export interface Velocity {
  readonly vx: number;
  readonly vy: number;
  /** 速度大小，等于 hypot(vx, vy)。 */
  readonly speed: number;
}

export const ZERO_VELOCITY: Velocity = { vx: 0, vy: 0, speed: 0 };

export interface HitConfig {
  /**
   * 静止时的外扩边距，精灵像素。
   *
   * 3 px 的构成：掩膜边缘的 1 px 描边 + 一次轮询间隔内慢速光标的位移余量。
   * 这个边距是**会偷用户点击的窄带**，所以不能大 - 3 精灵像素在 3 倍放大下
   * 约 9 个物理像素，贴着猫的轮廓，用户几乎不会往那里点。
   */
  readonly baseMargin: number;
  /**
   * 提前量，秒。乘上速度得到沿运动方向的前探距离。
   *
   * 最坏链路：光标轮询 16ms + 决策所在帧 16.7ms + macOS 上
   * `ignoresMouseEvents` 的传播延迟 ≤5ms ≈ 38ms。取 50ms 留余量。
   * 这一项是 ADR 0006「必须提前于光标抵达切换」的量化形式。
   */
  readonly leadTimeS: number;
  /**
   * 前探距离的上限，精灵像素。
   *
   * 36 = 精灵宽度的一半。再大就等于把整窗都算成命中区，那正是要避免的死区。
   * 撞到这个上限意味着光标在高速掠过，此刻用户不可能在点猫，宁可漏判。
   */
  readonly maxLead: number;
  /**
   * 退出时的额外边距，精灵像素。
   *
   * 进入与退出用不同阈值（hysteresis）：边界上的一点抖动不该来回切换状态，
   * 每次切换都有传播延迟，抖动期间窗口到底是哪个状态是不确定的。
   */
  readonly exitExtra: number;
  /**
   * 退出前的持续时间，毫秒。
   *
   * 光标离开后要连续满足退出条件这么久才真的开启穿透。80ms 的取法：
   * 足够盖过几帧的抖动，又短到用户不会觉得猫旁边有一块黏手的区域。
   */
  readonly leaveDelayMs: number;
}

export const DEFAULT_HIT_CONFIG: HitConfig = {
  baseMargin: 3,
  leadTimeS: 0.05,
  maxLead: 36,
  exitExtra: 2,
  leaveDelayMs: 80,
};

/** 前探时沿线段的采样步长，精灵像素。必须小于 2 倍 baseMargin，否则线段上会漏掉掩膜。 */
const SWEEP_STEP = 2;

/** 两次采样间隔超过这个秒数就不再拿它算速度 - 平均速度已经不代表当前速度。 */
const MAX_SAMPLE_GAP_S = 0.25;

/**
 * 由相邻两次采样估算速度。
 *
 * 估偏大是安全方向（前探更多、更早关穿透），估偏小才会导致漏判，
 * 因此不做平滑：平滑会削掉起步那一下的加速度，正是最需要提前量的时刻。
 */
export function velocityOf(prev: CursorSample | null, cur: CursorSample): Velocity {
  if (!prev) return ZERO_VELOCITY;
  const dt = (cur.t - prev.t) / 1000;
  if (dt <= 0 || dt > MAX_SAMPLE_GAP_S) return ZERO_VELOCITY;
  const vx = (cur.x - prev.x) / dt;
  const vy = (cur.y - prev.y) / dt;
  return { vx, vy, speed: Math.hypot(vx, vy) };
}

/** 该速度下沿运动方向的前探距离，精灵像素。 */
export function leadDistance(speed: number, cfg: HitConfig = DEFAULT_HIT_CONFIG): number {
  if (!Number.isFinite(speed) || speed <= 0) return 0;
  return Math.min(cfg.maxLead, speed * cfg.leadTimeS);
}

/**
 * 掩膜上是否存在与 (x, y) 距离不超过 margin 的像素。
 *
 * 距离是点到像素方格的欧氏距离，因此 margin = 0 时等价于「落在该像素上」，
 * 与渲染层的 hitTest 结果一致（有测试交叉验证这一点）。
 */
export function nearMask(frame: HitFrame, x: number, y: number, margin: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const { width, height, alphaMask } = frame;
  const m = Number.isFinite(margin) ? Math.max(0, margin) : 0;
  const x0 = Math.max(0, Math.floor(x - m));
  const x1 = Math.min(width - 1, Math.ceil(x + m));
  const y0 = Math.max(0, Math.floor(y - m));
  const y1 = Math.min(height - 1, Math.ceil(y + m));
  const m2 = m * m;
  for (let py = y0; py <= y1; py++) {
    // 点到该行像素方格的纵向距离
    const dy = Math.max(0, Math.abs(py + 0.5 - y) - 0.5);
    if (dy > m) continue;
    const row = py * width;
    for (let px = x0; px <= x1; px++) {
      if (alphaMask[row + px] !== 255) continue;
      const dx = Math.max(0, Math.abs(px + 0.5 - x) - 0.5);
      if (dx * dx + dy * dy <= m2) return true;
    }
  }
  return false;
}

/**
 * 从当前位置沿运动方向前探一段，看这条线段上是否有点靠近掩膜。
 *
 * **只沿运动方向前探，不等比例放大边距。** 等比例放大在高速时会把整个精灵
 * 都圈进命中区（36 px 的边距对 72x56 的精灵就是整窗），等于挖死区；
 * 沿运动方向前探则只覆盖光标即将到达的地方，光标身后不受影响。
 */
export function sweepNearMask(
  frame: HitFrame,
  x: number,
  y: number,
  vel: Velocity,
  margin: number,
  lead: number,
): boolean {
  if (nearMask(frame, x, y, margin)) return true;
  if (lead <= 0 || vel.speed <= 0 || !Number.isFinite(vel.speed)) return false;
  const ux = vel.vx / vel.speed;
  const uy = vel.vy / vel.speed;
  const steps = Math.ceil(lead / SWEEP_STEP);
  for (let i = 1; i <= steps; i++) {
    const d = Math.min(lead, i * SWEEP_STEP);
    if (nearMask(frame, x + ux * d, y + uy * d, margin)) return true;
  }
  return false;
}

/** 判定的输入。位置与速度分开传：速度由光标追踪器按自己的采样节奏算，与帧率无关。 */
export interface HitInput {
  /** 光标位置，精灵像素。null = 位置未知（探测失败，或光标不在本窗口所在的屏幕上）。 */
  readonly cursor: { readonly x: number; readonly y: number } | null;
  readonly velocity: Velocity;
  /** 决策时刻，毫秒。只用于退出延迟计时。 */
  readonly now: number;
}

export interface HitState {
  /** true = 应该开启整窗穿透，点击落到下层窗口。 */
  readonly passThrough: boolean;
  /** 退出条件开始持续满足的时刻，毫秒；未满足为 null。 */
  readonly leavingSince: number | null;
}

/**
 * 初始状态：穿透。
 *
 * 必须与 Rust 侧窗口创建后的初值一致（platform.rs 里创建后就设成穿透）。
 * 前端还没做出第一次判定之前，窗口绝不该截获桌面上的点击。
 */
export function initialHitState(): HitState {
  return { passThrough: true, leavingSince: null };
}

/**
 * 走一步判定。纯函数，返回新状态，不改动入参。
 *
 * frame 必须是**当前帧**的掩膜。
 */
export function stepHit(
  state: HitState,
  frame: HitFrame,
  input: HitInput,
  cfg: HitConfig = DEFAULT_HIT_CONFIG,
): HitState {
  const near = isNear(frame, input, state.passThrough, cfg);

  if (near) return { passThrough: false, leavingSince: null };
  if (state.passThrough) return { passThrough: true, leavingSince: null };

  // 已经关着穿透、现在离开了：等退出延迟走完再真的开启。
  const since = state.leavingSince ?? input.now;
  if (input.now - since >= cfg.leaveDelayMs) return { passThrough: true, leavingSince: null };
  return { passThrough: false, leavingSince: since };
}

function isNear(frame: HitFrame, input: HitInput, passThrough: boolean, cfg: HitConfig): boolean {
  if (!input.cursor) return false; // 位置未知 → 当作远离，走向穿透
  // 关着穿透时用更大的边距，形成进入/退出的双阈值。
  const margin = passThrough ? cfg.baseMargin : cfg.baseMargin + cfg.exitExtra;
  const lead = leadDistance(input.velocity.speed, cfg);
  return sweepNearMask(frame, input.cursor.x, input.cursor.y, input.velocity, margin, lead);
}
