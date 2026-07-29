import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  POLL_MOVING_MS,
  POLL_STILL_MS,
  STILL_AFTER_MS,
  CursorTracker,
} from '../../src/app/cursor.js';

/**
 * 光标追踪的对外行为：采样频率、静止降频、探测失败后的失效方向。
 *
 * 频率不是可有可无的调优项 - 太慢会漏掉快速接近（点不到猫），
 * 太快会在猫静止不动时白烧电，而桌面宠物是常驻进程。
 */

/** 每 4 个精灵像素一个 CSS 像素，随便取的换算，只要固定就行。 */
const toSprite = (x: number, y: number): { x: number; y: number } => ({ x: x / 4, y: y / 4 });

describe('轮询节奏', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('光标移动时按一帧的节奏探测', async () => {
    let calls = 0;
    let px = 0;
    const tracker = new CursorTracker(
      async () => {
        calls++;
        px += 8; // 每次都在动
        return { x: px, y: 0 };
      },
      toSprite,
      () => Date.now(),
    );

    tracker.start();
    await vi.advanceTimersByTimeAsync(400);
    tracker.stop();

    // 400ms 内应当接近 400 / 16 次。放宽区间，只保证量级正确。
    expect(calls).toBeGreaterThan(400 / POLL_MOVING_MS - 4);
    expect(calls).toBeLessThan(400 / POLL_MOVING_MS + 4);
  });

  it('光标静止一段时间后降频', async () => {
    let calls = 0;
    const tracker = new CursorTracker(
      async () => {
        calls++;
        return { x: 40, y: 40 }; // 一直不动
      },
      toSprite,
      () => Date.now(),
    );

    tracker.start();
    // 先跑过静止判定阈值
    await vi.advanceTimersByTimeAsync(STILL_AFTER_MS + 100);
    const before = calls;
    await vi.advanceTimersByTimeAsync(1000);
    tracker.stop();

    const idleCalls = calls - before;
    expect(idleCalls).toBeGreaterThan(1000 / POLL_STILL_MS - 4);
    expect(idleCalls).toBeLessThan(1000 / POLL_STILL_MS + 4);
    // 降频必须是真的降了，而不是恰好等于移动时的频率
    expect(idleCalls).toBeLessThan(1000 / POLL_MOVING_MS / 2);
  });

  it('降频期间光标又动起来，立刻回到高频', async () => {
    let calls = 0;
    let moving = false;
    let px = 0;
    const tracker = new CursorTracker(
      async () => {
        calls++;
        if (moving) px += 8;
        return { x: px, y: 0 };
      },
      toSprite,
      () => Date.now(),
    );

    tracker.start();
    await vi.advanceTimersByTimeAsync(STILL_AFTER_MS + 200);
    moving = true;
    const before = calls;
    await vi.advanceTimersByTimeAsync(320);
    tracker.stop();

    const movingCalls = calls - before;
    // 第一次探测到位移之后就该回到 16ms 节奏
    expect(movingCalls).toBeGreaterThan(320 / POLL_MOVING_MS / 2);
  });

  it('stop 之后不再探测', async () => {
    let calls = 0;
    const tracker = new CursorTracker(async () => {
      calls++;
      return { x: 0, y: 0 };
    }, toSprite);

    tracker.start();
    await vi.advanceTimersByTimeAsync(100);
    tracker.stop();
    const after = calls;
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toBe(after);
  });
});

describe('采样内容', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('位置换算成精灵坐标，速度由相邻采样算出', async () => {
    let px = 0;
    const tracker = new CursorTracker(
      async () => {
        const p = { x: px, y: 0 };
        px += 64; // 每次 64 CSS 像素 = 16 精灵像素
        return p;
      },
      toSprite,
      () => Date.now(),
    );

    tracker.start();
    await vi.advanceTimersByTimeAsync(100);
    tracker.stop();

    expect(tracker.latest).not.toBeNull();
    // 16 精灵像素 / 16ms = 1000 精灵像素每秒
    expect(tracker.velocity.speed).toBeGreaterThan(500);
    expect(tracker.velocity.vx).toBeGreaterThan(0);
    expect(tracker.velocity.vy).toBe(0);
  });

  it('探测返回位置未知时清掉采样，不留旧位置', async () => {
    let known = true;
    const tracker = new CursorTracker(
      async () => (known ? { x: 40, y: 40 } : null),
      toSprite,
      () => Date.now(),
    );

    tracker.start();
    await vi.advanceTimersByTimeAsync(50);
    expect(tracker.latest).not.toBeNull();

    known = false;
    await vi.advanceTimersByTimeAsync(50);
    tracker.stop();
    // 拿失效前的位置继续判定会让窗口停在错误的状态上
    expect(tracker.latest).toBeNull();
    expect(tracker.velocity.speed).toBe(0);
  });

  it('探测抛错时位置变为未知，并退避而不是原速重试', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    let calls = 0;
    let failing = false;
    const tracker = new CursorTracker(
      async () => {
        calls++;
        if (failing) throw new Error('boom');
        return { x: 40, y: 40 };
      },
      toSprite,
      () => Date.now(),
    );

    tracker.start();
    await vi.advanceTimersByTimeAsync(50);
    failing = true;
    await vi.advanceTimersByTimeAsync(50);
    const before = calls;
    await vi.advanceTimersByTimeAsync(500);
    tracker.stop();

    expect(tracker.latest).toBeNull();
    expect(calls - before, '失败后仍在原速重试').toBeLessThan(3);
    // 只报第一次，不刷屏
    expect(err.mock.calls.length).toBe(1);
    err.mockRestore();
  });

  it('DOM 事件也能供样，穿透关闭时不必等下一次轮询', () => {
    const tracker = new CursorTracker(async () => null, toSprite, () => Date.now());
    tracker.observe(80, 40);
    expect(tracker.latest).toEqual({ x: 20, y: 10, t: expect.any(Number) });
  });
});
