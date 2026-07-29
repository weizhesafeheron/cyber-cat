import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../src/render/rng.js';
import { draw, seedRngState } from '../../src/world/rng.js';

/**
 * 可序列化随机源的对照测试。
 *
 * 世界层把 PRNG 状态摊成一个整数放进存档，这是「离线推演可回放」的前提。
 * 但摊状态这件事本身就是一处可能悄悄出错的改写 - 少一个 |0，随机流就在某个
 * 溢出点之后偏离，而症状是「几十步之后猫的行为不一样了」，极难归因。
 *
 * 所以这里用渲染层现成的 mulberry32 当对照组，逐个值比对。
 * 最后一条是对**测试本身**的检验：换个种子必须比对失败，否则这个测试在测空气。
 */
describe('可序列化随机源', () => {
  const seeds = [0, 1, 42, 20260728, -7, 0x7fffffff, seedRngState(20260728)];

  for (const seed of seeds) {
    it(`种子 ${seed} 的序列与 mulberry32 完全一致`, () => {
      const reference = mulberry32(seed);
      let state = seed;
      for (let i = 0; i < 5000; i++) {
        const d = draw(state);
        state = d.state;
        expect(d.value).toBe(reference());
      }
    });
  }

  it('对照组：换一个种子后序列必须不同（证明上面在真比对）', () => {
    const reference = mulberry32(12345);
    let state = 12346;
    let mismatches = 0;
    for (let i = 0; i < 200; i++) {
      const d = draw(state);
      state = d.state;
      if (d.value !== reference()) mismatches++;
    }
    expect(mismatches).toBeGreaterThan(190);
  });

  it('状态始终是 int32，不会溢出成浮点', () => {
    let state = seedRngState(999);
    for (let i = 0; i < 10_000; i++) {
      state = draw(state).state;
      expect(Number.isInteger(state)).toBe(true);
      expect(state).toBe(state | 0);
    }
  });
});
