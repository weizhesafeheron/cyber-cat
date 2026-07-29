import type { HitFrame } from '../../src/app/hit.js';

/**
 * 命中判定测试用的掩膜辅助工具。
 *
 * 掩膜一律来自 src/render 的真实渲染结果 - 手搓假掩膜测不出「命中形状跟着
 * 姿态变」这类真正会出问题的地方。
 *
 * 这里的「点到掩膜的距离」是独立推导的一份实现（点到像素方格的距离用
 * `max(px - x, x - px - 1, 0)` 表达），与 hit.ts 里的写法不同但等价，
 * 因此可以当作被测代码的对照。测试里另有一条断言直接拿渲染层自己的 hitTest
 * 校准 margin = 0 的情形，防止「工具坏了导致误判」。
 */

export interface Point {
  x: number;
  y: number;
}

/** 拷贝掩膜。渲染器复用内部缓冲，要同时持有两帧必须先拷。 */
export function frameOf(res: HitFrame): HitFrame {
  return {
    width: res.width,
    height: res.height,
    alphaMask: Uint8Array.from(res.alphaMask),
  };
}

/** 点到掩膜的最近距离（欧氏，把每个掩膜像素看成 1x1 的方格）。掩膜为空返回 Infinity。 */
export function distToMask(frame: HitFrame, x: number, y: number): number {
  const { width, height, alphaMask } = frame;
  let best = Infinity;
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      if (alphaMask[py * width + px] !== 255) continue;
      const dx = Math.max(px - x, x - (px + 1), 0);
      const dy = Math.max(py - y, y - (py + 1), 0);
      const d = Math.hypot(dx, dy);
      if (d < best) best = d;
    }
  }
  return best;
}

/** 所有掩膜像素的中心点。 */
export function maskCenters(frame: HitFrame): Point[] {
  const out: Point[] = [];
  for (let py = 0; py < frame.height; py++) {
    for (let px = 0; px < frame.width; px++) {
      if (frame.alphaMask[py * frame.width + px] === 255) out.push({ x: px + 0.5, y: py + 0.5 });
    }
  }
  return out;
}

/** 距离掩膜在 [lo, hi) 区间内的所有像素中心。 */
export function centersAtDistance(frame: HitFrame, lo: number, hi: number): Point[] {
  const out: Point[] = [];
  for (let py = 0; py < frame.height; py++) {
    for (let px = 0; px < frame.width; px++) {
      const d = distToMask(frame, px + 0.5, py + 0.5);
      if (d >= lo && d < hi) out.push({ x: px + 0.5, y: py + 0.5 });
    }
  }
  return out;
}

/** 从数组里等距取最多 n 个元素，用来在不牺牲覆盖面的前提下压测试时长。 */
export function sampleEvenly<T>(items: readonly T[], n: number): T[] {
  if (items.length <= n) return [...items];
  const step = items.length / n;
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(items[Math.floor(i * step)]!);
  return out;
}
