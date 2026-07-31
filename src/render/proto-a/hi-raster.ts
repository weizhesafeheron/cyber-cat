/**
 * 原型 A 的高分辨率光栅化器。
 *
 * 架构：`HiRaster extends Raster`，几何输入仍是 72x56 的精灵坐标系
 * （GROUND、CENTER_X、所有品种参数一概不动），内部在 2 倍网格（144x112）
 * 上重新采样。这样 poses.ts / parts.ts / actions.ts 一行不改，
 * 现状渲染器与原型可以在同一页面共存对比。
 *
 * 144x112 是调研给出的分辨率天花板：1x 屏 1:1、Retina 干净 2x，
 * 216x168 会跌破 1:1 直接排除。
 *
 * 着色升级的四件事都在这里落地：
 * - blob/rect 内逐像素解析法线 -> 固定光向点乘 -> 量化色带（shading.ts）
 * - 色带用 hue shift 查表色（color.ts / shading.ts）
 * - outlinePass 换成 selout：受光侧描边提亮为本体暗色
 * - 轮廓毛簇：部件局部极角上的确定性噪声（fur.ts），帧间不沸腾
 */

import { SHADOW } from '../palette.js';
import {
  KIND_CAT,
  KIND_DECOR,
  KIND_EMPTY,
  KIND_PROP,
  GROUND,
  Raster,
  W,
  H,
  type Shade,
} from '../raster.js';
import { clamp } from '../rng.js';
import type { Cat, RenderResult } from '../types.js';
import { furOffset } from './fur.js';
import {
  LIGHT2D,
  reshadeCylinder,
  reshadeSphere,
  seloutColor,
  shadeLutFor,
  type ShadeLut,
} from './shading.js';

export const SCALE = 2;
export const W2 = W * SCALE;
export const H2 = H * SCALE;

const colorCache = new Map<string, readonly [number, number, number]>();

function rgb(hex: string): readonly [number, number, number] {
  let c = colorCache.get(hex);
  if (!c) {
    c = [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ] as const;
    colorCache.set(hex, c);
  }
  return c;
}

export class HiRaster extends Raster {
  private readonly hbuf: (string | undefined)[] = new Array<string | undefined>(W2 * H2);
  private readonly hkind = new Uint8Array(W2 * H2);
  private readonly hpixels = new Uint8ClampedArray(W2 * H2 * 4);
  private readonly hmask = new Uint8Array(W2 * H2);
  private lut: ShadeLut = new Map();

  /** 每帧渲染前设置当前猫，用它的调色板建着色查表。 */
  setCat(cat: Cat): void {
    this.lut = shadeLutFor(cat.pal);
  }

  override clear(): void {
    this.hbuf.fill(undefined);
    this.hkind.fill(KIND_EMPTY);
  }

