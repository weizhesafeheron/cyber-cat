import { describe, expect, it } from 'vitest';
import {
  XIAOMI_FRAME_COUNT,
  XIAOMI_FRAME_MS,
  xiaomiActionDurationMs,
  xiaomiFrameIndex,
} from '../../src/render/index.js';

describe('小米完整帧时间映射', () => {
  it('循环动作按六格首尾相接', () => {
    const frameSeconds = XIAOMI_FRAME_MS.walk / 1000;
    expect(xiaomiFrameIndex('walk', 0)).toBe(0);
    expect(xiaomiFrameIndex('walk', frameSeconds * 5)).toBe(5);
    expect(xiaomiFrameIndex('walk', frameSeconds * XIAOMI_FRAME_COUNT)).toBe(0);
  });

  it('一次性动作停在末格而不是重播', () => {
    const frameSeconds = XIAOMI_FRAME_MS.yawn / 1000;
    expect(xiaomiFrameIndex('yawn', frameSeconds * 4)).toBe(4);
    expect(xiaomiFrameIndex('yawn', frameSeconds * 20)).toBe(5);
  });

  it('负时间钳制到第一格', () => {
    expect(xiaomiFrameIndex('idle', -1)).toBe(0);
  });

  it('公开真实时间线总长，供抚摸特效共用同一个结束点', () => {
    expect(xiaomiActionDurationMs('stretch')).toBe(XIAOMI_FRAME_MS.stretch * XIAOMI_FRAME_COUNT);
  });

  it('落地时间线与物理接触对齐：接触即压缩，450ms 内回弹站稳', () => {
    expect(xiaomiFrameIndex('land', 0)).toBe(2);
    expect(xiaomiFrameIndex('land', 0.05)).toBe(3);
    expect(xiaomiFrameIndex('land', 0.12)).toBe(2);
    expect(xiaomiFrameIndex('land', 0.2)).toBe(1);
    expect(xiaomiFrameIndex('land', 0.3)).toBe(0);
    expect(xiaomiFrameIndex('land', 0.449)).toBe(0);
  });
});
