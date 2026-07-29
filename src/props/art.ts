import { OUTLINE } from '../render/palette.js';
import { KIBBLE_MAX_ROWS, PROP_SPRITE } from './constants.js';
import type { PropKind, PropSprite } from './types.js';

/**
 * 挂件的像素画。
 *
 * **为什么不画在猫的渲染器里。** 原型阶段食盆是猫的姿态字段（`Pose.bowl`），
 * 跟着猫画在同一个 72×56 的缓冲里 - 那时房间是一整块画布，食盆理所当然是画面的
 * 一部分。ADR 0004 之后挂件是独立窗口、位置由用户决定，它和猫已经不在同一个
 * 缓冲里了，继续挂在 Pose 上只会让猫的渲染器背着一个永远为 undefined 的字段。
 *
 * 与猫的渲染层共用的只有两样东西：描边色，以及「先铺色块、最后统一描边」这个
 * 画法。共用描边色是必须的 - 差一点点色调，挂件就会读成另一套美术里的贴纸。
 *
 * 不依赖 DOM：输出是裸的像素与掩膜，画到 canvas 是挂件窗口的事。因此可以在
 * node 里测（test/props/art.test.ts）。
 */

/** 食盆的三档蓝紫，与原型里那个食盆同色 - 那套配色已经验收过。 */
const BOWL_RIM = '#4a5ea0';
const BOWL_BODY = '#3d4f8a';
const BOWL_BODY_DARK = '#2c3a68';
const BOWL_BASE = '#232c52';
/** 猫粮。暖橙，是整块画面里唯一的暖色 - 「碗里有粮」要一眼看见。 */
const KIBBLE = '#c98a4b';
const KIBBLE_HI = '#e0a45e';

/** 猫窝坐垫。低饱和紫，与爪印和尘土同一族的冷灰紫。 */
const BED_HI = '#7d68a6';
const BED_BODY = '#6f5c93';
const BED_DARK = '#54467a';
const BED_BASE = '#42355c';

/** 一行色块：[y, x 起, x 止（含）, 颜色]。挂件都是横向对称的矮东西，按行写最好读也最好调。 */
type Row = readonly [number, number, number, string];

/**
 * 食盆的盆体。
 *
 * 盆口那一行中间压深一档（BOWL_BODY_DARK），两侧留出 RIM 的亮边 -
 * 只有这一笔能让空盆读出「是个凹的容器」而不是一块梯形色块。
 */
const BOWL_ROWS: readonly Row[] = [
  [6, 3, 22, BOWL_RIM],
  [6, 6, 19, BOWL_BODY_DARK],
  [7, 3, 22, BOWL_BODY],
  [8, 4, 21, BOWL_BODY_DARK],
  [9, 6, 19, BOWL_BASE],
  [10, 8, 17, BOWL_BASE],
];

/**
 * 猫粮：一份一行，从盆口往上堆，越往上越窄。
 *
 * 堆在盆口**之上**而不是填在盆里：盆只有 5 行高，填进去的粮会被盆壁挡掉，
 * 「碗里有粮」在 3 倍缩放下也看不出来。原型里也是堆在盆口上的。
 */
const KIBBLE_ROWS: readonly Row[] = [
  [5, 7, 18, KIBBLE],
  [4, 9, 16, KIBBLE],
  [3, 11, 14, KIBBLE_HI],
];

/** 粮堆上的高光点。两三个亮像素就够读出颗粒感，铺满会糊成一块橙色。 */
const KIBBLE_SPECKS: readonly (readonly [number, number])[] = [
  [9, 5],
  [14, 5],
  [11, 4],
];

/** 猫窝坐垫。扁的椭圆，最高处离地 6 个精灵像素。 */
const BED_ROWS: readonly Row[] = [
  [4, 8, 35, BED_HI],
  [5, 5, 38, BED_BODY],
  [6, 4, 39, BED_BODY],
  [7, 5, 38, BED_DARK],
  [8, 8, 35, BED_BASE],
];

/**
 * 坐垫上的缝线。
 *
 * 等距的暗点，不是随机噪点 - 与橘猫条纹那条结论同源（art-and-motion-decisions）：
 * 在这个尺度上随机抖动读起来是脏，规律排列才读成织物。
 */
