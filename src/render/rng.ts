/**
 * 确定性随机源。
 *
 * 渲染层与世界层都不得使用 Math.random() - 相同输入必须得到相同输出，
 * 这是离线推演可回放（ADR 0001）与渲染可测试（ADR 0002）的共同前提。
 */

/** 快速 32 位 PRNG。返回一个每次调用产出 [0,1) 的函数。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function (): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 稳定的逐像素哈希，返回 [0,1)。
 *
 * 用于绒毛边缘与花纹的边界抖动。关键性质是**不随帧变化** -
 * 同一个像素坐标每帧得到同一个值，否则毛边会逐帧闪烁。
 */
export function hash2(x: number, y: number, s: number): number {
  let h = (x * 374761393 + y * 668265263 + s * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return (((h ^ (h >>> 16)) >>> 0) % 1000) / 1000;
}

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
