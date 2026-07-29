import { describe, expect, it } from 'vitest';
import { DEFAULT_HIT_CONFIG, ZERO_VELOCITY } from '../../src/app/hit.js';
import type { CursorSample, HitFrame, Velocity } from '../../src/app/hit.js';
import { PollingPassthrough } from '../../src/app/passthrough.js';
import type { CursorSource } from '../../src/app/passthrough.js';
import { ACTIONS, CatRenderer, H, W, makeCat } from '../../src/render/index.js';
import { centersAtDistance, frameOf, maskCenters } from './masks.js';

/**
 * 穿透控制器的对外行为：什么时候真的向 Rust 下发状态。
 *
 * 关心的是「下发了几次、下发的是什么」- 每帧一次 IPC 会把 Rust 侧的调用队列排满，
 * 而漏发一次意味着窗口卡在错误的状态上。
 */

const renderer = new CatRenderer();
const MI = { eyeOpen: 1, earFlickL: 0, earFlickR: 0, tilt: 0 };
const CFG = DEFAULT_HIT_CONFIG;

const cat = makeCat('orange', 20260728);
const frame = frameOf(renderer.render(cat, ACTIONS.sit.make(0, cat, MI)));
const onCat = maskCenters(frame)[0]!;
const farAway = centersAtDistance(frame, CFG.baseMargin + CFG.exitExtra + 1, Infinity)[0]!;

class FakeCursor implements CursorSource {
  latest: CursorSample | null = null;
  velocity: Velocity = ZERO_VELOCITY;

  at(p: { x: number; y: number } | null, t: number): void {
    this.latest = p ? { x: p.x, y: p.y, t } : null;
  }
}

function harness(): {
  cursor: FakeCursor;
  applied: boolean[];
  ctl: PollingPassthrough;
  tick: (p: { x: number; y: number } | null, now: number) => void;
} {
  const cursor = new FakeCursor();
  const applied: boolean[] = [];
  const ctl = new PollingPassthrough(cursor, (on) => applied.push(on));
  return {
    cursor,
    applied,
    ctl,
    tick(p, now) {
      cursor.at(p, now);
      ctl.update(frame, now);
    },
  };
}

describe('穿透状态的下发', () => {
  it('初始就是穿透，且不重复下发 - Rust 侧创建窗口时已经设成穿透', () => {
    const h = harness();
    expect(h.ctl.passThrough).toBe(true);
    for (let i = 0; i < 10; i++) h.tick(farAway, i * 16);
    expect(h.applied).toEqual([]);
  });

  it('光标压到猫身上时下发一次「不穿透」，之后不重复下发', () => {
    const h = harness();
    for (let i = 0; i < 20; i++) h.tick(onCat, i * 16);
    expect(h.applied).toEqual([false]);
    expect(h.ctl.passThrough).toBe(false);
  });

  it('光标离开并等过退出延迟后下发「穿透」', () => {
    const h = harness();
    h.tick(onCat, 0);
    expect(h.applied).toEqual([false]);

    // 退出延迟内不下发
    for (let now = 16; now < CFG.leaveDelayMs; now += 16) h.tick(farAway, now);
    expect(h.applied).toEqual([false]);

    h.tick(farAway, 16 + CFG.leaveDelayMs);
    expect(h.applied).toEqual([false, true]);
    expect(h.ctl.passThrough).toBe(true);
  });

  it('光标位置未知时回到穿透 - 探测失败不该让窗口卡在截获状态', () => {
    const h = harness();
    h.tick(onCat, 0);
    expect(h.ctl.passThrough).toBe(false);
    for (let now = 16; now <= 16 + CFG.leaveDelayMs; now += 16) h.tick(null, now);
    expect(h.ctl.passThrough).toBe(true);
    expect(h.applied).toEqual([false, true]);
  });

  it('一次往返只下发两次，不随帧数增长', () => {
    const h = harness();
    let now = 0;
    for (let i = 0; i < 60; i++, now += 16) h.tick(onCat, now);
    for (let i = 0; i < 60; i++, now += 16) h.tick(farAway, now);
    expect(h.applied).toEqual([false, true]);
  });

  it('用的是每次传进来的那一帧掩膜', () => {
    const cursor = new FakeCursor();
    const applied: boolean[] = [];
    const ctl = new PollingPassthrough(cursor, (on) => applied.push(on));
    const empty: HitFrame = { width: W, height: H, alphaMask: new Uint8Array(W * H) };

    cursor.at(onCat, 0);
    ctl.update(empty, 0); // 空掩膜（没有猫）：同一个位置也应当穿透
    expect(ctl.passThrough).toBe(true);
    ctl.update(frame, 16); // 换成真实掩膜：立刻改判
    expect(ctl.passThrough).toBe(false);
    expect(applied).toEqual([false]);
  });
});
