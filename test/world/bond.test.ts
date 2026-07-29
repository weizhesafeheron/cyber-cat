import { describe, expect, it } from 'vitest';
import { BOND_MAX, step } from '../../src/world/index.js';
import { BEAT, DAY, HOUR, TICK, makeWorld, runTicks } from './helpers.js';

/**
 * 亲密度：所有互动长期累积，长期不互动缓慢流失。
 *
 * 「长期」这个词是有内容的 - 一天来看两眼不该掉。所以流失有一段宽限期，
 * 只有超过它才开始扣。无条件流失写起来更短，但那就变成「每天都在掉」，
 * 与 CONTEXT.md 里「久不上线才折损」不是一回事。
 */

describe('亲密度累积', () => {
  it('添粮与抚摸都会累积亲密度', () => {
    const w = makeWorld({ hour: 18, patch: { needs: { hunger: 70, energy: 80, mood: 60 } } });
    const fed = step(w, 0, { actions: [{ type: 'fillBowl' }] }).world;
    const petted = step(w, 0, { actions: [{ type: 'pet' }] }).world;
    expect(fed.bond).toBeGreaterThan(w.bond);
    expect(petted.bond).toBeGreaterThan(w.bond);
  });

  it('长期照顾会把亲密度堆起来', () => {
    const w = makeWorld({ hour: 8 });
    const after = runTicks(w, 6 * 48, (i) =>
      i % 8 === 0 ? { actions: [{ type: 'fillBowl' }, { type: 'pet' }] } : {},
    ).world;
    expect(after.bond).toBeGreaterThan(w.bond + 30);
  });

  it('亲密度不会超过上限', () => {
    const w = makeWorld({ hour: 8, patch: { bond: BOND_MAX - 0.1 } });
    const after = runTicks(w, 100, () => ({ actions: [{ type: 'pet' }, { type: 'fillBowl' }] }));
    expect(after.world.bond).toBe(BOND_MAX);
  });
});

describe('亲密度流失', () => {
  it('宽限期内不流失（一天来看两眼不该掉）', () => {
    const w = makeWorld({ hour: 8, patch: { bond: 50 } });
    // 恰好一整天不互动，还在宽限期内。
    const after = runTicks(w, 48).world;
    expect(after.bond).toBe(50);
  });

  it('宽限期之后开始缓慢流失', () => {
    const w = makeWorld({ hour: 8, patch: { bond: 50 } });
    const after = runTicks(w, 3 * 48 + 24).world;
    expect(after.bond).toBeLessThan(50 - 3);
    // 「缓慢」是要求的一部分：三天半不理它也只掉个位数，不是清零。
    expect(after.bond).toBeGreaterThan(50 - 12);
  });

  it('互动会重置宽限期', () => {
    const base = makeWorld({ hour: 8, patch: { bond: 50 } });
    const neglected = runTicks(base, 2 * 48).world;
    // 每 24 小时摸一次，宽限期就永远不会走完。
    const visited = runTicks(base, 2 * 48, (i) => (i % 48 === 0 ? { actions: [{ type: 'pet' }] } : {}));
    expect(neglected.bond).toBeLessThan(50);
    expect(visited.world.bond).toBeGreaterThan(50);
  });

  it('亲密度不会掉到负数', () => {
    const w = makeWorld({ hour: 8, patch: { bond: 0.5 } });
    const after = runTicks(w, 3 * 48).world;
    expect(after.bond).toBe(0);
  });

  it('亲密度影响心情的基线', () => {
    const patch = { needs: { hunger: 80, energy: 80, mood: 40 } };
    const close = makeWorld({ hour: 18, patch: { ...patch, bond: BOND_MAX } });
    const distant = makeWorld({ hour: 18, patch: { ...patch, bond: 0 } });
    expect(runTicks(close, 20).world.needs.mood).toBeGreaterThan(
      runTicks(distant, 20).world.needs.mood,
    );
  });
});

describe('陪伴记录', () => {
  it('喂食与抚摸次数被记下来，告别页要用', () => {
    const w = makeWorld({ hour: 18, patch: { needs: { hunger: 70, energy: 80, mood: 60 } } });
    const after = runTicks(w, 20, (i) =>
      i % 4 === 0 ? { actions: [{ type: 'fillBowl' }, { type: 'pet' }] } : {},
    ).world;
    expect(after.stats.feedCount).toBe(5);
    expect(after.stats.petCount).toBeGreaterThan(0);
    expect(after.stats.petCount).toBeLessThanOrEqual(5);
  });

  it('猫死后统计不再变化', () => {
    const dead = runTicks(makeWorld({ hour: 9 }), 10 * 48).world;
    expect(dead.dead).toBe(true);
    const later = step(dead, DAY, { actions: [{ type: 'fillBowl' }, { type: 'pet' }] }).world;
    expect(later.stats).toEqual(dead.stats);
  });
});

describe('时间推进的算术', () => {
  it('时钟按整拍前进，不满一拍的零头单独留着', () => {
    const w = makeWorld({ hour: 8 });
    const after = step(w, 1.5 * HOUR + 10 * 60_000 + 7_000).world;
    // 100 分钟正好是 400 个整拍，7 秒不够一拍。
    expect(after.clock).toBe(w.clock + 100 * 60_000);
    expect(after.carryMs).toBe(7_000);
    // 模拟步的相位不靠时钟余额记，而靠已走过的拍数：400 = 3 个整步 + 40 拍。
    // 这个计数器必须进存档，否则重启会把「已经走了 10 分钟」忘掉。
    expect(after.beatsInTick).toBe(400 - 3 * (TICK / BEAT));
  });

  it('负的或零的时间差不会让世界倒退', () => {
    const w = makeWorld({ hour: 8 });
    expect(step(w, 0).world).toEqual(w);
    expect(step(w, -5 * HOUR).world).toEqual(w);
  });
});
