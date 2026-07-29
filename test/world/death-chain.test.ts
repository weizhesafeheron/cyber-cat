import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../src/render/rng.js';
import { NEED_MAX, step } from '../../src/world/index.js';
import type { UserAction, World, WorldEvent } from '../../src/world/index.js';
import { DAY, HOUR, TICK, kinds, makeWorld, runTicks } from './helpers.js';

/**
 * 挨饿 → 生病 → 死亡这条链。
 *
 * 时间常数照抄 docs/mvp-scope.md 2.3 的定档表，不从 constants.ts 导入 -
 * 理由同 needs.test.ts。
 */

const SPEC_HUNGER_FULL_TO_EMPTY_HOURS = 16;
const SPEC_STARVE_TO_SICK_HOURS = 24;
const SPEC_SICK_TO_DEATH_HOURS = 48;
/** 定档表：最后一次喂食 → 死亡约 3.7 天。 */
const SPEC_FED_TO_DEATH_HOURS =
  SPEC_HUNGER_FULL_TO_EMPTY_HOURS + SPEC_STARVE_TO_SICK_HOURS + SPEC_SICK_TO_DEATH_HOURS;

/** 时间断言的容差：一个模拟步。链上每一段都以整步为粒度，误差不会超过它。 */
const TOLERANCE_MS = TICK;

function fullFedWorld(): World {
  return makeWorld({ hour: 9, patch: { needs: { hunger: NEED_MAX, energy: 70, mood: 65 } } });
}

function eventAt(events: readonly WorldEvent[], kind: string): WorldEvent {
  const found = events.find((e) => e.kind === kind);
  if (!found) throw new Error(`事件序列里没有 ${kind}：${kinds(events).join(', ')}`);
  return found;
}

describe('死亡链的时间线', () => {
  const start = fullFedWorld();
  const run = runTicks(start, 10 * 48);

  it('饱食度归零 → 挨饿满 24 小时 → 生病', () => {
    const sickAt = eventAt(run.events, 'fellSick').at;
    const expected =
      start.clock + (SPEC_HUNGER_FULL_TO_EMPTY_HOURS + SPEC_STARVE_TO_SICK_HOURS) * HOUR;
    expect(Math.abs(sickAt - expected)).toBeLessThanOrEqual(TOLERANCE_MS);
  });

  it('生病满 48 小时 → 死亡', () => {
    const sickAt = eventAt(run.events, 'fellSick').at;
    const diedAt = eventAt(run.events, 'died').at;
    expect(Math.abs(diedAt - sickAt - SPEC_SICK_TO_DEATH_HOURS * HOUR)).toBeLessThanOrEqual(
      TOLERANCE_MS,
    );
  });

  it('从满格喂饱到死亡约 3.7 天，且不短于三天', () => {
    const diedAt = eventAt(run.events, 'died').at;
    const elapsed = diedAt - start.clock;
    expect(elapsed).toBeGreaterThanOrEqual(3 * DAY);
    expect(Math.abs(elapsed - SPEC_FED_TO_DEATH_HOURS * HOUR)).toBeLessThanOrEqual(TOLERANCE_MS);
  });

  it('挨饿期间会先明显表现出饿，用户有机会挽回', () => {
    const seq = kinds(run.events);
    expect(seq.indexOf('hungry')).toBeGreaterThanOrEqual(0);
    expect(seq.indexOf('hungry')).toBeLessThan(seq.indexOf('fellSick'));
    expect(seq.indexOf('starving')).toBeLessThan(seq.indexOf('fellSick'));
  });

  it('生病与死亡都是重要事件，必然进日记', () => {
    expect(eventAt(run.events, 'fellSick').important).toBe(true);
    expect(eventAt(run.events, 'died').important).toBe(true);
    expect(run.world.diary.map((e) => e.kind)).toContain('died');
  });

  it('告别页要的陪伴天数随事件带出', () => {
    expect(eventAt(run.events, 'died').data?.['days']).toBeGreaterThanOrEqual(3);
  });
});

