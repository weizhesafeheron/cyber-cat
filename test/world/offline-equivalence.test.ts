import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../src/render/rng.js';
import { step } from '../../src/world/index.js';
import type { World, WorldEvent } from '../../src/world/index.js';
import { BEAT, DAY, HOUR, kinds, makeWorld, runTicks } from './helpers.js';

/**
 * 离线推演等价性。ADR 0001 的核心保证，也是整个世界层最重要的一个测试。
 *
 * 要保证的事：**离线补算与实时运行是同一条代码路径。**
 * 具体到可断言的形式 - 一次 24 小时的大跨步补算，与 48 次连续的 30 分钟步进，
 * 产出的 world 与事件序列必须完全一致。
 *
 * 这条一旦破了，症状是「关机一晚再打开，猫的状态和一直开着不一样」，
 * 而且没有任何一处报错。会破它的典型改动：
 * - 在 step 里按 elapsedMs 做连续插值（例如亲密度按毫秒线性流失）；
 * - 把随机源换成每次 step 重新播种；
 * - 把「不满一步的余额」丢掉而不是留在 carryMs 里。
 */

function runOnce(world: World, elapsedMs: number): { world: World; events: WorldEvent[] } {
  const r = step(world, elapsedMs);
  return { world: r.world, events: [...r.events] };
}

describe('离线推演等价性', () => {
  it('一次 24 小时补算 === 48 次 30 分钟步进（world 与事件序列完全一致）', () => {
    const start = makeWorld({ hour: 20, patch: { bowl: 2 } });

    const bulk = runOnce(start, DAY);
    const stepwise = runTicks(start, 48);

    expect(stepwise.world).toEqual(bulk.world);
    expect(stepwise.events).toEqual(bulk.events);

    // 对测试本身的检验：这 24 小时里必须真的发生过事，否则上面在比对两个空数组。
    expect(bulk.events.length).toBeGreaterThan(3);
    expect(kinds(bulk.events)).toContain('ate');
  });

  it('一次 7 天补算 === 336 次 30 分钟步进（覆盖完整死亡链）', () => {
    const start = makeWorld({ hour: 9, patch: { needs: { hunger: 100, energy: 70, mood: 65 } } });

    const bulk = runOnce(start, 7 * DAY);
    const stepwise = runTicks(start, 7 * 48);

    expect(stepwise.world).toEqual(bulk.world);
    expect(stepwise.events).toEqual(bulk.events);

    // 七天不喂必然走完 生病 → 死亡，等价性必须覆盖到这条链而不是只覆盖日常。
    expect(kinds(bulk.events)).toContain('fellSick');
    expect(kinds(bulk.events)).toContain('died');
    expect(bulk.world.dead).toBe(true);
  });

  it('不规则切分同样等价：随机把 24 小时切成上百段', () => {
    const start = makeWorld({ hour: 3, patch: { bowl: 3 } });
    const bulk = runOnce(start, DAY);

    // 用 seeded rng 切，切法本身也是确定的。
    const rnd = mulberry32(777);
    const chunks: number[] = [];
    let left = DAY;
    while (left > 0) {
      // 整数毫秒，避免把浮点误差混进这个测试要测的东西里。
      const take = Math.min(left, 1 + Math.floor(rnd() * 20 * 60_000));
      chunks.push(take);
      left -= take;
    }
    expect(chunks.length).toBeGreaterThan(50);
    expect(chunks.reduce((a, b) => a + b, 0)).toBe(DAY);

    let world = start;
    const events: WorldEvent[] = [];
    for (const c of chunks) {
      const r = step(world, c);
      world = r.world;
      events.push(...r.events);
    }

    expect(world).toEqual(bulk.world);
    expect(events).toEqual(bulk.events);
  });

  it('不满一拍的时间不会丢：48 次 29 分 7 秒，攒下的零头留在 carryMs', () => {
    const start = makeWorld({ hour: 8 });
    // 故意取一个不是整拍的时长。整拍的话余额恒为 0，这条就退化成恒真了。
    const partial = 29 * 60_000 + 7_000;

    let world = start;
    for (let i = 0; i < 48; i++) world = step(world, partial).world;

    const totalMs = 48 * partial;
    const advanced = Math.floor(totalMs / BEAT);
    expect(world.clock).toBe(start.clock + advanced * BEAT);
    expect(world.carryMs).toBeCloseTo(totalMs - advanced * BEAT, 6);

    // 同样的总时长一次给完，结果相同。
    expect(step(start, totalMs).world).toEqual(world);
  });

  it('对照组：总时长不同必须产出不同结果（证明比对不是恒真）', () => {
    const start = makeWorld({ hour: 8 });
    const a = runOnce(start, DAY);
    const b = runOnce(start, DAY + HOUR);
    expect(a.world).not.toEqual(b.world);
  });

  it('对照组：起始时刻不同必须产出不同的作息（证明节律真的在起作用）', () => {
    const atNight = runOnce(makeWorld({ hour: 1 }), 6 * HOUR);
    const atDusk = runOnce(makeWorld({ hour: 17 }), 6 * HOUR);
    expect(atNight.world.sleeping).not.toBe(atDusk.world.sleeping);
  });

  it('补算过程中穿插序列化往返，结果仍与一次性补算一致', () => {
    const start = makeWorld({ hour: 12, patch: { bowl: 2 } });
    const bulk = runOnce(start, 2 * DAY);

    let world = start;
    const events: WorldEvent[] = [];
    for (let i = 0; i < 96; i++) {
      const r = step(world, HOUR / 2);
      events.push(...r.events);
      world = JSON.parse(JSON.stringify(r.world)) as World;
    }

    expect(world).toEqual(bulk.world);
    expect(events).toEqual(bulk.events);
  });
});
