/**
 * 原型 A（程序化着色升级，issue #24）的纯逻辑单测。
 *
 * 原型不追求覆盖率，这里守住的是调研报告点名的翻车点：
 * - 明暗必须来自法线点乘光向，不能是「离部件中心的距离」（pillow shading）
 * - 毛簇必须跟随部件运动，不能固定在屏幕空间（帧间沸腾）
 * - hue shift 的提亮/压暗方向必须真实生效
 */

import { describe, expect, it } from 'vitest';
import { GROUND, W, makeCat, ACTIONS } from '../../src/render/index.js';
import type { Cat, MicroOut } from '../../src/render/index.js';
import {
  H2,
  ProtoARenderer,
  SCALE,
  W2,
  bandOf,
  buildShadeRamp,
  coolDarken,
  furOffset,
  luma,
  shadeLutFor,
  warmLighten,
} from '../../src/render/proto-a/index.js';
import { rgbToHsl, hexToRgb } from '../../src/render/proto-a/color.js';
import { PALETTES } from '../../src/render/palette.js';

const HEX = /^#[0-9a-f]{6}$/;

const NEUTRAL_MICRO: MicroOut = { eyeOpen: 1, earFlickL: 0, earFlickR: 0, tilt: 0 };

describe('color: hue shift 工具', () => {
  it('warmLighten 提亮并输出合法 hex', () => {
    for (const hex of ['#f5a94e', '#3b3850', '#ffffff', '#232033']) {
      const out = warmLighten(hex, 0.42);
      expect(out).toMatch(HEX);
      expect(luma(out)).toBeGreaterThanOrEqual(luma(hex));
    }
  });

  it('coolDarken 压暗并输出合法 hex', () => {
    for (const hex of ['#f5a94e', '#efeef5', '#ffffff']) {
      const out = coolDarken(hex, 0.4);
      expect(out).toMatch(HEX);
      expect(luma(out)).toBeLessThan(luma(hex));
    }
  });

  it('压暗后的色相向冷色（蓝紫）靠近', () => {
    const src = '#f5a94e'; // 橘
    const [h0] = rgbToHsl(...hexToRgb(src));
    const [h1] = rgbToHsl(...hexToRgb(coolDarken(src, 0.6)));
    const dist = (h: number): number => Math.abs(((265 - h + 540) % 360) - 180);
    expect(dist(h1)).toBeLessThan(dist(h0));
  });
});

describe('shading: 色带量化与查表', () => {
  it('bandOf 单调：受光越强档位越亮', () => {
    expect(bandOf(1)).toBe(0);
    expect(bandOf(0.7)).toBe(1);
    expect(bandOf(0.45)).toBe(2);
    expect(bandOf(0.2)).toBe(3);
    expect(bandOf(0)).toBe(3);
    let prev = bandOf(0);
    for (let l = 0; l <= 1; l += 0.02) {
      const b = bandOf(l);
      expect(b).toBeLessThanOrEqual(prev);
      prev = b;
    }
  });

  it('buildShadeRamp 保留手调的三阶原色，只新增暖高光', () => {
    const ramp = PALETTES.orange.base;
    const shade = buildShadeRamp(ramp);
    expect(shade).toHaveLength(4);
    expect(shade.slice(1)).toEqual([...ramp]);
    expect(luma(shade[0])).toBeGreaterThanOrEqual(luma(ramp[0]));
  });

  it('查表覆盖每个品种的全部 ramp 色与口鼻色', () => {
    for (const pal of Object.values(PALETTES)) {
      const lut = shadeLutFor(pal);
      for (const ramp of [pal.base, pal.mark, pal.white]) {
        for (const c of ramp) expect(lut.has(c)).toBe(true);
      }
      expect(lut.has(pal.muzzle)).toBe(true);
      // 眼睛与鼻头是符号不是体积，不应被重着色。
      expect(lut.has(pal.eye[0])).toBe(false);
    }
  });

  it('同一调色板的查表结果被缓存', () => {
    expect(shadeLutFor(PALETTES.black)).toBe(shadeLutFor(PALETTES.black));
  });
});

describe('fur: 确定性毛簇', () => {
  it('同参数恒等（不随帧变化）', () => {
    for (let i = 0; i < 50; i++) {
      const theta = -Math.PI + (i / 50) * 2 * Math.PI;
      expect(furOffset(theta, 12345, 0.4)).toBe(furOffset(theta, 12345, 0.4));
    }
  });

  it('幅度有界（轮廓破碎不超过约 1 个精灵像素）', () => {
    for (let i = 0; i < 200; i++) {
      const theta = -Math.PI + (i / 200) * 2 * Math.PI;
      const off = furOffset(theta, 999, 1);
      expect(Math.abs(off)).toBeLessThanOrEqual(0.2);
    }
  });

  it('不同 seed 的簇分布不同', () => {
    let diff = 0;
    for (let i = 0; i < 64; i++) {
      const theta = -Math.PI + (i / 64) * 2 * Math.PI;
      if (furOffset(theta, 1, 0.5) !== furOffset(theta, 2, 0.5)) diff++;
    }
    expect(diff).toBeGreaterThan(16);
  });
});

