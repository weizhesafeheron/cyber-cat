import { describe, expect, it } from 'vitest';
import { requestAnotherCat } from '../../src/farewell/handoff.js';

/**
 * 「再养一只」的交接顺序。
 *
 * 与 test/adopt/handoff.test.ts 同一条理由：这里唯一的内容就是顺序与失败方向，
 * 而两者错了都只表现为「点了按钮什么都没发生」。
 */

describe('先报一声，再关窗', () => {
  it('顺序是 announce → close', async () => {
    const calls: string[] = [];
    await requestAnotherCat({
      announce: async () => {
        calls.push('announce');
      },
      close: async () => {
        calls.push('close');
      },
    });
    expect(calls).toEqual(['announce', 'close']);
  });

  it('报不出去就不关窗，并把错误抛出去让用户能重试', async () => {
    let closed = false;
    await expect(
      requestAnotherCat({
        announce: async () => {
          throw new Error('事件总线不通');
        },
        close: async () => {
          closed = true;
        },
      }),
    ).rejects.toThrow('事件总线不通');
    expect(closed).toBe(false);
  });

  it('关窗失败不算失败 - 领养已经开始了', async () => {
    await expect(
      requestAnotherCat({
        announce: async () => undefined,
        close: async () => {
          throw new Error('关不掉');
        },
      }),
    ).resolves.toBeUndefined();
  });
});
