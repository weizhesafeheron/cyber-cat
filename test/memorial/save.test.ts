import { describe, expect, it } from 'vitest';
import {
  MEMORIAL_SAVE_VERSION,
  MemorialSaveError,
  emptyMemorial,
  enshrine,
  parseMemorial,
  serializeMemorial,
} from '../../src/memorial/index.js';
import { DAY, makeWorld } from '../world/helpers.js';

/**
 * 档案存档的编解码。
 *
 * 与 world/save.ts、props/save.ts 同一条纪律：解析是系统边界，逐字段验证。
 * 这份文件比另外两份更要紧一点 - 里面的猫都死了，坏掉就再也演化不回来。
 */

function archiveWithOneCat(): ReturnType<typeof enshrine> {
  const base = makeWorld({ hour: 9, patch: { stats: { feedCount: 5, petCount: 9 } } });
  return enshrine(emptyMemorial(), {
    ...base,
    dead: true,
    diedAt: base.clock + 20 * DAY,
  });
}

describe('档案存档往返', () => {
  it('一整份档案序列化再解析回来完全相同', () => {
    const archive = archiveWithOneCat();
    expect(parseMemorial(serializeMemorial(archive))).toEqual(archive);
  });

  it('空档案也能往返 - 第一次写盘时就是它', () => {
    expect(parseMemorial(serializeMemorial(emptyMemorial()))).toEqual(emptyMemorial());
  });

  it('日记条目原样保留，一条不少', () => {
    const archive = archiveWithOneCat();
    const back = parseMemorial(serializeMemorial(archive));
    expect(back.cats[0]!.diary).toEqual(archive.cats[0]!.diary);
  });

  it('多余字段被丢掉，不会顺着写回下一次的存档', () => {
    const archive = archiveWithOneCat();
    const raw = JSON.parse(serializeMemorial(archive)) as Record<string, unknown>;
    (raw['cats'] as Record<string, unknown>[])[0]!['诡异字段'] = 1;
    raw['另一个诡异字段'] = 2;
    const back = parseMemorial(JSON.stringify(raw));
    expect(back).toEqual(archive);
  });
});

describe('坏掉的档案要可见地失败', () => {
  const bad: Array<[string, string]> = [
    ['不是 JSON', '{ 这不是 json'],
    ['顶层是数组', '[]'],
    ['缺 version', JSON.stringify({ cats: [] })],
    ['版本不对', JSON.stringify({ version: MEMORIAL_SAVE_VERSION + 1, cats: [] })],
    ['cats 不是数组', JSON.stringify({ version: MEMORIAL_SAVE_VERSION, cats: {} })],
    [
      '品种是编造的',
      JSON.stringify({
        version: MEMORIAL_SAVE_VERSION,
        cats: [
          {
            identity: { breed: '不存在的猫', seed: 1, bornAt: 0, name: 'x' },
            diedAt: 1,
            stats: { feedCount: 0, petCount: 0 },
            diary: [],
          },
        ],
      }),
    ],
    [
      'diedAt 是 null（活着的猫不该在档案里）',
      JSON.stringify({
        version: MEMORIAL_SAVE_VERSION,
        cats: [
          {
            identity: { breed: 'orange', seed: 1, bornAt: 0, name: 'x' },
            diedAt: null,
            stats: { feedCount: 0, petCount: 0 },
            diary: [],
          },
        ],
      }),
    ],
    [
      '日记条目缺时刻',
      JSON.stringify({
        version: MEMORIAL_SAVE_VERSION,
        cats: [
          {
            identity: { breed: 'orange', seed: 1, bornAt: 0, name: 'x' },
            diedAt: 1,
            stats: { feedCount: 0, petCount: 0 },
            diary: [{ kind: 'ate', important: false }],
          },
        ],
      }),
    ],
  ];

  for (const [what, text] of bad) {
    it(`${what} → 抛 MemorialSaveError`, () => {
      expect(() => parseMemorial(text)).toThrow(MemorialSaveError);
    });
  }
});
