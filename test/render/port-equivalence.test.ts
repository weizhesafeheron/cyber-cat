import { describe, expect, it } from 'vitest';
import { ACTIONS, ACTION_KEYS, BREED_KEYS, CatRenderer, makeCat, makeMicro, stepMicro } from '../../src/render/index.js';
import type { ActionKey } from '../../src/render/index.js';
import { loadPrototype, makeCanvasStub } from './prototype-reference.js';

/**
 * 端口保真性验证。
 *
 * ticket 02 要求「对外行为不变」。这组测试把端口后的渲染核心与 prototype 阶段的
 * 参照实现逐像素比对，用来证明这次重构确实没有改变任何视觉输出。
 *
 * 这**不是**长期的回归基准 - 见 docs/art-and-motion-decisions.md，我们明确
 * 不做像素级黄金图对比，因为美术调整会频繁改动像素而不改变行为。
 * 参照实现（.lavish/cat-core.js）删除时，本文件应一并删除。
 */

const proto = loadPrototype();

/** 抽样的 Seed。覆盖小值、大值与容易踩边界的值。 */
const SEEDS = [1, 20260728, 999999937, 42, 7] as const;
/** 每个动作抽样的局部时间点。覆盖循环内的不同阶段。 */
const TIMES = [0, 0.37, 1.4, 2.9, 3.95] as const;

describe('端口保真性：与 prototype 参照实现比对', () => {
  it('BREED_KEYS 的顺序一致（makeCat 的种子推导依赖它）', () => {
    // 顺序变了会让所有既有存档的猫变成另一只猫。
    expect(BREED_KEYS).toEqual(proto.BREED_KEYS);
  });

  describe('makeCat 产出的外观参数逐字段一致', () => {
    for (const breed of BREED_KEYS) {
      for (const seed of SEEDS) {
        it(`${breed} / seed ${seed}`, () => {
          const mine = makeCat(breed, seed);
          const theirs = proto.makeCat(breed, seed);

          // 标量参数
          for (const k of [
            'bodyRW',
            'bodyRH',
            'headR',
            'earH',
            'earW',
            'tailLen',
            'tailThick',
            'legLen',
            'fluff',
            'eyeBig',
            'sitW',
            'earSet',
            'earSpread',
            'earDrop',
          ] as const) {
            expect(mine[k], `字段 ${k}`).toBe(theirs[k]);
          }
          expect(mine.earRound).toBe(theirs.earRound);
          expect(mine.eyeLiner).toBe(theirs.eyeLiner);

          // 性格：三个参数都必须一致，因为它们直接驱动行为
          expect(mine.personality).toEqual(theirs.personality);

          // 花纹参数
          expect(mine.marks).toEqual(theirs.marks);

          // 调色板（布偶的重点色由 Seed 抽取，必须抽到同一个）
          expect(mine.pal.base).toEqual(theirs.pal.base);
          expect(mine.pal.mark).toEqual(theirs.pal.mark);
          expect(mine.pal.white).toEqual(theirs.pal.white);
          expect(mine.pal.nose).toBe(theirs.pal.nose);
          expect(mine.pal.muzzle).toBe(theirs.pal.muzzle);
          expect(mine.pal.inner).toBe(theirs.pal.inner);
          expect(mine.pal.eye).toEqual(theirs.pal.eye);
        });
      }
    }
  });

  it('stepMicro 的输出序列一致（含歪头分支）', () => {
    const mine = makeMicro(20260728);
    const theirs = proto.makeMicro(20260728);
    // 跑够长的时间让眨眼、耳抖、歪头三条时间线都触发多轮
    for (let i = 0; i < 4000; i++) {
      const a = stepMicro(mine, 0.016, { tilt: true });
      const b = theirs && proto.stepMicro(theirs, 0.016, { tilt: true });
      expect(a, `第 ${i} 帧`).toEqual(b);
    }
  });

  it('stepMicro 在关闭眨眼与耳抖时也一致', () => {
    const mine = makeMicro(7);
    const theirs = proto.makeMicro(7);
    for (let i = 0; i < 1200; i++) {
      expect(stepMicro(mine, 0.02, { blink: false, ear: false })).toEqual(
        proto.stepMicro(theirs, 0.02, { blink: false, ear: false }),
      );
    }
  });

  describe('动作库产出的 pose 一致', () => {
    for (const key of ACTION_KEYS) {
      it(`${key}`, () => {
        const cat = makeCat('orange', 20260728);
        for (const t of TIMES) {
          // 用同一份微动作输出喂给两边，隔离出动作库本身的差异
          const mi = { eyeOpen: 0.8, earFlickL: 1, earFlickR: 0, tilt: 0.5 };
          const mine = ACTIONS[key].make(t, cat, mi, { tailSweep: true });
          const theirs = proto.ACTIONS[key]!.make(t, cat, mi, { tailSweep: true });
          expect(mine, `t=${t}`).toEqual(theirs);
        }
      });
    }
  });

  describe('渲染输出逐像素一致', () => {
    const renderer = new CatRenderer();
    const stub = makeCanvasStub();
    const protoRenderer = proto.createRenderer(stub.canvas);

    for (const breed of BREED_KEYS) {
      it(`${breed}：全部动作 × 全部抽样 Seed × 全部抽样时间点`, () => {
        for (const seed of SEEDS) {
          // 关键：两边喂同一只猫、同一个 pose，隔离出渲染代码本身的差异。
          // makeCat 与动作库的等价性由上面的测试单独保证。
          const cat = makeCat(breed, seed);
          for (const key of ACTION_KEYS as readonly ActionKey[]) {
            for (const t of TIMES) {
              const mi = { eyeOpen: 1, earFlickL: 0, earFlickR: 0, tilt: 0 };
              const pose = ACTIONS[key].make(t, cat, mi);

              const mine = renderer.render(cat, pose);
              protoRenderer.draw(cat, pose);
              const theirs = stub.read();

              expect(mine.pixels.length).toBe(theirs.length);

              // 比对口径：所有像素比 alpha，只有不透明像素才比 RGB。
              //
              // 原型复用同一个输出数组，空像素只把 alpha 置 0 而**保留上一帧的 RGB 残留**；
              // 端口把 RGB 一并清零。透明像素的 RGB 不可观测，所以这是端口修掉的一个
              // 无害残留，不是行为差异 - 但逐字节比对会把它误报成不一致。
              for (let px = 0; px < mine.width * mine.height; px++) {
                const o = px * 4;
                const x = px % mine.width;
                const y = (px / mine.width) | 0;
                const where = `${breed} seed=${seed} ${key} t=${t} 像素 (${x}, ${y})`;

                if (mine.pixels[o + 3] !== theirs[o + 3]) {
                  throw new Error(
                    `${where}：alpha 不一致，端口 ${mine.pixels[o + 3]} vs 原型 ${theirs[o + 3]}`,
                  );
                }
                if (theirs[o + 3] === 0) continue; // 透明，RGB 不可观测

                for (let ch = 0; ch < 3; ch++) {
                  if (mine.pixels[o + ch] !== theirs[o + ch]) {
                    throw new Error(
                      `${where}：通道 ${ch} 不一致，端口 ${mine.pixels[o + ch]} vs 原型 ${theirs[o + ch]}`,
                    );
                  }
                }
              }
            }
          }
        }
      });
    }
  });
});
