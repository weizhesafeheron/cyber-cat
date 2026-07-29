import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  BREEDS,
  BREED_KEYS,
  CatRenderer,
  H,
  PALETTES,
  W,
  makeCat,
} from '../../src/render/index.js';
import type { Cat, RenderResult } from '../../src/render/index.js';
import { maskBbox, snapshot } from './mask.js';

/**
 * 品种的结构性差异。
 *
 * **品种差异必须做在结构上，不能只靠换色。**
 * 这是 prototype ① 的核心反馈（原话：「德文和阿比的模型都一样了，只是颜色不一样，
 * 毫无辨识度」），详见 docs/art-and-motion-decisions.md。
 */

const renderer = new CatRenderer();
const MI = { eyeOpen: 1, earFlickL: 0, earFlickR: 0, tilt: 0 };
const SEEDS = [1, 20260728, 999999937, 42] as const;

/**
 * 关键手法：把所有品种强制换成同一套调色板再比对。
 *
 * 这样任何差异都只能来自几何（体型、耳朵、姿态参数）与花纹布局，
 * 颜色的贡献被完全剥离 - 只改调色板的伪辨识度骗不过这组测试。
 */
const NEUTRAL_PALETTE = PALETTES.orange;

function renderNeutral(breed: (typeof BREED_KEYS)[number], seed: number): RenderResult {
  const cat: Cat = { ...makeCat(breed, seed), pal: NEUTRAL_PALETTE };
  return snapshot(renderer.render(cat, ACTIONS.idle.make(0, cat, MI)));
}

/** 可见像素的差异率：轮廓不同或同位置颜色不同都算差异。 */
function visibleDiffRatio(a: RenderResult, b: RenderResult): number {
  let diff = 0;
  let union = 0;
  for (let i = 0; i < W * H; i++) {
    const o = i * 4;
    const va = a.pixels[o + 3] === 255;
    const vb = b.pixels[o + 3] === 255;
    if (!va && !vb) continue;
    union++;
    if (va !== vb) {
      diff++;
      continue;
    }
    if (
      a.pixels[o] !== b.pixels[o] ||
      a.pixels[o + 1] !== b.pixels[o + 1] ||
      a.pixels[o + 2] !== b.pixels[o + 2]
    ) {
      diff++;
    }
  }
  return union === 0 ? 0 : diff / union;
}

describe('剥离颜色后，任意两个品种仍必须明显可辨', () => {
  it('强制统一调色板，两两差异率均超过 25%', () => {
    for (const seed of SEEDS) {
      const rendered = new Map<string, RenderResult>();
      for (const breed of BREED_KEYS) rendered.set(breed, renderNeutral(breed, seed));

      for (let i = 0; i < BREED_KEYS.length; i++) {
        for (let j = i + 1; j < BREED_KEYS.length; j++) {
          const a = BREED_KEYS[i]!;
          const b = BREED_KEYS[j]!;
          const ratio = visibleDiffRatio(rendered.get(a)!, rendered.get(b)!);
          expect(
            ratio,
            `seed ${seed}：${BREEDS[a].label} 与 ${BREEDS[b].label} 在同一套调色板下只差 ` +
              `${(ratio * 100).toFixed(1)}%。这两个品种的区分过度依赖颜色，` +
              `结构或花纹算法需要拉开差距`,
          ).toBeGreaterThan(0.25);
        }
      }
    }
  });
});

describe('德文卷毛与阿比西尼亚的耳朵剪影', () => {
  it('两者的耳朵参数保持显著区分', () => {
    const devon = BREEDS.devon;
    const aby = BREEDS.aby;
    const mid = (r: readonly [number, number]): number => (r[0] + r[1]) / 2;

    // 德文：低位、超宽、圆尖。阿比：高位、外张、尖耳。
    expect(devon.earRound, '德文的圆耳尖是它的辨识特征').toBe(true);
    expect(aby.earRound ?? false, '阿比必须保持尖耳').toBe(false);
    expect(mid(devon.earW), '德文的耳朵应明显更宽').toBeGreaterThan(mid(aby.earW) + 0.8);
    expect(devon.earSet!, '德文的耳距更大（耳朵贴在头两侧）').toBeGreaterThan(aby.earSet!);
    expect(devon.earDrop!, '德文是低位耳').toBeGreaterThan(aby.earDrop!);
    // 外张范围不允许重叠：阿比最小的外张也要大于德文最大的外张
    expect(aby.earSpread![0], '阿比的耳尖外张应明显多于德文').toBeGreaterThan(devon.earSpread![1]);
  });

  it('渲染出来的剪影顶端高度不同：阿比的高位尖耳伸得更高', () => {
    for (const seed of SEEDS) {
      const devonCat = makeCat('devon', seed);
      const abyCat = makeCat('aby', seed);
      const devonTop = maskBbox(
        renderer.render(devonCat, ACTIONS.sit.make(0, devonCat, MI)).alphaMask,
      ).y0;
      const abyTop = maskBbox(
        renderer.render(abyCat, ACTIONS.sit.make(0, abyCat, MI)).alphaMask,
      ).y0;
      expect(
        abyTop,
        `seed ${seed}：阿比剪影顶端 y=${abyTop}，德文 y=${devonTop}。` +
          `阿比的高位尖耳应当比德文的低位耳伸得更高（y 更小）`,
      ).toBeLessThan(devonTop);
    }
  });
});

describe('坐姿高度随腿长变化', () => {
  /** 坐姿剪影的顶端 y。腿越长，猫坐得越高，y 越小。 */
  function sitTopY(cat: Cat): number {
    const mask = renderer.render(cat, ACTIONS.sit.make(0, cat, MI)).alphaMask;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) if (mask[y * W + x] === 255) return y;
    }
    return -1;
  }

  it('同一只猫只改腿长，坐姿高度随之单调升高', () => {
    // 直接测机制而不是跨品种比较 - 跨品种的总剪影高度还受头围与耳高影响，
    // 不是坐姿高度的干净代理（曾用它写断言，在某些 Seed 上会反向）。
    //
    // 见 docs/art-and-motion-decisions.md「坐姿高度必须随腿长变化」：
    // 写死高度会让腿长的黑猫和腿短的橘猫坐下来一样高，抹掉体型差异。
    for (const breed of ['orange', 'black', 'aby'] as const) {
      const base = makeCat(breed, 20260728);
      const tops = [0, 1, 2, 3].map((d) => sitTopY({ ...base, legLen: base.legLen + d }));

      for (let i = 1; i < tops.length; i++) {
        expect(
          tops[i]!,
          `${BREEDS[breed].label}：腿长 +${i} 时坐姿顶端 y=${tops[i]}，` +
            `腿长 +${i - 1} 时 y=${tops[i - 1]}。坐姿高度似乎没有随腿长变化`,
        ).toBeLessThan(tops[i - 1]!);
      }
    }
  });

  it('品种之间的腿长确实不同（体型差异存在于数据层）', () => {
    const lens = BREED_KEYS.map((b) => makeCat(b, 20260728).legLen);
    const distinct = new Set(lens.map((l) => l.toFixed(3)));
    expect(distinct.size, '所有品种的腿长都一样，体型差异不存在').toBe(BREED_KEYS.length);
  });
});
