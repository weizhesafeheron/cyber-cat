import { OUTLINE } from '../render/palette.js';
import { GLYPH_H, GLYPH_W, textPixels, textWidth } from './font.js';

/**
 * 台词气泡的像素画。
 *
 * 与回归气泡（diary/art.ts）是两件东西，刻意不共用：那个是**可点的入口**，
 * 尺寸下限由「点得中」决定、颜色要在任何壁纸上都显眼、形状固定；
 * 这个是纯装饰，宽度跟着台词长短变，而且**永远不进命中掩膜** -
 * 点在「yummy...」上不该有任何反应，那不是一个按钮。
 *
 * 共用的只有描边色与「先铺色块、最后统一描边」这个画法。共用描边色是必须的：
 * 差一点色调，气泡就会读成另一套美术里的贴纸（props/art.ts 也复述了这条）。
 *
 * 不依赖 DOM，输出是裸像素，因此可以在 node 里测。
 */

/** 气泡内壁。与回归气泡同色 - 同一只猫的两种气泡不该看起来来自两套美术。 */
const PANEL = '#161c34';

/** 字的颜色。奶油白，比青色柔和 - 这是句闲话，不是要用户去点的提示。 */
const INK = '#ffe9c9';

/** 文字四周的内边距，像素。左右各这么多，上下各这么多。 */
const PAD_X = 3;
const PAD_Y = 3;

/** 尾巴的高度，像素。尖对着猫的头顶。 */
const TAIL_H = 3;

export interface SaySprite {
  readonly width: number;
  readonly height: number;
  /** RGBA，长度 width * height * 4。 */
  readonly pixels: Uint8ClampedArray;
  /** 尾巴尖所在的列。气泡按它对齐到猫的头顶正中。 */
  readonly tipX: number;
}

function rgb(hex: string): readonly [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ] as const;
}

/**
 * 排一句台词的气泡。
 *
 * 形状是按文字尺寸算出来的，不是手写点阵：台词一改，手写的形状就得重画一遍，
 * 而且宽度对不上的时候文字会压在描边上 - 那种缺陷在真机上很难一眼看出。
 */
export function saySprite(text: string): SaySprite {
  const tw = textWidth(text);
  const bodyW = tw + PAD_X * 2;
  const bodyH = GLYPH_H + PAD_Y * 2;
  const w = bodyW;
  const h = bodyH + TAIL_H;

  const solid = new Uint8Array(w * h);
  // body：上下各削一级圆角，四个角空出来就够圆了 - 削两级在这个高度上会显得瘪。
  for (let y = 0; y < bodyH; y++) {
    const inset = y === 0 || y === bodyH - 1 ? 1 : 0;
    for (let x = inset; x < w - inset; x++) solid[y * w + x] = 1;
  }
  // 尾巴：从下沿偏左三分之一处伸出，逐行收窄成一个尖。
  // 偏左而不是正中：猫吃饭时头是朝前低下去的，气泡的尖偏向头那一侧才像它说的。
  const tipX = Math.max(1, Math.round(w * 0.34));
  for (let i = 0; i < TAIL_H; i++) {
    const y = bodyH + i;
    const half = TAIL_H - 1 - i;
    for (let x = tipX - half; x <= tipX + half; x++) {
      if (x >= 0 && x < w) solid[y * w + x] = 1;
    }
  }

  const color = new Array<string | undefined>(w * h);
  const at = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= w || y >= h ? 0 : solid[y * w + x]!;
  // 描边：形状内、四邻里有一个在形状外。与渲染层和回归气泡同一个画法 -
  // 手工标每个边缘像素的话，调一次圆角就得全部重标。
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!solid[y * w + x]) continue;
      const edge =
        at(x + 1, y) === 0 || at(x - 1, y) === 0 || at(x, y + 1) === 0 || at(x, y - 1) === 0;
      color[y * w + x] = edge ? OUTLINE : PANEL;
    }
  }
  // 文字压在最上层，落在 body 的内部，所以不会被描边吃掉。
  for (const [gx, gy] of textPixels(text)) {
    const x = PAD_X + gx;
    const y = PAD_Y + gy;
    if (x >= 0 && x < w && y >= 0 && y < h) color[y * w + x] = INK;
  }

  const pixels = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const c = color[i];
    if (c === undefined) continue;
    const [r, g, b] = rgb(c);
    const o = i * 4;
    pixels[o] = r;
    pixels[o + 1] = g;
    pixels[o + 2] = b;
    pixels[o + 3] = 255;
  }
  return { width: w, height: h, pixels, tipX };
}

/** 字模的尺寸。给测试与布局用。 */
export const SAY_GLYPH = { w: GLYPH_W, h: GLYPH_H } as const;
