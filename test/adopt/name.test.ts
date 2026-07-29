import { describe, expect, it } from 'vitest';
import { NAME_MAX_CHARS } from '../../src/adopt/constants.js';
import { normalizeName } from '../../src/adopt/name.js';

/**
 * 起名是整个应用里唯一一处用户自由输入，因此是系统边界，必须验证。
 *
 * 名字会进存档、进托盘文案、以后还要进日记，一个带控制字符或者两百字的名字会在
 * 很远的地方才暴露出来 - 那时已经查不回输入的这一刻了。
 */

/** 用 fromCharCode 构造控制字符，避免它以不可见字节的形式躺在源码里。 */
const CTRL = String.fromCharCode(1);

describe('名字规范化', () => {
  it('去掉首尾空白', () => {
    const r = normalizeName('  橘子  ');
    expect(r.ok && r.name).toBe('橘子');
  });

  it('中间的连续空白（含全角空格与制表符）压成一个空格', () => {
    const r = normalizeName('小　 \t橘');
    expect(r.ok && r.name).toBe('小 橘');
  });

  it('控制字符被剔除，而不是当成合法字符留在名字里', () => {
    const r = normalizeName(`橘${CTRL}子`);
    expect(r.ok && r.name).toBe('橘子');
  });

  it('空名字与纯空白都被拒绝', () => {
    for (const raw of ['', '   ', '　', '\n\t']) {
      const r = normalizeName(raw);
      expect(r.ok, `${JSON.stringify(raw)} 不该被接受`).toBe(false);
    }
  });

  it('只由控制字符组成的名字也被拒绝', () => {
    expect(normalizeName(CTRL + CTRL).ok).toBe(false);
  });

  it('零宽字符被剔除：一个「看起来非空」的空名字必须被拦住', () => {
    // 全是零宽空格的名字能通过任何非空检查，之后托盘里显示的是一只没名字的猫。
    const zeroWidth = '\u200b\u200c\ufeff';
    expect(normalizeName(zeroWidth).ok).toBe(false);
    const mixed = normalizeName(`小\u200b橘`);
    expect(mixed.ok && mixed.name).toBe('小橘');
  });

  it(`长度上限按码点算：${NAME_MAX_CHARS} 个字以内通过，超出被拒`, () => {
    expect(normalizeName('猫'.repeat(NAME_MAX_CHARS)).ok).toBe(true);
    expect(normalizeName('猫'.repeat(NAME_MAX_CHARS + 1)).ok).toBe(false);
  });

  it('emoji 按码点计一个字，不按 UTF-16 长度算两个', () => {
    // '🐱'.length === 2，若拿 length 判长度，上限会凭空少一半。
    const raw = '🐱'.repeat(NAME_MAX_CHARS);
    expect(raw.length).toBeGreaterThan(NAME_MAX_CHARS);
    expect(normalizeName(raw).ok, 'emoji 名字被 UTF-16 长度误判成超长').toBe(true);
  });

  it('被拒绝时给出可以直接显示给用户的理由', () => {
    const r = normalizeName('');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.length).toBeGreaterThan(0);
  });

  it('规范化是幂等的：已经合法的名字再过一遍不变', () => {
    const once = normalizeName(' 小 \t 黑 ');
    expect(once.ok).toBe(true);
    if (once.ok) {
      expect(once.name).toBe('小 黑');
      const twice = normalizeName(once.name);
      expect(twice.ok && twice.name).toBe(once.name);
    }
  });
});
