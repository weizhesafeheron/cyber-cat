/**
 * 原型 B 资产生成器的像素网格与着色工具。
 *
 * 部件位图在这里以「语义 ID 网格」表示（每像素一个 palette ID），
 * 导出 PNG 时才转成规范 RGB。着色规则来自 hi-fi 调研报告：
 * 固定光源（上偏前）、法线点乘量化到色带档位、受光侧 selout、
 * 确定性毛发簇打破轮廓。
 */
import { CANON, ID } from '../../src/render/proto-b/palette.js';
import { parseHex } from '../../src/render/proto-b/ramp.js';

/** 全局光向（指向光源）。屏幕坐标 y 向下，光在上方偏右前。 */
export const LIGHT_X = 0.35;
export const LIGHT_Y = -0.94;

export class PGrid {
  readonly w: number;
  readonly h: number;
  readonly d: Uint8Array;
  /** 每像素的光照亮度缓存，描边 pass 判定受光侧用。 */
  readonly lum: Float32Array;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.d = new Uint8Array(w * h);
    this.lum = new Float32Array(w * h).fill(-2);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  get(x: number, y: number): number {
    return this.inBounds(x, y) ? this.d[y * this.w + x]! : 0;
  }

  set(x: number, y: number, id: number, lum?: number): void {
    if (!this.inBounds(x, y)) return;
    this.d[y * this.w + x] = id;
    if (lum !== undefined) this.lum[y * this.w + x] = lum;
  }

  lumAt(x: number, y: number): number {
    return this.inBounds(x, y) ? this.lum[y * this.w + x]! : -2;
  }

  clone(): PGrid {
    const g = new PGrid(this.w, this.h);
    g.d.set(this.d);
    g.lum.set(this.lum);
    return g;
  }
}

/** 确定性 2D 哈希，[0, 1)。同一坐标永远同一值，轮廓簇不会帧间沸腾。 */
export function hash2(x: number, y: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** 一个可填充区域：判定 + 伪法线（单位化的表面朝向，屏幕平面分量）。 */
export interface Region {
  contains(x: number, y: number): boolean;
  normal(x: number, y: number): readonly [number, number];
}

/** 胶囊体（两端半径可不同，即圆台胶囊）。身体、腿、尾段都用它。 */
export function capsule(
  x0: number,
  y0: number,
  r0: number,
  x1: number,
  y1: number,
  r1: number,
): Region {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy || 1;
  const at = (x: number, y: number): { px: number; py: number; r: number } => {
    const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / len2));
    return { px: x0 + dx * t, py: y0 + dy * t, r: r0 + (r1 - r0) * t };
  };
  return {
    contains(x, y) {
      const { px, py, r } = at(x, y);
      const ox = x - px;
      const oy = y - py;
      return ox * ox + oy * oy <= r * r;
    },
    normal(x, y) {
      const { px, py, r } = at(x, y);
      const ox = (x - px) / (r || 1);
      const oy = (y - py) / (r || 1);
      return [ox, oy];
    },
  };
}

export function ellipse(cx: number, cy: number, rx: number, ry: number): Region {
  return {
    contains(x, y) {
      const u = (x - cx) / rx;
      const v = (y - cy) / ry;
      return u * u + v * v <= 1;
    },
    normal(x, y) {
      return [(x - cx) / rx, (y - cy) / ry];
    },
  };
}

/** 多区域并集。normal 取第一个包含该点的区域。 */
export function union(...regions: Region[]): Region {
  return {
    contains(x, y) {
      return regions.some((r) => r.contains(x, y));
    },
    normal(x, y) {
      // 取「离表面最近」的区域法线：用法线长度（越小越靠中心）挑最深的区域，
      // 让重叠处的光照来自主导形体，接缝不打架。
      let best: readonly [number, number] = [0, 0];
      let bestLen = Infinity;
      for (const r of regions) {
        if (!r.contains(x, y)) continue;
        const n = r.normal(x, y);
        const len = n[0] * n[0] + n[1] * n[1];
        if (len < bestLen) {
          bestLen = len;
          best = n;
        }
      }
      return best;
    },
  };
}

