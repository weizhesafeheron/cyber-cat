import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  ACTION_KEYS,
  BREED_KEYS,
  CatRenderer,
  makeCat,
  makeMicro,
  stepMicro,
} from '../../src/render/index.js';
import { snapshot } from './mask.js';

/**
 * 确定性与身份稳定性。
 *
 * 存档只存「品种 + Seed + 出生时间 + 名字」，靠 makeCat 重建外观与性格。
 * 一旦这里失去确定性，用户重启后就会得到另一只猫 - 这是产品层面的致命故障，
 * 不只是渲染 bug。
 */

const MI = { eyeOpen: 1, earFlickL: 0, earFlickR: 0, tilt: 0 };

describe('渲染确定性', () => {
  it('相同 cat 与 pose 重复渲染，像素与掩膜完全相同', () => {
    const a = new CatRenderer();
    const b = new CatRenderer();
    for (const breed of BREED_KEYS) {
      const cat = makeCat(breed, 20260728);
      for (const key of ACTION_KEYS) {
        const pose = ACTIONS[key].make(1.7, cat, MI);
        const first = snapshot(a.render(cat, pose));
        // 同一个实例再渲染一次
        const again = snapshot(a.render(cat, pose));
        // 另一个全新实例渲染一次 - 排除内部缓冲状态泄漏
        const fresh = snapshot(b.render(cat, pose));
        expect(again.pixels, `${breed} ${key} 同实例重复渲染不一致`).toEqual(first.pixels);
        expect(again.alphaMask).toEqual(first.alphaMask);
        expect(fresh.pixels, `${breed} ${key} 新实例渲染不一致`).toEqual(first.pixels);
        expect(fresh.alphaMask).toEqual(first.alphaMask);
      }
    }
  });

  it('渲染别的猫之后再渲染回来，结果不变（缓冲没有残留）', () => {
    const r = new CatRenderer();
    const orange = makeCat('orange', 20260728);
    const ragdoll = makeCat('ragdoll', 42);
    const pose = ACTIONS.idle.make(0.5, orange, MI);

    const before = snapshot(r.render(orange, pose));
    r.render(ragdoll, ACTIONS.pounce.make(1.5, ragdoll, MI));
    r.render(ragdoll, ACTIONS.sleep.make(2.5, ragdoll, MI));
    const after = snapshot(r.render(orange, pose));

    expect(after.pixels).toEqual(before.pixels);
    expect(after.alphaMask).toEqual(before.alphaMask);
  });
});

describe('身份稳定性', () => {
  it('相同品种与 Seed 重建出的猫，外观参数完全一致', () => {
    for (const breed of BREED_KEYS) {
      for (const seed of [1, 20260728, 999999937, 123456]) {
        expect(makeCat(breed, seed), `${breed}/${seed}`).toEqual(makeCat(breed, seed));
      }
    }
  });

  it('不同 Seed 产出不同的猫（个体差异确实存在）', () => {
    for (const breed of BREED_KEYS) {
      const a = makeCat(breed, 1);
      const b = makeCat(breed, 2);
      expect(a, `${breed} 的两个 Seed 产出了相同的猫`).not.toEqual(b);
    }
  });

  it('不同品种即使同 Seed 也是不同的猫', () => {
    const seen = new Set<string>();
    for (const breed of BREED_KEYS) {
      const cat = makeCat(breed, 20260728);
      const fingerprint = JSON.stringify([cat.bodyRW, cat.bodyRH, cat.headR, cat.earH, cat.earW]);
      expect(seen.has(fingerprint), `${breed} 与另一个品种的骨架参数完全相同`).toBe(false);
      seen.add(fingerprint);
    }
  });
});

describe('微动作确定性', () => {
  it('相同 Seed 的微动作序列可复现', () => {
    const run = (): unknown[] => {
      const m = makeMicro(20260728);
      const out: unknown[] = [];
      for (let i = 0; i < 600; i++) out.push(stepMicro(m, 0.016, { tilt: true }));
      return out;
    };
    expect(run()).toEqual(run());
  });

  it('不同 Seed 的微动作时序不同', () => {
    const run = (seed: number): unknown[] => {
      const m = makeMicro(seed);
      const out: unknown[] = [];
      for (let i = 0; i < 600; i++) out.push(stepMicro(m, 0.016, { tilt: true }));
      return out;
    };
    expect(run(1)).not.toEqual(run(2));
  });
});
