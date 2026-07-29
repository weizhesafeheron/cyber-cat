import { mulberry32 } from '../render/rng.js';

/**
 * 可序列化的随机源。
 *
 * 世界层不能持有一个闭包形式的 PRNG - 闭包进不了 JSON，存档往返之后随机流
 * 就断了，离线推演也就不再可回放（ADR 0001）。所以这里把 PRNG 的状态摊成
 * 一个 32 位整数放进 world，每次取值同时算出下一个状态。
 *
 * 产出的序列与 `mulberry32(seed)` 逐个调用完全一致 - 值本身就是它算的，
 * 这里只额外把状态推进公开出来。等价性由 test/world/rng.test.ts 用
 * `mulberry32` 本身作对照组守着。
 */

/** mulberry32 每次调用对内部状态施加的增量。 */
const MULBERRY32_STEP = 0x6d2b79f5;

export interface Draw {
  /** [0, 1) */
  value: number;
  /** 下一次取值应传入的状态。 */
  state: number;
}

export function draw(state: number): Draw {
  // 末尾的 |0 不是装饰：不截回 int32 的话状态会溢出成浮点，随机流从此偏离。
  return { value: mulberry32(state)(), state: (((state | 0) + MULBERRY32_STEP) | 0) };
}

/** 由个体种子导出初始随机状态。与 prototype ④ 的取法一致。 */
export function seedRngState(seed: number): number {
  return (seed ^ 0x5f3759df) | 0;
}
