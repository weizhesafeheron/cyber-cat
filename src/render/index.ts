import { drawBowl, drawDust, drawZzz } from './decor.js';
import { FORMS } from './poses.js';
import { Raster } from './raster.js';
import type { Cat, Pose, RenderResult } from './types.js';

export { BREEDS, BREED_KEYS, type BreedDef } from './breeds.js';
export { makeCat } from './cat.js';
export { PALETTES, RAGDOLL_POINTS } from './palette.js';
export { ACTIONS, ACTION_KEYS, type ActionKey } from './actions.js';
export { makeMicro, stepMicro, type MicroState, type MicroOpts, type MicroOut } from './micro.js';
export { GROUND, H, W } from './raster.js';
export { mulberry32 } from './rng.js';
export * from './types.js';

/**
 * 渲染器。持有一个复用的像素缓冲，因此不要跨线程共享实例。
 *
 * 与 DOM 完全无关 - 输出是裸的像素与掩膜数组，画到 canvas 是调用方的事。
 * 这让渲染层可以在 node 里被测试（缝二）。
 */
export class CatRenderer {
  private readonly raster = new Raster();

  /**
   * 渲染一帧。
   *
   * 返回的 pixels 与 alphaMask 是内部复用的数组 - 下一次 render 会覆写它们。
   * 需要跨帧保留请自行拷贝。
   */
  render(cat: Cat, pose: Pose): RenderResult {
    const r = this.raster;
    r.clear();

    // 食盆先画，会被猫压住（deprecated，见 decor.ts）。
    if (pose.bowl) drawBowl(r, pose.bowl);

    const form = FORMS[pose.form ?? 'stand'];
    const anchors = form(r, cat, pose);

    // 描边必须在所有部件之后、装饰之前。
    r.outlinePass();
    // 掩膜的语义由 Raster 的 kind 缓冲承载：影子与装饰标为 DECOR，
    // 因此下面这些绘制不会污染命中区域。
    r.shadowPass(anchors.bx, cat.bodyRW + 3);

    // 注意是真值判断而非 != null：t == 0 时不画 Zzz（与原型一致）。
    if (pose.zzz) drawZzz(r, anchors.hx + 8 * (pose.dir ?? 1), anchors.hy - 10, pose.zzz);
    if (pose.dust != null) drawDust(r, anchors.bx, pose.dust);

    return r.toResult();
  }
}

/**
 * 命中测试：给定渲染结果与相对于精灵左上角的坐标，判断是否落在猫身上。
 *
 * 这是 ADR 0006 的消费端 - 掩膜里只有猫本体为 255，影子与装饰为 0。
 */
export function hitTest(result: RenderResult, x: number, y: number): boolean {
  const px = Math.floor(x);
  const py = Math.floor(y);
  if (px < 0 || py < 0 || px >= result.width || py >= result.height) return false;
  return result.alphaMask[py * result.width + px] === 255;
}
