import { GROUND, KIND_DECOR, KIND_PROP, type Raster } from './raster.js';
import { clamp } from './rng.js';

/**
 * 食盆。
 *
 * @deprecated 食盆已由 ADR 0004 改为独立的桌面挂件窗口。
 * 这里保留仅为与原型渲染保持等价，ticket 08 落地后应整体删除。
 * 标记为 KIND_PROP，因此不进命中掩膜 - 点食盆不该算摸到猫。
 */
export function drawBowl(r: Raster, x: number): void {
  for (let dx = -4; dx <= 4; dx++) r.px(x + dx, GROUND - 1, '#3d4f8a', KIND_PROP);
  for (let dx = -5; dx <= 5; dx++) {
    r.px(x + dx, GROUND, '#2c3a68', KIND_PROP);
    r.px(x + dx, GROUND + 1, '#232c52', KIND_PROP);
  }
  for (let dx = -3; dx <= 3; dx++) r.px(x + dx, GROUND - 2, '#c98a4b', KIND_PROP);
  r.px(x - 1, GROUND - 3, '#e0a45e', KIND_PROP);
  r.px(x + 2, GROUND - 3, '#e0a45e', KIND_PROP);
}

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
