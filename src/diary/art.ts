import { OUTLINE } from '../render/palette.js';
import { BUBBLE_H_SPRITE, BUBBLE_W_SPRITE } from './constants.js';

/**
 * 回归气泡的像素画。
 *
 * **不画在猫的精灵缓冲里。** 既定结论是「精灵缓冲里只有猫」
 * （docs/art-and-motion-decisions.md 的「场景道具一律不画在精灵缓冲里」，
 * props/art.ts 也复述了一遍）。气泡更是如此：它是 UI 覆盖层，只在离开够久之后
 * 出现几十秒，而缓冲里的每个像素都会进命中掩膜与描边通道。
 * 所以它走爪印那条路 - 舞台里的第二张画布（app/bubble.ts）。
 *
 * 与猫共用的只有描边色。共用是必须的：差一点色调，气泡就会读成另一套美术里的贴纸。
 *
 * 不依赖 DOM，输出是裸像素，因此可以在 node 里测。
 */

/** 气泡内壁。深靛蓝，与领养页的卡片同色 - 那套配色已经验收过。 */
const PANEL = '#161c34';
/**
 * 三个点。
 *
 * 取青色（与领养页的强调色同一个）是因为**气泡必须在任何壁纸上都能被看见**：
 * 深色描边保证它在浅色壁纸上有轮廓，亮青的点保证它在深色壁纸上不会整块消失。
 * 用「三个点」而不是一个字：一个汉字在 22×18 里只能占 8×8，笔画会糊成一团；
 * 省略号是「它有话要说」的通用记号，不需要认字。
 */
const DOT = '#4deeea';

/** 一行色块：[y, x 起, x 止（含）]。气泡是个对称的圆角块，按行写最好调。 */
type Run = readonly [number, number, number];

/**
 * 气泡的轮廓形状（含尾巴）。
 *
 * 上下各削两级圆角，尾巴从下沿正中伸出三行收成一个尖 - 尖对着猫的头顶，
 * 「这句话是这只猫的」靠这一笔说清，不靠位置暗示。
 */
const SHAPE: readonly Run[] = [
  [0, 2, 19],
  [1, 1, 20],
  [2, 0, 21],
  [3, 0, 21],
  [4, 0, 21],
  [5, 0, 21],
  [6, 0, 21],
  [7, 0, 21],
  [8, 0, 21],
  [9, 0, 21],
  [10, 0, 21],
  [11, 0, 21],
  [12, 0, 21],
  [13, 1, 20],
  [14, 2, 19],
  [15, 9, 13],
  [16, 10, 12],
  [17, 11, 11],
];

/** 三个点，每个 3×3。行列都在轮廓内部，所以不会被描边吃掉。 */
const DOTS: readonly Run[] = [
  [7, 4, 6],
  [7, 9, 11],
  [7, 14, 16],
  [8, 4, 6],
  [8, 9, 11],
  [8, 14, 16],
  [9, 4, 6],
  [9, 9, 11],
  [9, 14, 16],
];

export interface BubbleSprite {
  readonly width: number;
  readonly height: number;
  /** RGBA，长度 width * height * 4。 */
  readonly pixels: Uint8ClampedArray;
}

function rgb(hex: string): readonly [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ] as const;
}

function build(): BubbleSprite {
  const w = BUBBLE_W_SPRITE;
  const h = BUBBLE_H_SPRITE;
  const solid = new Uint8Array(w * h);
  for (const [y, x0, x1] of SHAPE) {
    for (let x = x0; x <= x1; x++) solid[y * w + x] = 1;
  }

  const color = new Array<string | undefined>(w * h);
  // 描边：形状内、且四邻里有一个不在形状里的像素。与渲染层「先铺色块、最后统一
  // 描边」是同一个画法，不是手工标出每一个边缘像素 - 手标的话调一次圆角就得重标。
  const at = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= w || y >= h ? 0 : solid[y * w + x]!;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!solid[y * w + x]) continue;
      const edge =
        at(x + 1, y) === 0 || at(x - 1, y) === 0 || at(x, y + 1) === 0 || at(x, y - 1) === 0;
      color[y * w + x] = edge ? OUTLINE : PANEL;
    }
  }
  for (const [y, x0, x1] of DOTS) {
    for (let x = x0; x <= x1; x++) color[y * w + x] = DOT;
  }

  const pixels = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const c = color[i];
    if (!c) continue;
    const [r, g, b] = rgb(c);
    const o = i * 4;
    pixels[o] = r;
    pixels[o + 1] = g;
    pixels[o + 2] = b;
    pixels[o + 3] = 255;
  }
  return { width: w, height: h, pixels };
}

/**
 * 气泡贴图。形状是固定的，所以只算一次。
 *
 * 返回的数组不要改动 - 它被所有调用方共用（与渲染层「复用缓冲」同一条约定）。
 */
export const BUBBLE_SPRITE: BubbleSprite = build();
