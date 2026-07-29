/**
 * 世界层。猫的状态权威。
 *
 * 对外只有一个函数 `step(world, elapsedMs, inputs)`。
 * 平台无关、无 I/O、无时钟、无随机源 - 时钟与随机源由调用方注入。
 * 这是离线推演可回放、可测试的前提（ADR 0001），也是缝一测试的落点。
 */
export * from './types.js';
export { step } from './step.js';
export { createWorld, type AdoptionSpec } from './create.js';
export { renderIntentOf, statusOf } from './intent.js';
export { parseWorld, serializeWorld, SaveFormatError } from './save.js';
export { companionDays, localDayIndex, localHourOfDay, worldNow } from './clock.js';
export * from './constants.js';
