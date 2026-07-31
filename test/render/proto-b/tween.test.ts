/** 缓动与拼接时间线。 */
import { describe, expect, it } from 'vitest';
import {
  blinkOpenness,
  easeInOutQuad,
  easeOutBack,
  easeOutCubic,
  phaseAt,
} from '../../../src/render/proto-b/tween.js';

describe('缓动函数', () => {
  it('端点固定 0→0、1→1', () => {
    for (const fn of [easeInOutQuad, easeOutCubic, easeOutBack]) {
      expect(fn(0)).toBeCloseTo(0, 9);
      expect(fn(1)).toBeCloseTo(1, 9);
    }
  });

  it('easeOutBack 有过冲', () => {
    expect(easeOutBack(0.85)).toBeGreaterThan(1);
  });
});

describe('phaseAt', () => {
  const durs = [2.5, 0.5, 2.0] as const;

  it('定位到正确的段与段内进度', () => {
    expect(phaseAt(1.0, durs).index).toBe(0);
    expect(phaseAt(2.7, durs)).toMatchObject({ index: 1 });
    expect(phaseAt(2.75, durs).u).toBeCloseTo(0.5, 9);
    expect(phaseAt(4.9, durs).index).toBe(2);
  });

  it('loop 时对总时长取模', () => {
    const total = 5.0;
    const a = phaseAt(1.3, durs);
    const b = phaseAt(1.3 + total * 3, durs);
    expect(b.index).toBe(a.index);
    expect(b.u).toBeCloseTo(a.u, 6);
  });

  it('不 loop 时停在最后一段末尾', () => {
    const end = phaseAt(99, durs, false);
    expect(end.index).toBe(2);
    expect(end.u).toBe(1);
  });

  it('负时间不越界', () => {
    const st = phaseAt(-0.3, durs);
    expect(st.index).toBeGreaterThanOrEqual(0);
    expect(st.u).toBeGreaterThanOrEqual(0);
    expect(st.u).toBeLessThanOrEqual(1);
  });
});

describe('blinkOpenness', () => {
  it('同 seed 同时刻结果一致（确定性）', () => {
    expect(blinkOpenness(1.234, 42)).toBe(blinkOpenness(1.234, 42));
  });

  it('大部分时间全睁，周期尾部有一次闭合', () => {
    const seed = 7;
    const period = 2.8 + (seed % 7) * 0.22;
    expect(blinkOpenness(period * 0.5, seed)).toBe(1);
    // 闭合窗口内某时刻应显著小于 1。
    const closing = blinkOpenness(period - 0.055, seed);
    expect(closing).toBeLessThan(0.6);
  });

  it('输出始终在 0..1', () => {
    for (let t = 0; t < 10; t += 0.01) {
      const v = blinkOpenness(t, 3);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
