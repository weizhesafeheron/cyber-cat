import { describe, expect, it } from 'vitest';
import { ACTIONS, CatRenderer, H, W, makeCat } from '../../src/render/index.js';
import { colorAt } from './mask.js';

/**
 * 保底可见性回归测试。
 *
 * 随机参数必须钳制到「特征一定看得见」的范围内。
 * 这组测试防的是一类具体的历史故障：奶牛猫的斑块全部落在被头与胸遮挡的位置，
 * 渲染出来看起来是一只纯白猫。见 docs/art-and-motion-decisions.md。
 */

const renderer = new CatRenderer();
const MI = { eyeOpen: 1, earFlickL: 0, earFlickR: 0, tilt: 0 };

/** 奶牛猫的深色斑块色阶 #4a4760 / #312e44 / #232033 */
const COW_MARK_RGB = new Set(['74,71,96', '49,46,68', '35,32,51']);

function countColor(breed: 'cow', seed: number, palette: Set<string>): number {
  const cat = makeCat(breed, seed);
  const res = renderer.render(cat, ACTIONS.sit.make(0, cat, MI));
  let n = 0;
  for (let i = 0; i < W * H; i++) {
    // 只数进了掩膜的像素 - 那才是用户真正看到的猫身上的部分
    if (res.alphaMask[i] !== 255) continue;
    if (palette.has(colorAt(res, i))) n++;
  }
  return n;
}

describe('奶牛猫的斑块永远可见', () => {
  it('300 个 Seed 在坐姿下都有可见的深色斑块', () => {
    const failures: { seed: number; pixels: number }[] = [];
    for (let i = 0; i < 300; i++) {
      const seed = i * 7919 + 13;
      const n = countColor('cow', seed, COW_MARK_RGB);
      // 阈值 6 像素：低于这个数量在 72x56 的画布上等于看不见。
      if (n < 6) failures.push({ seed, pixels: n });
    }
    expect(
      failures,
      `以下 Seed 的奶牛猫斑块几乎不可见，会被误认为白猫：` +
        failures
          .slice(0, 5)
          .map((f) => `seed ${f.seed} 仅 ${f.pixels}px`)
          .join('；'),
    ).toEqual([]);
  });

  it('斑块也不能糊满全身（保底不该变成过度钳制）', () => {
    for (let i = 0; i < 60; i++) {
      const seed = i * 104729 + 7;
      const cat = makeCat('cow', seed);
      const res = renderer.render(cat, ACTIONS.sit.make(0, cat, MI));
      let mark = 0;
      let total = 0;
      for (let p = 0; p < W * H; p++) {
        if (res.alphaMask[p] !== 255) continue;
        total++;
        if (COW_MARK_RGB.has(colorAt(res, p))) mark++;
      }
      expect(mark / total, `seed ${seed} 的斑块占了 ${((mark / total) * 100) | 0}%`).toBeLessThan(
        0.9,
      );
    }
  });
});
