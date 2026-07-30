import { describe, expect, it } from 'vitest';
import { walkFrame } from '../../src/adopt/arrival.js';
import {
  ADOPT_H,
  ADOPT_PREVIEW_W,
  ADOPT_SCALE,
  ADOPT_W,
  ENTER_X,
  EXIT_X,
  HALF_SPRITE,
  REST_X,
  SETTLE_S,
  SKY_H,
} from '../../src/adopt/constants.js';
import { H } from '../../src/render/index.js';

/**
 * 入场与离场的时间线。
 *
 * 「猫走来并停下」是这个流程的核心呈现，所以它必须是一个可以断言的纯函数：
 * 走多久、停在哪、什么时候坐下、离场有没有真的走出画面。
 * 埋在 rAF 回调里的话，这些只能靠盯着屏幕数秒。
 */

const SPEED = 100;

describe('走进来', () => {
  const from = 400;
  const to = 200;

  it('第一帧还在画面外，播的是走路', () => {
    const f = walkFrame(0, { from, to, speed: SPEED, settleS: SETTLE_S });
    expect(f.x).toBe(from);
    expect(f.action).toBe('walk');
    expect(f.done).toBe(false);
  });

  it('朝向就是行进方向', () => {
    expect(walkFrame(0.5, { from: 400, to: 200, speed: SPEED }).dir).toBe(-1);
    expect(walkFrame(0.5, { from: 100, to: 300, speed: SPEED }).dir).toBe(1);
  });

  it('走的距离等于速度乘时间，中途不会瞬移', () => {
    expect(walkFrame(1, { from, to, speed: SPEED }).x).toBeCloseTo(300, 6);
    expect(walkFrame(1.5, { from, to, speed: SPEED }).x).toBeCloseTo(250, 6);
  });

  it('抵达的时刻正好是路程除以速度', () => {
    const arriveS = Math.abs(to - from) / SPEED;
    expect(walkFrame(arriveS - 0.01, { from, to, speed: SPEED }).done).toBe(false);
    expect(walkFrame(arriveS, { from, to, speed: SPEED }).done).toBe(true);
  });

  it('不会冲过目标再退回来 - 那是一次肉眼可见的抽动', () => {
    for (const t of [2, 5, 100, 1e6]) {
      expect(walkFrame(t, { from, to, speed: SPEED }).x).toBe(to);
    }
  });

  it('停下之后先站着，过了 settle 才坐下', () => {
    const arriveS = Math.abs(to - from) / SPEED;
    const at = (t: number): string =>
      walkFrame(t, { from, to, speed: SPEED, settleS: SETTLE_S }).action;
    expect(at(arriveS + 0.1)).toBe('idle');
    expect(at(arriveS + SETTLE_S - 0.01)).toBe('idle');
    expect(at(arriveS + SETTLE_S)).toBe('sit');
  });

  it('不给 settle 就一直站着 - 离场的猫不该在半路坐下', () => {
    const arriveS = Math.abs(to - from) / SPEED;
    expect(walkFrame(arriveS + 99, { from, to, speed: SPEED }).action).toBe('idle');
  });

  it('时间倒退或为负都当成起点，不产出 NaN', () => {
    const f = walkFrame(-3, { from, to, speed: SPEED });
    expect(f.x).toBe(from);
    expect(Number.isFinite(f.x)).toBe(true);
  });

  it('速度非正时直接算抵达，而不是让猫永远卡在画面外', () => {
    // 失效方向：宁可少一段入场动画，也不能出现一个空荡荡的领养窗口。
    for (const speed of [0, -5, NaN]) {
      const f = walkFrame(0, { from, to, speed });
      expect(f.x, `speed=${speed}`).toBe(to);
      expect(f.done).toBe(true);
    }
  });

  it('起点与终点相同时一开始就算到了', () => {
    const f = walkFrame(0, { from: to, to, speed: SPEED });
    expect(f.done).toBe(true);
    expect(f.action).toBe('idle');
  });
});

describe('画面尺寸与站位', () => {
  it('领养窗口能容纳相遇画面与直观调参区', () => {
    expect(ADOPT_W).toBeGreaterThanOrEqual(860);
    expect(ADOPT_H).toBeGreaterThanOrEqual(680);
  });

  it('猫停下时整只都在画面里', () => {
    expect(REST_X - HALF_SPRITE).toBeGreaterThanOrEqual(0);
    expect(REST_X + HALF_SPRITE).toBeLessThanOrEqual(ADOPT_PREVIEW_W);
  });

  it('入场起点与离场终点都在画面外，看不到猫凭空出现或消失', () => {
    expect(ENTER_X - HALF_SPRITE).toBeGreaterThanOrEqual(ADOPT_PREVIEW_W);
    expect(EXIT_X + HALF_SPRITE).toBeLessThanOrEqual(0);
  });

  it('雨夜画面装得下整只猫', () => {
    expect(SKY_H).toBeGreaterThanOrEqual(H * ADOPT_SCALE);
    expect(SKY_H).toBeLessThan(ADOPT_H);
  });

  it('入场有真正走一段的余量，不是一步到位', () => {
    // 少于一个身位的路程读不出「走来」，只会看到猫在边上抖一下。
    expect(ENTER_X - REST_X).toBeGreaterThan(HALF_SPRITE * 2);
  });
});
