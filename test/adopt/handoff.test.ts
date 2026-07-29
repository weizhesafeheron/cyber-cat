import { describe, expect, it } from 'vitest';
import { handOff } from '../../src/adopt/handoff.js';
import type { AdoptedIdentity } from '../../src/adopt/identity.js';

/**
 * 交接：领养窗口把选定的猫交回宠物窗口，然后自己关掉。
 *
 * 顺序与失败处理是这里唯一的内容，但两者都很容易搞错，而且错了只在真机上
 * 表现为「领养完之后什么都没有发生」，从现象反推很痛苦。
 */

const IDENTITY: AdoptedIdentity = { breed: 'cow', seed: 12345, name: '小奶牛' };

describe('交接顺序', () => {
  it('先交回身份，再关窗口', () => {
    const calls: string[] = [];
    return handOff(IDENTITY, {
      announce: async () => {
        calls.push('announce');
      },
      close: async () => {
        calls.push('close');
      },
    }).then(() => {
      // 反过来的话窗口在事件送达之前就没了，宠物窗口会一直等一只永远不来的猫
      expect(calls).toEqual(['announce', 'close']);
    });
  });

  it('交回的就是选定的那只猫', async () => {
    let got: AdoptedIdentity | null = null;
    await handOff(IDENTITY, {
      announce: async (id) => {
        got = id;
      },
      close: async () => {},
    });
    expect(got).toEqual(IDENTITY);
  });
});

describe('交接失败', () => {
  it('交回失败时不关窗口，错误往外抛', async () => {
    // 关掉窗口就再没有第二次机会了：宠物窗口还是隐藏的，用户面对的是一个
    // 什么都没有的桌面。留着窗口至少还能重试。
    let closed = false;
    await expect(
      handOff(IDENTITY, {
        announce: async () => {
          throw new Error('IPC 挂了');
        },
        close: async () => {
          closed = true;
        },
      }),
    ).rejects.toThrow('IPC 挂了');
    expect(closed).toBe(false);
  });

  it('关窗口失败不算领养失败 - 身份已经交回去了', async () => {
    await expect(
      handOff(IDENTITY, {
        announce: async () => {},
        close: async () => {
          throw new Error('关不掉');
        },
      }),
    ).resolves.toBeUndefined();
  });
});
