import { describe, expect, it } from 'vitest';
import { NEED_MAX, step } from '../../src/world/index.js';
import { HOUR, TICK, feedEvery, makeWorld, runTicks } from './helpers.js';

/**
 * 三条需求的演化速率。
 *
 * 这里的数字**直接照抄 docs/mvp-scope.md 2.3 的定档表**，而不是从
 * src/world/constants.ts 导入 - 从常量导入的话，改常量测试会跟着改，
 * 那这个测试就不再是「产品节奏的锚」，只是把代码抄了一遍。
 * 改动定档数值会让这里失败，那是期望行为。
 */

/** docs/mvp-scope.md 2.3：饱食度满 → 空约 16 小时。 */
const SPEC_HUNGER_FULL_TO_EMPTY_HOURS = 16;

describe('饱食度', () => {
  it(`满格不喂，${SPEC_HUNGER_FULL_TO_EMPTY_HOURS} 小时后恰好归零`, () => {
    const w = makeWorld({ hour: 8, patch: { needs: { hunger: NEED_MAX, energy: 70, mood: 65 } } });
    const ticksToEmpty = (SPEC_HUNGER_FULL_TO_EMPTY_HOURS * HOUR) / TICK;

    // 提前一步还没空，正好那一步空 - 卡住上下两侧，不给「差不多」留余地。
    expect(runTicks(w, ticksToEmpty - 1).world.needs.hunger).toBeGreaterThan(0);
    expect(runTicks(w, ticksToEmpty).world.needs.hunger).toBe(0);
  });

  it('中途任意时刻的饱食度都落在线性下降线上', () => {
    const w = makeWorld({ hour: 8, patch: { needs: { hunger: NEED_MAX, energy: 70, mood: 65 } } });
    for (const hours of [2, 4, 8, 12]) {
      const after = runTicks(w, (hours * HOUR) / TICK).world;
      const expected = NEED_MAX * (1 - hours / SPEC_HUNGER_FULL_TO_EMPTY_HOURS);
      expect(after.needs.hunger).toBeCloseTo(expected, 8);
    }
  });

  it('饱食度下降与睡醒无关（睡着的猫照样会饿）', () => {
    // 深夜 + 精力不足，这两小时里不会醒，饱食度的下降因此可以精确断言。
    const asleep = makeWorld({
      hour: 1,
      patch: { sleeping: true, needs: { hunger: NEED_MAX, energy: 40, mood: 65 } },
    });
    const after = runTicks(asleep, 4).world;
    expect(after.sleeping).toBe(true);
    expect(after.needs.hunger).toBeCloseTo(
      NEED_MAX - (2 / SPEC_HUNGER_FULL_TO_EMPTY_HOURS) * NEED_MAX,
      8,
    );
  });

  it('进食后饱食度不超过满格', () => {
    const w = makeWorld({ hour: 8, patch: { bowl: 3, needs: { hunger: 90, energy: 70, mood: 65 } } });
    const after = runTicks(w, 20).world;
    expect(after.needs.hunger).toBeLessThanOrEqual(NEED_MAX);
    expect(after.needs.hunger).toBeGreaterThan(0);
  });
});

