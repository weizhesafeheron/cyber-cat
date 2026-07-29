import { describe, expect, it } from 'vitest';
import {
  BOWL_MAX_PORTIONS,
  BOWL_PORTIONS_PER_FILL,
} from '../../src/world/index.js';
import {
  KIBBLE_MAX_ROWS,
  PROP_KINDS,
  PROP_SPRITE,
  bedSprite,
  bowlSprite,
  propSprite,
} from '../../src/props/index.js';
import type { PropSprite } from '../../src/props/index.js';
import { OUTLINE } from '../../src/render/palette.js';

/**
 * 挂件的像素画。
 *
 * 不做像素级黄金图对比（与猫同样的理由，见 docs/art-and-motion-decisions.md）：
 * 美术调整会频繁改动像素而不改变行为。这里测的是**行为**：
 * 碗里有几份粮画出来就该有几层、掩膜与像素同源、描边不吃掉透明区。
 */

/** 一张贴图里不透明像素的个数。 */
function filled(sprite: PropSprite): number {
  let n = 0;
  for (let i = 0; i < sprite.width * sprite.height; i++) {
    if (sprite.pixels[i * 4 + 3] === 255) n++;
  }
  return n;
}

function colorAt(sprite: PropSprite, i: number): string {
  const o = i * 4;
  return `${sprite.pixels[o]},${sprite.pixels[o + 1]},${sprite.pixels[o + 2]}`;
}

function rgbOf(hex: string): string {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(',');
}

/** 贴图里最靠上的那个不透明行。粮堆高了它就往上跑。 */
function topRow(sprite: PropSprite): number {
  for (let y = 0; y < sprite.height; y++) {
    for (let x = 0; x < sprite.width; x++) {
      if (sprite.pixels[(y * sprite.width + x) * 4 + 3] === 255) return y;
    }
  }
  return sprite.height;
}

describe('尺寸与结构', () => {
  it('两张贴图的尺寸就是常量声明的那些', () => {
    for (const kind of PROP_KINDS) {
      const s = propSprite(kind, 3);
      expect(s.width, kind).toBe(PROP_SPRITE[kind].w);
      expect(s.height, kind).toBe(PROP_SPRITE[kind].h);
      expect(s.pixels.length).toBe(s.width * s.height * 4);
      expect(s.alphaMask.length).toBe(s.width * s.height);
    }
  });

  it('掩膜与像素同源：掩膜标 255 的位置像素一定不透明，反之亦然', () => {
    // 这是 ADR 0006 对挂件的要求 - 挂件窗口也要逐像素穿透，
    // 掩膜与画出去的像素不同源的话，穿透会在贴图边缘失准。
    for (const kind of PROP_KINDS) {
      for (const portions of [0, 1, 2, 3]) {
        const s = propSprite(kind, portions);
        for (let i = 0; i < s.width * s.height; i++) {
          expect(s.alphaMask[i] === 255, `${kind}/${portions} 第 ${i} 个像素`).toBe(
            s.pixels[i * 4 + 3] === 255,
          );
        }
      }
    }
  });

  it('两张贴图都画得出东西，而且四周留着透明边（窗口才不会是一整块色板）', () => {
    for (const kind of PROP_KINDS) {
      const s = propSprite(kind, 3);
      const n = filled(s);
      expect(n, `${kind} 画出来是空的`).toBeGreaterThan(40);
      expect(n, `${kind} 铺满了整个窗口`).toBeLessThan(s.width * s.height * 0.8);
      // 最上一行必须是透明的：贴图顶到窗口边缘意味着描边被裁掉了。
      for (let x = 0; x < s.width; x++) {
        expect(s.pixels[x * 4 + 3], `${kind} 顶行第 ${x} 列不透明`).toBe(0);
      }
    }
  });

  it('有描边，而且描边色与猫的一致 - 不然挂件像另一套美术里的贴纸', () => {
    const ink = rgbOf(OUTLINE);
    for (const kind of PROP_KINDS) {
      const s = propSprite(kind, 2);
      let outline = 0;
      for (let i = 0; i < s.width * s.height; i++) {
        if (s.pixels[i * 4 + 3] === 255 && colorAt(s, i) === ink) outline++;
      }
      expect(outline, `${kind} 没有描边`).toBeGreaterThan(20);
    }
  });

  it('确定性：同样的入参画出完全一样的字节', () => {
    for (const kind of PROP_KINDS) {
      const a = propSprite(kind, 2);
      const b = propSprite(kind, 2);
      expect([...a.pixels]).toEqual([...b.pixels]);
      expect([...a.alphaMask]).toEqual([...b.alphaMask]);
    }
  });

  it('每次都是新的数组 - 挂件窗口会跨帧持有当前那张贴图', () => {
    const a = propSprite('bowl', 1);
    const b = propSprite('bowl', 3);
    expect(a.pixels).not.toBe(b.pixels);
    expect(filled(a)).not.toBe(filled(b));
  });
});