export function triangle(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): Region {
  const sign = (x: number, y: number, x1: number, y1: number, x2: number, y2: number): number =>
    (x - x2) * (y1 - y2) - (x1 - x2) * (y - y2);
  const gx = (ax + bx + cx) / 3;
  const gy = (ay + by + cy) / 3;
  return {
    contains(x, y) {
      const d1 = sign(x, y, ax, ay, bx, by);
      const d2 = sign(x, y, bx, by, cx, cy);
      const d3 = sign(x, y, cx, cy, ax, ay);
      const neg = d1 < 0 || d2 < 0 || d3 < 0;
      const pos = d1 > 0 || d2 > 0 || d3 > 0;
      return !(neg && pos);
    },
    normal(x, y) {
      const dx = x - gx;
      const dy = y - gy;
      const len = Math.hypot(dx, dy) || 1;
      return [(dx / len) * 0.8, (dy / len) * 0.8];
    },
  };
}

/** 法线 → 亮度。加确定性抖动让色带边界有机化。 */
export function brightness(nx: number, ny: number, x: number, y: number, seed = 0): number {
  const b = nx * LIGHT_X + ny * LIGHT_Y;
  return b + (hash2(x, y, seed) - 0.5) * 0.18;
}

/** 亮度量化到 4 档填充带。 */
export function coatBand(b: number): number {
  if (b > 0.52) return ID.C3;
  if (b > 0.02) return ID.C2;
  if (b > -0.52) return ID.C1;
  return ID.C0;
}

/** 亮度量化到 3 档腹白带。 */
export function bellyBand(b: number): number {
  if (b > 0.35) return ID.B2;
  if (b > -0.4) return ID.B1;
  return ID.B0;
}

export type BandPicker = (b: number, x: number, y: number) => number;

/** 填充一个区域。bandPicker 决定亮度落到哪条色带的哪一档。 */
export function fillRegion(g: PGrid, region: Region, pick: BandPicker, seed = 0): void {
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      if (!region.contains(x, y)) continue;
      const [nx, ny] = region.normal(x, y);
      const b = brightness(nx, ny, x, y, seed);
      g.set(x, y, pick(b, x, y), b);
    }
  }
}

/**
 * 毛发簇：在轮廓外侧长出 1px 小簇，间距由哈希决定（不均匀但确定）。
 * 只在「上方/斜上方为空」的边缘长毛，腹侧和贴地边保持干净。
 */
export function furTufts(g: PGrid, prob = 0.34, seed = 7): void {
  const src = g.clone();
  for (let y = 1; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const below = src.get(x, y);
      if (below === 0 || src.get(x, y - 1) !== 0) continue;
      // (x, y-1) 是空且正下方有实体：候选簇位。
      if (hash2(x, y, seed) < prob && hash2(x + 13, y, seed) > 0.35) {
        g.set(x, y - 1, below, src.lumAt(x, y));
      }
    }
  }
}

/**
 * 描边 pass：轮廓内侧一圈换成描边带。
 * 受光侧（亮度高）用 OUT_SOFT（selout），背光侧与贴地处用 OUT_DARK。
 */
export function outlinePass(g: PGrid, opts: { groundY?: number } = {}): void {
  const src = g.clone();
  const isBody = (id: number): boolean => id !== 0 && id !== ID.OUT_DARK && id !== ID.OUT_SOFT;
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const id = src.get(x, y);
      if (!isBody(id)) continue;
      const edge =
        src.get(x - 1, y) === 0 ||
        src.get(x + 1, y) === 0 ||
        src.get(x, y - 1) === 0 ||
        src.get(x, y + 1) === 0;
      if (!edge) continue;
      const lit =
        src.lumAt(x, y) > 0.34 && (src.get(x, y - 1) === 0 || src.get(x + 1, y) === 0);
      const grounded = opts.groundY !== undefined && y >= opts.groundY - 1;
      g.set(x, y, lit && !grounded ? ID.OUT_SOFT : ID.OUT_DARK);
    }
  }
}

/** 把 ID 网格转成 RGBA 像素。未知 ID 直接抛错（非法色检查在源头兜底）。 */
export function toRGBA(g: PGrid): Uint8ClampedArray {
  const out = new Uint8ClampedArray(g.w * g.h * 4);
  for (let i = 0; i < g.d.length; i++) {
    const id = g.d[i]!;
    if (id === 0) continue;
    const hex = CANON[id];
    if (!hex) throw new Error(`未登记的 palette ID: ${id}`);
    const rgb = parseHex(hex);
    out[i * 4] = (rgb >> 16) & 0xff;
    out[i * 4 + 1] = (rgb >> 8) & 0xff;
    out[i * 4 + 2] = rgb & 0xff;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** 二值 mask 网格 → RGBA（黑色 + alpha）。 */
export function maskToRGBA(mask: Uint8Array, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) out[i * 4 + 3] = 255;
  }
  return out;
}
