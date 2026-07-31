/** 原型 B 的公开类型。 */
import type { PartPose } from './transform.js';

/** parts.json 的部件条目。数组顺序保证父先于子。 */
export interface PartEntry {
  id: string;
  parent: string | null;
  /** 关节圆心，画布坐标。旋转/缩放绕它进行。 */
  pivot: readonly [number, number];
  /** 绘制次序，与父子层级无关。 */
  z: number;
  /** 变体名 → 图片文件名。同一部件的变体共享 pivot 与层级。 */
  images: Readonly<Record<string, string>>;
}

export interface PartsDoc {
  canvas: { w: number; h: number; ground: number };
  parts: readonly PartEntry[];
  /** 图片文件名 → 花纹 key → mask 文件名。 */
  masks: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

/** 与原型 A 约定的六个判决场景。 */
export type SceneKey = 'stand-blink' | 'walk' | 'sleep' | 'eat' | 'held-land' | 'sit-rise';

export const SCENE_KEYS: readonly SceneKey[] = [
  'stand-blink',
  'walk',
  'sleep',
  'eat',
  'held-land',
  'sit-rise',
];

export const SCENE_LABELS: Readonly<Record<SceneKey, string>> = {
  'stand-blink': '站立眨眼',
  walk: '行走',
  sleep: '睡觉呼吸',
  eat: '进食',
  'held-land': '拎起/落地',
  'sit-rise': '蹲坐→起身',
};

/** 对比页传入的猫描述。cat 是现有 makeCat 的产物，本渲染器只取个别字段。 */
export interface CatSpecB {
  breed: string;
  seed: number;
  cat?: unknown;
}

/** 一帧的装配指令：选哪些变体、每个部件叠加什么变换。 */
export interface Frame {
  /** 部件 id → 变体名。缺省部件不绘制（如 curl 姿态没有独立尾巴）。 */
  variants: Readonly<Record<string, string>>;
  /** 部件 id → 局部姿态增量。缺省即单位变换。 */
  poses: Readonly<Record<string, PartPose | undefined>>;
  /** 整猫根变换（拎起、落地压缩都作用在根上）。 */
  root?: PartPose;
  /** 根变换的 pivot（画布坐标）。拎起绕后颈、落地压缩绕脚底。 */
  rootPivot?: readonly [number, number];
  /** 睡觉 Zzz 装饰的动画时间，undefined 不画。 */
  zzz?: number;
  /** 地面阴影缩放（腾空时收小）。0 不画。 */
  shadow: number;
  /** 阴影中心 x，姿态不同重心不同。缺省 72。 */
  shadowCx?: number;
}
