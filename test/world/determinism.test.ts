import { describe, expect, it } from 'vitest';
import {
  SaveFormatError,
  parseWorld,
  serializeWorld,
  step,
  worldNow,
} from '../../src/world/index.js';
import type { World, WorldInputs } from '../../src/world/index.js';
import { DAY, HOUR, TICK, makeWorld, runTicks } from './helpers.js';

/**
 * 确定性与存档往返。
 *
 * 这两条是同一件事的两面：只有「world + inputs + 时间差」完全决定结果，
 * 存档才是猫的全部，离线推演才能复现（ADR 0001）。
 */

describe('确定性', () => {
  const world = makeWorld({ hour: 19, patch: { bowl: 1 } });
  const inputs: WorldInputs = { actions: [{ type: 'fillBowl' }, { type: 'pet' }] };

  it('相同 world、inputs、时间差，重复调用结果完全相同', () => {
    const first = step(world, 3 * HOUR, inputs);
    for (let i = 0; i < 5; i++) {
      const again = step(world, 3 * HOUR, inputs);
      expect(again.world).toEqual(first.world);
      expect(again.events).toEqual(first.events);
      expect(again.renderIntent).toEqual(first.renderIntent);
    }
  });

  it('长跑也确定：两次独立跑 5 天，逐步结果一致', () => {
    const a = runTicks(world, 5 * 48, (i) =>
      i % 12 === 0 ? { actions: [{ type: 'fillBowl' }] } : {},
    );
    const b = runTicks(world, 5 * 48, (i) =>
      i % 12 === 0 ? { actions: [{ type: 'fillBowl' }] } : {},
    );
    expect(b.world).toEqual(a.world);
    expect(b.events).toEqual(a.events);
  });

  it('step 不修改传进来的 world', () => {
    const before = structuredClone(world);
    step(world, 2 * DAY, inputs);
    expect(world).toEqual(before);
  });

  it('返回的 world 与入参不是同一个对象，嵌套结构也不共享', () => {
    const r = step(world, TICK, inputs);
    expect(r.world).not.toBe(world);
    expect(r.world.needs).not.toBe(world.needs);
    expect(r.world.diary).not.toBe(world.diary);
    expect(r.world.stats).not.toBe(world.stats);
  });

  it('renderIntent 只由 world 决定：同一个 world 推 0 毫秒得到同一个 intent', () => {
    const mid = runTicks(world, 37, (i) => (i === 3 ? { actions: [{ type: 'pet' }] } : {})).world;
    expect(step(mid, 0).renderIntent).toEqual(step(mid, 0).renderIntent);
    // 跑到同一个 world 的两条不同路径给出同一个 intent。
    const viaBulk = step(world, 37 * TICK).world;
    expect(step(viaBulk, 0).renderIntent).toEqual(
      step(runTicks(world, 37).world, 0).renderIntent,
    );
  });
});

describe('存档序列化往返', () => {
  it('新领养的性格、形象与动作快照不会在往返时丢失', () => {
    const world = makeWorld({
      patch: {
        identity: {
          breed: 'cow',
          seed: 42,
          bornAt: 100,
          name: '团子',
          personality: { active: 0.2, clingy: 0.8, greedy: 0.4 },
          marking: { variant: 'mask', seed: 20260730 },
          art: {
            roundness: 0.6,
            headSize: 0,
            earSize: 0,
            earShape: 0,
            earSpread: 0,
            legLength: -0.2,
            eyeSize: 0.3,
            tailVolume: 0,
            fluffiness: 0,
            colorEnergy: 0,
            outlineStrength: 0.4,
            shadingDepth: 0,
            cheekWidth: 0.5,
            muzzleSize: 0,
            markingTemplate: 0.7,
            jointBlend: 0.5,
          },
          motion: {
            walk: {
              tempo: -0.2,
              strideLength: 0.3,
              footLift: -0.2,
              bodyBob: -0.8,
              headBob: -0.4,
              gaitFlow: 0.6,
              tailBalance: 0.2,
            },
          },
        },
      },
    });
    expect(parseWorld(serializeWorld(world)).identity).toEqual(world.identity);
  });

  it('往返之后继续步进，结果与未序列化时一致', () => {
    const world = runTicks(makeWorld({ hour: 6, patch: { bowl: 2 } }), 20).world;

    const direct = step(world, 12 * HOUR);
    const restored = step(parseWorld(serializeWorld(world)), 12 * HOUR);

    expect(restored.world).toEqual(direct.world);
    expect(restored.events).toEqual(direct.events);
    expect(restored.renderIntent).toEqual(direct.renderIntent);
  });

  it('往返不丢任何字段', () => {
    const world = runTicks(makeWorld({ hour: 22 }), 100, (i) =>
      i % 7 === 0 ? { actions: [{ type: 'fillBowl' }, { type: 'pet' }] } : {},
    ).world;
    expect(parseWorld(serializeWorld(world))).toEqual(world);
  });

  it('反复往返也稳定（存档每次退出都会被重写一遍）', () => {
    let world = makeWorld({ hour: 8 });
    for (let i = 0; i < 24; i++) {
      world = parseWorld(serializeWorld(step(world, HOUR).world));
    }
    const straight = step(makeWorld({ hour: 8 }), 24 * HOUR).world;
    expect(world).toEqual(straight);
  });

  it('worldNow 把整步时刻与余额加回来，恢复时才算得出离开了多久', () => {
    const world = step(makeWorld({ hour: 8 }), 95 * 60_000).world;
    expect(worldNow(world)).toBe(makeWorld({ hour: 8 }).clock + 95 * 60_000);
  });
});

describe('存档解析拒绝坏数据', () => {
  const good = serializeWorld(makeWorld({ hour: 8 }));

  it('不是 JSON', () => {
    expect(() => parseWorld('{ 这不是 json')).toThrow(SaveFormatError);
  });

  it('版本不一致', () => {
    const raw = JSON.parse(good) as Record<string, unknown>;
    raw['version'] = 999;
    expect(() => parseWorld(JSON.stringify(raw))).toThrow(/版本/);
  });

  it('品种不认识', () => {
    const raw = JSON.parse(good) as { identity: Record<string, unknown> };
    raw.identity['breed'] = 'tiger';
    expect(() => parseWorld(JSON.stringify(raw))).toThrow(/品种/);
  });

  it('缺字段', () => {
    const raw = JSON.parse(good) as Record<string, unknown>;
    delete raw['starveHours'];
    expect(() => parseWorld(JSON.stringify(raw))).toThrow(SaveFormatError);
  });

  it('字段是 NaN（JSON 里会变成 null）', () => {
    const raw = JSON.parse(good) as { needs: Record<string, unknown> };
    raw.needs['hunger'] = null;
    expect(() => parseWorld(JSON.stringify(raw))).toThrow(SaveFormatError);
  });

  it('多余的字段被丢掉，不会带进世界', () => {
    const raw = JSON.parse(good) as Record<string, unknown>;
    raw['somethingElse'] = 42;
    const parsed = parseWorld(JSON.stringify(raw)) as World & { somethingElse?: number };
    expect(parsed.somethingElse).toBeUndefined();
  });
});
