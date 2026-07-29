import {
  BORED_AFTER_POUNCES,
  BORED_COOLDOWN_MS,
  CHASES_PER_HOUR_ACTIVE,
  CHASES_PER_HOUR_LAZY,
  CHASE_WINDOW_MS,
  POUNCE_OFFSET_PX,
  REACT_DELAY_ACTIVE_MS,
  REACT_DELAY_LAZY_MS,
} from './constants.js';
import { chaseQuota, pruneChases } from './gates.js';

/**
 * 逗猫的运行期状态与落点计算。
 *
 * **这些状态不进存档，也不进 World。** 它们由帧级事件驱动（光标扑了几次、
 * 上次扑是什么时候），而世界层不能被帧级数据驱动 - 那会破坏离线推演的等价性
 * （ADR 0001、0007）。代价是重启之后「玩腻」与「每小时上限」从头算，
 * 这是可以接受的：那两条防的是连续骚扰，而重启本身就打断了连续性。
 */

export interface TeaseState {
  /** 连续扑中几次。被别的事打断（睡了、走开了）就归零。 */
  readonly pouncesInARow: number;
  /** 玩腻的冷却截止时刻，毫秒。null = 不在冷却里。 */
  readonly boredUntil: number | null;
  /** 最近一次扑跳的时刻，毫秒。 */
  readonly lastPounceAt: number | null;
  /** 统计窗口内的追逐时刻，用于全局节流。 */
  readonly recentChases: readonly number[];
}

export const INITIAL_TEASE: TeaseState = {
  pouncesInARow: 0,
  boredUntil: null,
  lastPounceAt: null,
  recentChases: [],
};

/** 这只猫每小时能追几次。活跃度高的上限更高。 */
export function quotaFor(active: number): number {
  return chaseQuota(active, CHASES_PER_HOUR_LAZY, CHASES_PER_HOUR_ACTIVE);
}

/**
 * 从「注意到」到「起跳」等多久，毫秒。
 *
 * 懒猫慢半拍，活跃的猫说走就走。票上要求响应节奏由性格缩放而不是全局常量 -
 * 这个延迟是那条要求最直接的落点，而且它顺带让猫不像个瞄准器：
 * 零延迟的追逐读起来是程序在响应事件，不是一只猫动了心。
 */
export function reactDelayMs(active: number): number {
  return REACT_DELAY_LAZY_MS + (REACT_DELAY_ACTIVE_MS - REACT_DELAY_LAZY_MS) * active;
}

/**
 * 扑跳的落点，屏幕 x。
 *
 * **不扑到光标上**（票上的硬要求）：落在光标偏猫这一侧的位置上，猫停在旁边，
 * 不压住用户要点的东西。
 *
 * 偏向猫来的那一侧而不是随便挑一边：猫从左边过来就停在光标左边，
 * 从右边来就停右边。反过来的话猫会穿过光标再回头，读起来像扑失手了。
 */
export function pounceLandingX(cursorX: number, catX: number): number {
  const fromLeft = catX <= cursorX;
  return cursorX + (fromLeft ? -POUNCE_OFFSET_PX : POUNCE_OFFSET_PX);
}

/** 记下一次扑跳。连续次数加一，够数就进冷却。 */
export function afterPounce(state: TeaseState, now: number): TeaseState {
  const inARow = state.pouncesInARow + 1;
  const bored = inARow >= BORED_AFTER_POUNCES;
  return {
    pouncesInARow: inARow,
    boredUntil: bored ? now + BORED_COOLDOWN_MS : state.boredUntil,
    lastPounceAt: now,
    recentChases: pruneChases([...state.recentChases, now], now, CHASE_WINDOW_MS),
  };
}

/**
 * 冷却走完就把连续次数归零，重新开始算。
 *
 * 每帧调一次。**不在这里清 recentChases** - 全局节流的窗口是一小时，
 * 与玩腻是两条独立的闸门，混在一起清会让「玩腻一次就把一小时的额度也重置了」。
 */
export function refreshTease(state: TeaseState, now: number): TeaseState {
  const chases = pruneChases(state.recentChases, now, CHASE_WINDOW_MS);
  const cooledDown = state.boredUntil !== null && now >= state.boredUntil;
  if (!cooledDown) {
    return chases === state.recentChases ? state : { ...state, recentChases: chases };
  }
  return { ...state, pouncesInARow: 0, boredUntil: null, recentChases: chases };
}

/**
 * 被别的事打断（睡着、生病、被拎起来）时清掉连续计数。
 *
 * 「连续扑中三次」说的是一串不被打断的追逐。猫睡了一觉起来又扑三次，
 * 那是两串，不该算成六次。
 */
export function interruptTease(state: TeaseState): TeaseState {
  if (state.pouncesInARow === 0) return state;
  return { ...state, pouncesInARow: 0 };
}
