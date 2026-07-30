import { describe, expect, it } from 'vitest';
import { BREED_KEYS, makeCat } from '../../src/render/index.js';
import { HIGHLIGHT, MOUTH_DARK, OUTLINE, PUPIL } from '../../src/render/palette.js';
import { TRAY_ICON_SIZE, trayIcon } from '../../src/tray/index.js';
import type { TrayIconBitmap, TrayIconState } from '../../src/tray/index.js';

/**
 * 托盘图标。
 *
 * 不做像素级黄金图对比（与猫、与挂件同样的理由，见 docs/art-and-motion-decisions.md）：
 * 美术调整会频繁改动像素而不改变行为。这里测的是**这张图能不能用**：
 * 尺寸对得上系统那道 18 点的缩放、五个状态两两分得开、放大是整数复制、
 * 边缘没有半透明像素、同一只猫画两次逐字节相同。
 */

const STATES: readonly TrayIconState[] = ['ok', 'sleeping', 'hungry', 'sick', 'dead'];

/** 抽样用的种子。每个品种四只，够覆盖 marks 的几种分支（虎斑额纹、奶牛半脸斑）。 */
const SEEDS = [0, 1, 7, 23] as const;

/** 逐字节不同的像素个数。 */
function pixelDiff(a: TrayIconBitmap, b: TrayIconBitmap): number {
  let n = 0;
  for (let i = 0; i < a.w * a.h; i++) {
    const o = i * 4;
    if (
      a.rgba[o] !== b.rgba[o] ||
      a.rgba[o + 1] !== b.rgba[o + 1] ||
      a.rgba[o + 2] !== b.rgba[o + 2] ||
      a.rgba[o + 3] !== b.rgba[o + 3]
    ) {
      n++;
    }
  }
  return n;
}

/**
 * 两个状态之间至少要差这么多像素。
 *
 * **这个下限不是拍的，是按最小的那处刻意改动定的。** 五档里差别最小的一对是
 * ok 与 hungry：它们只差一个右下角的徽章，徽章连描边占 7×6 = 42 格，
 * 再减去几格本来就是描边色、换成徽章的描边圈之后没变的，实测正好 42。
 * 下限取 36 是给美术留一点挪动空间（徽章往里缩一格仍然能过），
 * 但不允许任何一对掉到「一个徽章」以下 - 那就意味着某两档在菜单栏里长得一样。
 *
 * 换算一下：36 / 324 ≈ 11% 的画面。这是余光里能察觉「图标变了」的量级，
 * 也是这条自动化断言唯一能替人眼守住的东西 -「一眼分得开」本身测不了，
 * 能测的只有「改动的面积够不够大」。
 */
const MIN_STATE_DIFF = 36;

describe('尺寸与缓冲', () => {
  it('边长是 18 的整数倍，缓冲长度正好是 w * h * 4', () => {
    // 18 由 tray-icon 0.24 在 macOS 上定死（icon_height = 18.0）。
    // 不是 18 的整数倍就会被系统重采样，像素画当场糊掉。
    for (const scale of [1, 2, 3]) {
      const icon = trayIcon(makeCat('orange', 7), 'ok', scale);
      expect(icon.w).toBe(TRAY_ICON_SIZE * scale);
      expect(icon.h).toBe(icon.w);
      expect(icon.rgba.length).toBe(icon.w * icon.h * 4);
    }
  });

  it('非整数或小于 1 的倍数直接抛，不悄悄取整', () => {
    // 悄悄取整会让调用方拿到一张尺寸对不上的图，而那种错要到真机的菜单栏上
    // 才看得出来 - 那时已经没有任何线索指回这里。
    const cat = makeCat('orange', 7);
    expect(() => trayIcon(cat, 'ok', 1.5)).toThrow(RangeError);
    expect(() => trayIcon(cat, 'ok', 0)).toThrow(RangeError);
    expect(() => trayIcon(cat, 'ok', -2)).toThrow(RangeError);
  });
});

