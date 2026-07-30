import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  CatRenderer,
  DEFAULT_ART_TUNING,
  W,
  makeCat,
  normalizeArtTuning,
  tuneCatArt,
} from '../../src/render/index.js';
import { snapshot } from './mask.js';

const MI = { eyeOpen: 1, earFlickL: 0, earFlickR: 0, tilt: 0 };

describe('猫咪美术语义调参', () => {
  it('默认参数逐像素保持现有美术', () => {
    const cat = makeCat('orange', 20260730);
    const tuned = tuneCatArt(cat, DEFAULT_ART_TUNING);
    const pose = ACTIONS.idle.make(1.3, cat, MI);
    const original = snapshot(new CatRenderer().render(cat, pose));
    const after = snapshot(new CatRenderer().render(tuned, pose));
    expect(after.pixels).toEqual(original.pixels);
    expect(after.alphaMask).toEqual(original.alphaMask);
  });

  it('调参返回新猫且不改动品种与 Seed', () => {
    const cat = makeCat('devon', 42);
    const before = structuredClone(cat);
    const tuned = tuneCatArt(cat, {
      headSize: 0.7,
      earSize: -0.5,
      eyeSize: 1,
      colorEnergy: 0.4,
      cheekWidth: 0.5,
      muzzleSize: -0.4,
    });
    expect(cat).toEqual(before);
    expect(tuned.breed).toBe(cat.breed);
    expect(tuned.seed).toBe(cat.seed);
    expect(tuned.headR).toBeGreaterThan(cat.headR);
    expect(tuned.earH).toBeLessThan(cat.earH);
    expect(tuned.eyeScale).toBeGreaterThan(1);
    expect(tuned.pal.base).not.toEqual(cat.pal.base);
  });

  it('拒绝非数值并把外部值钳制到安全范围', () => {
    const tuning = normalizeArtTuning({ roundness: 9, headSize: -8, eyeSize: Number.NaN });
    expect(tuning.roundness).toBe(1);
    expect(tuning.headSize).toBe(-1);
    expect(tuning.eyeSize).toBe(0);
  });

  it('耳朵形状可以在尖耳与圆耳之间明确选择', () => {
    expect(makeCat('orange', 42).earRound).toBe(false);
    expect(tuneCatArt(makeCat('orange', 42), { earShape: 1 }).earRoundness).toBe(1);
    expect(makeCat('devon', 42).earRound).toBe(true);
    expect(tuneCatArt(makeCat('devon', 42), { earShape: -1 }).earRound).toBe(false);
  });

  it('圆耳从耳尖到耳根都是半椭圆曲线，不只是加宽顶行', () => {
    const renderer = new CatRenderer();
    const base = makeCat('orange', 42);
    const pointed = tuneCatArt(base, { earShape: -1 });
    const rounded = tuneCatArt(base, { earShape: 1 });
    const pose = ACTIONS.idle.make(0, base, MI);
    const pointedFrame = snapshot(renderer.render(pointed, pose));
    const roundedFrame = snapshot(renderer.render(rounded, pose));
    const upperPixels = (mask: Uint8Array): number => {
      let count = 0;
      for (let y = 0; y < 19; y++) {
        for (let x = 0; x < W; x++) if (mask[y * W + x] === 255) count++;
      }
      return count;
    };
    const topRowPixels = (mask: Uint8Array): number => {
      const first = mask.findIndex((value) => value === 255);
      const y = Math.floor(first / W);
      let count = 0;
      for (let x = 0; x < W; x++) if (mask[y * W + x] === 255) count++;
      return count;
    };
    expect(upperPixels(roundedFrame.alphaMask)).toBeGreaterThan(upperPixels(pointedFrame.alphaMask));
    expect(topRowPixels(roundedFrame.alphaMask)).toBeGreaterThan(
      topRowPixels(pointedFrame.alphaMask),
    );
  });
});
