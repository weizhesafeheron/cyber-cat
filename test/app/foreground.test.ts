import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FOREGROUND_POLL_ACTIVE_MS,
  FOREGROUND_POLL_BACKOFF_MS,
  FOREGROUND_POLL_IDLE_MS,
  ForegroundWatcher,
  foregroundPollMs,
} from '../../src/app/foreground.js';
import type { ForegroundPorts } from '../../src/app/foreground.js';
import type { ForegroundWindow } from '../../src/app/perch.js';

/**
 * 前台窗口的轮询（ticket 12）。
 *
 * 这一层是**注入端口才测得动**的典型：读窗口几何跨进程，真机之外完全看不见，
 * 而这里全部的逻辑都是「什么时候该问一次」。同一条经验在挂件那边付过代价 -
 * 那次没有端口注入，一个「首次摆放时把另一个挂件误标成已下发」的 bug 一路溜到真机，
 * 症状是猫窝永远不出现，而且没有任何报错（见 app/props.ts 的 PropsPorts）。
 */

const WIN: ForegroundWindow = { id: 1, pid: 2, x: 100, y: 200, w: 800, h: 400, scale: 1 };

/** 一个记账用的假端口。 */
function ports(result: () => Promise<ForegroundWindow | null> = async () => WIN): {
  ports: ForegroundPorts;
  calls: () => number;
} {
  let calls = 0;
  return {
    ports: {
      probe: () => {
        calls++;
        return result();
      },
    },
    calls: () => calls,
  };
}

/** 让所有已经 resolve 的 promise 落地。 */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('轮询频率', () => {
  it('猫在动时 10 Hz，静止时 2 Hz', () => {
    expect(foregroundPollMs(true, 0)).toBe(FOREGROUND_POLL_ACTIVE_MS);
    expect(foregroundPollMs(false, 0)).toBe(FOREGROUND_POLL_IDLE_MS);
    // 静止时必须真的更省：这条是「猫趴着不动时降频」那条验收项的落点。
    expect(FOREGROUND_POLL_IDLE_MS).toBeGreaterThan(FOREGROUND_POLL_ACTIVE_MS * 2);
  });

  it('连续失败之后退避，不再每帧重试', () => {
    expect(foregroundPollMs(true, 3)).toBe(FOREGROUND_POLL_BACKOFF_MS);
    expect(FOREGROUND_POLL_BACKOFF_MS).toBeGreaterThan(FOREGROUND_POLL_IDLE_MS);
  });
});

describe('ForegroundWatcher', () => {
  it('第一帧就问一次，之后按间隔节流', async () => {
    const p = ports();
    const w = new ForegroundWatcher(p.ports);
    w.poll(0, { active: true, hidden: false });
    await settle();
    expect(p.calls()).toBe(1);
    expect(w.window).toEqual(WIN);

    // 间隔没到：一帧一帧地问也不会真的发出去。
    for (let ms = 16; ms < FOREGROUND_POLL_ACTIVE_MS; ms += 16) {
      w.poll(ms, { active: true, hidden: false });
    }
    await settle();
    expect(p.calls()).toBe(1);

    // 到点了才问第二次。
    w.poll(FOREGROUND_POLL_ACTIVE_MS, { active: true, hidden: false });
    await settle();
    expect(p.calls()).toBe(2);
  });

  it('猫静止时问得更少（对照组：同一段时间里猫在动）', async () => {
    const countOver = async (active: boolean): Promise<number> => {
      const p = ports();
      const w = new ForegroundWatcher(p.ports);
      for (let ms = 0; ms <= 2000; ms += 16) {
        w.poll(ms, { active, hidden: false });
        await settle();
      }
      return p.calls();
    };
    const busy = await countOver(true);
    const still = await countOver(false);
    expect(busy).toBeGreaterThan(still * 2);
  });

  it('窗口不可见（锁屏、被完全遮挡）时完全不问，并且丢掉旧读数', async () => {
    const p = ports();
    const w = new ForegroundWatcher(p.ports);
    w.poll(0, { active: true, hidden: false });
    await settle();
    expect(w.window).not.toBeNull();

    for (let ms = 1000; ms <= 5000; ms += 100) {
      w.poll(ms, { active: true, hidden: true });
    }
    await settle();
    expect(p.calls()).toBe(1);
    // 读数一起丢掉：醒来之后那个矩形很可能已经过期，宁可让猫回到地面重新来。
    expect(w.window).toBeNull();
  });

  it('同一时刻只有一次在飞，不会积压', async () => {
    let release: (v: ForegroundWindow | null) => void = () => undefined;
    const p = ports(
      () =>
        new Promise<ForegroundWindow | null>((r) => {
          release = r;
        }),
    );
    const w = new ForegroundWatcher(p.ports);
    w.poll(0, { active: true, hidden: false });
    // 上一次还没回来，之后每一帧都不该再发。
    for (let ms = 200; ms <= 2000; ms += 100) {
      w.poll(ms, { active: true, hidden: false });
    }
    await settle();
    expect(p.calls()).toBe(1);
    release(WIN);
    await settle();
    // 落地之后才恢复正常节奏。
    w.poll(3000, { active: true, hidden: false });
    await settle();
    expect(p.calls()).toBe(2);
  });

  describe('读不到窗口', () => {
    beforeEach(() => {
      // 失败会打日志，那是有意的（前几次），但不要污染测试输出。
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('失败时读数变成 null（猫会跳下来），并且退避重试', async () => {
      const p = ports(() => Promise.reject(new Error('命令没注册')));
      const w = new ForegroundWatcher(p.ports);
      let ms = 0;
      // 连着失败三次：每次都要等到间隔才重试。
      for (let i = 0; i < 3; i++) {
        w.poll(ms, { active: true, hidden: false });
        await settle();
        ms += FOREGROUND_POLL_ACTIVE_MS;
      }
      expect(p.calls()).toBe(3);
      expect(w.window).toBeNull();

      // 之后进入退避：按原来的间隔再问也不会发出去。
      w.poll(ms, { active: true, hidden: false });
      await settle();
      expect(p.calls()).toBe(3);
      w.poll(ms + FOREGROUND_POLL_BACKOFF_MS, { active: true, hidden: false });
      await settle();
      expect(p.calls()).toBe(4);
    });

    it('恢复之后回到正常节奏', async () => {
      let fail = true;
      const p = ports(() => (fail ? Promise.reject(new Error('临时错误')) : Promise.resolve(WIN)));
      const w = new ForegroundWatcher(p.ports);
      let ms = 0;
      for (let i = 0; i < 4; i++) {
        w.poll(ms, { active: true, hidden: false });
        await settle();
        ms += FOREGROUND_POLL_BACKOFF_MS;
      }
      fail = false;
      w.poll(ms, { active: true, hidden: false });
      await settle();
      expect(w.window).toEqual(WIN);
      const before = p.calls();
      // 已经恢复：不再退避。
      w.poll(ms + FOREGROUND_POLL_ACTIVE_MS, { active: true, hidden: false });
      await settle();
      expect(p.calls()).toBe(before + 1);
    });
  });
});
