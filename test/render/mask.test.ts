import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  ACTION_KEYS,
  BREED_KEYS,
  CatRenderer,
  GROUND,
  H,
  W,
  hitTest,
  makeCat,
} from '../../src/render/index.js';
import { colorAt, maskBbox, snapshot } from './mask.js';

/**
 * alpha 掩膜的行为。
 *
 * 掩膜是选择性点击穿透的承重墙（ADR 0006）- 掩膜错了猫就点不到，
 * 而这类 bug 靠人眼很难稳定复现，所以必须有自动化保护。
 */

const renderer = new CatRenderer();
const MI = { eyeOpen: 1, earFlickL: 0, earFlickR: 0, tilt: 0 };
const SEEDS = [1, 20260728, 999999937] as const;

/** 影子色 #151126 */
const SHADOW_RGB = '21,17,38';
/** Zzz 气泡色 #9db8ff / #6fe3ff */
const ZZZ_RGB = new Set(['157,184,255', '111,227,255']);
/** 尘土色 #8a86a8 */
const DUST_RGB = '138,134,168';
/** 食盆色 */
const BOWL_RGB = new Set(['61,79,138', '44,58,104', '35,44,82', '201,138,75', '224,164,94']);

describe('掩膜与像素同源', () => {
  it('掩膜标记为不透明的位置，像素一定不透明', () => {
    for (const breed of BREED_KEYS) {
      for (const seed of SEEDS) {
        const cat = makeCat(breed, seed);
        for (const key of ACTION_KEYS) {
          for (const t of [0, 1.1, 2.5, 3.9]) {
            const res = renderer.render(cat, ACTIONS[key].make(t, cat, MI));
            for (let i = 0; i < W * H; i++) {
              if (res.alphaMask[i] === 255 && res.pixels[i * 4 + 3] !== 255) {
                const x = i % W;
                const y = (i / W) | 0;
                throw new Error(
                  `${breed} ${key} t=${t}：掩膜在 (${x}, ${y}) 标记为猫，但像素是透明的`,
                );
              }
            }
          }
        }
      }
    }
  });

  it('每个品种的每个动作都产出非空掩膜', () => {
    for (const breed of BREED_KEYS) {
      const cat = makeCat(breed, 20260728);
      for (const key of ACTION_KEYS) {
        const res = renderer.render(cat, ACTIONS[key].make(1.1, cat, MI));
        const bb = maskBbox(res.alphaMask);
        expect(bb.n, `${breed} ${key} 的掩膜是空的`).toBeGreaterThan(150);
      }
    }
  });
});

