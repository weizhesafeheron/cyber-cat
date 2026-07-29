import { describe, expect, it } from 'vitest';
import { ACTIONS, CatRenderer, H, W, makeCat } from '../../src/render/index.js';
import type { ActionKey, MicroOut } from '../../src/render/index.js';
import {
  NO_SETTLE,
  SETTLE_MAX_PX,
  SETTLE_MS,
  beginSettle,
  centroidY,
  settleOffset,
} from '../../src/app/settle.js';

/**
 * 换动作时的落位过渡。
 *
 * 起因是真机上看到的现象：「动作变化的时候猫会闪动一下」。
 * 根因不是掉帧也不是重绘，是两个姿态的形体高度差得多 - 站姿与趴姿的轮廓
 * 差十个精灵像素，站姿与睡姿差十七个。硬切就是一帧之内整只猫上下跳一截。
 *
 * 这个文件先用真实的动作库把「跳变确实存在且很大」量出来（否则下面测的东西
 * 就没有意义），再守过渡本身的性质。
 */

const cat = makeCat('orange', 20260728);
const renderer = new CatRenderer();
// 微动作全部静止：这个文件量的是姿态本身的高度差，不该被眨眼歪头搅进来。
const MICRO: MicroOut = { eyeOpen: 1, earFlickL: 0, earFlickR: 0, tilt: 0 };

function cyOf(action: ActionKey, t: number): number {
  const res = renderer.render(cat, ACTIONS[action].make(t, cat, MICRO));
  const cy = centroidY(res.alphaMask);
  if (cy === null) throw new Error(`${action} 在 t=${t} 画出来是空的`);
  return cy;
}

describe('重心测量', () => {
  it('空掩膜返回 null，不是 0 也不是 NaN', () => {
    expect(centroidY(new Uint8Array(W * H))).toBeNull();
  });

  it('只有一行像素时重心就是那一行', () => {
    const mask = new Uint8Array(W * H);
    for (let x = 10; x < 20; x++) mask[7 * W + x] = 255;
    expect(centroidY(mask)).toBe(7);
  });

  it('只认 255 - 掩膜是二值的，半透明像素不该被算进猫的位置', () => {
    const mask = new Uint8Array(W * H);
    mask[3 * W + 5] = 255;
    mask[40 * W + 5] = 128;
    expect(centroidY(mask)).toBe(3);
  });
});

describe('这个问题真实存在（否则过渡就是无用的复杂度）', () => {
  it('站姿与趴姿、睡姿的重心相差好几个精灵像素', () => {
    const stand = cyOf('idle', 9.7);
    expect(Math.abs(cyOf('lie', 0) - stand)).toBeGreaterThan(5);
    expect(Math.abs(cyOf('sleep', 0) - stand)).toBeGreaterThan(7);
  });

  it('全动作两两之间，最大跳变超过八个精灵像素', () => {
    const keys = Object.keys(ACTIONS) as ActionKey[];
    let worst = 0;
    for (const from of keys) {
      for (const to of keys) {
        if (from === to) continue;
        worst = Math.max(worst, Math.abs(cyOf(to, 0) - cyOf(from, 9.7)));
      }
    }
    expect(worst).toBeGreaterThan(8);
  });
});

describe('过渡的性质', () => {
  it('起点补满整个落差，终点归零', () => {
    const s = beginSettle(20, 30, 1000);
    expect(s.from).toBe(-10);
    expect(settleOffset(s, 1000)).toBe(-10);
    expect(settleOffset(s, 1000 + SETTLE_MS)).toBe(0);
    expect(settleOffset(s, 1000 + SETTLE_MS * 3)).toBe(0);
  });

  it('过渡期间单调收敛，不会回弹', () => {
    const s = beginSettle(40, 28, 0);
    let prev = Math.abs(settleOffset(s, 0));
    for (let t = 1; t <= SETTLE_MS; t += 4) {
      const now = Math.abs(settleOffset(s, t));
      expect(now).toBeLessThanOrEqual(prev + 1e-9);
      prev = now;
    }
    expect(settleOffset(s, SETTLE_MS)).toBe(0);
  });

  it('两端慢中间快 - 线性的话起落都是硬的，仍然有「咔」的一下', () => {
    const s = beginSettle(0, 10, 0);
    // smoothstep 在前 15% 里走掉的比例应当明显小于线性的 15%
    const early = 1 - settleOffset(s, SETTLE_MS * 0.15) / s.from;
    expect(early).toBeLessThan(0.1);
    // 中段应当快于线性
    const mid = 1 - settleOffset(s, SETTLE_MS * 0.5) / s.from;
    expect(mid).toBeCloseTo(0.5, 5);
  });

  it('上一帧没有猫（首帧、猫刚离开）时不过渡', () => {
    expect(beginSettle(null, 30, 100)).toEqual(NO_SETTLE);
    expect(beginSettle(30, null, 100)).toEqual(NO_SETTLE);
    expect(settleOffset(NO_SETTLE, 12_345)).toBe(0);
  });

  it('落差有上限 - 掩膜异常时不能把猫甩出画面', () => {
    expect(beginSettle(0, 500, 0).from).toBe(-SETTLE_MAX_PX);
    expect(beginSettle(500, 0, 0).from).toBe(SETTLE_MAX_PX);
  });

  it('真实的站姿→趴姿切换：过渡开始时补偏移，结束时完全回到趴姿本来的位置', () => {
    const s = beginSettle(cyOf('idle', 9.7), cyOf('lie', 0), 0);
    // 趴姿的重心更低，所以要先往上提一截再滑下去。
    expect(s.from).toBeLessThan(0);
    // 屏幕上的重心在过渡开始时与上一帧一致 - 这就是「不跳」的定义。
    expect(cyOf('lie', 0) + settleOffset(s, 0)).toBeCloseTo(cyOf('idle', 9.7), 5);
    expect(settleOffset(s, SETTLE_MS)).toBe(0);
  });
});
