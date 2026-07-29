import type { StagePaw } from './motion.js';

/**
 * 爪印画布。
 *
 * 与猫的画布分开是必要的：猫的画布只有 72×56 个精灵像素、跟着猫在舞台里移动，
 * 而爪印散布在整个舞台上、落地之后就不再跟猫走（[ADR 0007](../../docs/adr/0007-stage-window-and-motion-layer.md)）。
 *
 * 这个类只管画。爪印的位置、寿命、换算都在运动层（motion.ts），那是纯逻辑、有测试。
 */

/**
 * 爪印图形，以精灵像素为单位的相对坐标（0,0 是左上角）。
 *
 * 三趾一垫，5×2。在 72×56 这个尺度上「只靠一两个像素变化等于没有动作」的结论
 * 同样适用于痕迹：更小的形状在桌面壁纸上会读成噪点而不是脚印。
 */
const PAW_GLYPH: readonly (readonly [number, number])[] = [
  [0, 0],
  [2, 0],
  [4, 0],
  [1, 1],
  [2, 1],
  [3, 1],
];

const PAW_W = 5;

/**
 * 爪印颜色。
 *
 * 取一个中间调的紫灰而不是描边色的近黑：桌面壁纸深浅未知，纯深色在深色壁纸上
 * 会完全看不见。这个值与落地尘土同色，属于「猫留下的痕迹」这一族。
 */
const PAW_INK = '#8a86a8';

/** 最深的不透明度。爪印是痕迹不是实体，压到 1 会比猫还抢眼。 */
const PAW_MAX_ALPHA = 0.72;

/** 远侧脚的爪印上移这么多精灵像素，形成双排足迹。 */
const FAR_PAW_DY = -2;

export class PawCanvas {
  private readonly ctx: CanvasRenderingContext2D;
  private hadPaws = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  /** dpr 或舞台尺寸变化时重设后备缓冲。 */
  resize(cssW: number, cssH: number, dpr: number): void {
    this.canvas.width = Math.max(1, Math.round(cssW * dpr));
    this.canvas.height = Math.max(1, Math.round(cssH * dpr));
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.hadPaws = false;
  }

  /**
   * 画一帧爪印。
   *
   * `block` 是一个精灵像素占多少**物理**像素，与猫的画布同一个值 -
   * 两者的像素格必须一样大，否则爪印一眼就能看出不是同一套美术。
   */
  paint(paws: readonly StagePaw[], block: number, dpr: number): void {
    // 没有爪印、上一帧也没有：连清屏都不必做。
    if (paws.length === 0 && !this.hadPaws) return;
    this.hadPaws = paws.length > 0;

    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = PAW_INK;
    for (const paw of paws) {
      if (paw.alpha <= 0) continue;
      ctx.globalAlpha = paw.alpha * PAW_MAX_ALPHA;
      // 落在整数物理像素上：小数边界会让像素块出现宽窄不一的缝。
      // 不额外对齐到 block 的整数倍 - 那样纵向会被推离地面线最多一个像素块，
      // 而爪印必须和猫的影子踩在同一行才像是同一套美术里的东西。
      const ox = Math.round(paw.x * dpr) - ((PAW_W * block) >> 1);
      const oy = Math.round(paw.y * dpr) + (paw.side < 0 ? FAR_PAW_DY * block : 0);
      for (const [gx, gy] of PAW_GLYPH) {
        ctx.fillRect(ox + gx * block, oy + gy * block, block, block);
      }
    }
    ctx.globalAlpha = 1;
  }

  clear(): void {
    if (!this.hadPaws) return;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.hadPaws = false;
  }
}
