/**
 * 抚摸时冒出来的爱心。
 *
 * 与爪印分层的理由完全相同（见 paws.ts）：爱心从猫头顶升起、各自有寿命，
 * 而猫的画布只有 72×56 个精灵像素并且跟着猫在舞台里移动。
 * 画在猫的缓冲里就会跟着猫一起被裁掉，而且「精灵缓冲里只有猫」是一条既定结论
 * （见 docs/art-and-motion-decisions.md）。
 *
 * **这一层不参与命中判定。** 掩膜里只有猫本体（ADR 0006）- 点在爱心上不算摸到猫，
 * 否则用户点一次会因为爱心还没散而连着摸到好几次。
 *
 * 位置与寿命是纯逻辑（stepHearts / heartsInStage），画的部分才碰 canvas。
 */

/**
 * 爱心图形，精灵像素相对坐标。5×5 的一颗小心。
 *
 * 手写点阵而不是画贝塞尔：这一层与猫共用同一个像素格（同样的整数缩放），
 * 矢量描边在放大之后边缘会与猫的像素错开半格，一眼看出是两套东西。
 */
const HEART_GLYPH: readonly (readonly [number, number])[] = [
  [1, 0],
  [3, 0],
  [0, 1],
  [1, 1],
  [2, 1],
  [3, 1],
  [4, 1],
  [0, 2],
  [1, 2],
  [2, 2],
  [3, 2],
  [4, 2],
  [1, 3],
  [2, 3],
  [3, 3],
  [2, 4],
];

const HEART_W = 5;
const HEART_H = 5;

/** 爱心的颜色。偏粉的暖色，与爪印那族「痕迹色」区分开 - 这是情绪，不是痕迹。 */
const HEART_INK = '#ff8fb0';

/** 一次抚摸冒几颗。三颗够读成「一串」，再多就成了特效表演。 */
export const HEART_COUNT = 3;

/** 每颗的寿命，毫秒。 */
export const HEART_LIFE_MS = 900;

/** 同一次抚摸里，后面的心比前面的晚出来这么多毫秒，形成一串而不是一坨。 */
const HEART_STAGGER_MS = 130;

/** 升起的高度，精灵像素。 */
const HEART_RISE_SPRITE = 14;

/** 横向飘移的幅度，精灵像素。 */
const HEART_DRIFT_SPRITE = 3;

/** 从猫的锚点往上多少精灵像素开始冒。猫高 56，取到头顶稍上。 */
const HEART_FROM_TOP_SPRITE = 46;

export interface Heart {
  /** 冒出来的时刻，毫秒。 */
  readonly at: number;
  /** 猫当时的屏幕 x（精灵横向中心）。 */
  readonly x: number;
  /** 同一串里的序号，决定错开时间与飘移方向。 */
  readonly i: number;
}

/** 一次抚摸冒出的一串爱心。 */
export function burstHearts(now: number, catX: number): Heart[] {
  return Array.from({ length: HEART_COUNT }, (_, i) => ({ at: now + i * HEART_STAGGER_MS, x: catX, i }));
}

/** 淘汰已经散完的。与爪印同一个做法：寿命一到就不存在了，不留半透明的残骸。 */
export function stepHearts(hearts: readonly Heart[], now: number): readonly Heart[] {
  const alive = hearts.filter((h) => now - h.at < HEART_LIFE_MS);
  return alive.length === hearts.length ? hearts : alive;
}

export interface StageHeart {
  /** 舞台客户区坐标，CSS 像素。 */
  readonly x: number;
  readonly y: number;
  readonly alpha: number;
}

/**
 * 换算到舞台客户区坐标。
 *
 * `groundY` 是猫脚下地面线的**屏幕** y，`stage` 是舞台原点 - 两者相减才是
 * 舞台内坐标。爱心不跟着舞台滚动（它冒出来就属于那个位置），所以这里每帧重算。
 */
export function heartsInStage(
  hearts: readonly Heart[],
  now: number,
  stage: { readonly x: number; readonly y: number },
  groundY: number,
  spriteScale: number,
): StageHeart[] {
  const out: StageHeart[] = [];
  for (const h of hearts) {
    const age = now - h.at;
    if (age < 0 || age >= HEART_LIFE_MS) continue;
    const k = age / HEART_LIFE_MS;
    // 先快后慢地升起：刚冒出来那一下要有劲，末尾轻轻散掉。
    const rise = (1 - (1 - k) * (1 - k)) * HEART_RISE_SPRITE * spriteScale;
    // 左右交替飘，同一串三颗才不会重叠成一条竖线。
    const side = h.i % 2 === 0 ? 1 : -1;
    const drift = side * Math.sin(k * Math.PI) * HEART_DRIFT_SPRITE * spriteScale;
    out.push({
      x: h.x + drift - stage.x - (HEART_W * spriteScale) / 2,
      y: groundY - HEART_FROM_TOP_SPRITE * spriteScale - rise - stage.y,
      // 后半段才开始淡出：前半段保持实心，读起来更像「冒出来」而不是「渐显」。
      alpha: k < 0.5 ? 1 : 1 - (k - 0.5) * 2,
    });
  }
  return out;
}

/** 爱心画布。只管画，位置与寿命都在上面那些纯函数里。 */
export class HeartCanvas {
  private readonly ctx: CanvasRenderingContext2D;
  private dpr = 1;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  resize(cssW: number, cssH: number, dpr: number): void {
    this.dpr = dpr;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.ctx.imageSmoothingEnabled = false;
  }

  paint(hearts: readonly StageHeart[], spriteScale: number): void {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (hearts.length === 0) return;
    const px = spriteScale * this.dpr;
    ctx.fillStyle = HEART_INK;
    for (const h of hearts) {
      ctx.globalAlpha = Math.max(0, Math.min(1, h.alpha));
      // 落在整数物理像素上，否则放大后的方块边缘会发虚（与 display.ts 同一条约束）。
      const ox = Math.round(h.x * this.dpr);
      const oy = Math.round(h.y * this.dpr);
      for (const [gx, gy] of HEART_GLYPH) {
        ctx.fillRect(ox + Math.round(gx * px), oy + Math.round(gy * px), Math.ceil(px), Math.ceil(px));
      }
    }
    ctx.globalAlpha = 1;
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}

/** 爱心图形的尺寸，精灵像素。给测试与布局用。 */
export const HEART_SIZE = { w: HEART_W, h: HEART_H } as const;
