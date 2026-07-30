import { OUTLINE, SHADOW } from './palette.js';
import { clamp, hash2 } from './rng.js';
import type { RenderResult } from './types.js';

/**
 * 像素缓冲尺寸。
 *
 * 72x56 是可爱度与可辨识度的平衡点，改动它会让所有品种参数需要重新调。
 * GROUND 是地面线的 y 坐标，姿态系统以它为基准把猫放在地上。
 */
export const W = 72;
export const H = 56;
export const GROUND = 50;

/**
 * 像素归属。决定该像素是否进入命中掩膜。
 *
 * 影子、Zzz 气泡、尘土都是画面的一部分但不是猫 -
 * 点影子不该算摸到猫（ADR 0006）。
 */
export const KIND_EMPTY = 0;
export const KIND_CAT = 1;
/**
 * 场景道具。
 *
 * 食盆曾经是这一类里唯一的成员；ADR 0004 之后它变成了独立的挂件窗口，
 * 于是这个缓冲里已经不会再出现道具像素。留着不删是因为 outlinePass 的
 * 「描边属于它所包围的东西」那条规则要有一个「不是猫」的归属可写 -
 * 少了它，将来任何非猫的绘制都会默默变成可点区域。
 */
export const KIND_PROP = 2;
/** 装饰（影子、Zzz、尘土）。 */
export const KIND_DECOR = 3;

/** shade 回调：给定局部坐标与绝对坐标，返回颜色或 null（不画）。 */
export type Shade = (u: number, v: number, x: number, y: number) => string | null | undefined;

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

/**
 * 逐像素光栅化目标。
 *
 * 像素与命中掩膜从同一个缓冲一次产出（见 toResult），因此两者的同源性是
 * 结构保证，不依赖调用方的使用约定。
 */
export class Raster {
  private readonly buf: (string | undefined)[] = new Array<string | undefined>(W * H);
  private readonly kind = new Uint8Array(W * H);
  private readonly pixels = new Uint8ClampedArray(W * H * 4);
  private readonly mask = new Uint8Array(W * H);

  clear(): void {
    this.buf.fill(undefined);
    this.kind.fill(KIND_EMPTY);
  }

  px(x: number, y: number, color: string | null | undefined, kind = KIND_CAT): void {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    if (!color) return;
    const i = y * W + x;
    this.buf[i] = color;
    this.kind[i] = kind;
  }

  private at(x: number, y: number): string | undefined {
    if (x < 0 || y < 0 || x >= W || y >= H) return undefined;
    return this.buf[y * W + x];
  }

