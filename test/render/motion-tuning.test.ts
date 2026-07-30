import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  CatRenderer,
  DEFAULT_MOTION_TUNING,
  makeCat,
  motionTuningControlsFor,
  normalizeMotionTuning,
  tuneCatArt,
  tuneMotionPose,
  tuneMotionTime,
} from '../../src/render/index.js';
import { snapshot } from './mask.js';

const MI = { eyeOpen: 1, earFlickL: 0, earFlickR: 0, tilt: 0 };

describe('猫咪动作语义调参', () => {
  it('每个动作只暴露真正适配的参数', () => {
    expect(motionTuningControlsFor('walk').map(({ key }) => key)).toEqual([
      'tempo',
      'strideLength',
      'footLift',
      'bodyBob',
      'headBob',
      'gaitFlow',
      'tailBalance',
    ]);
    expect(motionTuningControlsFor('groom').map(({ key }) => key)).toEqual([
      'tempo',
      'headBob',
      'tailBalance',
    ]);
    expect(motionTuningControlsFor('sleep').map(({ key }) => key)).toEqual([
      'tempo',
      'bodyBob',
    ]);
  });

  it('默认参数逐像素保持现有走路动作', () => {
    const cat = makeCat('orange', 20260730);
    const pose = ACTIONS.walk.make(1.3, cat, MI);
    const tunedPose = tuneMotionPose('walk', pose, DEFAULT_MOTION_TUNING);
    const original = snapshot(new CatRenderer().render(cat, pose));
    const after = snapshot(new CatRenderer().render(cat, tunedPose));
    expect(after.pixels).toEqual(original.pixels);
    expect(after.alphaMask).toEqual(original.alphaMask);
  });

  it('优雅方向会降低身体起伏并让步幅更舒展', () => {
    const cat = makeCat('aby', 42);
    const pose = ACTIONS.walk.make(0.1, cat, MI);
    const tuned = tuneMotionPose('walk', pose, {
      strideLength: 0.4,
      bodyBob: -0.8,
      headBob: -0.4,
      gaitFlow: 0.6,
      tailBalance: 0.2,
    });
    expect(Math.abs(tuned.dy ?? 0)).toBeLessThan(Math.abs(pose.dy ?? 0));
    expect(Math.abs(tuned.headDY ?? 0)).toBeLessThanOrEqual(Math.abs(pose.headDY ?? 0));
    expect(Math.abs(tuned.legOx?.[0] ?? 0)).toBeGreaterThanOrEqual(Math.abs(pose.legOx?.[0] ?? 0));
  });

  it('动作节奏可调且外部值会钳制', () => {
    expect(tuneMotionTime(2, { tempo: -1 })).toBeLessThan(2);
    expect(tuneMotionTime(2, { tempo: 1 })).toBeGreaterThan(2);
    const normalized = normalizeMotionTuning({ bodyBob: -9, tempo: 8, footLift: Number.NaN });
    expect(normalized.bodyBob).toBe(-1);
    expect(normalized.tempo).toBe(1);
    expect(normalized.footLift).toBe(0);
  });

  it('小体型短腿猫不会被调出超过身体尺度的步幅与步频', () => {
    const cat = tuneCatArt(makeCat('orange', 42), { roundness: -1, legLength: -1 });
    const pose = ACTIONS.walk.make(0.1, cat, MI);
    const originalMax = Math.max(...(pose.legOx ?? []).map((value) => Math.abs(value)));
    const tuned = tuneMotionPose(
      'walk',
      pose,
      { strideLength: 1, tempo: 1 },
      cat,
    );
    const tunedMax = Math.max(...(tuned.legOx ?? []).map((value) => Math.abs(value)));
    expect(tunedMax).toBeLessThanOrEqual(
      Math.max(originalMax, Math.min(cat.bodyRW * 0.24, cat.legLen * 0.62)),
    );
    expect(tuneMotionTime(1, { tempo: 1 }, 'walk', cat)).toBeLessThanOrEqual(
      0.9 + cat.legLen * 0.07,
    );
    expect(tuneMotionTime(1, { tempo: -1 }, 'walk', cat)).toBeGreaterThanOrEqual(0.62);
  });

  it('小头猫吃饭抬头时保留颈部连接余量', () => {
    const cat = tuneCatArt(makeCat('cow', 20260730), { headSize: -1 });
    const liftRoom = Math.min(2.35, Math.max(0.45, (cat.headR - 6) * 0.72));
    for (let t = 0; t <= 3.6; t += 0.02) {
      const pose = ACTIONS.eat.make(t, cat, MI);
      expect(pose.headDY).toBeGreaterThanOrEqual(-liftRoom);
    }
  });
});
