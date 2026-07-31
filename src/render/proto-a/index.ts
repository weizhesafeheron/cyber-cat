/**
 * 原型 A：程序化着色升级（issue #24）。
 *
 * 与 CatRenderer 相同的渲染骨架，几何完全复用现有 FORMS / parts / actions，
 * 只把光栅化器换成 HiRaster（144x112 + 体积光影 + hue shift + selout + 毛簇）。
 *
 * 这是判决用原型，做在独立分支上，不合并。
 */

import { drawDust, drawZzz } from '../decor.js';
import { FORMS } from '../poses.js';
import type { Cat, Pose, RenderResult } from '../types.js';
import { HiRaster } from './hi-raster.js';

export { H2, SCALE, W2 } from './hi-raster.js';
export { bandOf, buildShadeRamp, shadeLutFor, LIGHT, LIGHT2D } from './shading.js';
export { coolDarken, luma, mixHex, warmLighten } from './color.js';
export { furOffset } from './fur.js';

export class ProtoARenderer {
  private readonly raster = new HiRaster();

  /**
   * 渲染一帧，144x112。
   * 返回的 pixels 与 alphaMask 是内部复用的数组，跨帧保留请自行拷贝。
   */
  render(cat: Cat, pose: Pose): RenderResult {
    const r = this.raster;
    r.setCat(cat);
    r.clear();

    const form = FORMS[pose.form ?? 'stand'];
    const anchors = form(r, cat, pose);

    r.outlinePass(cat.outlineStrength ?? 0);
    r.shadowPass(anchors.bx, cat.bodyRW + 3);

    if (pose.zzz) drawZzz(r, anchors.hx + 8 * (pose.dir ?? 1), anchors.hy - 10, pose.zzz);
    if (pose.dust != null) drawDust(r, anchors.bx, pose.dust);

    return r.toResult();
  }
}