describe('生病是死亡的必经前置状态', () => {
  /**
   * 穷举式检验：随机输入序列 + 随机种子，逐步（一步 = 30 分钟）跑，
   * 在死亡发生的那一步检查上一步的状态。
   *
   * 只靠「读代码知道 dead 只在 sick 分支里赋值」是不够的 - 那是实现细节，
   * 重构时会被搬走。这里断言的是外部可观察的时序关系。
   */
  const CARING: UserAction[] = [{ type: 'fillBowl' }, { type: 'pet' }, { type: 'medicate' }];
  /** 弃养：只摸不喂，也不喂药。用来保证穷举里真的有死掉的猫。 */
  const NEGLECTFUL: UserAction[] = [{ type: 'pet' }];

  const outcomes = { died: 0, survived: 0 };
  const violations: string[] = [];
  /** 未生病状态下最后一次真的吃到东西，到死亡之间的最短间隔。 */
  let minMealToDeath = Number.POSITIVE_INFINITY;

  for (let scenario = 0; scenario < 240; scenario++) {
    const rnd = mulberry32(scenario * 7919 + 13);
    /**
     * 三类剧本，缺一类这组穷举就有盲区：
     * - 一直照顾：几乎不会死，用来证明死亡不是必然。
     * - 一直弃养：必死，但从没吃过东西，测不到「进食 → 死亡」的间隔。
     * - 先养一阵再弃养：既有进食也有死亡，是三天下限唯一能被观测到的剧本。
     */
    const kind = scenario % 3;
    const abandonAfter = (2 + rnd() * 3) * 48;
    const poolAt = (tick: number): UserAction[] => {
      if (kind === 0) return CARING;
      if (kind === 1) return NEGLECTFUL;
      return tick < abandonAfter ? CARING : NEGLECTFUL;
    };
    let world = makeWorld({
      hour: Math.floor(rnd() * 24),
      seed: 1000 + scenario,
      patch: { needs: { hunger: rnd() * NEED_MAX, energy: rnd() * NEED_MAX, mood: rnd() * NEED_MAX } },
    });

    let lastHealthyMealAt: number | null = null;
    let sawSick = false;
    let died = false;

    for (let i = 0; i < 20 * 48 && !died; i++) {
      const actions: UserAction[] = [];
      // 大部分步没有输入；偶尔来一个，偶尔连来两个。
      const pool = poolAt(i);
      while (rnd() < 0.12) actions.push(pool[Math.floor(rnd() * pool.length)]!);

      const before = world;
      const r = step(world, TICK, { actions });
      world = r.world;

      if (world.sick) sawSick = true;
      if (r.events.some((e) => e.kind === 'ate' || e.kind === 'ateGreedy') && !world.sick) {
        lastHealthyMealAt = world.clock;
      }
      if (world.dead && !before.dead) {
        died = true;
        if (!before.sick) violations.push(`场景 ${scenario}：死亡前一步并未生病`);
        if (!sawSick) violations.push(`场景 ${scenario}：整个过程从未生病`);
        if (before.sickHours < SPEC_SICK_TO_DEATH_HOURS - 1) {
          violations.push(`场景 ${scenario}：生病仅 ${before.sickHours}h 就死亡`);
        }
        if (lastHealthyMealAt != null) {
          minMealToDeath = Math.min(minMealToDeath, world.clock - lastHealthyMealAt);
        }
      }
    }
    if (died) outcomes.died++;
    else outcomes.survived++;
  }

  it('对照组：穷举里既有死掉的猫也有活下来的猫（否则这组测试在测空气）', () => {
    expect(outcomes.died).toBeGreaterThan(20);
    expect(outcomes.survived).toBeGreaterThan(20);
  });

  it('不存在任何输入序列能让猫跳过生病直接死亡', () => {
    expect(violations).toEqual([]);
  });

  it('任何一次「健康时的进食」到死亡都不短于三天', () => {
    expect(minMealToDeath).toBeLessThan(Number.POSITIVE_INFINITY);
    expect(minMealToDeath).toBeGreaterThanOrEqual(3 * DAY);
  });
});

