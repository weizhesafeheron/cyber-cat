import { describe, expect, it } from 'vitest';
import { ACTIONS, makeCat, makeMicro, stepMicro } from '../../src/render/index.js';
import { step } from '../../src/world/index.js';
import { TICK, feedEvery, findSeed, makeWorld, runTicks } from './helpers.js';

/**
 * renderIntent 是世界层与渲染层之间的那道缝。
 *
 * 这里只测「说出来的话渲染层听得懂」以及「状态确实被表达出来了」，
 * 不测像素 - 像素是缝二的事（test/render/）。
 */

describe('renderIntent 能被渲染层直接消费', () => {
  it('动作键在 ACTIONS 里，覆盖层能合进 Pose', () => {
    const world = makeWorld({ hour: 6 });
    const cat = makeCat(world.identity.breed, world.identity.seed);
    const micro = makeMicro(world.identity.seed);

    let current = world;
    const feed = feedEvery(8);
    for (let i = 0; i < 300; i++) {
      const r = step(current, TICK, feed(i));
      current = r.world;
      const intent = r.renderIntent;
      if (intent.action === null) continue;

      const def = ACTIONS[intent.action];
      expect(def).toBeDefined();
      const mi = stepMicro(micro, 1 / 60, intent.micro);
      const pose = { ...def.make(i * intent.timeScale, cat, mi), ...intent.pose };
      // 合并出来的 pose 必须是渲染层认得的形状 - form 缺省是允许的。
      expect(pose.form === undefined || ['stand', 'sit', 'lie', 'curl'].includes(pose.form)).toBe(
        true,
      );
    }
  });

  it('生病的表现是「趴着 + 放慢 + 眼半闭」，三样都在', () => {
    const sick = makeWorld({
      hour: 12,
      patch: { sick: true, sickHours: 4, needs: { hunger: 40, energy: 60, mood: 25 } },
    });
    const intent = step(sick, 0).renderIntent;
    expect(intent.action).toBe('lie');
    expect(intent.timeScale).toBeLessThan(1);
    expect(intent.pose.eyeOpen).toBeLessThan(0.5);
    expect(intent.pose.tailWave).toBe(0);
  });

  it('睡着时关掉眨眼与耳朵抖动（睡着的猫不眨眼）', () => {
    const asleep = makeWorld({
      hour: 2,
      patch: { sleeping: true, needs: { hunger: 60, energy: 40, mood: 60 } },
    });
    const intent = step(asleep, 0).renderIntent;
    expect(intent.action).toBe('sleep');
    expect(intent.micro.blink).toBe(false);
    expect(intent.micro.ear).toBe(false);
  });

  it('饿了有可视表现，与状态不错时不是同一个姿态', () => {
    const hungry = step(
      makeWorld({ hour: 18, patch: { needs: { hunger: 10, energy: 70, mood: 55 } } }),
      0,
    ).renderIntent;
    const fine = step(
      makeWorld({ hour: 18, patch: { needs: { hunger: 80, energy: 70, mood: 55 } } }),
      0,
    ).renderIntent;
    expect(hungry.status).toBe('hungry');
    expect(hungry.pose).not.toEqual(fine.pose);
  });

  it('心情好的时候尾巴摆得更欢', () => {
    const happy = step(
      makeWorld({ hour: 18, patch: { needs: { hunger: 80, energy: 70, mood: 95 } } }),
      0,
    ).renderIntent;
    const meh = step(
      makeWorld({ hour: 18, patch: { needs: { hunger: 80, energy: 70, mood: 50 } } }),
      0,
    ).renderIntent;
    expect(happy.pose.tailWave ?? 0).toBeGreaterThan(meh.pose.tailWave ?? 0);
  });

  it('刚醒来会伸个懒腰', () => {
    const w = makeWorld({
      hour: 18,
      patch: { sleeping: true, needs: { hunger: 70, energy: 95, mood: 60 } },
    });
    const { steps } = runTicks(w, 12);
    const wakeStep = steps.find((s) => !s.world.sleeping);
    expect(wakeStep).toBeDefined();
    expect(wakeStep!.renderIntent.action).toBe('stretch');
  });

  it('吃饭的时候画吃饭', () => {
    const w = makeWorld({
      hour: 18,
      patch: { bowl: 2, needs: { hunger: 20, energy: 80, mood: 60 } },
    });
    expect(step(w, TICK).renderIntent.action).toBe('eat');
  });
});