  /** 直接写一个高分辨率像素。 */
  private hset(x: number, y: number, color: string | null | undefined, kind: number): void {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= W2 || y >= H2) return;
    if (!color) return;
    const i = y * W2 + x;
    this.hbuf[i] = color;
    this.hkind[i] = kind;
  }

  private hat(x: number, y: number): string | undefined {
    if (x < 0 || y < 0 || x >= W2 || y >= H2) return undefined;
    return this.hbuf[y * W2 + x];
  }

  private hkindAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= W2 || y >= H2) return KIND_EMPTY;
    return this.hkind[y * W2 + x]!;
  }

  /**
   * 精灵坐标写点：填一个 2x2 块。
   *
   * 眼睛、内耳、Zzz、尘土这些逐点绘制的符号沿用它，
   * 保持与现状相同的视觉粒度（符号不是体积，不参与重着色）。
   */
  override px(x: number, y: number, color: string | null | undefined, kind = KIND_CAT): void {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    if (!color) return;
    for (let dy = 0; dy < SCALE; dy++) {
      for (let dx = 0; dx < SCALE; dx++) {
        this.hset(x * SCALE + dx, y * SCALE + dy, color, kind);
      }
    }
  }

  /**
   * 椭圆：在 2 倍网格上重新采样。
   *
   * - shade 回调收到的 x, y 是**精灵坐标**（高分坐标右移一位），
   *   花纹里的哈希抖动与波浪纹保持原空间尺度，也保持 2x2 的色块簇感 -
   *   调研明确：内部花纹用色块簇，不用逐像素噪声。
   * - fluff/seed 语义升级：不再逐像素哈希啃边，而是部件局部极角上的
   *   确定性毛簇（fur.ts）。seed 为 0 的装饰性椭圆（口鼻、关节垫）保持光滑。
   */
  override blob(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    shade: Shade,
    fluff: number,
    seed: number,
    kind = KIND_CAT,
  ): void {
    const x0 = Math.floor((cx - rx) * SCALE) - 3;
    const x1 = Math.ceil((cx + rx) * SCALE) + 3;
    const y0 = Math.floor((cy - ry) * SCALE) - 3;
    const y1 = Math.ceil((cy + ry) * SCALE) + 3;
    const furry = seed !== 0;
    const small = Math.min(rx, ry) <= 2.6;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const sx = (x + 0.5) / SCALE;
        const sy = (y + 0.5) / SCALE;
        const u = (sx - cx) / rx;
        const v = (sy - cy) / ry;
        const d = u * u + v * v;
        const rr = Math.sqrt(d);
        const edge = furry ? 1 + furOffset(Math.atan2(v, u), seed, fluff) : 1;
        if (rr > edge) continue;
        const uc = clamp(u, -1, 1);
        const vc = clamp(v, -1, 1);
        const c = shade(uc, vc, Math.floor(sx), Math.floor(sy));
        if (!c) continue;
        this.hset(x, y, reshadeSphere(this.lut, c, uc, vc, Math.min(d, 1), small), kind);
      }
    }
  }

  /** 矩形（腿）：按竖直柱面着色。 */
  override rect(x0: number, y0: number, w: number, h: number, shade: Shade, kind = KIND_CAT): void {
    const X0 = x0 * SCALE;
    const Y0 = y0 * SCALE;
    const HW = w * SCALE;
    const HH = h * SCALE;
    for (let y = Y0; y < Y0 + HH; y++) {
      for (let x = X0; x < X0 + HW; x++) {
        const u = HW > 1 ? ((x - X0 + 0.5) / HW) * 2 - 1 : 0;
        const v = HH > 1 ? ((y - Y0 + 0.5) / HH) * 2 - 1 : 0;
        const c = shade(u, v, x >> 1, y >> 1);
        if (!c) continue;
        this.hset(x, y, reshadeCylinder(this.lut, c, u, v), kind);
      }
    }
  }

  /**
   * selout 描边：整圈锁形，但描边色随受光侧变化。
   *
   * 均匀深色描边是「贴纸/塑料玩具」观感的直接来源之一（调研 2.4 节）。
   * 受光侧提亮到本体暗色而不是去掉描边 - 桌面壁纸不可控，
   * 任意壁纸上剪影必须完整。
   */
  override outlinePass(rawStrength = 0): void {
    const strength = clamp(rawStrength, -1, 1);
    interface Mark {
      i: number;
      color: string;
      touchesCat: boolean;
    }
    const marks: Mark[] = [];
    for (let y = 0; y < H2; y++) {
      for (let x = 0; x < W2; x++) {
        if (this.hbuf[y * W2 + x]) continue;
        let ox = 0;
        let oy = 0;
        let neighbor: string | undefined;
        const consider = (dx: number, dy: number): void => {
          const c = this.hat(x + dx, y + dy);
          if (!c) return;
          ox -= dx;
          oy -= dy;
          neighbor = neighbor ?? c;
        };
        consider(1, 0);
        consider(-1, 0);
        consider(0, 1);
        consider(0, -1);
        const cardinal = neighbor !== undefined;
        if (!cardinal && strength > 0.48) {
          consider(1, 1);
          consider(-1, 1);
          consider(1, -1);
          consider(-1, -1);
        }
        if (neighbor === undefined) continue;
        const len = Math.hypot(ox, oy) || 1;
        const dot = (ox / len) * LIGHT2D[0] + (oy / len) * LIGHT2D[1];
        const touchesCat =
          this.hkindAt(x + 1, y) === KIND_CAT ||
          this.hkindAt(x - 1, y) === KIND_CAT ||
          this.hkindAt(x, y + 1) === KIND_CAT ||
          this.hkindAt(x, y - 1) === KIND_CAT;
        marks.push({ i: y * W2 + x, color: seloutColor(this.lut, neighbor, dot), touchesCat });
      }
    }
    for (const m of marks) {
      this.hbuf[m.i] = m.color;
      this.hkind[m.i] = m.touchesCat ? KIND_CAT : KIND_PROP;
    }
  }

  /** 地面投影。3 行高分像素的半椭圆，只填空像素。 */
  override shadowPass(cx: number, rx: number): void {
    const cy = GROUND * SCALE;
    const hrx = rx * SCALE;
    for (let y = cy; y < cy + 3; y++) {
      for (let x = Math.round(cx * SCALE - hrx); x <= Math.round(cx * SCALE + hrx); x++) {
        if (x < 0 || x >= W2 || y < 0 || y >= H2) continue;
        const u = (x - cx * SCALE) / hrx;
        if (u * u <= 1 - (y - cy) * 0.28 && !this.hbuf[y * W2 + x]) {
          this.hbuf[y * W2 + x] = SHADOW;
          this.hkind[y * W2 + x] = KIND_DECOR;
        }
      }
    }
  }

  override toResult(): RenderResult {
    const { hbuf, hkind, hpixels, hmask } = this;
    for (let i = 0; i < W2 * H2; i++) {
      const c = hbuf[i];
      const o = i * 4;
      if (c) {
        const [r, g, b] = rgb(c);
        hpixels[o] = r;
        hpixels[o + 1] = g;
        hpixels[o + 2] = b;
        hpixels[o + 3] = 255;
      } else {
        hpixels[o] = 0;
        hpixels[o + 1] = 0;
        hpixels[o + 2] = 0;
        hpixels[o + 3] = 0;
      }
      hmask[i] = hkind[i] === KIND_CAT ? 255 : 0;
    }
    return { width: W2, height: H2, pixels: hpixels, alphaMask: hmask };
  }
}
