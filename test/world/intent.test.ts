import { describe, expect, it } from 'vitest';
import { ACTIONS, makeCat, makeMicro, stepMicro } from '../../src/render/index.js';
import { step } from '../../src/world/index.js';
import { TICK, feedEvery, makeWorld, runTicks } from './helpers.js';

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
