import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE } from './constants.js';
import type { World } from './types.js';

/**
 * 时钟换算。
 *
 * 全部是纯算术，**不用 Date**。作息节律要本地小时，而 Date 的本地小时来自
 * 运行环境的时区设置 - 用了它，同一份存档在不同机器上会演化出不同的作息，
 * 测试也会随 TZ 环境变量飘。时区偏移由平台层写进 world.tzOffsetMinutes。
 */

/** 本地小时，0..23（含小数）。 */
export function localHourOfDay(atMs: number, tzOffsetMinutes: number): number {
  const local = atMs + tzOffsetMinutes * MS_PER_MINUTE;
  const hours = local / MS_PER_HOUR;
  return ((hours % 24) + 24) % 24;
}

/** 本地日序号。用于日记的每日条数节流。 */
export function localDayIndex(atMs: number, tzOffsetMinutes: number): number {
  return Math.floor((atMs + tzOffsetMinutes * MS_PER_MINUTE) / MS_PER_DAY);
}

/**
 * 世界眼中的「现在」。
 *
 * = 已推进到的整步时刻 + 不满一步的余额。存档恢复时用它算离开了多久。
 */
export function worldNow(world: World): number {
  return world.clock + world.carryMs;
}

/** 猫已经陪了多少天（向上取整到 1，告别页用）。 */
export function companionDays(world: World, atMs: number): number {
  return Math.max(1, Math.round((atMs - world.identity.bornAt) / MS_PER_DAY));
}
