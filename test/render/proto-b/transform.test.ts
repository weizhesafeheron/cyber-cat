/** 部件树变换：pivot 旋转、父子复合、z 排序。 */
import { describe, expect, it } from 'vitest';
import {
  IDENTITY,
  applyToPoint,
  drawOrder,
  localMatrix,
  multiply,
  worldMatrices,
  type PartNode,
} from '../../../src/render/proto-b/transform.js';

const near = (a: readonly [number, number], b: readonly [number, number]): void => {
  expect(a[0]).toBeCloseTo(b[0], 6);
  expect(a[1]).toBeCloseTo(b[1], 6);
};

describe('localMatrix', () => {
  it('空姿态严格返回单位矩阵（静止部件零成本）', () => {
    expect(localMatrix(undefined, 50, 60)).toBe(IDENTITY);
    expect(localMatrix({ dx: 0, dy: 0, rot: 0, sx: 1, sy: 1 }, 50, 60)).toBe(IDENTITY);
  });

  it('pivot 是旋转不动点', () => {
    const m = localMatrix({ rot: 1.2 }, 46, 71);
    near(applyToPoint(m, 46, 71), [46, 71]);
  });

  it('绕 pivot 旋转 90 度', () => {
    const m = localMatrix({ rot: Math.PI / 2 }, 10, 10);
    // (11, 10) 在 pivot 右侧 1px，顺时针（屏幕系）转 90° 后应到 pivot 下方。
    near(applyToPoint(m, 11, 10), [10, 11]);
  });

  it('缩放围绕 pivot 进行，再叠加平移', () => {
    const m = localMatrix({ sy: 0.5, dy: 3 }, 0, 100);
    // pivot 在脚底：头顶 (0, 0) 压到一半高度再整体下移 3。
    near(applyToPoint(m, 0, 0), [0, 53]);
    near(applyToPoint(m, 0, 100), [0, 103]);
  });
});

describe('worldMatrices', () => {
  const parts: PartNode[] = [
    { id: 'body', parent: null, pivot: [70, 80], z: 2 },
    { id: 'head', parent: 'body', pivot: [92, 60], z: 4 },
    { id: 'eyes', parent: 'head', pivot: [95, 48], z: 6 },
  ];

  it('子节点跟随父节点平移', () => {
    const world = worldMatrices(parts, { body: { dy: -2 } }, undefined, [72, 101]);
    near(applyToPoint(world.get('eyes')!, 95, 48), [95, 46]);
  });

  it('孙节点叠加自身与父链的变换', () => {
    const world = worldMatrices(
      parts,
      { body: { dy: -2 }, head: { dx: 4 } },
      undefined,
      [72, 101],
    );
    near(applyToPoint(world.get('eyes')!, 95, 48), [99, 46]);
  });

  it('根变换作用于所有无父部件', () => {
    const world = worldMatrices(parts, {}, { dy: -20 }, [72, 101]);
    near(applyToPoint(world.get('body')!, 70, 80), [70, 60]);
    near(applyToPoint(world.get('eyes')!, 95, 48), [95, 28]);
  });

  it('父节点未先计算时抛错', () => {
    const bad: PartNode[] = [{ id: 'ear', parent: 'head', pivot: [0, 0], z: 0 }];
    expect(() => worldMatrices(bad, {}, undefined, [0, 0])).toThrow(/父节点/);
  });
});

describe('multiply / drawOrder', () => {
  it('矩阵乘法与逐点应用一致', () => {
    const a = localMatrix({ rot: 0.7 }, 3, 4);
    const b = localMatrix({ dx: 5, sy: 1.2 }, 8, 9);
    const ab = multiply(a, b);
    const viaCompose = applyToPoint(ab, 11, 13);
    const viaSteps = applyToPoint(a, ...applyToPoint(b, 11, 13));
    near(viaCompose, viaSteps);
  });

  it('drawOrder 按 z 稳定排序', () => {
    const parts: PartNode[] = [
      { id: 'a', parent: null, pivot: [0, 0], z: 4 },
      { id: 'b', parent: null, pivot: [0, 0], z: 0 },
      { id: 'c', parent: null, pivot: [0, 0], z: 4 },
    ];
    expect(drawOrder(parts).map((p) => p.id)).toEqual(['b', 'a', 'c']);
  });
});
