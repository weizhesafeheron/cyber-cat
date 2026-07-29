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
 */

const SAMPLE: PropsState = {
  bowl: { x: 1304, y: 1044, visible: true },
  bed: { x: 404, y: 1050, visible: false },
};

describe('序列化往返', () => {
  it('往返一次完全相同', () => {
    expect(parseProps(serializeProps(SAMPLE))).toEqual(SAMPLE);
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
    expect(parseProps(serializeProps(odd))).toEqual(odd);
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
    expect(parsed).toEqual(SAMPLE);
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
      JSON.stringify({ version: PROPS_SAVE_VERSION, bowl: { x: 1, y: Infinity, visible: true }, bed: SAMPLE.bed }),
      'Infinity 坐标应当被拒',
    );
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
