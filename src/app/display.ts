import { H, W } from '../render/index.js';
import type { RenderResult } from '../render/index.js';

/**
 * 把渲染结果画到屏幕上，并保证像素永远锐利。
 *
 * 核心约束：**每个源像素必须占据整数个物理像素。**
 * 如果在 CSS 里写死放大倍数，在 devicePixelRatio = 1.5 的屏幕上
 * 3 × 1.5 = 4.5，单个源像素会横跨非整数个物理像素，出现宽窄不一的色块，
 * 像素风立刻破功（见 mvp-scope 第 8 节）。
 *
 * 做法是反过来算：先把设备缩放取整，再由它反推 CSS 尺寸。
 * 代价是表观大小会与目标值略有偏差，换来任何 dpr 下都锐利。
 */

/** 设备缩放倍数：目标逻辑倍数 × dpr 后取整，至少 1。 */
export function deviceScaleFor(targetScale: number, dpr: number): number {
  return Math.max(1, Math.round(targetScale * dpr));
}

/** 该设备缩放下的 CSS 尺寸（逻辑像素）。 */
export function cssSizeFor(deviceScale: number, dpr: number): { w: number; h: number } {
  return { w: (W * deviceScale) / dpr, h: (H * deviceScale) / dpr };
}

export class CatDisplay {
  private readonly src: HTMLCanvasElement;
  private readonly srcCtx: CanvasRenderingContext2D;
  private readonly img: ImageData;
  private readonly ctx: CanvasRenderingContext2D;
  private deviceScale = 1;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly targetScale: number,
  ) {
    // 源画布固定为渲染缓冲的原始尺寸，放大在 drawImage 阶段做
    this.src = document.createElement('canvas');
    this.src.width = W;
    this.src.height = H;
    this.srcCtx = this.src.getContext('2d')!;
    this.img = this.srcCtx.createImageData(W, H);

    this.ctx = canvas.getContext('2d')!;
    this.applyScale();
  }

  /** dpr 变化时（跨屏拖动、系统缩放调整）重新计算。 */
  applyScale(): void {
    const dpr = window.devicePixelRatio || 1;
    this.deviceScale = deviceScaleFor(this.targetScale, dpr);
    const { w, h } = cssSizeFor(this.deviceScale, dpr);
    this.canvas.width = W * this.deviceScale;
    this.canvas.height = H * this.deviceScale;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    // drawImage 放大时必须关掉平滑，否则会插值成糊的
    this.ctx.imageSmoothingEnabled = false;
  }

  get scale(): number {
    return this.deviceScale;
  }

  paint(res: RenderResult): void {
    this.img.data.set(res.pixels);
    this.srcCtx.putImageData(this.img, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.drawImage(this.src, 0, 0, this.canvas.width, this.canvas.height);
  }

  /** 什么都不画。猫死后没有姿态可画，画布必须真的空，不能留着上一帧。 */
  clear(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}
