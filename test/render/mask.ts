import { H, W } from '../../src/render/index.js';
import type { RenderResult } from '../../src/render/index.js';

export interface Bbox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  w: number;
  h: number;
  /** 掩膜内的像素数 */
  n: number;
}

/** 命中掩膜的包围盒。掩膜为空时返回 n = 0。 */
export function maskBbox(mask: Uint8Array): Bbox {
  let x0 = W;
  let y0 = H;
  let x1 = -1;
  let y1 = -1;
  let n = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (mask[y * W + x] !== 255) continue;
      n++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1, n };
}

/** 掩膜的 Jaccard 差异率：两者不一致的像素数 / 两者并集。0 = 完全相同。 */
export function maskDiffRatio(a: Uint8Array, b: Uint8Array): number {
  let diff = 0;
  let union = 0;
  for (let i = 0; i < a.length; i++) {
    const p = a[i] === 255;
    const q = b[i] === 255;
    if (p !== q) diff++;
    if (p || q) union++;
  }
  return union === 0 ? 0 : diff / union;
}

/** 取某个像素的 "r,g,b" 字符串，便于按颜色查找特定元素。 */
export function colorAt(res: RenderResult, i: number): string {
  const o = i * 4;
  return `${res.pixels[o]},${res.pixels[o + 1]},${res.pixels[o + 2]}`;
}

/** 拷贝一份渲染结果 - 渲染器复用内部缓冲，跨帧保留必须拷贝。 */
export function snapshot(res: RenderResult): RenderResult {
  return {
    width: res.width,
    height: res.height,
    pixels: Uint8ClampedArray.from(res.pixels),
    alphaMask: Uint8Array.from(res.alphaMask),
  };
}
