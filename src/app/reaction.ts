import {
  tuneMotionTime,
  xiaomiActionDurationMs,
} from '../render/index.js';
import type { ActionKey, Cat, CatMotionTuning } from '../render/index.js';

/**
 * 完整帧动作在当前节奏与世界状态下的真实墙钟时长。
 *
 * 图集用调参后的局部时间选帧，运动层还会把生病/虚弱的 timeScale 乘进 dt；这里
 * 必须做完全相反的换算，桃心与动作窗口才能落在同一个结束点。
 */
export function reactionDurationMs(
  action: ActionKey,
  tuning: Partial<CatMotionTuning> | null | undefined,
  cat: Cat,
  worldTimeScale: number,
): number {
  const tunedScale = tuneMotionTime(1, tuning, action, cat);
  const scale = Math.max(0.001, tunedScale * Math.max(0.001, worldTimeScale));
  return xiaomiActionDurationMs(action) / scale;
}
