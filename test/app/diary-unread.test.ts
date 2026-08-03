import { describe, expect, it } from 'vitest';
import { diaryAdvanced, newestDiaryAt } from '../../src/app/diary-unread.js';

describe('猫咪日记未读判定', () => {
  it('没有新日志时不亮', () => {
    expect(diaryAdvanced(null, [])).toBe(false);
    expect(diaryAdvanced(200, [{ at: 100 }, { at: 200 }])).toBe(false);
  });

  it('最后一条日志变新时亮起', () => {
    expect(diaryAdvanced(null, [{ at: 100 }])).toBe(true);
    expect(diaryAdvanced(100, [{ at: 100 }, { at: 300 }])).toBe(true);
  });

  it('即使日记达到上限、长度不变，仍按最后时间识别新增', () => {
    const before = Array.from({ length: 400 }, (_, i) => ({ at: i + 1 }));
    const after = [...before.slice(1), { at: 401 }];
    expect(before).toHaveLength(after.length);
    expect(diaryAdvanced(newestDiaryAt(before), after)).toBe(true);
  });
});
