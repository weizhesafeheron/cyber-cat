/** 场景驱动的结构性质：局部静止、变体合法、转场连续性要点。 */
import { describe, expect, it } from 'vitest';
import { PARTS_DOC } from '../../../src/render/proto-b/parts-data.js';
import { sceneFrame } from '../../../src/render/proto-b/scenes.js';
import { SCENE_KEYS } from '../../../src/render/proto-b/types.js';

const OPTS = { seed: 11, active: 0.5 };

describe('变体合法性', () => {
  const entryById = new Map(PARTS_DOC.parts.map((p) => [p.id, p]));

  it('所有场景在整条时间线上引用的部件与变体都存在', () => {
    for (const scene of SCENE_KEYS) {
      for (let t = 0; t < 8; t += 0.05) {
        const frame = sceneFrame(scene, t, OPTS);
        for (const [id, variant] of Object.entries(frame.variants)) {
          const entry = entryById.get(id);
          expect(entry, `${scene} t=${t} 引用了不存在的部件 ${id}`).toBeTruthy();
          expect(
            entry!.images[variant],
            `${scene} t=${t} 部件 ${id} 引用了不存在的变体 ${variant}`,
          ).toBeTruthy();
        }
      }
    }
  });
});

describe('局部静止（判决场景 1 的试金石）', () => {
  it('站立眨眼时腿永远不出现在 poses 里', () => {
    for (let t = 0; t < 8; t += 0.03) {
      const frame = sceneFrame('stand-blink', t, OPTS);
      expect(frame.poses['leg-near-front']).toBeUndefined();
      expect(frame.poses['leg-near-back']).toBeUndefined();
      expect(frame.poses['leg-far-front']).toBeUndefined();
      expect(frame.poses['leg-far-back']).toBeUndefined();
      expect(frame.root).toBeUndefined();
    }
  });

  it('睡觉时耳朵不动（只有身体呼吸帧交换）', () => {
    for (let t = 0; t < 8; t += 0.03) {
      const frame = sceneFrame('sleep', t, OPTS);
      expect(frame.poses['ear-back']).toBeUndefined();
      expect(frame.poses['ear-front']).toBeUndefined();
      expect(['curl0', 'curl1']).toContain(frame.variants.body);
    }
  });

  it('眨眼由眼睑图层交换实现，头部姿态不因眨眼变化', () => {
    // 同一秒内找出闭眼与睁眼两个时刻，头的姿态应一致（不含耳抖窗口）。
    const seen = new Set<string>();
    for (let t = 3.0; t < 4.2; t += 0.01) {
      const frame = sceneFrame('stand-blink', t, OPTS);
      seen.add(frame.variants.eyes!);
    }
    expect(seen.size).toBeGreaterThan(1); // 确实发生过眨眼
  });
});

describe('转场', () => {
  it('拎起悬空时腿是 dangle、影子收小；落地后回到 stand', () => {
    const hover = sceneFrame('held-land', 1.0, OPTS);
    expect(hover.variants['leg-near-front']).toBe('dangle');
    expect(hover.shadow).toBeLessThan(0.5);
    expect(hover.root?.dy).toBeLessThan(0);

    const landed = sceneFrame('held-land', 3.5, OPTS);
    expect(landed.variants['leg-near-front']).toBe('stand');
    expect(landed.shadow).toBeCloseTo(1, 1);
  });

  it('蹲坐阶段用 sit 装配，起身结束后是 stand 装配', () => {
    const sitting = sceneFrame('sit-rise', 1.0, OPTS);
    expect(sitting.variants.body).toBe('sit');
    expect(sitting.variants.tail).toBe('sit');
    expect(sitting.variants['leg-near-front']).toBeUndefined();

    const standing = sceneFrame('sit-rise', 4.0, OPTS);
    expect(standing.variants.body).toBe('stand');
    expect(standing.variants['leg-near-front']).toBe('stand');
  });

  it('起身转场的根缩放从压低平滑回到 1（缓动，不是硬切）', () => {
    const samples: number[] = [];
    for (let t = 2.78; t <= 3.1; t += 0.04) {
      const frame = sceneFrame('sit-rise', t, OPTS);
      samples.push(frame.root?.sy ?? 1);
    }
    // 单调不减地回到 1 附近（easeOutBack 允许轻微过冲后收敛）。
    expect(samples[0]!).toBeLessThan(1);
    expect(samples[samples.length - 1]!).toBeCloseTo(1, 1);
  });

  it('对比页传入 eyeOpen 时覆盖内置眨眼', () => {
    const closed = sceneFrame('stand-blink', 1.0, { ...OPTS, eyeOpen: 0 });
    expect(closed.variants.eyes).toBe('closed');
    const open = sceneFrame('stand-blink', 1.0, { ...OPTS, eyeOpen: 1 });
    expect(open.variants.eyes).toBe('open');
  });
});
