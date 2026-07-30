import { describe, expect, it } from 'vitest';
import { beginAdoption, meetNext } from '../../src/adopt/flow.js';
import type { Candidate } from '../../src/adopt/flow.js';
import { introOf } from '../../src/adopt/intro.js';
import {
  ACTIONS,
  BREEDS,
  BREED_KEYS,
  CatRenderer,
  H,
  W,
  makeCat,
  mulberry32,
} from '../../src/render/index.js';
import type { ActionKey, BreedKey, RenderResult } from '../../src/render/index.js';

/**
 * 验收项：**同品种不同 Seed 的猫，外观与性格明显不同。**
 *
 * 这条容易写成恒真断言。两个防护：
 * 1. 度量本身先自证 - 同一只猫与自己比必须是 0 差异（见「度量可信」一节）。
 *    差异率若恒大于阈值，这一条会先炸。
 * 2. 比的是**领养流程真的会发给用户的那些猫**（Seed 由 flow 产出），
 *    而不是手挑的几个 Seed - 后者只能证明 makeCat 有能力生成不同的猫，
 *    不能证明领养流程真的用上了这个能力。
 */

const renderer = new CatRenderer();
const MI = { eyeOpen: 1, earFlickL: 0, earFlickR: 0, tilt: 0 };

/** 领养窗口里猫会摆的两种姿态：走到位后先站着，稍后坐下。 */
const POSES: readonly ActionKey[] = ['idle', 'sit'];

function snap(breed: BreedKey, seed: number, action: ActionKey): RenderResult {
  const cat = makeCat(breed, seed);
  const r = renderer.render(cat, ACTIONS[action].make(0, cat, MI));
  // render 复用内部缓冲，跨帧保留必须自己拷贝
  return {
    width: r.width,
    height: r.height,
    pixels: new Uint8ClampedArray(r.pixels),
    alphaMask: new Uint8Array(r.alphaMask),
  };
}

/**
 * 可见像素的差异率：轮廓不同、或同一位置颜色不同都算差异。
 *
 * 与 test/render/breed-structure.test.ts 里的度量一致。**这里不统一调色板**：
 * 跨品种比较必须剥离颜色（否则换个色板就算「有辨识度」），但同品种内部
 * 颜色差异本身就是个体差异的合法来源 - 布偶的重点色色系由 Seed 抽取，
 * 那是 prototype ① 反馈里拉开个体差异最有效的一招。
 */
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

/** 从领养流程里连续接待若干只猫，按品种分组。 */
function candidatesByBreed(count: number, rngSeed: number): Map<BreedKey, Candidate[]> {
  const rnd = mulberry32(rngSeed);
  let flow = beginAdoption(rnd);
  const out = new Map<BreedKey, Candidate[]>(BREED_KEYS.map((b) => [b, []]));
  for (let i = 0; i < count; i++) {
    out.get(flow.candidate.breed)!.push(flow.candidate);
    flow = meetNext(flow, rnd);
  }
  return out;
}