/**
 * 挂件锚点：世界层说「猫想去哪个挂件」，**只给名字，不给坐标**。
 *
 * 这是「喂食与睡觉是空间行为」（ADR 0004）的世界层一侧。
 * 坐标进了世界层，同一份存档在不同分辨率的机器上就会演化出不同的猫，
 * 离线推演的可回放性当场失效（ADR 0001）- 所以这一组还顺带守着「只有名字」。
 */
describe('renderIntent 的挂件锚点', () => {
  const AWAKE = { hunger: 90, energy: 70, mood: 60 };
  const anchorOf = (patch: Partial<ReturnType<typeof makeWorld>>, hour = 18): unknown =>
    step(makeWorld({ hour, patch }), 0).renderIntent.anchor;

  it('锚点只可能是挂件的名字或 null，永远不是坐标', () => {
    const feed = feedEvery(6);
    let current = makeWorld({ hour: 5 });
    const seen = new Set<unknown>();
    for (let i = 0; i < 48 * 20; i++) {
      const r = step(current, TICK, feed(i));
      current = r.world;
      seen.add(r.renderIntent.anchor);
    }
    // 长跑里三种取值都出现过，且没有第四种。
    expect(new Set(seen)).toEqual(new Set([null, 'bed', 'bowl']));
  });

  it('睡着 → 猫窝：困了走回窝里睡，不是随地趴下', () => {
    expect(anchorOf({ sleeping: true, needs: { hunger: 70, energy: 40, mood: 60 } }, 2)).toBe('bed');
  });

  it('正在吃 → 食盆', () => {
    expect(anchorOf({ activity: 'eat', needs: AWAKE })).toBe('bowl');
  });

  it('碗里有粮且已经够饿 → 食盆（这是给运动层的提前量）', () => {
    // 30 远低于任何性格的开吃阈值（最低 45），所以任何猫都成立。
    expect(anchorOf({ bowl: 2, needs: { hunger: 30, energy: 70, mood: 60 } })).toBe('bowl');
  });

  it('不够饿就没有锚点 - 粮放在盆里也不去，这就是「不饿的晚点再说」', () => {
    // 95 高于任何性格的开吃阈值（最高 80）。
    expect(anchorOf({ bowl: 2, needs: { hunger: 95, energy: 70, mood: 60 } })).toBeNull();
  });

  it('碗是空的、也还没饿到有可视表现 → 没有锚点，猫自己漫游', () => {
    expect(anchorOf({ bowl: 0, needs: { hunger: 40, energy: 70, mood: 60 } })).toBeNull();
  });

  it('饿到有可视表现 → 食盆，即使碗是空的（「在食盆边徘徊」是字面意思）', () => {
    expect(anchorOf({ bowl: 0, needs: { hunger: 10, energy: 70, mood: 60 } })).toBe('bowl');
  });

  it('生病没有锚点 - 蔫着趴在原地才是病的读数，不该爬起来走回窝', () => {
    expect(anchorOf({ sick: true, sickHours: 4, needs: { hunger: 10, energy: 60, mood: 25 } })).toBeNull();
  });

  it('死后没有锚点', () => {
    expect(anchorOf({ dead: true, needs: AWAKE })).toBeNull();
  });

  it('贪吃度决定同一个饥饿度下要不要去食盆', () => {
    // 60 落在两只猫的开吃阈值之间，所以差别只可能来自贪吃度 -
    // 与 test/world/invitation.test.ts 里那条进食时机测试同一套取值。
    const greedy = findSeed('orange', (p) => p.greedy > 0.93);
    const picky = findSeed('orange', (p) => p.greedy < 0.07);
    const patch = { bowl: 2, needs: { hunger: 60, energy: 70, mood: 60 } };
    expect(step(makeWorld({ seed: greedy, hour: 18, patch }), 0).renderIntent.anchor).toBe('bowl');
    expect(step(makeWorld({ seed: picky, hour: 18, patch }), 0).renderIntent.anchor).toBeNull();
  });
});