const BED_STITCH_X: readonly number[] = [11, 17, 23, 29, 35];

/**
 * 逐像素光栅化目标。
 *
 * 与渲染层的 `Raster` 是同一个思路但**不复用它**：那个类的尺寸是写死的 72×56
 * （所有品种参数都按那个尺度调的常量），挂件各有自己的尺寸。
 * 这里也不需要 kind 缓冲 - 挂件窗口里的每个像素都是挂件本体，全部可点。
 */
class PropRaster {
  private readonly buf: (string | undefined)[];

  constructor(
    private readonly w: number,
    private readonly h: number,
  ) {
    this.buf = new Array<string | undefined>(w * h);
  }

  px(x: number, y: number, color: string): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.buf[y * this.w + x] = color;
  }

  row([y, x0, x1, color]: Row): void {
    for (let x = x0; x <= x1; x++) this.px(x, y, color);
  }

  private at(x: number, y: number): string | undefined {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return undefined;
    return this.buf[y * this.w + x];
  }

  /**
   * 描边。**必须在所有色块之后跑**，否则会在色块之间描出内部黑线。
   * 先收集再写入，避免刚写下的描边成为下一个像素的邻居而级联扩散。
   * 这两条约束与渲染层的 outlinePass 完全相同，踩过的坑也相同。
   */
  outline(): void {
    const marks: number[] = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.buf[y * this.w + x]) continue;
        if (this.at(x + 1, y) || this.at(x - 1, y) || this.at(x, y + 1) || this.at(x, y - 1)) {
          marks.push(y * this.w + x);
        }
      }
    }
    for (const i of marks) this.buf[i] = OUTLINE;
  }

  /** 像素与掩膜在同一次遍历里从同一个缓冲产出，同源性是结构保证（ADR 0006）。 */
  toSprite(): PropSprite {
    const pixels = new Uint8ClampedArray(this.w * this.h * 4);
    const alphaMask = new Uint8Array(this.w * this.h);
    for (let i = 0; i < this.w * this.h; i++) {
      const c = this.buf[i];
      if (!c) continue;
      const o = i * 4;
      pixels[o] = parseInt(c.slice(1, 3), 16);
      pixels[o + 1] = parseInt(c.slice(3, 5), 16);
      pixels[o + 2] = parseInt(c.slice(5, 7), 16);
      pixels[o + 3] = 255;
      alphaMask[i] = 255;
    }
    return { width: this.w, height: this.h, pixels, alphaMask };
  }
}

/**
 * 画食盆。`portions` 是碗里剩余的份数（世界层的 `world.bowl`）。
 *
 * 份数直接决定粮堆的层数，所以「视觉上能看到碗里有粮」不是另做一套表现，
 * 而是同一个数的投影 - 世界层加一份，盆里就高一层。
 */
export function bowlSprite(portions: number): PropSprite {
  const { w, h } = PROP_SPRITE.bowl;
  const r = new PropRaster(w, h);
  for (const row of BOWL_ROWS) r.row(row);
  const heap = Math.max(0, Math.min(KIBBLE_MAX_ROWS, Math.floor(portions)));
  for (let i = 0; i < heap; i++) r.row(KIBBLE_ROWS[i]!);
  if (heap > 0) {
    for (const [x, y] of KIBBLE_SPECKS) {
      // 只在这一层真的有粮时才点高光，否则高光会浮在空气里。
      if (y >= 6 - heap) r.px(x, y, KIBBLE_HI);
    }
  }
  r.outline();
  return r.toSprite();
}

/** 画猫窝。没有状态可分档 - 窝就是窝，猫在不在里面由猫的窗口表现。 */
export function bedSprite(): PropSprite {
  const { w, h } = PROP_SPRITE.bed;
  const r = new PropRaster(w, h);
  for (const row of BED_ROWS) r.row(row);
  for (const x of BED_STITCH_X) r.px(x, 5, BED_DARK);
  r.outline();
  return r.toSprite();
}

/** 按种类取贴图。`portions` 只对食盆有意义。 */
export function propSprite(kind: PropKind, portions = 0): PropSprite {
  return kind === 'bowl' ? bowlSprite(portions) : bedSprite();
}
