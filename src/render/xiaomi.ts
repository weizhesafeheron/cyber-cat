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

/**
 * 把动作局部时间映射到完整帧。
 *
 * 循环动作首尾相接；一次性动作走到末格后停住，避免世界层分配的剩余时长里
 * 又从第一格重播一次哈欠、扑跳或落地。
 */
export function xiaomiFrameIndex(action: ActionKey, seconds: number): number {
  const raw = Math.floor((Math.max(0, seconds) * 1000) / XIAOMI_FRAME_MS[action]);
  return ACTIONS[action].loop
    ? raw % XIAOMI_FRAME_COUNT
    : Math.min(raw, XIAOMI_FRAME_COUNT - 1);
}

