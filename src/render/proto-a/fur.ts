/**
 * 轮廓毛簇：把光滑椭圆边打破成不规则小簇（调研 2.5 节）。
 *
 * 两条铁律，都来自调研点名的翻车点：
 * - **确定性**：只依赖 (theta, seed)，与屏幕坐标无关。部件移动时毛簇跟着
 *   部件走，不会帧间沸腾（屏幕空间噪声在动画里就是沸腾的轮廓）。
 * - **不均匀**：簇的间距与大小由逐扇区哈希决定。周期均匀 = 毛刷/锯齿，
 *   逐像素随机 = 噪声，两个都被否决过。
 */

import { hash2 } from '../rng.js';

/** 圆周划分的扇区数。约等于轮廓上毛簇的数量级。 */
const SECTORS = 26;

/**
 * 给定部件局部极角，返回轮廓半径的相对偏移。
 *
 * @param theta atan2(v, u)，[-PI, PI]
 * @param seed 部件种子（同一只猫同一部件恒定）
 * @param fluff 品种绒毛量，0..1
 * @returns 相对半径偏移。正值向外长毛，负值向内啃边；幅度约 [-0.05, 0.1]
 */
export function furOffset(theta: number, seed: number, fluff: number): number {
  const t01 = (theta + Math.PI) / (2 * Math.PI);
  const s = Math.min(0.9999, Math.max(0, t01)) * SECTORS;
  const i = Math.floor(s);
  const f = s - i;
  // 每扇区一个三角形小簇：幅度、峰位、方向都由哈希决定。
  const amp01 = hash2(i, 17, seed);
  const peak = 0.25 + hash2(i, 29, seed) * 0.5;
  const tri = f < peak ? f / peak : (1 - f) / (1 - peak);
  // 基础幅度让所有品种的轮廓都有细微破碎（这是四技法之一，不是蓬松品种专属），
  // fluff 再往上叠。
  const amp = (0.3 + fluff * 1.4) * (0.3 + amp01 * 0.9);
  // 约三成的簇向内啃一口，模拟毛的重叠而不是纯外凸的毛刺。
  const inward = hash2(i, 43, seed) < 0.3 ? -0.55 : 1;
  return tri * amp * inward * 0.062;
}
