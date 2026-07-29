import type { SaySprite, StageRect } from '../say/index.js';

/**
 * 台词气泡的画布。
 *
 * 与回归气泡各用一张画布：两者位置重合但生命周期完全不同（一个跟着动作的时相
 * 每隔几秒闪一次，一个冒出来挂几十秒等人点），共用一张就要在两套时序之间
 * 协调「谁该清屏」。多一张透明画布的代价只有一次合成。
 *
 * 这个类只管画。要不要显示、画在哪，全在 src/say/bubble.ts（纯函数、有测试）。
 */
export class SayCanvas {
  private readonly ctx: CanvasRenderingContext2D;
  /** 贴图的离屏缓冲。台词是固定的，所以只 putImageData 一次。 */
  private readonly src: HTMLCanvasElement;
  private showing = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    sprite: SaySprite,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.src = document.createElement('canvas');
    this.src.width = sprite.width;
    this.src.height = sprite.height;
    const sctx = this.src.getContext('2d')!;
    const img = sctx.createImageData(sprite.width, sprite.height);
    img.data.set(sprite.pixels);
    sctx.putImageData(img, 0, 0);
  }

  resize(cssW: number, cssH: number, dpr: number): void {
    this.canvas.width = Math.max(1, Math.round(cssW * dpr));
    this.canvas.height = Math.max(1, Math.round(cssH * dpr));
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.showing = false;
  }

  /**
   * 画气泡。落在整数物理像素上 - 小数边界会让浏览器对整张贴图重采样，
   * 像素风当场破功（与 display.ts、paws.ts、bubble.ts 同一条约束）。
   */
  paint(box: StageRect, dpr: number): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      this.src,
      Math.round(box.x * dpr),
      Math.round(box.y * dpr),
      Math.round(box.w * dpr),
      Math.round(box.h * dpr),
    );
    this.showing = true;
  }

  /** 不画。上一帧也没画时连清屏都省掉 - 气泡绝大多数时候不在。 */
  clear(): void {
    if (!this.showing) return;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.showing = false;
  }
}
