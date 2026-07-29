import { describe, expect, it } from 'vitest';
import {
  PROPS_SAVE_VERSION,
  PropsSaveError,
  parseProps,
  serializeProps,
} from '../../src/props/index.js';
import type { PropsState } from '../../src/props/index.js';

/**
 * 挂件摆放的存档。
 *
 * 「位置持久化」这条验收标准在这一层是可以直接断言的：往返一次必须一模一样。
 * 解析是系统边界，所以坏输入的每一种都要有明确的失败，不能带着一个 NaN 坐标
 * 去调窗口移动 - 那会让挂件消失在一个算不出来的位置上。
 *
 * **纵向不进存档。** y 是派生量（由地面线与贴图高度算出来），存进去就多了一份
 * 会过期的真相 - 早先连 y 一起存，往存档里写一个任意的 y，挂件就浮在半空，
 * 而猫仍然按地面线走过去吃饭。所以往返只保 x 与可见性，解析出来的 y 是占位的 0，
 * 由调用方走一遍 groundedPropsState 算回去。
 */

const SAMPLE: PropsState = {
  bowl: { x: 1304, y: 1044, visible: true },
  bed: { x: 404, y: 1050, visible: false },
};

/** 往返之后 y 一律是占位的 0，其余原样。 */
const grounded = (s: PropsState): PropsState => ({
  bowl: { ...s.bowl, y: 0 },
  bed: { ...s.bed, y: 0 },
});

describe('序列化往返', () => {
  it('往返一次，x 与可见性完全相同', () => {
    expect(parseProps(serializeProps(SAMPLE))).toEqual(grounded(SAMPLE));
  });

  it('纵向不进存档 - 存进去就多了一份会过期的真相', () => {
    const raw = JSON.parse(serializeProps(SAMPLE)) as Record<string, Record<string, unknown>>;
    expect(Object.keys(raw['bowl']!).sort()).toEqual(['visible', 'x']);
    expect(Object.keys(raw['bed']!).sort()).toEqual(['visible', 'x']);
  });

  it('往返两次仍然相同（不会每次多写点什么进去）', () => {
    const once = parseProps(serializeProps(SAMPLE));
    expect(serializeProps(once)).toBe(serializeProps(SAMPLE));
  });

  it('负坐标（左侧外接屏）与小数坐标都能原样回来', () => {
    const odd: PropsState = {
      bowl: { x: -1620.5, y: -12.25, visible: true },
      bed: { x: 0, y: 0, visible: true },
    };
    expect(parseProps(serializeProps(odd))).toEqual(grounded(odd));
  });

  it('存档里带着版本号 - 结构变了要能认出来', () => {
    const raw = JSON.parse(serializeProps(SAMPLE)) as { version: number };
    expect(raw.version).toBe(PROPS_SAVE_VERSION);
  });

  it('多余的字段被丢掉，不会顺着流进内存里的状态', () => {
    const text = JSON.stringify({
      version: PROPS_SAVE_VERSION,
      bowl: { ...SAMPLE.bowl, nonsense: 1 },
      bed: SAMPLE.bed,
      alsoNonsense: 'x',
    });
    const parsed = parseProps(text);
    expect(parsed).toEqual(grounded(SAMPLE));
    expect(Object.keys(parsed.bowl).sort()).toEqual(['visible', 'x', 'y']);
  });
});

describe('坏存档要可见地失败', () => {
  const bad = (text: string, why: string): void => {
    expect(() => parseProps(text), why).toThrow(PropsSaveError);
  };

  it('不是 JSON', () => bad('{不是 JSON', '应当报「不是合法 JSON」'));
  it('顶层是数组', () => bad('[]', '顶层必须是对象'));
  it('顶层是 null', () => bad('null', '顶层必须是对象'));

  it('版本不一致 - 不做迁移，退回默认摆放更便宜也更安全', () => {
    bad(JSON.stringify({ ...SAMPLE, version: PROPS_SAVE_VERSION + 1 }), '版本应当被拒');
  });

  it('少一个挂件', () => {
    bad(JSON.stringify({ version: PROPS_SAVE_VERSION, bowl: SAMPLE.bowl }), '缺 bed 应当报错');
  });

  it('坐标不是数值', () => {
    bad(
      JSON.stringify({ version: PROPS_SAVE_VERSION, bowl: { x: '1', y: 2, visible: true }, bed: SAMPLE.bed }),
      '字符串坐标应当被拒',
    );
  });

  it('坐标是 NaN 或 Infinity（JSON 里会变成 null）', () => {
    bad(
      JSON.stringify({ version: PROPS_SAVE_VERSION, bowl: { x: NaN, y: 2, visible: true }, bed: SAMPLE.bed }),
      'NaN 坐标应当被拒',
    );
    bad(
      JSON.stringify({ version: PROPS_SAVE_VERSION, bowl: { x: Infinity, visible: true }, bed: SAMPLE.bed }),
      'Infinity 坐标应当被拒',
    );
    // y 不再进存档，所以文件里的 y 是什么都不影响解析 - 它压根不被读。
    expect(() =>
      parseProps(
        JSON.stringify({
          version: PROPS_SAVE_VERSION,
          bowl: { x: 1, y: NaN, visible: true },
          bed: SAMPLE.bed,
        }),
      ),
    ).not.toThrow();
  });

  it('visible 不是布尔值', () => {
    bad(
      JSON.stringify({ version: PROPS_SAVE_VERSION, bowl: { x: 1, y: 2, visible: 1 }, bed: SAMPLE.bed }),
      '数字 1 不算 true',
    );
  });

  it('挂件是数组而不是对象', () => {
    bad(JSON.stringify({ version: PROPS_SAVE_VERSION, bowl: [], bed: SAMPLE.bed }), '数组应当被拒');
  });

  it('报错信息里点出是哪个字段 - 不然只能靠猜', () => {
    try {
      parseProps(JSON.stringify({ version: PROPS_SAVE_VERSION, bowl: SAMPLE.bowl, bed: {} }));
      throw new Error('本应抛出');
    } catch (err) {
      expect(err).toBeInstanceOf(PropsSaveError);
      expect((err as Error).message).toContain('bed');
    }
  });
});
