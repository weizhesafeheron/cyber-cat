/**
 * 部件树的 2D 仿射变换。纯数学，不依赖 DOM。
 *
 * 每个部件的局部变换 = 绕自身 pivot 的旋转/缩放 + 平移增量。
 * 世界变换 = 父链自根向下依次复合（Godot cutout 的父子层级语义）。
 * 所有部件画在同一张画布布局的原位上（Mana Seed 约定），
 * 因此静止部件的变换恒为单位矩阵，装配零对位成本。
 */

/** 列主序仿射矩阵 [a, b, c, d, e, f]：x' = a·x + c·y + e；y' = b·x + d·y + f。 */
export type Mat = readonly [number, number, number, number, number, number];

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

export interface PartPose {
  dx?: number;
  dy?: number;
  /** 弧度，正值顺时针（屏幕坐标系 y 向下）。 */
  rot?: number;
  sx?: number;
  sy?: number;
}

export function multiply(m1: Mat, m2: Mat): Mat {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

export function applyToPoint(m: Mat, x: number, y: number): readonly [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/**
 * 由 PartPose 构造局部矩阵：先绕 pivot 旋转缩放，再叠加平移。
 * pose 为空（全部缺省）时严格返回单位矩阵，保证静止部件零成本。
 */
export function localMatrix(pose: PartPose | undefined, px: number, py: number): Mat {
  const dx = pose?.dx ?? 0;
  const dy = pose?.dy ?? 0;
  const rot = pose?.rot ?? 0;
  const sx = pose?.sx ?? 1;
  const sy = pose?.sy ?? 1;
  if (dx === 0 && dy === 0 && rot === 0 && sx === 1 && sy === 1) return IDENTITY;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const a = cos * sx;
  const b = sin * sx;
  const c = -sin * sy;
  const d = cos * sy;
  // T(pivot) · R · S · T(-pivot) · T(dx, dy)
  return [a, b, c, d, px - a * px - c * py + dx, py - b * px - d * py + dy];
}

export interface PartNode {
  id: string;
  parent: string | null;
  pivot: readonly [number, number];
  z: number;
}

/**
 * 计算一组部件的世界矩阵。
 * 父节点必须先于子节点出现在 parts 中（parts.json 按此约定生成）。
 */
export function worldMatrices(
  parts: readonly PartNode[],
  poses: Readonly<Record<string, PartPose | undefined>>,
  root: PartPose | undefined,
  rootPivot: readonly [number, number],
): Map<string, Mat> {
  const world = new Map<string, Mat>();
  const rootMat = localMatrix(root, rootPivot[0], rootPivot[1]);
  for (const part of parts) {
    const parentMat = part.parent ? world.get(part.parent) : rootMat;
    if (part.parent && !parentMat) {
      throw new Error(`部件 ${part.id} 的父节点 ${part.parent} 尚未计算（顺序错误？）`);
    }
    const local = localMatrix(poses[part.id], part.pivot[0], part.pivot[1]);
    world.set(part.id, multiply(parentMat ?? rootMat, local));
  }
  return world;
}

/** 按 zIndex 稳定排序的绘制顺序。z 相同保持 parts.json 中的先后。 */
export function drawOrder(parts: readonly PartNode[]): readonly PartNode[] {
  return parts
    .map((p, i) => [p, i] as const)
    .sort((x, y) => x[0].z - y[0].z || x[1] - y[1])
    .map(([p]) => p);
}
