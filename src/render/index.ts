import { drawDust, drawZzz } from './decor.js';
import { FORMS } from './poses.js';
import { Raster } from './raster.js';
import type { Cat, Pose, RenderResult } from './types.js';

export { BREEDS, BREED_KEYS, getBreed, hasBreed, type BreedDef } from './breeds.js';
export {
  MARKING_VARIANTS,
  hasMarkingVariant,
  markingChoiceFor,
  markingVariantsFor,
  type MarkingVariantDef,
} from './marking-variants.js';
export { makeCat } from './cat.js';
export { PALETTES, RAGDOLL_POINTS } from './palette.js';
export {
  ACTIONS,
  ACTION_KEYS,
  EAT_CYCLE,
  LEAP_CROUCH_S,
  MOTION_ONLY_ACTIONS,
  type ActionKey,
  type MotionOnlyAction,
  type WorldActionKey,
} from './actions.js';
export { makeMicro, stepMicro, type MicroState, type MicroOpts, type MicroOut } from './micro.js';
export { GROUND, H, W } from './raster.js';
export { headColumn } from './poses.js';
export { earAttachment, type EarAttachment } from './parts.js';
export { mulberry32 } from './rng.js';
export {
  XIAOMI_FRAME_COUNT,
  XIAOMI_FRAME_H,
  XIAOMI_FRAME_MS,
  XIAOMI_FRAME_W,
  xiaomiActionDurationMs,
  xiaomiFrameIndex,
} from './xiaomi.js';
export {
  ART_TUNING_CONTROLS,
  DEFAULT_ART_TUNING,
  normalizeArtTuning,
  tuneCatArt,
  type ArtTuningControl,
  type CatArtTuning,
  type CatArtTuningKey,
} from './art-tuning.js';
export {
  DEFAULT_MOTION_TUNING,
  MOTION_TUNING_CONTROLS,
  motionTuningControlsFor,
  normalizeMotionTuning,
  tuneMotionPose,
  tuneMotionTime,
  type CatMotionTuning,
  type CatMotionTuningKey,
  type MotionTuningControl,
} from './motion-tuning.js';
export {
  materializeCat,
  motionTuningFor,
  normalizeProfile,
  randomPersonality,
  type CatProfile,
  type MotionProfile,
} from './profile.js';
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

    const form = FORMS[pose.form ?? 'stand'];
    const anchors = form(r, cat, pose);

    // 描边必须在所有部件之后、装饰之前。
    r.outlinePass(cat.outlineStrength ?? 0);
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
