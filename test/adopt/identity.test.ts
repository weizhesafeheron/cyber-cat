import { describe, expect, it } from 'vitest';
import { SEED_SPACE } from '../../src/adopt/constants.js';
import { ADOPTED_EVENT, AdoptionPayloadError, parseAdopted } from '../../src/adopt/identity.js';

/**
 * 领养窗口交回来的身份是**跨窗口的输入**，因此是系统边界。
 *
 * 这份数据紧接着就会被 createWorld 写进存档，一个坏掉的 Seed（NaN、小数、字符串）
 * 会变成一只无法重建的猫：makeCat 会照着 NaN 生成一团东西，而下次启动读存档时
 * 得到的又是另一团。宁可在这里可见地失败。
 */

const GOOD = { breed: 'orange', seed: 20260729, name: '小橘' };

describe('事件名', () => {
  it('只用 Tauri 允许的字符', () => {
    // Tauri 的事件名只接受字母数字与 - / : _（tauri::event::is_event_name_valid），
    // 非法字符要到运行时 emit 那一刻才报错 - 而那一刻是首次启动的领养流程，
    // 表现为「点了「就叫这个」之后什么都没发生」。
    expect(ADOPTED_EVENT).toMatch(/^[\p{L}\p{N}\-/:_]+$/u);
  });
});

describe('身份载荷解析', () => {
  it('合法载荷原样通过', () => {
    const id = parseAdopted(GOOD);
    expect(id).toEqual(GOOD);
  });

  it('名字顺手规范化，避免两端各存一份写法', () => {
    expect(parseAdopted({ ...GOOD, name: '  小橘 ' }).name).toBe('小橘');
  });

  it('未知品种被拒', () => {
    expect(() => parseAdopted({ ...GOOD, breed: 'tiger' })).toThrow(AdoptionPayloadError);
  });

  it('Seed 必须是范围内的整数', () => {
    for (const seed of [1.5, NaN, Infinity, -1, SEED_SPACE, '123', null]) {
      expect(() => parseAdopted({ ...GOOD, seed }), `seed=${String(seed)} 不该被接受`).toThrow(
        AdoptionPayloadError,
      );
    }
  });

  it('名字缺失、非字符串或空白都被拒', () => {
    for (const name of [undefined, 42, '', '   ']) {
      expect(() => parseAdopted({ ...GOOD, name }), `name=${String(name)} 不该被接受`).toThrow(
        AdoptionPayloadError,
      );
    }
  });

  it('压根不是对象的载荷也被拒，而不是抛一个看不懂的 TypeError', () => {
    for (const raw of [null, undefined, 'orange', 7, []]) {
      expect(() => parseAdopted(raw)).toThrow(AdoptionPayloadError);
    }
  });

  it('多余字段被丢掉，不会带进存档', () => {
    const id = parseAdopted({ ...GOOD, personality: { active: 1 } });
    expect(Object.keys(id).sort()).toEqual(['breed', 'name', 'seed']);
  });
});
