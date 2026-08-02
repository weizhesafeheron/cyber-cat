import { ACTIONS } from './actions.js';
import type { ActionKey } from './actions.js';

/** 小米 A 方案的完整帧数量。每个动作都是同一规格的六格横向条带。 */
export const XIAOMI_FRAME_COUNT = 6;

/** 单格高清源尺寸。运行时直接缩放整格，不再拆头、爪或身体。 */
export const XIAOMI_FRAME_W = 288;
export const XIAOMI_FRAME_H = 224;

/**
 * 沿用已验收 Demo 的动作节奏。这里只决定换格速度；桌面位移仍由运动层负责。
 */
export const XIAOMI_FRAME_MS = {
  idle: 340,
  walk: 160,
  sit: 360,
  lie: 380,
  sleep: 420,
  groom: 240,
  eat: 300,
  yawn: 320,
  stretch: 280,
  pounce: 180,
  held: 280,
  land: 120,
  leapUp: 180,
  leapDown: 180,
  edge: 240,
} as const satisfies Record<ActionKey, number>;

type XiaomiTimeline = {
  readonly order: readonly [number, number, number, number, number, number];
  readonly durationsMs: readonly [number, number, number, number, number, number];
};

const SEQUENTIAL_ORDER = [0, 1, 2, 3, 4, 5] as const;

/**
 * 需要与物理事件精确咬合的动作使用独立时间线。
 *
 * land 的素材原始顺序是站立 → 下压 → 深压 → 最深 → 回升 → 坐稳；物理层在
 * `liftY` 归零的同一帧才切进 land，因此入口必须直接取压缩格。随后在动作本身的
 * 450ms 周期内完成深压与回弹，不能沿用 120ms 等间隔（那会让后两格永远播不到）。
 */
const PRECISE_TIMELINES: Partial<Record<ActionKey, XiaomiTimeline>> = {
  land: {
    order: [2, 3, 2, 1, 0, 0],
    durationsMs: [45, 65, 75, 85, 90, 90],
  },
};

function timelineFor(action: ActionKey): XiaomiTimeline {
  const frameMs = XIAOMI_FRAME_MS[action];
  return (
    PRECISE_TIMELINES[action] ?? {
      order: SEQUENTIAL_ORDER,
      durationsMs: [frameMs, frameMs, frameMs, frameMs, frameMs, frameMs],
    }
  );
}

/**
 * 把动作局部时间映射到完整帧。
 *
 * 循环动作首尾相接；一次性动作走到末格后停住，避免世界层分配的剩余时长里
 * 又从第一格重播一次哈欠、扑跳或落地。
 */
export function xiaomiFrameIndex(action: ActionKey, seconds: number): number {
  const timeline = timelineFor(action);
  const totalMs = timeline.durationsMs.reduce((sum, duration) => sum + duration, 0);
  const elapsedMs = Math.max(0, seconds) * 1000;
  const localMs = ACTIONS[action].loop ? elapsedMs % totalMs : Math.min(elapsedMs, totalMs);

  let endMs = 0;
  for (let step = 0; step < XIAOMI_FRAME_COUNT; step++) {
    endMs += timeline.durationsMs[step]!;
    if (localMs < endMs) return timeline.order[step]!;
  }
  return timeline.order[XIAOMI_FRAME_COUNT - 1]!;
}
