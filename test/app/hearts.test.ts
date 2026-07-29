import { describe, expect, it } from 'vitest';
import {
  HEART_COUNT,
  HEART_LIFE_MS,
  HEART_SIZE,
  burstHearts,
  heartsInStage,
  stepHearts,
} from '../../src/app/hearts.js';

/**
 * 抚摸冒出的爱心。
 *
 * 位置与寿命是纯逻辑，所以「冒几颗、飘多久、往哪飘」这些不需要人眼来验。
 * 需要人眼的只有「好不好看」。
 */

const STAGE = { x: 500, y: 800 } as const;
const GROUND_Y = 1000;
const SCALE = 3;

describe('一次抚摸冒一串', () => {
  it('冒 HEART_COUNT 颗，而且错开时间 - 同时出来会叠成一坨', () => {
    const hs = burstHearts(1000, 300);
    expect(hs).toHaveLength(HEART_COUNT);
    const times = hs.map((h) => h.at);
    expect(new Set(times).size).toBe(HEART_COUNT);
    // 按序号递增
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('记的是猫当时的位置 - 猫走了爱心不跟着走', () => {
    const hs = burstHearts(0, 777);
    for (const h of hs) expect(h.x).toBe(777);
  });
});

describe('寿命', () => {
  it('到期就不存在了，不留半透明残骸', () => {
    const hs = burstHearts(0, 100);
    const last = Math.max(...hs.map((h) => h.at));
    expect(stepHearts(hs, last + HEART_LIFE_MS + 1)).toHaveLength(0);
  });

  it('没有任何变化时返回同一个数组 - 每帧都新建数组是白烧垃圾回收', () => {
    const hs = burstHearts(0, 100);
    expect(stepHearts(hs, 10)).toBe(hs);
  });

  it('还没到冒出时刻的那几颗不画出来', () => {
    const hs = burstHearts(1000, 100);
    const atStart = heartsInStage(hs, 1000, STAGE, GROUND_Y, SCALE);
    // 第一颗已经出来，后面两颗还没到时候
    expect(atStart).toHaveLength(1);
  });
});

describe('飘的轨迹', () => {
  const one = burstHearts(0, 800).slice(0, 1);

  it('往上飘 - y 单调减小', () => {
    let prev = Infinity;
    for (let age = 0; age < HEART_LIFE_MS; age += 50) {
      const [h] = heartsInStage(one, age, STAGE, GROUND_Y, SCALE);
      expect(h).toBeDefined();
      expect(h!.y).toBeLessThan(prev);
      prev = h!.y;
    }
  });

  it('从猫头顶上方开始，不是从脚底 - 猫高 56 个精灵像素', () => {
    const [h] = heartsInStage(one, 0, STAGE, GROUND_Y, SCALE);
    const localGround = GROUND_Y - STAGE.y;
    // 起点要在地面线上方至少三分之二个猫高
    expect(localGround - h!.y).toBeGreaterThan(56 * SCALE * 0.6);
  });

  it('后半段才淡出，前半段保持实心', () => {
    const early = heartsInStage(one, HEART_LIFE_MS * 0.2, STAGE, GROUND_Y, SCALE)[0]!;
    const late = heartsInStage(one, HEART_LIFE_MS * 0.9, STAGE, GROUND_Y, SCALE)[0]!;
    expect(early.alpha).toBe(1);
    expect(late.alpha).toBeLessThan(0.3);
    expect(late.alpha).toBeGreaterThanOrEqual(0);
  });

  it('同一串里左右交替飘开，不叠成一条竖线', () => {
    const hs = burstHearts(0, 800);
    // 取一个三颗都已经出来、且都还活着的时刻
    const t = Math.max(...hs.map((h) => h.at)) + HEART_LIFE_MS * 0.4;
    const shown = heartsInStage(hs, t, STAGE, GROUND_Y, SCALE);
    expect(shown.length).toBeGreaterThanOrEqual(2);
    expect(new Set(shown.map((h) => Math.round(h.x))).size).toBeGreaterThan(1);
  });

  it('换算扣掉了舞台原点 - 舞台滚动之后爱心不会整体偏移', () => {
    const a = heartsInStage(one, 100, { x: 0, y: 0 }, GROUND_Y, SCALE)[0]!;
    const b = heartsInStage(one, 100, { x: 200, y: 50 }, GROUND_Y, SCALE)[0]!;
    expect(a.x - b.x).toBe(200);
    expect(a.y - b.y).toBe(50);
  });

  it('图形有实际尺寸 - 换算时按中心对齐扣掉了半个宽', () => {
    expect(HEART_SIZE.w).toBeGreaterThan(2);
    const [h] = heartsInStage(one, 0, { x: 0, y: 0 }, GROUND_Y, SCALE);
    expect(h!.x).toBe(800 - (HEART_SIZE.w * SCALE) / 2);
  });
});
