/**
 * 原型 B：分层部件资产渲染器。
 *
 * 对外接口与原型 A 对比页的约定一致：
 *   render(canvas, spec, scene, t, pose?)
 * - spec: { breed, seed, cat? }，cat 是现有 makeCat 产物，这里只取 personality。
 * - t: 秒，场景切换归零。
 * - pose: 对比页统一算好的当帧 Pose，本渲染器仅采纳 eyeOpen 做眨眼同步。
 *
 * 缓冲固定 144×112（hi-fi 调研的分辨率上限），背景透明。
 */
import { drawShadow, drawZzz } from './decor.js';
import { assetsReady, ensureLoading, partBitmap } from './loader.js';
import { colorwayFor } from './palette.js';
import { PARTS_DOC } from './parts-data.js';
import { sceneFrame } from './scenes.js';
import { drawOrder, worldMatrices, type PartNode } from './transform.js';
import type { CatSpecB, Frame, SceneKey } from './types.js';

export { COLORWAYS, colorwayByKey, colorwayFor } from './palette.js';
export { PARTS_DOC } from './parts-data.js';
export { sceneFrame } from './scenes.js';
export { SCENE_KEYS, SCENE_LABELS } from './types.js';
export type { CatSpecB, Frame, PartsDoc, SceneKey } from './types.js';

const BUF_W = PARTS_DOC.canvas.w;
const BUF_H = PARTS_DOC.canvas.h;
const GROUND = PARTS_DOC.canvas.ground;

/** 资产加载完成的信号，harness 截图前 await 它保证首帧就有画面。 */
export function ready(): Promise<void> {
  return ensureLoading();
}

interface PoseLike {
  eyeOpen?: number;
}

function personalityActive(spec: CatSpecB): number {
  const cat = spec.cat as { personality?: { active?: number } } | undefined;
  const active = cat?.personality?.active;
  return typeof active === 'number' ? active : 0.5;
}

const PART_NODES: readonly PartNode[] = PARTS_DOC.parts.map((p) => ({
  id: p.id,
  parent: p.parent,
  pivot: p.pivot,
  z: p.z,
}));
const ORDERED = drawOrder(PART_NODES);
const ENTRY_BY_ID = new Map(PARTS_DOC.parts.map((p) => [p.id, p]));

/** 食盆等道具不吃整猫根变换。 */
const FIXED_PARTS = new Set(['bowl']);

export function render(
  canvas: HTMLCanvasElement,
  spec: CatSpecB,
  scene: SceneKey,
  t: number,
  pose?: PoseLike,
): void {
  if (canvas.width !== BUF_W || canvas.height !== BUF_H) {
    canvas.width = BUF_W;
    canvas.height = BUF_H;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, BUF_W, BUF_H);

  if (!assetsReady()) {
    void ensureLoading();
    return;
  }

  const frame: Frame = sceneFrame(scene, t, {
    seed: spec.seed,
    active: personalityActive(spec),
    eyeOpen: pose?.eyeOpen,
  });
  const cw = colorwayFor(spec.breed, spec.seed);

  // 阴影先画，猫压在上面。
  drawShadow(ctx, frame.shadowCx ?? 72, GROUND, frame.shadow);

  const world = worldMatrices(
    PART_NODES,
    frame.poses,
    frame.root,
    frame.rootPivot ?? [72, GROUND],
  );

  for (const node of ORDERED) {
    const variant = frame.variants[node.id];
    if (!variant) continue;
    const entry = ENTRY_BY_ID.get(node.id)!;
    const file = entry.images[variant];
    if (!file) continue;
    const bmp = partBitmap(file, cw);
    if (!bmp) continue;
    const m = FIXED_PARTS.has(node.id)
      ? ([1, 0, 0, 1, 0, 0] as const)
      : world.get(node.id)!;
    ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    ctx.drawImage(bmp, 0, 0);
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (frame.zzz !== undefined) drawZzz(ctx, frame.zzz);
}
