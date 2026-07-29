import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  EAT_CYCLE,
  H as SPRITE_H,
  W as SPRITE_W,
  headColumn,
  makeCat,
} from '../../src/render/index.js';
import {
  EAT_LINE,
  EAT_SAY_SPRITE,
  GLYPH_GAP,
  GLYPH_H,
  GLYPH_W,
  MissingGlyphError,
  SAY_BASE_SPRITE_Y,
  SUPPORTED,
  sayBob,
  saySpriteRect,
  sayStageRect,
  sayVisible,
  saySprite,
  textPixels,
  textWidth,
} from '../../src/say/index.js';

/**
 * 吃饭时头顶的「yummy...」气泡。
 *
 * 时机、位置、贴图都是纯逻辑，所以「什么时候冒、冒在哪、字排得对不对」不需要人眼验。
 * 需要人眼的只有「3×5 的字母认不认得出来」。
 */

describe('像素字模', () => {
  it('台词里的每个字符都在字模表里 - 缺了会在构建贴图时就炸', () => {
    for (const ch of EAT_LINE) expect(SUPPORTED).toContain(ch);
  });

  it('缺字符抛错，不是静默跳过', () => {
    // 跳过的后果是气泡里少一个字母，那种缺陷在真机上只有盯着看才发现。
    expect(() => textPixels('z')).toThrow(MissingGlyphError);
  });

  it('宽度按「字宽 + 字间距」算，末尾不留空档', () => {
    expect(textWidth('')).toBe(0);
    expect(textWidth('y')).toBe(GLYPH_W);
    expect(textWidth('yu')).toBe(GLYPH_W * 2 + GLYPH_GAP);
    expect(textWidth(EAT_LINE)).toBe(EAT_LINE.length * GLYPH_W + (EAT_LINE.length - 1) * GLYPH_GAP);
  });

  it('每个字母都真的有像素，空格没有', () => {
    for (const ch of ['y', 'u', 'm', '.']) {
      expect(textPixels(ch).length, `${ch} 是空的`).toBeGreaterThan(0);
    }
    expect(textPixels(' ')).toHaveLength(0);
  });

  it('像素都落在字模的框里', () => {
    for (const [x, y] of textPixels(EAT_LINE)) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(textWidth(EAT_LINE));
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(GLYPH_H);
    }
  });

  it('相邻两个字母之间有空列 - 挨着写 mm 会连成一片', () => {
    const cols = new Set(textPixels('mm').map(([x]) => x));
    // 第一个 m 占 0..2，第二个占 4..6，第 3 列必须是空的
    expect(cols.has(3)).toBe(false);
  });
});

describe('贴图', () => {
  it('尺寸随台词长短变，且包住文字与内边距', () => {
    const short = saySprite('y');
    const long = saySprite(EAT_LINE);
    expect(long.width).toBeGreaterThan(short.width);
    expect(long.width).toBeGreaterThan(textWidth(EAT_LINE));
    expect(long.height).toBeGreaterThan(GLYPH_H);
  });

  it('尾巴尖在气泡里面，不在边上', () => {
    expect(EAT_SAY_SPRITE.tipX).toBeGreaterThan(0);
    expect(EAT_SAY_SPRITE.tipX).toBeLessThan(EAT_SAY_SPRITE.width - 1);
  });

  it('画出来不是空的，而且最下面一行只有尾巴那一个尖', () => {
    const { width, height, pixels } = EAT_SAY_SPRITE;
    const opaque = (x: number, y: number): boolean => pixels[(y * width + x) * 4 + 3] !== 0;
    let total = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) if (opaque(x, y)) total++;
    }
    expect(total).toBeGreaterThan(50);
    const lastRow = [];
    for (let x = 0; x < width; x++) if (opaque(x, height - 1)) lastRow.push(x);
    expect(lastRow).toHaveLength(1);
    expect(lastRow[0]).toBe(EAT_SAY_SPRITE.tipX);
  });

  it('文字的颜色与内壁、描边都不同 - 否则字就糊在背景里了', () => {
    const { width, height, pixels } = EAT_SAY_SPRITE;
    const colors = new Set<string>();
    for (let i = 0; i < width * height; i++) {
      if (pixels[i * 4 + 3] === 0) continue;
      colors.add(`${pixels[i * 4]},${pixels[i * 4 + 1]},${pixels[i * 4 + 2]}`);
    }
    // 描边、内壁、字，三种色
    expect(colors.size).toBe(3);
  });
});

describe('什么时候冒', () => {
  const cycle = EAT_CYCLE.seconds;

  it('只在吃饭时冒', () => {
    const mid = cycle * 0.3;
    expect(sayVisible('eat', mid, false)).toBe(true);
    for (const other of ['idle', 'walk', 'sleep', 'groom', 'held'] as const) {
      expect(sayVisible(other, mid, false), `${other} 时不该冒`).toBe(false);
    }
    expect(sayVisible(null, mid, false)).toBe(false);
  });

  it('跟着低头的那一段，抬头嚼的时候不冒 - 一直挂着就成了状态栏', () => {
    // 周期起点：头还没埋下去
    expect(sayVisible('eat', 0, false)).toBe(false);
    // 埋下去的中段
    expect(sayVisible('eat', cycle * 0.3, false)).toBe(true);
    // 抬起头之后
    expect(sayVisible('eat', cycle * 0.85, false)).toBe(false);
  });

  it('时相与渲染层是同一个来源 - 抄一份比例过去迟早会有一边忘了改', () => {
    // 恰好在窗口的两端上
    expect(sayVisible('eat', cycle * EAT_CYCLE.downFrom, false)).toBe(true);
    expect(sayVisible('eat', cycle * EAT_CYCLE.downTo, false)).toBe(false);
  });

  it('下一个周期还会再冒 - 它是「隔几秒一次」', () => {
    expect(sayVisible('eat', cycle * 1.3, false)).toBe(true);
    expect(sayVisible('eat', cycle * 2.3, false)).toBe(true);
  });

  it('回归气泡在的时候让位 - 两者位置重合，那个是可点的入口', () => {
    expect(sayVisible('eat', cycle * 0.3, true)).toBe(false);
  });
});

