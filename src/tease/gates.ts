import type { CatStatus } from '../world/index.js';
import {
  BORED_AFTER_POUNCES,
  DROWSY_AFTER_MEAL_MS,
  FULL_ENOUGH,
  MOOD_MIN_TO_PLAY,
  NOTICE_RADIUS_PX,
  POUNCE_GAP_MS,
  PREY_MIN_SAMPLES,
  PREY_SPEED_MIN,
  PREY_TURN_MIN,
  PREY_WINDOW_MS,
  TYPING_IDLE_S,
} from './constants.js';

/**
 * 六道闸门。
 *
 * 「光标即逗猫棒」是这个产品里最容易做成骚扰的一个特效：光标一直在动，
 * 而猫一直在看。所以票上把它定义成**邀请而非命令** - 任何一道闸门不满足就完全
 * 无视光标（issue #11）。
 *
 * 这一层是纯函数：输入是一份快照，输出是「能不能追」以及**被哪一道拦住了**。
 * 返回拦住它的那一道而不是一个布尔值，是为了让测试能断言「拦它的是这一道」-
 * 六道里任何一道单独失效都会被同一个布尔值掩盖过去。
 *
 * 判定顺序按「最便宜、最该先否」排：状态与打字是整段时间的否决，
 * 距离与运动特征每帧都在变。
 */

/** 六道闸门的名字。诊断与测试用。 */
export type Gate =
  /** 睡着、生病、刚吃饱犯困、心情很差 */
  | 'state'
  /** 用户在打字 */
  | 'typing'
  /** 玩腻了，在冷却里 */
  | 'bored'
  /** 两次扑跳之间的最小间隔 */
  | 'gap'
  /** 每小时次数上限 */
  | 'quota'
  /** 光标不在注意范围内 */
  | 'distance'
  /** 光标的运动不像猎物 */
  | 'motion';

export interface CursorPoint {
  readonly x: number;
  readonly y: number;
  /** 采样时刻，毫秒。 */
  readonly t: number;
}

export interface TeaseInput {
  /** 猫的总体状态，来自世界层的 renderIntent。 */
  readonly status: CatStatus;
  readonly mood: number;
  readonly hunger: number;
  /** 上一次进食的时刻，毫秒（帧时钟）。null = 这次运行还没吃过。 */
  readonly lastMealAt: number | null;
  /** 距用户上次按键多少秒。见 constants 里 TYPING_IDLE_S 的注释。 */
  readonly keyboardIdleS: number;
  /** 猫此刻的屏幕位置（精灵横向中心）与脚下的地面线 y。 */
  readonly catX: number;
  readonly catY: number;
  /** 最近一段光标轨迹，按时间升序。最后一个是最新的。 */
  readonly trail: readonly CursorPoint[];
  /** 已经连续扑中几次。 */
  readonly pouncesInARow: number;
  /** 玩腻的冷却截止时刻，毫秒。null = 不在冷却里。 */
  readonly boredUntil: number | null;
  /** 最近一次扑跳的时刻，毫秒。null = 还没扑过。 */
  readonly lastPounceAt: number | null;
  /** 最近一小时里的扑跳时刻，用于全局节流。 */
  readonly recentChases: readonly number[];
  /** 这只猫每小时的追逐上限，由活跃度算出来（见 chaseQuota）。 */
  readonly quotaPerHour: number;
  /** 现在，毫秒（帧时钟）。 */
  readonly now: number;
}

export interface TeaseVerdict {
  readonly ok: boolean;
  /** 被哪一道拦住。ok 为真时是 null。 */
  readonly blockedBy: Gate | null;
}

const PASS: TeaseVerdict = { ok: true, blockedBy: null };
const block = (gate: Gate): TeaseVerdict => ({ ok: false, blockedBy: gate });

