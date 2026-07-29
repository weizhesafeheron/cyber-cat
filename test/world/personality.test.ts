import { describe, expect, it } from 'vitest';
import { step } from '../../src/world/index.js';
import type { World } from '../../src/world/index.js';
import { TICK, countBy, feedEvery, findSeed, makeWorld, personalityOf } from './helpers.js';

/**
 * 性格影响行为。
 *
 * issue #6 要求的是「性格真实影响行为分布」，不是「性格被存下来了」。
 * 所以这里测的是 renderIntent 的**分布**：同一个世界、同样的输入，
 * 高活跃与低活跃的猫必须画出不一样的东西。
 *
 * 两处对照设计，缺了任何一处这组测试都会变成恒真：
 * - 两个世界的 rngState **必须相同**。不同随机流本身就产出不同分布。
 * - 统计只取**醒着且健康**的那些步。睡觉占掉一半的时间，混在一起会把
 *   活动上的差异稀释到看不见 - 实测就是这样先失败过一次。
 */

/** 跑一段时间，统计醒着且健康时 renderIntent 选了哪些动作。 */
function awakeActionMix(world: World, ticks: number): Record<string, number> {
  const feed = feedEvery(8);
  const picks: string[] = [];
  let current = world;
  for (let i = 0; i < ticks; i++) {
    const r = step(current, TICK, feed(i));
    current = r.world;
    if (current.dead) throw new Error('长跑里猫死了，统计不成立');
    if (!current.sleeping && !current.sick) picks.push(r.renderIntent.action ?? 'none');
  }
  if (picks.length < ticks / 8) throw new Error(`醒着的采样只有 ${picks.length} 步，统计工具坏了`);
  return countBy(picks);
}

const share = (mix: Record<string, number>, ...keys: string[]): number => {
  const total = Object.values(mix).reduce((a, b) => a + b, 0);
  return keys.reduce((sum, k) => sum + (mix[k] ?? 0), 0) / total;
};

/**
 * 活跃度落在两端的两只猫。品种取活跃度基线差最远的橘猫与奶牛，
 * 再在种子空间里挑到各自的极值 - 单靠品种基线拉不开足够的差距。
 * 世界层里品种除了性格之外不影响任何东西，所以这两只猫的唯一差别就是性格。
 */
const LAZY_SEED = findSeed('orange', (p) => p.active < 0.08);
const BUSY_SEED = findSeed('cow', (p) => p.active > 0.9);

const LAZY = makeWorld({ breed: 'orange', seed: LAZY_SEED, hour: 6 });
const BUSY = { ...makeWorld({ breed: 'cow', seed: BUSY_SEED, hour: 6 }), rngState: LAZY.rngState };

const TICKS = 40 * 48;

describe('性格影响 renderIntent 的分布', () => {
  const lazyMix = awakeActionMix(LAZY, TICKS);
  const busyMix = awakeActionMix(BUSY, TICKS);

  it('对照组：性格相同（同一个世界跑两次）分布完全一样', () => {
    expect(awakeActionMix(LAZY, 480)).toEqual(awakeActionMix(LAZY, 480));
  });

  it('对照组：两只猫的活跃度确实落在两端', () => {
    const lazy = personalityOf('orange', LAZY_SEED).active;
    const busy = personalityOf('cow', BUSY_SEED).active;
    expect(busy - lazy).toBeGreaterThan(0.7);
  });

  it('两只猫的动作分布不同', () => {
    expect(busyMix).not.toEqual(lazyMix);
  });

  it('活跃的猫走动与扑跳明显更多', () => {
    expect(share(busyMix, 'walk', 'pounce')).toBeGreaterThan(
      share(lazyMix, 'walk', 'pounce') * 2,
    );
  });

  it('懒的猫更多趴着与坐着', () => {
    expect(share(lazyMix, 'lie', 'sit')).toBeGreaterThan(share(busyMix, 'lie', 'sit') * 1.5);
  });

  it('两只猫的动作都不止一种（分布不是退化的）', () => {
    expect(Object.keys(lazyMix).length).toBeGreaterThan(4);
    expect(Object.keys(busyMix).length).toBeGreaterThan(4);
  });

  it('renderIntent 的动作全都是渲染层认识的键', () => {
    const known = new Set([
      'idle',
      'walk',
      'sit',
      'lie',
      'sleep',
      'groom',
      'eat',
      'yawn',
      'stretch',
      'pounce',
    ]);
    for (const key of [...Object.keys(lazyMix), ...Object.keys(busyMix)]) {
      expect(known.has(key)).toBe(true);
    }
  });

  it('骨架阶段写死的 idle 已经被真正的行为选择取代', () => {
    expect(share(lazyMix, 'idle')).toBeLessThan(0.5);
    expect(share(busyMix, 'idle')).toBeLessThan(0.5);
  });
});

describe('贪吃度决定开吃的早晚', () => {
  it('同一个饥饿度下，贪吃的猫这一步就吃了，不贪吃的还不动', () => {
    // 饥饿度 60 落在两端猫的开吃阈值之间。碗里有粮，因此差别只可能来自贪吃度。
    const patch = { needs: { hunger: 60, energy: 80, mood: 60 }, bowl: 2 };
    const seeds = Array.from({ length: 60 }, (_, i) => 11 + i * 7);

    const samples = seeds
      .map((seed) => {
        const r = step(makeWorld({ breed: 'amshort', seed, hour: 18, patch }), TICK);
        return {
          greedy: personalityOf('amshort', seed).greedy,
          // 这一步睡过去的猫不算 - 那时候不吃是因为在睡，不是因为不贪吃。
          awake: !r.world.sleeping,
          ate: r.events.some((e) => e.kind === 'ate' || e.kind === 'ateGreedy'),
        };
      })
      .filter((s) => s.awake && (s.greedy > 0.6 || s.greedy < 0.3));

    // 对照组：样本里贪吃与不贪吃的猫都有，否则下面的比较没有意义。
    expect(samples.filter((s) => s.greedy > 0.6).length).toBeGreaterThan(2);
    expect(samples.filter((s) => s.greedy < 0.3).length).toBeGreaterThan(2);

    for (const s of samples) {
      expect(s.ate).toBe(s.greedy > 0.6);
    }
  });
});
