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

/** 可用的 CSS 空间（逻辑像素）。通常就是宠物窗口的客户区尺寸。 */
export interface CssBox {
  w: number;
  h: number;
}

/**
 * 设备缩放倍数：目标逻辑倍数 × dpr 后取整，至少 1。
 *
 * 给了 `box` 时会再钳制一次，保证放大后的画布**不会溢出可用空间**。
 * 这一步是必需的：取整是向上向下都可能的，`round(3 × 1.25) = 4` 会让画布的
 * CSS 宽变成 72 × 4 / 1.25 = 230.4，超出 216 宽的窗口，猫会被裁掉一截。
 * Windows 的 125% / 150% 缩放正好落在这类分数 dpr 上。
 */
export function deviceScaleFor(targetScale: number, dpr: number, box?: CssBox): number {
  let scale = Math.max(1, Math.round(targetScale * dpr));
  if (box) {
    // 能放进 box 的最大整数倍
    const fit = Math.min(Math.floor((box.w * dpr) / W), Math.floor((box.h * dpr) / H));
    scale = Math.min(scale, Math.max(1, fit));
  }
  return scale;
}

/** 该设备缩放下的 CSS 尺寸（逻辑像素）。 */
export function cssSizeFor(deviceScale: number, dpr: number): { w: number; h: number } {
  return { w: (W * deviceScale) / dpr, h: (H * deviceScale) / dpr };
}

/** 默认的可用空间就是整个窗口客户区。宠物窗口的舞台就是它。 */
const windowBox = (): CssBox => ({ w: window.innerWidth, h: window.innerHeight });

export class CatDisplay {
  private readonly src: HTMLCanvasElement;
  private readonly srcCtx: CanvasRenderingContext2D;
  private readonly img: ImageData;
  private readonly ctx: CanvasRenderingContext2D;
  private deviceScale = 1;
  private dpr = 1;
  private leftCss = 0;

  /**
   * `boxOf` 给出画布可以占用的 CSS 空间，用来钳制放大倍数。
   *
   * 默认是整个窗口 - 宠物窗口里画布就是铺满舞台的。领养窗口不一样：
   * 猫只占上半截的夜幕，按整窗钳制会在分数 dpr 下算出比夜幕更高的画布，
   * 猫的头会被裁掉。每帧调一次而不是记下来，是为了跨屏与系统缩放变化后自动正确。
   */
  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly targetScale: number,
    private readonly boxOf: () => CssBox = windowBox,
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
    this.dpr = dpr;
    // 以可用空间为上限，避免画布溢出把猫裁掉。
    // 舞台化之后宽度方向不会再触发钳制（舞台是三倍精灵宽），高度仍然会 -
    // 舞台高度的余量就是按这条算的，见 stage.ts。
    this.deviceScale = deviceScaleFor(this.targetScale, dpr, this.boxOf());
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

  /** 一个精灵像素占多少 CSS 像素。运动层的速度与步距按它把精灵尺度换算成屏幕尺度。 */
  get spriteScale(): number {
    return this.deviceScale / this.dpr;
  }

  get pixelRatio(): number {
    return this.dpr;
  }

  /**
   * 把猫放到舞台内的某个横向位置。`centerCss` 是精灵横向中心在舞台内的 CSS x。
   *
   * **只动横向。** 纵向一律不动 - 所有姿态的脚底线都画在同一条地面线上
   * （GROUND），整帧上下平移会把脚一起抬起来，屏幕上就是猫踩着的地面塌了一下。
   * 曾经为了平滑「换动作时的高度跳变」在这里加过纵向偏移，实测被一眼看破，
   * 见 docs/art-and-motion-decisions.md 里那条被否决的方案。
   *
   * 移动画布而不是重画整个舞台：猫只占舞台的三分之一，每帧清一整个舞台的画布
   * 是白烧填充率。
   *
   * **偏移必须落在整数物理像素上。** 非整数偏移会让浏览器对整张画布重采样，
   * 像素风立刻破功 - 这与 deviceScaleFor 取整是同一条约束的两面。
   */
  place(centerCss: number): void {
    const left = centerCss - (W * this.deviceScale) / this.dpr / 2;
    const snapped = Math.round(left * this.dpr) / this.dpr;
    this.leftCss = snapped;
    this.canvas.style.transform = `translateX(${snapped}px)`;
  }

  /**
   * 精灵左上角在画布父容器里的 CSS x，**已经对齐到整数物理像素**。
   *
   * 给舞台里的其他覆盖层用（回归气泡）。**必须从这里取，不能按运动层的 x 再算一遍** -
   * 那等于把定位规则抄第二份，两份一旦不同步（就是上面这次取整）覆盖层就会与猫错开，
   * 而且只在真机上看得出来。与 main.ts 里 toSprite 的注释是同一条理由。
   */
  get originCss(): number {
    return this.leftCss;
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
