import { describe, expect, it } from 'vitest';
import { step } from '../../src/world/index.js';
import { TICK, findSeed, kinds, makeWorld, personalityOf, runTicks } from './helpers.js';

/**
 * 邀请式交互（CONTEXT.md）。
 *
 * 用户的动作只影响环境或发出邀请，猫保有自主决定权。
 * 这一组测试是在守「猫不是一个按钮」这条产品气质，
 * 每一条都对应一个很容易在实现里被「优化」掉的分支 -
 * 比如「添粮后直接给饱食度 +62」写起来更短，但那就退回命令式了。
 */

/** 贪吃度接近上限的猫。makeCat 确定性，因此这两个种子固定。 */
const GREEDY_SEED = findSeed('orange', (p) => p.greedy > 0.93);
/** 贪吃度接近下限的猫。 */
const PICKY_SEED = findSeed('orange', (p) => p.greedy < 0.07);

describe('添粮是邀请，不是命令', () => {
  it('添粮那一刻饱食度完全不变，只是碗里有了粮', () => {
    const w = makeWorld({ hour: 10, patch: { needs: { hunger: 30, energy: 70, mood: 60 } } });
    const r = step(w, 0, { actions: [{ type: 'fillBowl' }] });
    expect(r.world.needs.hunger).toBe(30);
    expect(r.world.bowl).toBeGreaterThan(0);
    expect(kinds(r.events)).toEqual(['fedByOwner']);
  });

  it('不饿的猫不会因为你添了粮就去吃', () => {
    const w = makeWorld({
      seed: PICKY_SEED,
      hour: 10,
      patch: { needs: { hunger: 95, energy: 70, mood: 60 } },
    });
    const after = runTicks(w, 4, (i) => (i === 0 ? { actions: [{ type: 'fillBowl' }] } : {}));
    expect(kinds(after.events)).not.toContain('ate');
    expect(after.world.bowl).toBeGreaterThan(0);
  });

  it('进食时机受贪吃度影响：同样的饥饿度，贪吃的先动嘴', () => {
    // 60 落在两只猫的开吃阈值之间，因此差别只可能来自贪吃度。
    const patch = { needs: { hunger: 60, energy: 70, mood: 60 }, bowl: 2 };
    const greedy = makeWorld({ seed: GREEDY_SEED, hour: 10, patch });
    const picky = makeWorld({ seed: PICKY_SEED, hour: 10, patch });

    expect(personalityOf('orange', GREEDY_SEED).greedy).toBeGreaterThan(
      personalityOf('orange', PICKY_SEED).greedy,
    );

    const greedyEatsAt = runTicks(greedy, 12).steps.findIndex((s) =>
      s.events.some((e) => e.kind === 'ate' || e.kind === 'ateGreedy'),
    );
    const pickyEatsAt = runTicks(picky, 12).steps.findIndex((s) =>
      s.events.some((e) => e.kind === 'ate' || e.kind === 'ateGreedy'),
    );

    expect(greedyEatsAt).toBe(0);
    expect(pickyEatsAt).toBeGreaterThan(greedyEatsAt);
  });

  it('饿到一定程度，不贪吃的猫最终也会去吃', () => {
    const picky = makeWorld({
      seed: PICKY_SEED,
      hour: 10,
      patch: { needs: { hunger: 60, energy: 70, mood: 60 }, bowl: 2 },
    });
    expect(kinds(runTicks(picky, 12).events)).toContain('ate');
  });

  it('睡着的猫可能睡完这觉再说：添粮不会把它叫起来吃', () => {
    // 黄昏（最活跃的时段）+ 精力 40：睡着的不会醒（精力不够），
    // 醒着的也不会睡（此时段睡眠倾向极低）。除了睡醒，两个世界完全一样。
    const patch = { needs: { hunger: 40, energy: 40, mood: 60 } };
    const asleep = makeWorld({ seed: GREEDY_SEED, hour: 18, patch: { ...patch, sleeping: true } });
    const awake = makeWorld({ seed: GREEDY_SEED, hour: 18, patch: { ...patch, sleeping: false } });

    const fill = { actions: [{ type: 'fillBowl' } as const] };
    const sleeping = step(asleep, TICK, fill);
    expect(sleeping.world.sleeping).toBe(true);
    expect(kinds(sleeping.events)).not.toContain('ate');
    // 粮一份没少，还在碗里等它。
    expect(sleeping.world.bowl).toBe(step(asleep, 0, fill).world.bowl);
    expect(sleeping.world.needs.hunger).toBeLessThan(40);

    // 对照组：同一只猫醒着的时候立刻就吃了。证明上面不吃是因为在睡，
    // 不是因为阈值或碗里没粮。
    const eating = step(awake, TICK, fill);
    expect(kinds(eating.events).some((k) => k === 'ate' || k === 'ateGreedy')).toBe(true);
  });
});

describe('抚摸是邀请，猫有自己的边界', () => {
  it('醒着时蹭手心：心情上扬、亲密度累积', () => {
    const w = makeWorld({ hour: 18, patch: { needs: { hunger: 70, energy: 70, mood: 50 } } });
    const r = step(w, 0, { actions: [{ type: 'pet' }] });
    expect(kinds(r.events)).toEqual(['petted']);
    expect(r.world.bond).toBeGreaterThan(w.bond);
    expect(r.world.stats.petCount).toBe(1);
  });

  it('摸正在睡的猫会被甩尾巴：心情下降，亲密度不涨', () => {
    const w = makeWorld({
      hour: 13,
      patch: { sleeping: true, needs: { hunger: 70, energy: 40, mood: 50 } },
    });
    const r = step(w, 0, { actions: [{ type: 'pet' }] });
    expect(kinds(r.events)).toEqual(['petRefused']);
    expect(r.world.needs.mood).toBeLessThan(w.needs.mood);
    expect(r.world.bond).toBe(w.bond);
    expect(r.world.stats.petCount).toBe(0);
  });
});

describe('猫的状态对外可读，不需要打开界面', () => {
  it('四条状态的总体读数覆盖了正常、睡着、饿了、生病、离开', () => {
    const base = { hunger: 70, energy: 70, mood: 60 };
    const cases: Array<[string, ReturnType<typeof makeWorld>]> = [
      ['ok', makeWorld({ hour: 18, patch: { needs: base } })],
      ['sleeping', makeWorld({ hour: 13, patch: { sleeping: true, needs: base } })],
      ['hungry', makeWorld({ hour: 18, patch: { needs: { ...base, hunger: 10 } } })],
      ['starving', makeWorld({ hour: 18, patch: { needs: { ...base, hunger: 0 } } })],
      ['sick', makeWorld({ hour: 18, patch: { sick: true, needs: base } })],
      ['dead', makeWorld({ hour: 18, patch: { dead: true, needs: base } })],
    ];
    for (const [expected, world] of cases) {
      expect(step(world, 0).renderIntent.status).toBe(expected);
    }
  });
});