describe('画在哪', () => {
  const MI = { eyeOpen: 1, earFlickL: 0, earFlickR: 0, tilt: 0 };
  /** 吃饭低头段中间那一帧里，某只猫头中心的列位。 */
  const headOf = (breed: 'orange' | 'black' | 'ragdoll' | 'amshort' | 'devon', dir: 1 | -1): number => {
    const cat = makeCat(breed, 20260728);
    const pose = ACTIONS.eat.make(EAT_CYCLE.seconds * 0.4, cat, MI);
    return headColumn(cat, pose, dir);
  };
  const HEAD = headOf('orange', 1);
  it('在猫头顶之上，整块都在精灵缓冲之外', () => {
    const r = saySpriteRect(EAT_SAY_SPRITE, HEAD, 1, 0);
    expect(r.y1).toBeLessThanOrEqual(SAY_BASE_SPRITE_Y);
    expect(r.y0).toBeLessThan(0);
  });

  it('朝猫头那一侧偏，两个朝向偏的方向相反', () => {
    const right = saySpriteRect(EAT_SAY_SPRITE, HEAD, 1, 0);
    const left = saySpriteRect(EAT_SAY_SPRITE, headOf('orange', -1), -1, 0);
    expect(right.x0).toBeGreaterThan(left.x0);
  });

  it('尾巴尖对着猫头的那一列，每个品种都对得上', () => {
    // 头的列位由渲染层的 headColumn 给（与 drawStand 同一个表达式），
    // 气泡这边不拍偏移量 - 头的位置取决于品种体宽，拍死会在瘦品种上偏三四个精灵像素，
    // 而那种偏差只有盯着看才发现。
    for (const breed of ['orange', 'black', 'ragdoll', 'amshort', 'devon'] as const) {
      for (const dir of [1, -1] as const) {
        const headX = headOf(breed, dir);
        const r = saySpriteRect(EAT_SAY_SPRITE, headX, dir, 0);
        const tip = r.x0 + EAT_SAY_SPRITE.tipX;
        expect(
          Math.abs(tip - headX),
          `${breed} 朝向 ${dir} 时尾尖偏了 ${(tip - headX).toFixed(1)} 像素`,
        ).toBeLessThanOrEqual(2);
      }
    }
  });

  it('对照组：体宽差别最大的两个品种，气泡位置真的不同 - 否则上面那条是恒真', () => {
    const thin = saySpriteRect(EAT_SAY_SPRITE, headOf('devon', 1), 1, 0);
    const wide = saySpriteRect(EAT_SAY_SPRITE, headOf('amshort', 1), 1, 0);
    expect(thin.x0).not.toBe(wide.x0);
  });

  it('气泡主体在猫的上方可见范围内 - 不是整块飘到画面外', () => {
    for (const dir of [1, -1] as const) {
      const r = saySpriteRect(EAT_SAY_SPRITE, headOf('orange', dir), dir, 0);
      expect(r.x1).toBeGreaterThan(0);
      expect(r.x0).toBeLessThan(SPRITE_W);
    }
  });

  it('浮动偏移是整数 - 小数会让整块贴图重采样', () => {
    for (let t = 0; t < 4; t += 0.07) {
      expect(Number.isInteger(sayBob(t))).toBe(true);
      expect(sayBob(t)).toBeGreaterThanOrEqual(0);
      expect(sayBob(t)).toBeLessThanOrEqual(1);
    }
  });

  it('浮动真的在动，不是恒定值', () => {
    const seen = new Set<number>();
    for (let t = 0; t < 4; t += 0.05) seen.add(sayBob(t));
    expect(seen.size).toBe(2);
  });

  it('换算扣掉了舞台原点与精灵高度 - 猫走到哪气泡跟到哪', () => {
    const r = saySpriteRect(EAT_SAY_SPRITE, HEAD, 1, 0);
    const a = sayStageRect(r, 0, 3, 240);
    const b = sayStageRect(r, 120, 3, 240);
    expect(b.x - a.x).toBe(120);
    expect(a.h).toBe((r.y1 - r.y0) * 3);
    // 舞台高度变了，气泡跟着贴底 - 与猫的贴底方式一致
    const taller = sayStageRect(r, 0, 3, 300);
    expect(taller.y - a.y).toBe(60);
  });

  it('精灵高度参与换算 - 否则气泡会落在猫身上', () => {
    const r = saySpriteRect(EAT_SAY_SPRITE, HEAD, 1, 0);
    const box = sayStageRect(r, 0, 3, 240);
    // 气泡底边应当在「舞台底 - (精灵高 - 基线) × 缩放」附近
    expect(box.y + box.h).toBe(240 - (SPRITE_H - r.y1) * 3);
  });
});
