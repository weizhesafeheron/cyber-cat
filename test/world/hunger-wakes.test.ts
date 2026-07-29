import { describe, expect, it } from 'vitest';
import {
  ENERGY_EXHAUSTED,
  HUNGER_WAKES_THRESHOLD,
  HUNGRY_VISIBLE_THRESHOLD,
  step,
} from '../../src/world/index.js';
import type { World } from '../../src/world/index.js';
import { TICK, kinds, makeWorld } from './helpers.js';

/**
 * 饿会压过作息节律。
 *
 * 起因是真机上撞到的一幕：饱食度 26.9、碗里三份粮，连跑三个模拟步全在睡，
 * 饱食度只降不升。因为吃饭要求猫是醒的，而深夜的入睡倾向 0.85、醒来概率只有
 * 每半小时 4.5% - 一只饿着的猫能睡满整夜，碗里的粮一口不动，一路饿到生病。
 * 用户看到的是「碗是满的，猫却饿病了」，那读起来是系统坏了。
 *
 * 这条规则**不推翻**「睡着的可能睡完这觉」：阈值之上一切照旧，那条由下面的
 * 对照组守着。
 */

/** 深夜（入睡倾向最高的时段）的一只猫。`hunger` 决定饿不饿。 */
const atNight = (hunger: number, patch: Partial<World['needs']> = {}, seed = 20260728): World =>
  makeWorld({
    hour: 2,
    seed,
    patch: {
      bowl: 3,
      sleeping: false,
      needs: { hunger, energy: 80, mood: 60, ...patch },
    },
  });

/** 跑若干个整步，返回每一步之后是否在睡。 */
function sleepTrace(w: World, ticks: number): boolean[] {
  const out: boolean[] = [];
  let cur = w;
  for (let i = 0; i < ticks; i++) {
    cur = step(cur, TICK).world;
    out.push(cur.sleeping);
  }
  return out;
}

/**
 * 几个种子的平均「醒着的步数」。单条轨迹的噪声太大，比分布才有意义。
 *
 * **碗必须是空的。** 有粮的话猫第一步就吃上了、不饿了、于是正常睡下去 -
 * 那正是这条规则要的效果，但它让「饿着的猫睡不睡」这个问题变得没法观察。
 * 第一版忘了这点，测出「饿着平均醒 3.4 步、不饿的 3 步」，看着像规则没生效。
 */
function awakeSteps(hunger: number, ticks: number): number {
  const seeds = [20260728, 7, 31, 4242, 99991];
  let total = 0;
  for (const seed of seeds) {
    const w = atNight(hunger, {}, seed);
    total += sleepTrace({ ...w, bowl: 0 }, ticks).filter((s) => !s).length;
  }
  return total / seeds.length;
}

describe('饿着的猫睡不安稳', () => {
  it('深夜里饿着的猫多半醒着，不饿的多半睡着', () => {
    // 比分布而不是比单条轨迹：单条里「第几步睡下去」的噪声能有两三步。
    const hungry = awakeSteps(HUNGER_WAKES_THRESHOLD - 5, 12);
    const full = awakeSteps(90, 12);
    // 对照组：同一个时段、同一批种子，只有饱食度不同
    expect(hungry, `饿着平均醒 ${hungry} 步，不饿的醒 ${full} 步`).toBeGreaterThan(full * 1.5);
    expect(hungry).toBeGreaterThan(8);
  });

  it('已经睡着的饿猫会被饿醒', () => {
    const asleep = makeWorld({
      hour: 2,
      patch: {
        bowl: 3,
        sleeping: true,
        needs: { hunger: HUNGER_WAKES_THRESHOLD - 8, energy: 80, mood: 60 },
      },
    });
    const trace = sleepTrace(asleep, 4);
    expect(trace.some((s) => !s), '四步之内没被饿醒').toBe(true);
  });

  it('对照组：不饿的睡猫在深夜不会被叫醒 - 邀请式语义没被推翻', () => {
    const asleep = makeWorld({
      hour: 2,
      patch: { bowl: 3, sleeping: true, needs: { hunger: 90, energy: 60, mood: 60 } },
    });
    // 深夜醒来概率 4.5% 每步，四步内几乎不可能醒
    expect(sleepTrace(asleep, 4).every((s) => s)).toBe(true);
  });
});

describe('两条底线', () => {
  it('饿也拦不住累垮 - 饿与累同时到极限时猫会倒下', () => {
    const spent = atNight(HUNGER_WAKES_THRESHOLD - 10, { energy: 5 });
    expect(step(spent, TICK).world.sleeping).toBe(true);
  });

  it('醒过来的那一刻精力必须高于累垮线 - 否则会在「饿醒、累倒」之间来回抖', () => {
    // 守的不是「一直睡」：睡两步把精力攒到线以上再被饿醒是对的行为。
    // 守的是「不会在低于累垮线时醒」- 那才是抖动的来源。
    let w = makeWorld({
      hour: 2,
      patch: {
        bowl: 0, // 碗空着，排除「吃了一顿」这种干扰
        sleeping: true,
        needs: { hunger: HUNGER_WAKES_THRESHOLD - 10, energy: 6, mood: 60 },
      },
    });
    let wokeAtEnergy: number | null = null;
    for (let i = 0; i < 8; i++) {
      const before = w;
      w = step(w, TICK).world;
      if (before.sleeping && !w.sleeping) {
        // 读**决定醒来那一刻**的精力，不是这一步结束时的值：
        // decideSleep 跑在精力更新之前，醒着的那半步还会再掉一截。
        wokeAtEnergy = before.needs.energy;
        break;
      }
    }
    // 这段里确实醒过（否则下面那条断言是空的）
    expect(wokeAtEnergy, '八步之内一直没醒，这条测试没测到东西').not.toBeNull();
    expect(wokeAtEnergy!, `在精力 ${wokeAtEnergy} 时就被饿醒了`).toBeGreaterThan(ENERGY_EXHAUSTED);
  });
});

describe('这条规则要达到的效果', () => {
  it('深夜 + 饿 + 碗里有粮 → 几小时内一定吃上，不会睡着饿下去', () => {
    let w = atNight(HUNGER_WAKES_THRESHOLD - 5);
    const start = w.needs.hunger;
    let ate = false;
    for (let i = 0; i < 8 && !ate; i++) {
      const r = step(w, TICK);
      w = r.world;
      ate = kinds(r.events).some((k) => k === 'ate' || k === 'ateGreedy');
    }
    expect(ate, '四小时里都没吃上').toBe(true);
    expect(w.needs.hunger).toBeGreaterThan(start);
  });

  it('阈值在「饿到有可视表现」之前 - 猫是醒着走到食盆边的，用户才看得见', () => {
    expect(HUNGER_WAKES_THRESHOLD).toBeGreaterThan(HUNGRY_VISIBLE_THRESHOLD);
  });

  it('对照组：碗是空的时候，猫仍然醒着（这才有「在食盆边徘徊」可看）', () => {
    const noFood = makeWorld({
      hour: 2,
      patch: {
        bowl: 0,
        sleeping: false,
        needs: { hunger: HUNGER_WAKES_THRESHOLD - 5, energy: 80, mood: 60 },
      },
    });
    const trace = sleepTrace(noFood, 6);
    expect(trace.filter((s) => !s).length, '碗空着就睡过去了，用户看不到饿的信号').toBeGreaterThan(3);
  });
});