  private kindAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= W || y >= H) return KIND_EMPTY;
    return this.kind[y * W + x]!;
  }

  /**
   * 椭圆光栅化。
   *
   * fluff > 0 时在内缘随机剔除像素、在外缘随机长出像素，用来表现蓬松品种的
   * 轮廓。内外双向是必要的 - 只做外缘会变成描边毛刺。
   */
  blob(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    shade: Shade,
    fluff: number,
    seed: number,
    kind = KIND_CAT,
  ): void {
    const x0 = Math.floor(cx - rx - 2);
    const x1 = Math.ceil(cx + rx + 2);
    const y0 = Math.floor(cy - ry - 2);
    const y1 = Math.ceil(cy + ry + 2);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const u = (x + 0.5 - cx) / rx;
        const v = (y + 0.5 - cy) / ry;
        const d = u * u + v * v;
        if (d <= 1) {
          // 内缘啃出毛边
          if (fluff && d > 0.86 && hash2(x, y, seed) < fluff * 0.35) continue;
          this.px(x, y, shade(clamp(u, -1, 1), clamp(v, -1, 1), x, y), kind);
        } else if (fluff && d < 1.35 && hash2(x, y, seed + 7) < fluff * 0.6) {
          // 外缘长出绒毛
          this.px(x, y, shade(clamp(u, -1, 1), clamp(v, -1, 1), x, y), kind);
        }
      }
    }
  }

  rect(x0: number, y0: number, w: number, h: number, shade: Shade, kind = KIND_CAT): void {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const u = w > 1 ? ((x - x0) / (w - 1)) * 2 - 1 : 0;
        const v = h > 1 ? ((y - y0) / (h - 1)) * 2 - 1 : 0;
        this.px(x, y, shade(u, v, x, y), kind);
      }
    }
  }

  /**
   * 描边：给所有紧贴非空像素的空像素涂上描边色。
   *
   * **必须在所有部件绘制完之后跑**，否则会在部件之间产生内部黑线。
   * 先收集再统一写入，避免本次新写入的描边像素成为下一个像素的邻居而级联扩散。
   */
  outlinePass(rawStrength = 0): void {
    const strength = clamp(rawStrength, -1, 1);
    const marks: number[] = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (this.buf[y * W + x]) continue;
        const cardinal =
          this.at(x + 1, y) || this.at(x - 1, y) || this.at(x, y + 1) || this.at(x, y - 1);
        const diagonal =
          strength > 0.48 &&
          (this.at(x + 1, y + 1) ||
            this.at(x - 1, y + 1) ||
            this.at(x + 1, y - 1) ||
            this.at(x - 1, y - 1));
        if (cardinal || diagonal) {
          marks.push(y * W + x);
        }
      }
    }
    for (const i of marks) {
      const x = i % W;
      const y = (i / W) | 0;
      // 描边属于它所包围的东西。猫的描边算猫（可点），道具的描边算道具。
      const touchesCat =
        this.kindAt(x + 1, y) === KIND_CAT ||
        this.kindAt(x - 1, y) === KIND_CAT ||
        this.kindAt(x, y + 1) === KIND_CAT ||
        this.kindAt(x, y - 1) === KIND_CAT;
      if (Math.abs(strength) < 0.001) {
        this.buf[i] = OUTLINE;
      } else {
        const [r, g, b] = rgb(OUTLINE);
        const target = strength > 0 ? [10, 8, 16] : [102, 95, 116];
        const amount = Math.abs(strength) * 0.72;
        this.buf[i] = `#${[r, g, b]
          .map((channel, index) =>
            Math.round(channel + (target[index]! - channel) * amount)
              .toString(16)
              .padStart(2, '0'),
          )
          .join('')}`;
      }
      this.kind[i] = touchesCat ? KIND_CAT : KIND_PROP;
    }
  }

  /** 地面投影。半椭圆，只填空像素，不覆盖猫。 */
  shadowPass(cx: number, rx: number): void {
    for (let y = GROUND; y <= GROUND + 1; y++) {
      for (let x = Math.round(cx - rx); x <= Math.round(cx + rx); x++) {
        if (x < 0 || x >= W || y < 0 || y >= H) continue;
        const u = (x - cx) / rx;
        if (u * u <= 1 - (y - GROUND) * 0.4 && !this.buf[y * W + x]) {
          this.buf[y * W + x] = SHADOW;
          this.kind[y * W + x] = KIND_DECOR;
        }
      }
    }
  }

  /**
   * 输出。像素与掩膜在同一次遍历中从同一个缓冲产出。
   *
   * 返回的数组是内部复用的 - 调用方若需跨帧保留必须自行拷贝。
   */
  toResult(): RenderResult {
    const { buf, kind, pixels, mask } = this;
    for (let i = 0; i < W * H; i++) {
      const c = buf[i];
      const o = i * 4;
      if (c) {
        const [r, g, b] = rgb(c);
        pixels[o] = r;
        pixels[o + 1] = g;
        pixels[o + 2] = b;
        pixels[o + 3] = 255;
      } else {
        pixels[o] = 0;
        pixels[o + 1] = 0;
        pixels[o + 2] = 0;
        pixels[o + 3] = 0;
      }
      mask[i] = kind[i] === KIND_CAT ? 255 : 0;
    }
    return { width: W, height: H, pixels, alphaMask: mask };
  }
}
