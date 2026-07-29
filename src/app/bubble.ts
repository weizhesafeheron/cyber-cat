import { BUBBLE_SPRITE } from '../diary/index.js';
import type { StageRect } from '../diary/index.js';

/**
 * 回归气泡的画布。
 *
 * 与猫的画布分开，理由和爪印那张一样（[ADR 0007](../../docs/adr/0007-stage-window-and-motion-layer.md)、
 * [ADR 0011](../../docs/adr/0011-return-bubble-in-stage.md)）：
 * 猫的画布只有 72×56 个精灵像素，而气泡在猫的**头顶之上**，落在那个缓冲之外。
 * 更要紧的是既定结论「精灵缓冲里只有猫」- 画进去的每个像素都会进命中掩膜与描边通道，
 * 于是猫的可点范围会连着气泡一起长出去一块。
 *
 * 这个类只管画。要不要显示、画在哪、点没点中，全在 src/diary/bubble.ts（纯函数、有测试）。
 */
export class BubbleCanvas {
  private readonly ctx: CanvasRenderingContext2D;
  /** 气泡贴图的离屏缓冲。每帧重新 putImageData 是白费 - 贴图是固定的。 */
  private readonly src: HTMLCanvasElement;
  private showing = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    const { width, height, pixels } = BUBBLE_SPRITE;
    this.src = document.createElement('canvas');
    this.src.width = width;
    this.src.height = height;
    const sctx = this.src.getContext('2d')!;
    const img = sctx.createImageData(width, height);
    img.data.set(pixels);
    sctx.putImageData(img, 0, 0);
  }

  /** dpr 或舞台尺寸变化时重设后备缓冲。与猫、爪印三张画布的像素格必须一样大。 */
  resize(cssW: number, cssH: number, dpr: number): void {
    this.canvas.width = Math.max(1, Math.round(cssW * dpr));
    this.canvas.height = Math.max(1, Math.round(cssH * dpr));
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.showing = false;
  }

  /**
   * 画气泡。`box` 是它在舞台内的 CSS 矩形（由 diary/bubble.ts 的 bubbleStageRect 算出）。
   *
   * 落在整数物理像素上：小数边界会让浏览器对整张贴图重采样，像素风当场破功
   * （与 display.ts 的取整、paws.ts 的取整是同一条约束）。
   */
  paint(box: StageRect, dpr: number): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.imageSmoothingEnabled = false;
    const x = Math.round(box.x * dpr);
    const y = Math.round(box.y * dpr);
    const w = Math.round(box.w * dpr);
    const h = Math.round(box.h * dpr);
    ctx.drawImage(this.src, x, y, w, h);
    this.showing = true;
  }

  /** 不画。上一帧也没画时连清屏都省掉 - 气泡绝大多数时候是不在的。 */
  clear(): void {
    if (!this.showing) return;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.showing = false;
  }
}