describe('装饰与道具不进掩膜', () => {
  it('地面投影不算摸到猫', () => {
    const cat = makeCat('orange', 20260728);
    const res = renderer.render(cat, ACTIONS.sit.make(0, cat, MI));
    let shadowPixels = 0;
    for (let y = GROUND; y <= GROUND + 1; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (colorAt(res, i) !== SHADOW_RGB || res.pixels[i * 4 + 3] !== 255) continue;
        shadowPixels++;
        expect(res.alphaMask[i], `影子像素 (${x}, ${y}) 不该进掩膜`).toBe(0);
      }
    }
    // 确认这个测试真的看到了影子，否则它是空转的
    expect(shadowPixels, '没有找到任何影子像素，测试没有实际生效').toBeGreaterThan(10);
  });

  it('Zzz 气泡不算摸到猫', () => {
    const cat = makeCat('orange', 20260728);
    const res = renderer.render(cat, ACTIONS.sleep.make(2.0, cat, MI));
    let zzz = 0;
    for (let i = 0; i < W * H; i++) {
      if (res.pixels[i * 4 + 3] !== 255) continue;
      if (!ZZZ_RGB.has(colorAt(res, i))) continue;
      zzz++;
      expect(res.alphaMask[i], `Zzz 像素不该进掩膜`).toBe(0);
    }
    expect(zzz, '没有找到 Zzz 像素，测试没有实际生效').toBeGreaterThan(5);
  });

  it('落地尘土不算摸到猫', () => {
    const cat = makeCat('cow', 20260728);
    // 扑跳的落地压缩段带尘土
    const res = renderer.render(cat, ACTIONS.pounce.make(2.0, cat, MI));
    let dust = 0;
    for (let i = 0; i < W * H; i++) {
      if (res.pixels[i * 4 + 3] !== 255) continue;
      if (colorAt(res, i) !== DUST_RGB) continue;
      dust++;
      expect(res.alphaMask[i], '尘土像素不该进掩膜').toBe(0);
    }
    expect(dust, '没有找到尘土像素，测试没有实际生效').toBeGreaterThan(0);
  });

  it('食盆不算摸到猫', () => {
    const cat = makeCat('orange', 20260728);
    const res = renderer.render(cat, ACTIONS.eat.make(0.5, cat, MI));
    let bowl = 0;
    for (let i = 0; i < W * H; i++) {
      if (res.pixels[i * 4 + 3] !== 255) continue;
      if (!BOWL_RGB.has(colorAt(res, i))) continue;
      bowl++;
      expect(res.alphaMask[i], '食盆像素不该进掩膜').toBe(0);
    }
    expect(bowl, '没有找到食盆像素，测试没有实际生效').toBeGreaterThan(10);
  });
});

describe('掩膜随姿态变化', () => {
  it('伸懒腰与蜷睡的包围盒明显不同，不是同一个静态矩形', () => {
    const cat = makeCat('orange', 20260728);
    const stretch = maskBbox(renderer.render(cat, ACTIONS.stretch.make(1.2, cat, MI)).alphaMask);
    const sleep = maskBbox(renderer.render(cat, ACTIONS.sleep.make(1.2, cat, MI)).alphaMask);

    // 伸懒腰横向拉长、蜷睡缩成一团。若两者包围盒接近，说明命中形状
    // 退化成了静态矩形，选择性穿透会在这两个姿态上失准。
    expect(stretch.w).toBeGreaterThan(sleep.w * 1.3);
    expect(stretch.n).toBeGreaterThan(sleep.n * 1.4);
  });

  it('同一动作的不同时刻，掩膜会变化', () => {
    const cat = makeCat('cow', 20260728);
    const a = snapshot(renderer.render(cat, ACTIONS.pounce.make(0.8, cat, MI)));
    const b = snapshot(renderer.render(cat, ACTIONS.pounce.make(1.6, cat, MI)));
    // 蓄力与腾空的位置差异很大
    expect(maskBbox(a.alphaMask).x0).not.toBe(maskBbox(b.alphaMask).x0);
  });
});

describe('hitTest', () => {
  it('猫身体中心命中，画面角落不命中', () => {
    const cat = makeCat('orange', 20260728);
    const res = renderer.render(cat, ACTIONS.sit.make(0, cat, MI));
    const bb = maskBbox(res.alphaMask);

    // 包围盒里至少要有一个命中点
    let hits = 0;
    for (let y = bb.y0; y <= bb.y1; y++) {
      for (let x = bb.x0; x <= bb.x1; x++) if (hitTest(res, x, y)) hits++;
    }
    expect(hits).toBe(bb.n);

    expect(hitTest(res, 0, 0)).toBe(false);
    expect(hitTest(res, W - 1, 0)).toBe(false);
  });

  it('越界坐标不命中', () => {
    const cat = makeCat('orange', 1);
    const res = renderer.render(cat, ACTIONS.sit.make(0, cat, MI));
    expect(hitTest(res, -1, 10)).toBe(false);
    expect(hitTest(res, 10, -1)).toBe(false);
    expect(hitTest(res, W, 10)).toBe(false);
    expect(hitTest(res, 10, H)).toBe(false);
  });
});