describe('五个状态分得开', () => {
  it.each(STATES)('%s 与其余四档两两至少差 36 个像素', (state) => {
    for (const breed of BREED_KEYS) {
      for (const seed of SEEDS) {
        const cat = makeCat(breed, seed);
        const here = trayIcon(cat, state, 1);
        for (const other of STATES) {
          if (other === state) continue;
          const d = pixelDiff(here, trayIcon(cat, other, 1));
          expect(d, `${breed}#${seed} ${state}/${other}`).toBeGreaterThanOrEqual(MIN_STATE_DIFF);
        }
      }
    }
  });

  it('sick 与 dead 对每一个品种都改了整张脸，不只是记号', () => {
    // 这两档的主信号是全局调色（降饱和 / 去色）。奶牛猫与美短本来就是灰白配色，
    // 只降饱和对它们几乎不改颜色 - 所以 sick 还叠了一点橄榄色偏移。
    // 这条断言就是守着那个偏移：任何一个品种漏掉它，这一档在它身上就消失了。
    for (const breed of BREED_KEYS) {
      const cat = makeCat(breed, 3);
      const ok = trayIcon(cat, 'ok', 1);
      for (const state of ['sick', 'dead'] as const) {
        // 100 个像素 ≈ 整张脸的毛色区域。徽章只有 42 格，够不到这个数。
        expect(pixelDiff(ok, trayIcon(cat, state, 1)), `${breed} ${state}`).toBeGreaterThan(100);
      }
    }
  });
});

describe('用的是这只猫自己的配色', () => {
  it('不同品种画出来的图标不一样', () => {
    // 「橘猫的托盘图标就该是橘色的」这条要求，能自动化的部分就是它：
    // 配色真的取自 cat.pal，而不是写死的一套颜色。
    for (const state of STATES) {
      for (let i = 0; i < BREED_KEYS.length; i++) {
        for (let j = i + 1; j < BREED_KEYS.length; j++) {
          const a = trayIcon(makeCat(BREED_KEYS[i]!, 1), state, 1);
          const b = trayIcon(makeCat(BREED_KEYS[j]!, 1), state, 1);
          const label = `${state} ${BREED_KEYS[i]}/${BREED_KEYS[j]}`;
          expect(pixelDiff(a, b), label).toBeGreaterThan(0);
        }
      }
    }
  });

  it('图标里出现的颜色全部来自这只猫的调色板或那几个共用常量', () => {
    // 反过来守：出现一个既不在 cat.pal 里、也不在共用常量里的颜色，
    // 说明有人往图标里写死了一笔 - 那一笔在别的品种身上就会打架。
    // 只测 ok：sick 与 dead 会对整张图做调色，颜色本来就不在表里。
    const cat = makeCat('orange', 7);
    const pal = cat.pal;
    const allowed = new Set(
      [
        ...pal.base,
        ...pal.mark,
        ...pal.white,
        pal.muzzle,
        pal.nose,
        pal.inner,
        ...pal.eye,
        OUTLINE,
        PUPIL,
        HIGHLIGHT,
        MOUTH_DARK,
      ].map((hex) => hex.toLowerCase()),
    );
    const icon = trayIcon(cat, 'ok', 1);
    for (let i = 0; i < icon.w * icon.h; i++) {
      const o = i * 4;
      if (icon.rgba[o + 3] === 0) continue;
      const hex = `#${[0, 1, 2].map((k) => icon.rgba[o + k]!.toString(16).padStart(2, '0')).join('')}`;
      expect(allowed.has(hex), `第 ${i} 个像素是 ${hex}`).toBe(true);
    }
  });
});

