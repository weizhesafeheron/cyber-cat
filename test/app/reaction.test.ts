import { describe, expect, it } from 'vitest';
import { reactionDurationMs } from '../../src/app/reaction.js';
import {
  DEFAULT_MOTION_TUNING,
  makeCat,
  xiaomiActionDurationMs,
} from '../../src/render/index.js';

const CAT = makeCat('cow', 20260728);

describe('抚摸反馈共用真实动画时钟', () => {
  it('默认节奏下就是完整图集时间线的长度', () => {
    expect(reactionDurationMs('stretch', DEFAULT_MOTION_TUNING, CAT, 1)).toBe(
      xiaomiActionDurationMs('stretch'),
    );
  });

  it('动作节奏和生病/虚弱减速都会等比例改变桃心与动作的共同结束点', () => {
    const normal = reactionDurationMs('stretch', { tempo: 1 }, CAT, 1);
    const slowedByWorld = reactionDurationMs('stretch', { tempo: 1 }, CAT, 0.5);
    expect(slowedByWorld).toBeCloseTo(normal * 2, 6);
  });
});
