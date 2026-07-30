import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  BREED_KEYS,
  CatRenderer,
  H,
  W,
  makeCat,
  markingVariantsFor,
} from '../../src/render/index.js';
import type { RenderResult } from '../../src/render/index.js';
import { snapshot } from './mask.js';

const MI = { eyeOpen: 1, earFlickL: 0, earFlickR: 0, tilt: 0 };

function visibleDiffRatio(a: RenderResult, b: RenderResult): number {
  let visible = 0;
  let changed = 0;
  for (let i = 0; i < W * H; i++) {
    const o = i * 4;
    if (a.pixels[o + 3] !== 255 && b.pixels[o + 3] !== 255) continue;
    visible++;
    if (
      a.pixels[o] !== b.pixels[o] ||
      a.pixels[o + 1] !== b.pixels[o + 1] ||
      a.pixels[o + 2] !== b.pixels[o + 2] ||
      a.pixels[o + 3] !== b.pixels[o + 3]
    ) {
      changed++;
    }
  }
  return changed / visible;
}

describe('可扩展花纹模板', () => {
  it('每个品种都从自己的花纹适配器获得至少三种模板', () => {
    for (const breed of BREED_KEYS) {
      const variants = markingVariantsFor(breed);
      expect(variants.length, breed).toBeGreaterThanOrEqual(3);
      expect(new Set(variants.map((entry) => entry.key)).size, breed).toBe(variants.length);
    }
  });

  it('切换模板不改变同一只猫的体型与脸型', () => {
    const geometry = [
      'bodyRW',
      'bodyRH',
      'headR',
      'earH',
      'earW',
      'tailLen',
      'tailThick',
      'legLen',
      'earSet',
      'earSpread',
    ] as const;
    for (const breed of BREED_KEYS) {
      const [first, second] = markingVariantsFor(breed);
      const a = makeCat(breed, 20260730, { variant: first!.key, seed: 123 });
      const b = makeCat(breed, 20260730, { variant: second!.key, seed: 456 });
      for (const key of geometry) expect(b[key], `${breed}.${key}`).toBe(a[key]);
    }
  });

  it('同一适配器的任意两个模板在领养默认走路预览里都有可见差异', () => {
    const renderer = new CatRenderer();
    for (const breed of BREED_KEYS) {
      const frames = markingVariantsFor(breed).map((variant, index) => {
        const cat = makeCat(breed, 20260730, { variant: variant.key, seed: 700 + index });
        return {
          key: variant.key,
          frame: snapshot(renderer.render(cat, ACTIONS.walk.make(0.37, cat, MI))),
        };
      });
      for (let i = 0; i < frames.length; i++) {
        for (let j = i + 1; j < frames.length; j++) {
          const ratio = visibleDiffRatio(frames[i]!.frame, frames[j]!.frame);
          expect(
            ratio,
            `${breed}: ${frames[i]!.key} / ${frames[j]!.key} 只差 ${(ratio * 100).toFixed(1)}%`,
          ).toBeGreaterThan(0.025);
        }
      }
    }
  });
});