describe('确定性', () => {
  it('同一只猫、同一状态，画两次逐字节相同', () => {
    // 托盘图标每次状态刷新都会重画一遍（每 5 秒一次）。这里只要有一丝随机
    // （毛边哈希、时间参与），菜单栏上的图标就会自己抖 - 而那是最招人烦的一类噪音。
    for (const breed of BREED_KEYS) {
      for (const state of STATES) {
        const cat = makeCat(breed, 11);
        const a = trayIcon(cat, state, 2);
        const b = trayIcon(cat, state, 2);
        expect(a.rgba).toEqual(b.rgba);
      }
    }
  });

  it('同样的品种与 Seed 重新 makeCat 出来的猫，画出的图标也相同', () => {
    // 存档只存品种 + Seed（src/render/cat.ts 的身份模型）。重启之后重建的猫
    // 必须画出同一张图标，否则同一只猫在两次启动里是两个图标。
    const a = trayIcon(makeCat('ragdoll', 42), 'sick', 2);
    const b = trayIcon(makeCat('ragdoll', 42), 'sick', 2);
    expect(a.rgba).toEqual(b.rgba);
  });
});

describe('放大与边缘', () => {
  it('scale = 2 时每个原始像素是 2×2 个完全相同的四元组', () => {
    // 最近邻整数复制，不能有任何插值。有插值就会在色块交界处生出中间色，
    // 像素画的硬边当场消失。
    const scale = 2;
    for (const state of STATES) {
      const cat = makeCat('cow', 5);
      const one = trayIcon(cat, state, 1);
      const two = trayIcon(cat, state, scale);
      for (let y = 0; y < TRAY_ICON_SIZE; y++) {
        for (let x = 0; x < TRAY_ICON_SIZE; x++) {
          const src = (y * TRAY_ICON_SIZE + x) * 4;
          for (let sy = 0; sy < scale; sy++) {
            for (let sx = 0; sx < scale; sx++) {
              const dst = ((y * scale + sy) * two.w + x * scale + sx) * 4;
              for (let k = 0; k < 4; k++) {
                expect(two.rgba[dst + k], `${state} (${x},${y})+(${sx},${sy}) 通道 ${k}`).toBe(
                  one.rgba[src + k],
                );
              }
            }
          }
        }
      }
    }
  });

  it('alpha 只有 0 和 255，没有半透明的边缘像素', () => {
    // 半透明边缘在浅色菜单栏上会读成一圈灰边，而系统那道 18 点的缩放
    // 还会把灰边糊得更宽。透明的地方也必须是纯 0，不能留下带 alpha=0 的杂色。
    for (const breed of BREED_KEYS) {
      for (const state of STATES) {
        const icon = trayIcon(makeCat(breed, 2), state, 2);
        for (let i = 0; i < icon.w * icon.h; i++) {
          const a = icon.rgba[i * 4 + 3]!;
          expect(a === 0 || a === 255, `${breed} ${state} 第 ${i} 个像素 alpha=${a}`).toBe(true);
        }
      }
    }
  });

  it('猫头四周留出了描边的余地，最外一圈是空的', () => {
    // 描边是「在浅色菜单栏上不糊掉」的唯一保证，而描边要占一圈像素。
    // 猫本体贴到边就没地方描了 - 这条守的是版式，不是美术。
    //
    // 只测 ok：其余四档右下角的徽章是**故意**顶到右边和下边的，
    // 它自带一圈描边，不需要再留空。
    const icon = trayIcon(makeCat('amshort', 9), 'ok', 1);
    const N = TRAY_ICON_SIZE;
    const alphaAt = (x: number, y: number): number => icon.rgba[(y * N + x) * 4 + 3]!;
    for (let i = 0; i < N; i++) {
      expect(alphaAt(i, 0), `第 0 行第 ${i} 列`).toBe(0);
      expect(alphaAt(i, N - 1), `最后一行第 ${i} 列`).toBe(0);
      expect(alphaAt(0, i), `第 ${i} 行第 0 列`).toBe(0);
      expect(alphaAt(N - 1, i), `第 ${i} 行最后一列`).toBe(0);
    }
  });
});