describe('精力', () => {
  /**
   * 猫什么时候睡由节律与随机数决定，没有哪个精力区间能保证它醒着，
   * 所以速率不能靠「跑 N 步再看总量」来断言。
   * 改成对每一步下判断：这一步全程醒着，精力就必须恰好掉一步的量。
   * 断言的是速率本身，而且不受作息影响。
   */
  const perTick = (hours: number): number => (NEED_MAX * 0.5) / hours;

  it('醒着的每一步都按「约 16 小时耗尽」的速率掉精力', () => {
    const w = makeWorld({ hour: 6 });
    const { steps } = runTicks(w, 400, feedEvery(8));
    let checked = 0;
    let prev = w;
    for (const s of steps) {
      const stayedAwake = !prev.sleeping && !s.world.sleeping;
      // 触底会被 clamp 截断，虚弱期有额外倍率 - 这两类步不适用基准速率。
      const measurable = s.world.needs.energy > 0 && prev.weakHours === 0;
      if (stayedAwake && measurable) {
        expect(prev.needs.energy - s.world.needs.energy).toBeCloseTo(perTick(16), 8);
        checked++;
      }
      prev = s.world;
    }
    expect(checked).toBeGreaterThan(80);
  });

  it('睡着的每一步都按「约 7 小时回满」的速率恢复精力', () => {
    const w = makeWorld({ hour: 6 });
    const { steps } = runTicks(w, 400, feedEvery(8));
    let checked = 0;
    let prev = w;
    for (const s of steps) {
      const stayedAsleep = prev.sleeping && s.world.sleeping;
      if (stayedAsleep && s.world.needs.energy < NEED_MAX) {
        expect(s.world.needs.energy - prev.needs.energy).toBeCloseTo(perTick(7), 8);
        checked++;
      }
      prev = s.world;
    }
    expect(checked).toBeGreaterThan(40);
  });

  it('精力耗尽会强制入睡，不看时段也不看概率', () => {
    // 黄昏是最活跃的时段，此时仍然倒下睡才说明是「累垮了」而不是「困了」。
    const w = makeWorld({ hour: 18, patch: { needs: { hunger: 80, energy: 5, mood: 65 } } });
    expect(step(w, TICK).world.sleeping).toBe(true);
  });

  it('没睡够不会自己醒（只有累垮才会在活跃时段倒下）', () => {
    const w = makeWorld({
      hour: 18,
      patch: { sleeping: true, needs: { hunger: 80, energy: 25, mood: 65 } },
    });
    // 精力低于「睡够了」的门槛，即使在最活跃的时段也会一直睡。
    const { steps } = runTicks(w, 4);
    for (const s of steps.slice(0, 3)) expect(s.world.sleeping).toBe(true);
  });

  it('睡够了在活跃时段会醒来', () => {
    const w = makeWorld({
      hour: 18,
      patch: { sleeping: true, needs: { hunger: 80, energy: 95, mood: 65 } },
    });
    const { steps } = runTicks(w, 12);
    expect(steps.some((s) => !s.world.sleeping)).toBe(true);
  });

  it('需求永远落在 0..100 之间', () => {
    const w = makeWorld({ hour: 0 });
    const { steps } = runTicks(w, 48 * 5, feedEvery(10));
    for (const s of steps) {
      for (const v of [s.world.needs.hunger, s.world.needs.energy, s.world.needs.mood, s.world.bond]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(NEED_MAX);
      }
    }
  });
});

describe('心情', () => {
  it('向基线回落而不是无因漂移', () => {
    const low = makeWorld({ hour: 8, patch: { needs: { hunger: 80, energy: 70, mood: 0 } } });
    const high = makeWorld({ hour: 8, patch: { needs: { hunger: 80, energy: 70, mood: 100 } } });

    const afterLow = runTicks(low, 20).world.needs.mood;
    const afterHigh = runTicks(high, 20).world.needs.mood;

    expect(afterLow).toBeGreaterThan(0);
    expect(afterHigh).toBeLessThan(100);
    // 从两侧出发都收敛到同一个区间。
    expect(Math.abs(afterLow - afterHigh)).toBeLessThan(12);
  });

  it('挨饿与生病都会明显压低心情', () => {
    const ok = makeWorld({ hour: 8, patch: { needs: { hunger: 80, energy: 70, mood: 55 } } });
    const starving = makeWorld({ hour: 8, patch: { needs: { hunger: 0, energy: 70, mood: 55 } } });
    const sick = makeWorld({
      hour: 8,
      patch: { sick: true, sickHours: 1, needs: { hunger: 80, energy: 70, mood: 55 } },
    });

    const m = (w: ReturnType<typeof makeWorld>): number => runTicks(w, 12).world.needs.mood;
    expect(m(starving)).toBeLessThan(m(ok) - 10);
    expect(m(sick)).toBeLessThan(m(ok) - 10);
  });

  it('抚摸能拉升心情，且增益会逐步衰减', () => {
    const w = makeWorld({ hour: 8, patch: { needs: { hunger: 80, energy: 70, mood: 55 } } });
    const petted = step(w, TICK, { actions: [{ type: 'pet' }] }).world;
    const plain = step(w, TICK).world;
    expect(petted.needs.mood).toBeGreaterThan(plain.needs.mood);

    // 增益不是永久加成：不再互动之后心情回落。
    const later = runTicks(petted, 30).world;
    expect(later.needs.mood).toBeLessThan(petted.needs.mood + 12);
    expect(later.playGlow).toBe(0);
  });
});
