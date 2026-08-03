/**
 * 3×5 的小写拉丁像素字模。
 *
 * **只收当前真的用到的字符。** 一整套 ASCII 是 95 个字模，而这一版只有一句台词；
 * 收全等于维护一份用不上的资产，而且没有任何测试会覆盖那些没被用到的字形，
 * 写错了也发现不了。要新台词就往下加，缺字符会在构建贴图时可见地失败，不会静默画空。
 *
 * 3×5 是这个尺度上的下限：小写字母的中区（x 高度）只有 3 行，再矮 m 和 n 就分不开。
 * 汉字在 8×8 像素里会糊；拉丁小写在 3×5 里是清楚的，所以这里可以真写字。
 */

/** 一个字模：5 行，每行 3 个字符，`#` 是实心。 */
type Glyph = readonly [string, string, string, string, string];

const GLYPHS: Readonly<Record<string, Glyph>> = {
  y: ['# #', '# #', '###', '  #', '## '],
  u: ['   ', '# #', '# #', '# #', '###'],
  m: ['   ', '## ', '###', '# #', '# #'],
  // 句点占满三列宽度里的中间一列，落在基线上。
  '.': ['   ', '   ', '   ', '   ', ' # '],
  ' ': ['   ', '   ', '   ', '   ', '   '],
};

/** 字模的宽高，像素。 */
export const GLYPH_W = 3;
export const GLYPH_H = 5;

/** 字与字之间空一列。挨着写的话 mm 会连成一片。 */
export const GLYPH_GAP = 1;

export class MissingGlyphError extends Error {
  constructor(ch: string) {
    super(`字模里没有 ${JSON.stringify(ch)}，请在 src/say/font.ts 里补上`);
    this.name = 'MissingGlyphError';
  }
}

/** 一句话排出来占多宽，像素。 */
export function textWidth(text: string): number {
  if (text.length === 0) return 0;
  return text.length * GLYPH_W + (text.length - 1) * GLYPH_GAP;
}

/**
 * 把一句话排成点阵，返回每个实心像素的相对坐标（0,0 是左上）。
 *
 * 缺字符**抛错而不是跳过**：跳过的后果是气泡里少一个字母，而那种缺陷在真机上
 * 只有盯着看才会发现；抛错会在第一次构建贴图时就炸出来。
 */
export function textPixels(text: string): readonly (readonly [number, number])[] {
  const out: [number, number][] = [];
  let ox = 0;
  for (const ch of text) {
    const g = GLYPHS[ch];
    if (g === undefined) throw new MissingGlyphError(ch);
    for (let y = 0; y < GLYPH_H; y++) {
      const row = g[y] ?? '';
      for (let x = 0; x < GLYPH_W; x++) {
        if (row[x] === '#') out.push([ox + x, y]);
      }
    }
    ox += GLYPH_W + GLYPH_GAP;
  }
  return out;
}

/** 字模表里有哪些字符。给测试用。 */
export const SUPPORTED = Object.keys(GLYPHS);
