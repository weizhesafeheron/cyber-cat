import { describe, expect, it } from 'vitest';
import { RAIN_ALPHA, RAIN_DROPS, RAIN_LEN, RAIN_SPEED, RAIN_WIND } from '../../src/adopt/constants.js';
import { makeRain, stepRain } from '../../src/adopt/rain.js';
import { mulberry32 } from '../../src/render/index.js';

/**
 * 雨。
 *
 * 赛博朋克氛围在 ADR 0004 之后不再由背景画面承担，但领养的雨夜是文案与呈现的
 * 一部分（mvp-scope 第 1、7 节）。这里只测「雨会一直下」这件事 -
 * 雨滴漏出画面之后不回收，几秒之后画面上就没有雨了，而那是个只在真机上
 * 看几十秒才会发现的 bug。
 */

const BOX = { w: 464, h: 190 };

describe('雨滴场', () => {
  it('雨滴数量恒定，落出画面的会被送回顶上', () => {
    const rnd = mulberry32(1);
    let field = makeRain(BOX, rnd);
    expect(field.drops.length).toBe(RAIN_DROPS);
    // 20 秒足够让最慢的雨滴穿过画面好几遍
    for (let i = 0; i < 20 / 0.016; i++) field = stepRain(field, 0.016, BOX, rnd);
    expect(field.drops.length).toBe(RAIN_DROPS);
  });

  it('雨滴始终留在画面附近，不会飘到几千像素之外', () => {
    const rnd = mulberry32(2);
    let field = makeRain(BOX, rnd);
    for (let i = 0; i < 600; i++) {
      field = stepRain(field, 0.033, BOX, rnd);
      for (const d of field.drops) {
        expect(d.y).toBeGreaterThan(-BOX.h);
        expect(d.y).toBeLessThan(BOX.h + RAIN_LEN[1]);
        // 斜雨会横向漂出边界，回收时才归位，所以横向留一个画面宽的余量
        expect(d.x).toBeGreaterThan(-BOX.w);
        expect(d.x).toBeLessThan(BOX.w * 2);
      }
    }
  });

  it('雨在下落而不是静止', () => {
    const rnd = mulberry32(3);
    const field = makeRain(BOX, rnd);
    const next = stepRain(field, 0.1, BOX, rnd);
    const moved = next.drops.filter((d, i) => d.y !== field.drops[i]!.y);
    expect(moved.length).toBe(RAIN_DROPS);
  });

  it('雨是斜的：横向位移的方向与风一致', () => {
    const rnd = mulberry32(4);
    const field = makeRain(BOX, rnd);
    // 只看这一帧没有被回收的雨滴，回收会把 x 重新随机掉
    const next = stepRain(field, 0.01, BOX, rnd);
    let checked = 0;
    for (let i = 0; i < field.drops.length; i++) {
      const before = field.drops[i]!;
      const after = next.drops[i]!;
      if (after.y < before.y) continue; // 被回收了
      expect(Math.sign(after.x - before.x)).toBe(Math.sign(RAIN_WIND));
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('每滴雨的速度、长度、不透明度都在设定范围内 - 纵深靠这三项', () => {
    const rnd = mulberry32(5);
    let field = makeRain(BOX, rnd);
    for (let i = 0; i < 300; i++) field = stepRain(field, 0.05, BOX, rnd);
    for (const d of field.drops) {
      expect(d.speed).toBeGreaterThanOrEqual(RAIN_SPEED[0]);
      expect(d.speed).toBeLessThanOrEqual(RAIN_SPEED[1]);
      expect(d.len).toBeGreaterThanOrEqual(RAIN_LEN[0]);
      expect(d.len).toBeLessThanOrEqual(RAIN_LEN[1]);
      expect(d.alpha).toBeGreaterThanOrEqual(RAIN_ALPHA[0]);
      expect(d.alpha).toBeLessThanOrEqual(RAIN_ALPHA[1]);
    }
  });

  it('不改动传进来的场（返回新对象）', () => {
    const rnd = mulberry32(6);
    const field = makeRain(BOX, rnd);
    const before = field.drops.map((d) => d.y);
    const next = stepRain(field, 0.2, BOX, rnd);
    expect(field.drops.map((d) => d.y)).toEqual(before);
    expect(next).not.toBe(field);
  });

  it('同一个随机源给出同一场雨', () => {
    const a = makeRain(BOX, mulberry32(7));
    const b = makeRain(BOX, mulberry32(7));
    expect(a).toEqual(b);
  });
});
