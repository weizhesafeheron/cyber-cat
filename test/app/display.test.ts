import { describe, expect, it } from 'vitest';
import { cssSizeFor, deviceScaleFor } from '../../src/app/display.js';
import type { CssBox } from '../../src/app/display.js';
import { H, W } from '../../src/render/index.js';

/**
 * 像素完整性。
 *
 * 每个源像素必须占据整数个物理像素，否则像素风在非整数缩放的屏幕上会破功。
 * Windows 侧实测过 150% 缩放屏（dpr 1.5）是最容易踩这个坑的常见配置。
 */

/** 真实世界里会遇到的 devicePixelRatio。1.5 与 1.25 是 Windows 缩放的常见值。 */
const REAL_DPRS = [1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;

describe('设备缩放取整', () => {
  it('任何 dpr 下，源像素都占据整数个物理像素', () => {
    for (const dpr of REAL_DPRS) {
      for (const target of [2, 3, 4]) {
        const scale = deviceScaleFor(target, dpr);
        expect(Number.isInteger(scale), `dpr=${dpr} target=${target} 的设备缩放不是整数`).toBe(true);
        expect(scale).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('画布的物理尺寸是源尺寸的整数倍', () => {
    for (const dpr of REAL_DPRS) {
      const scale = deviceScaleFor(3, dpr);
      expect((W * scale) % W).toBe(0);
      expect((H * scale) % H).toBe(0);
    }
  });

  it('表观大小与目标值的偏差在可接受范围内', () => {
    // 取整会让表观尺寸偏离目标。偏差必须小于半个源像素的显示尺寸，
    // 否则用户会觉得猫在不同屏幕上大小不一。
    for (const dpr of REAL_DPRS) {
      const target = 3;
      const scale = deviceScaleFor(target, dpr);
      const { w } = cssSizeFor(scale, dpr);
      const idealW = W * target;
      const driftRatio = Math.abs(w - idealW) / idealW;
      expect(driftRatio, `dpr=${dpr} 的表观尺寸偏差 ${(driftRatio * 100).toFixed(1)}%`).toBeLessThan(
        0.2,
      );
    }
  });

  it('dpr 为 1.5 时不会退化成 4.5 这种非整数缩放', () => {
    // 这是最容易踩坑的一档：CSS 里写死 3× 就会得到 4.5 个物理像素/源像素
    expect(deviceScaleFor(3, 1.5)).toBe(5);
    expect(deviceScaleFor(3, 1.25)).toBe(4);
    expect(deviceScaleFor(3, 2)).toBe(6);
  });

  it('极小的 dpr 也不会得到 0 倍缩放', () => {
    expect(deviceScaleFor(3, 0.1)).toBeGreaterThanOrEqual(1);
    expect(deviceScaleFor(1, 0.01)).toBe(1);
  });
});

describe('画布不得溢出窗口', () => {
  /** 宠物窗口的客户区尺寸，与 tauri.conf.json 保持一致。 */
  const WINDOW: CssBox = { w: 240, h: 190 };

  it('各档真实 dpr 下，放大后的画布都放得进窗口', () => {
    for (const dpr of REAL_DPRS) {
      const scale = deviceScaleFor(3, dpr, WINDOW);
      const { w, h } = cssSizeFor(scale, dpr);
      expect(w, `dpr=${dpr} 画布宽 ${w} 超出窗口 ${WINDOW.w}`).toBeLessThanOrEqual(WINDOW.w);
      expect(h, `dpr=${dpr} 画布高 ${h} 超出窗口 ${WINDOW.h}`).toBeLessThanOrEqual(WINDOW.h);
      expect(Number.isInteger(scale)).toBe(true);
    }
  });

  it('不加钳制时，Windows 的 125% 缩放会让画布溢出 - 这是钳制存在的原因', () => {
    // 回归保护：这个组合曾经会让猫被裁掉一截。
    const unclamped = deviceScaleFor(3, 1.25);
    expect(cssSizeFor(unclamped, 1.25).w).toBeGreaterThan(216);
    // 加上钳制后放得进窗口
    const clamped = deviceScaleFor(3, 1.25, WINDOW);
    expect(cssSizeFor(clamped, 1.25).w).toBeLessThanOrEqual(WINDOW.w);
  });

  it('窗口足够大时钳制不生效，仍取目标倍数', () => {
    expect(deviceScaleFor(3, 2, { w: 9999, h: 9999 })).toBe(deviceScaleFor(3, 2));
  });

  it('窗口极小也至少保留 1 倍缩放', () => {
    expect(deviceScaleFor(3, 2, { w: 1, h: 1 })).toBe(1);
  });
});
