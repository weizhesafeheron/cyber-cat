import { describe, expect, it } from 'vitest';
import { localHourOfDay, step } from '../../src/world/index.js';
import type { World } from '../../src/world/index.js';
import { HOUR, TICK, feedEvery, makeWorld } from './helpers.js';

/**
 * 作息节律：真实猫的晨昏型分布（黎明黄昏活跃、白天大睡、深夜偶发跑酷）。
 *
 * 这里测的是**分布**而不是单点行为 - 单点行为受随机数支配，断言它只会得到
 * 一个脆弱的测试。做法是长跑几十天、按本地小时分桶统计睡眠比例，
 * 然后断言桶之间的大小关系。
 */

/** 按本地小时统计睡眠比例。 */
function sleepByHour(world: World, days: number): Map<number, { slept: number; total: number }> {
  const buckets = new Map<number, { slept: number; total: number }>();
  let current = world;
  const feed = feedEvery(8);
  for (let i = 0; i < days * 48; i++) {
    const r = step(current, TICK, feed(i));
    current = r.world;
    // 猫死了统计就没意义了 - 长跑测试必须先确认它活着。
    if (current.dead) throw new Error(`第 ${i} 步猫就死了，喂食节奏不足以支撑这个统计`);
    const hour = Math.floor(localHourOfDay(current.clock, current.tzOffsetMinutes));
    const b = buckets.get(hour) ?? { slept: 0, total: 0 };
    b.total++;
    if (current.sleeping) b.slept++;
    buckets.set(hour, b);
  }
  return buckets;
}

function ratio(
  buckets: Map<number, { slept: number; total: number }>,
  from: number,
  to: number,
): number {
  let slept = 0;
  let total = 0;
  for (let h = from; h < to; h++) {
    const b = buckets.get(h);
    if (!b) continue;
    slept += b.slept;
    total += b.total;
  }
  if (total === 0) throw new Error(`${from}-${to} 时段没有采样，统计工具坏了`);
  return slept / total;
}

describe('晨昏型作息', () => {
  const buckets = sleepByHour(makeWorld({ hour: 0, breed: 'amshort' }), 40);

  const deepNight = ratio(buckets, 0, 6);
  const dawn = ratio(buckets, 6, 12);
  const dayNap = ratio(buckets, 12, 16);
  const dusk = ratio(buckets, 16, 22);
  const lateEvening = ratio(buckets, 22, 24);

  it('对照组：采样覆盖了全部 24 个小时桶（否则下面的比较是在比空桶）', () => {
    for (let h = 0; h < 24; h++) {
      expect(buckets.get(h)?.total ?? 0).toBeGreaterThan(20);
    }
  });

  it('深夜睡得最多', () => {
    expect(deepNight).toBeGreaterThan(dayNap);
    expect(deepNight).toBeGreaterThan(dawn);
    expect(deepNight).toBeGreaterThan(dusk);
    expect(deepNight).toBeGreaterThan(0.6);
  });

  it('白天有一段大睡，明显多于黎明与黄昏', () => {
    expect(dayNap).toBeGreaterThan(dawn * 1.5);
    expect(dayNap).toBeGreaterThan(dusk * 1.5);
  });

  it('黎明与黄昏最活跃', () => {
    expect(dawn).toBeLessThan(dayNap);
    expect(dusk).toBeLessThan(dayNap);
    expect(Math.max(dawn, dusk)).toBeLessThan(0.5);
  });

  it('入夜前的睡眠倾向已经上来，但还不到深夜的程度', () => {
    expect(lateEvening).toBeGreaterThan(dusk);
    expect(lateEvening).toBeLessThan(deepNight);
  });
});

describe('懒猫午睡更久', () => {
  /**
   * 活跃度对作息本身的影响。两个品种的活跃度基线差得最远（橘猫 0.25、奶牛 0.85），
   * 而在世界层里品种除了性格之外不影响任何东西。
   */
  it('活跃度低的猫在白天睡得比活跃度高的猫多', () => {
    const lazy = sleepByHour(makeWorld({ hour: 0, breed: 'orange' }), 40);
    const busy = sleepByHour(makeWorld({ hour: 0, breed: 'cow' }), 40);
    expect(ratio(lazy, 12, 16)).toBeGreaterThan(ratio(busy, 12, 16));
  });
});

describe('深夜偶发跑酷', () => {
  it('跑酷只发生在深夜时段', () => {
    let world = makeWorld({ hour: 16, breed: 'cow' });
    const feed = feedEvery(8);
    const hours: number[] = [];
    for (let i = 0; i < 40 * 48; i++) {
      const r = step(world, TICK, feed(i));
      world = r.world;
      for (const e of r.events) {
        if (e.kind === 'zoomies') hours.push(Math.floor(localHourOfDay(e.at, 0)));
      }
    }
    expect(hours.length).toBeGreaterThan(5);
    for (const h of hours) expect(h >= 22 || h < 2).toBe(true);
  });
});

describe('时区由存档携带，不读系统时区', () => {
  it('同一个 UTC 时刻在不同时区偏移下作息不同', () => {
    const base = makeWorld({ hour: 4 });
    // UTC 04:00 在 UTC+0 是深夜，在 UTC+8 是正午前后 - 同一时刻，不同节律。
    const utc = { ...base, tzOffsetMinutes: 0 };
    const east8 = { ...base, tzOffsetMinutes: 480 };

    expect(localHourOfDay(base.clock, 0)).toBe(4);
    expect(localHourOfDay(base.clock, 480)).toBe(12);

    let a = utc;
    let b = east8;
    for (let i = 0; i < 8; i++) {
      a = step(a, TICK).world;
      b = step(b, TICK).world;
    }
    expect(a).not.toEqual(b);
  });

  it('时区偏移不影响时间的推进量，只影响本地小时', () => {
    const base = makeWorld({ hour: 4 });
    const shifted = step({ ...base, tzOffsetMinutes: 480 }, 6 * HOUR).world;
    expect(shifted.clock).toBe(base.clock + 6 * HOUR);
  });
});