const median = (xs: readonly number[]): number =>
  [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

describe('度量可信', () => {
  it('同一个品种同一个 Seed 渲染两次，差异率是 0', () => {
    // 若差异率恒大于阈值，下面所有断言都是恒真的。这一条先把那种可能性排掉。
    for (const action of POSES) {
      for (const breed of BREED_KEYS) {
        expect(visibleDiffRatio(snap(breed, 12345, action), snap(breed, 12345, action))).toBe(0);
      }
    }
  });

  it('拿到的确实是同品种不同 Seed 的样本', () => {
    const groups = candidatesByBreed(56, 20260729);
    for (const breed of BREED_KEYS) {
      const seeds = groups.get(breed)!.map((c) => c.seed);
      const enough = `${BREEDS[breed].label} 在 56 只来客里出现得太少，样本不足`;
      expect(seeds.length, enough).toBeGreaterThanOrEqual(8);
      expect(new Set(seeds).size, `${BREEDS[breed].label} 出现了重复的 Seed`).toBe(seeds.length);
    }
  });
});

/**
 * 差异率的下限。
 *
 * 实测（三组随机源 × 七个品种 × 两种姿态）：中位数落在 13.6% 到 58.1%，
 * 最接近的一对落在 4.2%。最弱的一档是**黑猫与美短的坐姿** - 黑猫没有花纹可随机，
 * 美短的虎斑在坐姿下大半被身体挡住，个体差异只剩体型与耳尾形状。
 *
 * 门槛压在最弱那一档之下而不是压在好看的数字上：这组断言能守住的是
 * 「个体差异没有退化」，**「一眼看出来不是同一只」仍然只能人眼判断**，
 * 那条写在报告的人工验收清单里。
 */
const MEDIAN_FLOOR = 0.1;
const CLOSEST_PAIR_FLOOR = 0.01;

describe('同品种不同 Seed 的外观差异', () => {
  it('两两差异率的中位数与最接近的一对都在下限之上', () => {
    for (const rngSeed of [20260729, 7, 999999937]) {
      const groups = candidatesByBreed(56, rngSeed);
      for (const action of POSES) {
        for (const breed of BREED_KEYS) {
          const seeds = groups.get(breed)!.map((c) => c.seed).slice(0, 8);
          const snaps = seeds.map((s) => snap(breed, s, action));
          const ratios: number[] = [];
          for (let i = 0; i < snaps.length; i++) {
            for (let j = i + 1; j < snaps.length; j++) {
              ratios.push(visibleDiffRatio(snaps[i]!, snaps[j]!));
            }
          }
          const label = `${BREEDS[breed].label}（${action}，rnd ${rngSeed}）`;
          expect(
            median(ratios),
            `${label} 的个体差异中位数只有 ${(median(ratios) * 100).toFixed(1)}%，` +
              `同品种的猫看起来是同一只`,
          ).toBeGreaterThan(MEDIAN_FLOOR);
          expect(
            Math.min(...ratios),
            `${label} 有一对个体只差 ${(Math.min(...ratios) * 100).toFixed(1)}%`,
          ).toBeGreaterThan(CLOSEST_PAIR_FLOOR);
        }
      }
    }
  });
});

describe('同品种不同 Seed 的性格差异', () => {
  it('性格标签在同品种内部出现多种组合，而不是一个品种一套说法', () => {
    const groups = candidatesByBreed(56, 20260729);
    for (const breed of BREED_KEYS) {
      const tags = groups
        .get(breed)!
        .slice(0, 8)
        .map((c) => introOf(makeCat(c.breed, c.seed)).traits.join('/'));
      const kinds = [...new Set(tags)];
      expect(
        kinds.length,
        `${BREEDS[breed].label} 的 8 只猫只有 ${kinds.length} 种性格说法：${kinds.join('，')}`,
      ).toBeGreaterThanOrEqual(4);
    }
  });

  it('性格参数本身的跨个体跨度足够大', () => {
    const groups = candidatesByBreed(56, 20260729);
    for (const breed of BREED_KEYS) {
      const ps = groups
        .get(breed)!
        .slice(0, 8)
        .map((c) => makeCat(c.breed, c.seed).personality);
      const spread = (k: 'active' | 'clingy' | 'greedy'): number =>
        Math.max(...ps.map((p) => p[k])) - Math.min(...ps.map((p) => p[k]));
      expect(spread('clingy'), `${BREEDS[breed].label} 的粘人度几乎一样`).toBeGreaterThan(0.4);
      expect(spread('greedy'), `${BREEDS[breed].label} 的贪吃度几乎一样`).toBeGreaterThan(0.4);
      // 活跃度是围绕品种基线采样的，跨度天然比另两项小 - 但不能是零
      const flat = `${BREEDS[breed].label} 的活跃度几乎没有个体差异`;
      expect(spread('active'), flat).toBeGreaterThan(0.2);
    }
  });

  it('同一个 Seed 的性格说法稳定 - 否则「重启后完全一致」无从谈起', () => {
    const cat = makeCat('ragdoll', 20260729);
    expect(introOf(cat)).toEqual(introOf(makeCat('ragdoll', 20260729)));
  });
});