describe('死亡不可逆', () => {
  const dead = runTicks(fullFedWorld(), 10 * 48).world;

  it('确实已经死了', () => {
    expect(dead.dead).toBe(true);
    expect(dead.diedAt).not.toBeNull();
  });

  it('之后任何输入都不能让它复活，需求也不再变化', () => {
    let world = dead;
    const events: WorldEvent[] = [];
    for (let i = 0; i < 20 * 48; i++) {
      const r = step(world, TICK, {
        actions: [{ type: 'fillBowl' }, { type: 'pet' }, { type: 'medicate' }],
      });
      events.push(...r.events);
      world = r.world;
    }
    expect(world.dead).toBe(true);
    expect(world.diedAt).toBe(dead.diedAt);
    expect(world.needs).toEqual(dead.needs);
    expect(world.bond).toBe(dead.bond);
    expect(world.bowl).toBe(dead.bowl);
    expect(world.stats).toEqual(dead.stats);
    expect(events).toEqual([]);
  });

  it('死后世界时钟仍然前进，告别页才知道现在几点', () => {
    const later = step(dead, 3 * DAY).world;
    expect(later.clock).toBe(dead.clock + 3 * DAY);
  });

  it('死后 renderIntent 不再要求画猫', () => {
    const intent = step(dead, TICK).renderIntent;
    expect(intent.status).toBe('dead');
    expect(intent.action).toBeNull();
  });
});

describe('喂药治愈与病后虚弱', () => {
  /** 一只刚好在下一步进入生病的猫。 */
  function aboutToFallSick(): World {
    return makeWorld({
      hour: 10,
      patch: {
        needs: { hunger: 0, energy: 60, mood: 40 },
        starveHours: SPEC_STARVE_TO_SICK_HOURS - 0.5,
      },
    });
  }

  it('喂药立刻治愈，并进入病后虚弱', () => {
    const sick = step(aboutToFallSick(), TICK).world;
    expect(sick.sick).toBe(true);

    const cured = step(sick, 0, { actions: [{ type: 'medicate' }] });
    expect(cured.world.sick).toBe(false);
    expect(cured.world.sickHours).toBe(0);
    expect(cured.world.weakHours).toBeGreaterThan(0);
    expect(kinds(cured.events)).toContain('cured');
  });

  it('虚弱期是有限的，几小时后自行恢复', () => {
    const sick = step(aboutToFallSick(), TICK).world;
    const cured = step(sick, 0, { actions: [{ type: 'medicate' }] }).world;
    const weakHours = cured.weakHours;
    // 只在第一步添一次粮。每步都添会把当天的日记条数打满，
    // 后面的日常事件（含「恢复」）就会被上限挡掉 - 那是另一条规则在起作用，
    // 会把这个测试变成在测日记节流。
    const feedOnce = (i: number): { actions?: readonly [{ type: 'fillBowl' }] } =>
      i === 0 ? { actions: [{ type: 'fillBowl' }] } : {};

    const stillWeak = runTicks(cured, (weakHours * HOUR) / TICK - 1, feedOnce).world;
    expect(stillWeak.weakHours).toBeGreaterThan(0);

    const recovered = runTicks(cured, (weakHours * HOUR) / TICK, feedOnce);
    expect(recovered.world.weakHours).toBe(0);
    expect(kinds(recovered.events)).toContain('recoveredFromWeakness');
  });

  it('虚弱期动作放慢，是这段经历留下的痕迹', () => {
    const sick = step(aboutToFallSick(), TICK).world;
    const cured = step(sick, 0, { actions: [{ type: 'medicate' }] }).world;
    const weak = step(cured, TICK, { actions: [{ type: 'fillBowl' }] }).renderIntent;
    expect(weak.timeScale).toBeLessThan(1);

    const healthy = runTicks(cured, 20, () => ({ actions: [{ type: 'fillBowl' }] })).steps.at(-1)!;
    expect(healthy.renderIntent.timeScale).toBe(1);
  });

  it('治好之后不喂还是会重新走一遍死亡链（治愈不是免死）', () => {
    const sick = step(aboutToFallSick(), TICK).world;
    const cured = step(sick, 0, { actions: [{ type: 'medicate' }] }).world;
    const later = runTicks(cured, 10 * 48);
    expect(kinds(later.events)).toContain('fellSick');
    expect(later.world.dead).toBe(true);
  });

  it('没病的时候喂药是无操作，不产生事件也不改状态', () => {
    const healthy = makeWorld({ hour: 10 });
    const r = step(healthy, 0, { actions: [{ type: 'medicate' }] });
    expect(r.events).toEqual([]);
    expect(r.world.weakHours).toBe(0);
    expect(r.world).toEqual(healthy);
  });
});
