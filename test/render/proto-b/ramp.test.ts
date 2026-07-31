/** 色带映射与花纹叠加的纪律测试：档位保持、描边免疫、非法色不吞。 */
import { describe, expect, it } from 'vitest';
import { CANON, COLORWAYS, ID, colorwayByKey } from '../../../src/render/proto-b/palette.js';
import { idOfPixel, isCanonColor, parseHex, remapPixels } from '../../../src/render/proto-b/ramp.js';

const rgbOf = (id: number): readonly [number, number, number] => {
  const v = parseHex(CANON[id]!);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
};

/** 造一张 1×N 的像素条，每个元素是一个 palette ID。 */
function strip(ids: readonly number[]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(ids.length * 4);
  ids.forEach((id, i) => {
    const [r, g, b] = rgbOf(id);
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = 255;
  });
  return out;
}

const hexAt = (px: Uint8ClampedArray, i: number): string =>
  `#${[px[i * 4]!, px[i * 4 + 1]!, px[i * 4 + 2]!]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`;

describe('色带映射', () => {
  it('填充带整条映射且亮度档位一一对应', () => {
    const cw = colorwayByKey('silver-tabby');
    const src = strip([ID.C0, ID.C1, ID.C2, ID.C3]);
    const out = remapPixels(src, null, cw);
    expect(hexAt(out, 0)).toBe(cw.coat[0]);
    expect(hexAt(out, 1)).toBe(cw.coat[1]);
    expect(hexAt(out, 2)).toBe(cw.coat[2]);
    expect(hexAt(out, 3)).toBe(cw.coat[3]);
  });

  it('暗描边不参与映射，软描边映射到配色的 outSoft', () => {
    for (const cw of COLORWAYS) {
      const out = remapPixels(strip([ID.OUT_DARK, ID.OUT_SOFT]), null, cw);
      expect(hexAt(out, 0)).toBe(CANON[ID.OUT_DARK]);
      expect(hexAt(out, 1)).toBe(cw.outSoft);
    }
  });

  it('瞳孔与高光是固定色，任何配色下原样保留', () => {
    for (const cw of COLORWAYS) {
      const out = remapPixels(strip([ID.PUPIL, ID.GLINT]), null, cw);
      expect(hexAt(out, 0)).toBe(CANON[ID.PUPIL]);
      expect(hexAt(out, 1)).toBe(CANON[ID.GLINT]);
    }
  });

  it('透明像素保持全零', () => {
    const src = new Uint8ClampedArray(8);
    const out = remapPixels(src, null, colorwayByKey('cow'));
    expect([...out]).toEqual(new Array(8).fill(0));
  });

  it('不认识的颜色原样透传，不吞不炸', () => {
    const src = new Uint8ClampedArray([12, 34, 56, 255]);
    const out = remapPixels(src, null, colorwayByKey('black'));
    expect([...out]).toEqual([12, 34, 56, 255]);
  });
});

describe('花纹叠加', () => {
  const cw = colorwayByKey('orange-tabby'); // pattern.bands = ['coat']
  const maskHit = new Uint8ClampedArray([0, 0, 0, 255]);
  const maskMiss = new Uint8ClampedArray([0, 0, 0, 0]);

  it('mask 命中 + 填充带 → 花纹带同档位', () => {
    for (let i = 0; i < 4; i++) {
      const out = remapPixels(strip([ID.C0 + i]), maskHit, cw);
      expect(hexAt(out, 0)).toBe(cw.pattern!.ramp[i]);
    }
  });

  it('mask 未命中 → 正常换色', () => {
    const out = remapPixels(strip([ID.C2]), maskMiss, cw);
    expect(hexAt(out, 0)).toBe(cw.coat[2]);
  });

  it('描边不在允许集合里，mask 命中也不换', () => {
    const out = remapPixels(strip([ID.OUT_DARK]), maskHit, cw);
    expect(hexAt(out, 0)).toBe(CANON[ID.OUT_DARK]);
  });

  it('腹白带只在配色声明后才被花纹覆盖', () => {
    const noBelly = remapPixels(strip([ID.B1]), maskHit, cw);
    expect(hexAt(noBelly, 0)).toBe(cw.belly[1]);

    const cowCw = colorwayByKey('cow'); // bands 含 belly
    const withBelly = remapPixels(strip([ID.B1]), maskHit, cowCw);
    expect(hexAt(withBelly, 0)).toBe(cowCw.pattern!.ramp[1]);
  });

  it('纯色配色（无 pattern）忽略 mask', () => {
    const black = colorwayByKey('black');
    const out = remapPixels(strip([ID.C1]), maskHit, black);
    expect(hexAt(out, 0)).toBe(black.coat[1]);
  });
});

describe('规范色识别', () => {
  it('规范色都能反查出 ID', () => {
    for (const [id, hex] of Object.entries(CANON)) {
      const v = parseHex(hex);
      expect(idOfPixel((v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff)).toBe(Number(id));
    }
  });

  it('非规范色返回 false / undefined', () => {
    expect(isCanonColor(1, 2, 3)).toBe(false);
    expect(idOfPixel(1, 2, 3)).toBeUndefined();
  });
});
