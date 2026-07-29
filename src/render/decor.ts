import { GROUND, KIND_DECOR, type Raster } from './raster.js';
import { clamp } from './rng.js';

/**
 * 猫身上的装饰件。
 *
 * 这里曾经还有一个 `drawBowl` - 原型时代食盆画在猫的精灵缓冲里。
 * 挂件改成独立窗口之后（ADR 0004、ticket 08）它搬去了 src/props/art.ts，
 * 因为食盆的位置由用户拖动决定，猫的渲染器无从知道。
 */

/** 3x3 的 Z 字形。 */
const Z_GLYPH: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 0],
  [2, 0],
  [1, 1],
  [0, 2],
  [1, 2],
  [2, 2],
];

/** 睡觉的 Zzz 气泡。两个 Z 交替上浮。装饰，不进命中掩膜。 */
export function drawZzz(r: Raster, x: number, y: number, t: number): void {
  const offsets: readonly (readonly [number, number])[] = [
    [0, 0],
    [4, -5],
  ];
  offsets.forEach(([ox, oy], i) => {
    const ph = (t * 0.5 + i * 0.5) % 1;
    const yy = y + oy - ph * 6;
    const xx = x + ox + Math.sin(ph * 6.28) * 1.5;
    if (ph < 0.85) {
      for (const [gx, gy] of Z_GLYPH) {
        r.px(Math.round(xx + gx), Math.round(yy + gy), i ? '#6fe3ff' : '#9db8ff', KIND_DECOR);
      }
    }
  });
}

/** 落地尘土。装饰，不进命中掩膜。 */
export function drawDust(r: Raster, x: number, t: number): void {
  const k = clamp(t, 0, 1);
  const puffs: readonly (readonly [number, number])[] = [
    [-6, -1],
    [6, -2],
    [-9, -3],
    [9, -1],
  ];
  for (const [ox, oy] of puffs) {
    if (k < 0.7) r.px(x + ox * (0.5 + k), GROUND - 1 + oy * k, '#8a86a8', KIND_DECOR);
  }
}