describe('ProtoARenderer', () => {
  const renderer = new ProtoARenderer();

  function catPixels(res: { width: number; height: number; alphaMask: Uint8Array }): number[] {
    const out: number[] = [];
    for (let i = 0; i < res.width * res.height; i++) if (res.alphaMask[i] === 255) out.push(i);
    return out;
  }

  it('输出 144×112，掩膜与像素同源', () => {
    expect(W2).toBe(W * SCALE);
    expect(H2).toBe(112);
    const cat = makeCat('orange', 7);
    const pose = ACTIONS.idle.make(0, cat, NEUTRAL_MICRO, {});
    const res = renderer.render(cat, pose);
    expect(res.width).toBe(144);
    expect(res.height).toBe(112);
    const cats = catPixels(res);
    expect(cats.length).toBeGreaterThan(800);
    for (const i of cats) expect(res.pixels[i * 4 + 3]).toBe(255);
  });

  it('确定性：同猫同姿态两次渲染逐像素一致', () => {
    const cat = makeCat('aby', 42);
    const pose = ACTIONS.idle.make(0.5, cat, NEUTRAL_MICRO, {});
    const a = new Uint8ClampedArray(renderer.render(cat, pose).pixels);
    const b = renderer.render(cat, pose).pixels;
    expect(Buffer.compare(Buffer.from(a.buffer.slice(0)), Buffer.from(b.buffer.slice(0)))).toBe(0);
  });

  it('站立时最低的猫像素不越过地面线', () => {
    for (const breed of ['orange', 'black', 'devon'] as const) {
      const cat = makeCat(breed, 3);
      const pose = ACTIONS.idle.make(0, cat, NEUTRAL_MICRO, {});
      const res = renderer.render(cat, pose);
      let lowest = 0;
      for (const i of catPixels(res)) lowest = Math.max(lowest, Math.floor(i / res.width));
      expect(lowest).toBeLessThanOrEqual(GROUND * SCALE);
    }
  });

  it('反 pillow shading：亮部质心在上、暗部质心在下（光源在上方）', () => {
    // 纯色黑猫 + 闭眼，排除花纹与眼睛符号色的干扰。
    const cat = makeCat('black', 11);
    const res = renderer.render(cat, { form: 'stand', eyeOpen: 0 });
    const entries: { y: number; l: number }[] = [];
    for (let i = 0; i < res.width * res.height; i++) {
      if (res.alphaMask[i] !== 255) continue;
      const o = i * 4;
      entries.push({
        y: Math.floor(i / res.width),
        l: 0.2126 * res.pixels[o]! + 0.7152 * res.pixels[o + 1]! + 0.0722 * res.pixels[o + 2]!,
      });
    }
    const sorted = [...entries].sort((a, b) => b.l - a.l);
    const q = Math.floor(sorted.length / 4);
    const mean = (xs: { y: number }[]): number => xs.reduce((s, e) => s + e.y, 0) / xs.length;
    const allY = mean(entries);
    const brightY = mean(sorted.slice(0, q));
    const darkY = mean(sorted.slice(-q));
    expect(allY - brightY).toBeGreaterThan(2);
    expect(darkY - allY).toBeGreaterThan(2);
  });

  it('毛簇跟随部件平移，不固定在屏幕空间（帧间不沸腾）', () => {
    // 纯色品种避开屏幕空间哈希的花纹（solid 只有 locket 用哈希，找一只没有的）。
    let cat: Cat | null = null;
    for (let s = 0; s < 60 && !cat; s++) {
      const c = makeCat('black', s);
      if (!c.marks.locket) cat = c;
    }
    expect(cat).not.toBeNull();
    const shift = 4; // 精灵像素
    const a = renderer.render(cat!, { form: 'stand', eyeOpen: 1 });
    const aCopy = new Uint8ClampedArray(a.pixels);
    const b = renderer.render(cat!, { form: 'stand', eyeOpen: 1, dx: shift });
    const hs = shift * SCALE;
    let mismatch = 0;
    for (let y = 0; y < H2; y++) {
      for (let x = 0; x < W2 - hs; x++) {
        const ia = (y * W2 + x) * 4;
        const ib = (y * W2 + x + hs) * 4;
        // 阴影行贴着缓冲底部按同一 cx 平移，也应一致；只比对非空像素归属与颜色。
        for (let k = 0; k < 4; k++) {
          if (aCopy[ia + k] !== b.pixels[ib + k]) {
            mismatch++;
            break;
          }
        }
      }
    }
    expect(mismatch).toBe(0);
  });
});