/**
 * 光标的运动像不像猎物。
 *
 * 两个条件同时成立才算：**够快**，而且**方向在变**。
 * 只看速度会把「快速划过屏幕去点右上角」误判成逗猫 - 那是用户在操作，不是在玩。
 * 只看方向变化会把慢慢画圈误判成逗猫。
 *
 * 方向变化取相邻两段位移的夹角之和：一次来回甩必然累出一个大角，
 * 而直线移动即使有抖动也累不出来。
 */
export function preyLike(trail: readonly CursorPoint[], now: number): boolean {
  const recent = trail.filter((p) => now - p.t <= PREY_WINDOW_MS);
  if (recent.length < PREY_MIN_SAMPLES) return false;

  const first = recent[0]!;
  const last = recent[recent.length - 1]!;
  const dt = (last.t - first.t) / 1000;
  if (dt <= 0) return false;

  // 走过的路程（不是首尾直线距离）：来回甩的首尾距离可能很小，但路程很长。
  let path = 0;
  let turn = 0;
  let prevAng: number | null = null;
  for (let i = 1; i < recent.length; i++) {
    const a = recent[i - 1]!;
    const b = recent[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) continue; // 静止的采样点不参与方向判定，否则角度是噪声
    path += len;
    const ang = Math.atan2(dy, dx);
    if (prevAng !== null) {
      let d = Math.abs(ang - prevAng);
      if (d > Math.PI) d = 2 * Math.PI - d; // 取小于 180 度的那一边
      turn += d;
    }
    prevAng = ang;
  }

  return path / dt >= PREY_SPEED_MIN && turn >= PREY_TURN_MIN;
}

/** 这只猫每小时能主动追几次。活跃度高的上限更高（票上的要求）。 */
export function chaseQuota(active: number, lazy: number, activeMax: number): number {
  return lazy + (activeMax - lazy) * active;
}

/**
 * 能不能追这个光标。
 *
 * 顺序即优先级。任何一道不满足就完全无视光标 - 不是「减弱反应」，是**没有反应**。
 */
export function teaseVerdict(input: TeaseInput): TeaseVerdict {
  // 一、状态闸门。睡着、生病、刚吃饱犯困、心情很差都不玩。
  if (input.status !== 'ok') return block('state');
  if (input.mood < MOOD_MIN_TO_PLAY) return block('state');
  if (
    input.lastMealAt !== null &&
    input.now - input.lastMealAt < DROWSY_AFTER_MEAL_MS &&
    input.hunger >= FULL_ENOUGH
  ) {
    return block('state');
  }

  // 二、打字免打扰。整段时间的否决，比后面几道都便宜。
  if (input.keyboardIdleS < TYPING_IDLE_S) return block('typing');

  // 三、玩腻。
  if (input.boredUntil !== null && input.now < input.boredUntil) return block('bored');
  if (input.pouncesInARow >= BORED_AFTER_POUNCES) return block('bored');

  // 四、两次扑跳之间的最小间隔。防的是同一次挥动里连扑好几下。
  if (input.lastPounceAt !== null && input.now - input.lastPounceAt < POUNCE_GAP_MS) {
    return block('gap');
  }

  // 五、全局节流。玩腻只管连续扑中，这条管「一整天零散地扑上百次」。
  if (input.recentChases.length >= input.quotaPerHour) return block('quota');

  // 六、距离与运动特征。每帧都在变的那两道放在最后。
  const last = input.trail[input.trail.length - 1];
  if (last === undefined) return block('distance');
  if (Math.hypot(last.x - input.catX, last.y - input.catY) > NOTICE_RADIUS_PX) {
    return block('distance');
  }
  if (!preyLike(input.trail, input.now)) return block('motion');

  return PASS;
}

/** 丢掉超出统计窗口的追逐记录。全局节流每帧都要问，所以这一步要便宜。 */
export function pruneChases(
  chases: readonly number[],
  now: number,
  windowMs: number,
): readonly number[] {
  const kept = chases.filter((t) => now - t < windowMs);
  return kept.length === chases.length ? chases : kept;
}