describe('碗里有粮要看得见', () => {
  it('份数越多粮堆越高，0 份时盆是空的', () => {
    const heights = [0, 1, 2, 3].map((n) => topRow(bowlSprite(n)));
    // 空盆的顶边最低（y 最大），每加一份都往上顶
    for (let i = 1; i < heights.length; i++) {
      expect(heights[i]!, `${i} 份没比 ${i - 1} 份更高`).toBeLessThan(heights[i - 1]!);
    }
  });

  it('份数越多不透明像素越多', () => {
    const counts = [0, 1, 2, 3].map((n) => filled(bowlSprite(n)));
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]!, `${i} 份的像素没比 ${i - 1} 份多`).toBeGreaterThan(counts[i - 1]!);
    }
  });

  it('粮是暖色，空盆里一个暖色像素都没有 - 「有粮」要一眼看见', () => {
    const cold = new Set(['74,94,160', '61,79,138', '44,58,104', '35,44,82', rgbOf(OUTLINE)]);
    const empty = bowlSprite(0);
    for (let i = 0; i < empty.width * empty.height; i++) {
      if (empty.pixels[i * 4 + 3] !== 255) continue;
      expect(cold.has(colorAt(empty, i)), `空盆里出现了非盆体的颜色 ${colorAt(empty, i)}`).toBe(
        true,
      );
    }
    // 对照组：有粮时确实出现了盆体之外的颜色。
    const full = bowlSprite(2);
    let warm = 0;
    for (let i = 0; i < full.width * full.height; i++) {
      if (full.pixels[i * 4 + 3] !== 255) continue;
      if (!cold.has(colorAt(full, i))) warm++;
    }
    expect(warm, '有粮的盆里没有粮的颜色').toBeGreaterThan(8);
  });

  it('份数超过上限不会画出越界的粮堆', () => {
    const capped = bowlSprite(KIBBLE_MAX_ROWS);
    expect(filled(bowlSprite(99))).toBe(filled(capped));
    expect(topRow(capped)).toBeGreaterThanOrEqual(0);
  });

  it('负数与小数份数不会画崩', () => {
    expect(filled(bowlSprite(-5))).toBe(filled(bowlSprite(0)));
    expect(filled(bowlSprite(1.9))).toBe(filled(bowlSprite(1)));
  });

  it('粮堆的层数够画出世界层的容量上限 - 攒满三份要看得出来', () => {
    // 世界层一次添两份、最多攒三份，所以画到三层就够；少一层的话
    // 「碗里还有粮」在满和快满之间就分不出来了。
    expect(KIBBLE_MAX_ROWS).toBe(BOWL_MAX_PORTIONS);
    expect(BOWL_PORTIONS_PER_FILL).toBeLessThanOrEqual(KIBBLE_MAX_ROWS);
  });
});

describe('猫窝', () => {
  it('是一张矮垫子，画得出来且没有分档', () => {
    const a = bedSprite();
    expect(filled(a)).toBeGreaterThan(80);
    // propSprite 的 portions 对猫窝不起作用
    expect([...propSprite('bed', 3).pixels]).toEqual([...a.pixels]);
  });

  it('比食盆宽 - 猫要躺得进去', () => {
    expect(PROP_SPRITE.bed.w).toBeGreaterThan(PROP_SPRITE.bowl.w);
  });
});
