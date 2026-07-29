import { describe, expect, it } from 'vitest';
import type { ActionKey } from '../../src/render/index.js';
import {
  ACTIVITY_HOLD_BEATS,
  BEATS_PER_TICK,
  BEAT_MS,
  TICK_MS,
  step,
} from '../../src/world/index.js';
import type { World } from '../../src/world/index.js';
import { BEAT, DAY, HOUR, TICK, kinds, makeWorld } from './helpers.js';

/**
 * 行为节拍。「猫在做什么」的粒度，与需求演化的模拟步长解耦。
 *
 * 为什么要有这一层：最初选动作写在 30 分钟的模拟步里，真机上看到的是一只
 * 趴着一动不动整整半小时的猫 - 读起来就是张静止的贴图，完全谈不上「它自己
 * 在生活」。拆开之后姿势按 15 秒换，需求仍然按 30 分钟演化。
 *
 * 这个文件守两件事：
 * - 行为变活了（换得勤，但不像节拍器）；
 * - **行为怎么调都不会动到已定档的数值**。后者靠两条独立随机流实现，
 *   是这里最重要的一条断言 - 它一破，调一个持续时长区间就会悄悄改变
 *   死亡链的取数序列，而没有任何一处报错。
 */

/** 逐拍推进，收集每一拍猫在做什么。 */
function activities(world: World, beats: number): ActionKey[] {
  const seen: ActionKey[] = [];
  let w = world;
  for (let i = 0; i < beats; i++) {
    w = step(w, BEAT).world;
    seen.push(w.activity);
  }
  return seen;
}

/** 把动作序列压成「动作 + 连续拍数」的段落。 */
function runs(seq: ActionKey[]): { action: ActionKey; beats: number }[] {
  const out: { action: ActionKey; beats: number }[] = [];
  for (const a of seq) {
    const last = out[out.length - 1];
    if (last && last.action === a) last.beats += 1;
    else out.push({ action: a, beats: 1 });
  }
  return out;
}

describe('节拍与模拟步的关系', () => {
  it('节拍整除模拟步 - 否则模拟步长会漂移，定档的 88 小时死亡链就不准了', () => {
    expect(TICK_MS % BEAT_MS).toBe(0);
    expect(BEATS_PER_TICK).toBe(TICK_MS / BEAT_MS);
    expect(Number.isInteger(BEATS_PER_TICK)).toBe(true);
  });

  it('半小时里需求只演化一次，不因为多了 120 个节拍而多掉', () => {
    const start = makeWorld({ hour: 8, patch: { bowl: 0 } });
    // 一次给满半小时，与逐拍走完半小时，需求必须一致（等价性的节拍版本）。
    const bulk = step(start, TICK).world;
    let stepwise = start;
    for (let i = 0; i < BEATS_PER_TICK; i++) stepwise = step(stepwise, BEAT).world;
    expect(stepwise.needs).toEqual(bulk.needs);
    // 而且真的只掉了一步的量，不是 120 步。
    const perTick = start.needs.hunger - bulk.needs.hunger;
    expect(perTick).toBeGreaterThan(0);
    expect(perTick).toBeLessThan(4);
  });

  it('模拟步的相位记在 beatsInTick 里，跨存档不丢', () => {
    const start = makeWorld({ hour: 8 });
    // 走 119 拍：差一拍到整步，需求还没动。
    let w = start;
    for (let i = 0; i < BEATS_PER_TICK - 1; i++) w = step(w, BEAT).world;
    expect(w.beatsInTick).toBe(BEATS_PER_TICK - 1);
    expect(w.needs.hunger).toBe(start.needs.hunger);
    // 序列化往返之后再走一拍，需求应当正好在这一拍演化。
    const revived = JSON.parse(JSON.stringify(w)) as World;
    const next = step(revived, BEAT).world;
    expect(next.beatsInTick).toBe(0);
    expect(next.needs.hunger).toBeLessThan(start.needs.hunger);
  });
});

describe('两条随机流互不影响', () => {
  it('只换行为流：需求、日记、生死序列一个字节都不变', () => {
    const base = makeWorld({ hour: 9, patch: { bowl: 2 } });
    // 只动行为流的种子，需求那条流的初值保持一致。
    const twin: World = {
      ...base,
      activityRngState: (base.activityRngState ^ 0x51ed270b) | 0,
    };

    const a = step(base, 7 * DAY);
    const b = step(twin, 7 * DAY);

    expect(b.world.needs).toEqual(a.world.needs);
    expect(b.world.rngState).toBe(a.world.rngState);
    expect(b.world.sleeping).toBe(a.world.sleeping);
    expect(b.world.sick).toBe(a.world.sick);
    expect(b.world.dead).toBe(a.world.dead);
    expect(b.world.diedAt).toBe(a.world.diedAt);
    expect(kinds(b.events)).toEqual(kinds(a.events));
    expect(b.world.diary).toEqual(a.world.diary);
    // 七天不喂必然走完死亡链，也就是说上面比的不是一段平淡的日常。
    expect(kinds(a.events)).toContain('died');
  });

  it('对照组：行为流确实在起作用（证明上一条不是恒真）', () => {
    const base = makeWorld({ hour: 17, patch: { bowl: 3 } });
    const twin: World = {
      ...base,
      activityRngState: (base.activityRngState ^ 0x51ed270b) | 0,
    };
    expect(activities(base, 240)).not.toEqual(activities(twin, 240));
  });
});

describe('十分钟里的行为读起来是自主的', () => {
  // 黄昏时段，醒着的概率高。挑一只活跃的猫。
  const dusk = () => makeWorld({ hour: 17, breed: 'cow', seed: 20260729, patch: { bowl: 2 } });

  it('十分钟里换过好几种动作，而不是一件事做到底', () => {
    const seq = activities(dusk(), (10 * 60_000) / BEAT_MS);
    expect(new Set(seq).size).toBeGreaterThanOrEqual(3);
    expect(runs(seq).length).toBeGreaterThanOrEqual(5);
  });

  it('但也不是节拍器：动作段落长短不一，且有明显长于一拍的段落', () => {
    const seq = activities(dusk(), (30 * 60_000) / BEAT_MS);
    const lens = runs(seq).map((r) => r.beats);
    expect(Math.max(...lens)).toBeGreaterThan(2);
    // 长短不一 - 段落长度不止一种取值。
    expect(new Set(lens).size).toBeGreaterThan(1);
  });

  it('每个动作至少持续到 ACTIVITY_HOLD_BEATS 给的下界', () => {
    // 只守下界。上界守不住也不该守：相邻两次抽签抽到同一个动作会合成一段更长的
    // 段落（猫多理了会儿毛），那是正常结果，不是缺陷。
    const seq = activities(dusk(), (6 * HOUR) / BEAT_MS);
    const segments = runs(seq);
    let checked = 0;
    segments.forEach((seg, i) => {
      // 首尾被观察窗口截断，长度不足是正常的。
      if (i === 0 || i === segments.length - 1) return;
      // 睡眠是持续状态，时长由作息决定而不由这张表决定；
      // 紧邻睡眠的段落会被「说睡就睡」拦腰截断，同样不参与判定。
      if (seg.action === 'sleep') return;
      if (segments[i - 1]?.action === 'sleep' || segments[i + 1]?.action === 'sleep') return;
      const [min] = ACTIVITY_HOLD_BEATS[seg.action];
      expect(seg.beats, `${seg.action} 只持续了 ${seg.beats} 拍`).toBeGreaterThanOrEqual(min);
      checked += 1;
    });
    expect(checked).toBeGreaterThan(10);
  });
});

describe('持续状态压过节拍', () => {
  it('睡着的每一拍都在睡，节拍不会把它叫起来换姿势', () => {
    const asleep = makeWorld({
      hour: 2,
      patch: { sleeping: true, needs: { hunger: 80, energy: 30, mood: 60 } },
    });
    // 精力低于 ENERGY_CAN_WAKE，深夜也不会自己醒。
    const seq = activities(asleep, BEATS_PER_TICK);
    expect(new Set(seq)).toEqual(new Set(['sleep']));
  });

  it('生病的每一拍都趴着', () => {
    const ill = makeWorld({ hour: 14, patch: { sick: true, sickHours: 1 } });
    const seq = activities(ill, BEATS_PER_TICK);
    expect(new Set(seq)).toEqual(new Set(['lie']));
  });

  it('睡着期间持续计数一直是 0 - 这才使得醒来那一拍能立刻重选动作', () => {
    // 不清零的话，猫会醒着却继续播睡觉的姿势，直到上一段时长走完。
    const asleep = makeWorld({
      hour: 2,
      patch: { sleeping: true, needs: { hunger: 80, energy: 30, mood: 60 } },
    });
    let w = asleep;
    for (let i = 0; i < BEATS_PER_TICK; i++) {
      w = step(w, BEAT).world;
      expect(w.activityBeatsLeft).toBe(0);
    }
  });

  it('猫死后节拍不再推进任何东西', () => {
    const dying = makeWorld({ hour: 9 });
    const dead = step(dying, 5 * DAY).world;
    expect(dead.dead).toBe(true);
    const later = step(dead, HOUR).world;
    expect(later.activity).toBe(dead.activity);
    expect(later.activityRngState).toBe(dead.activityRngState);
    expect(later.needs).toEqual(dead.needs);
    // 时钟继续走 - 告别页要知道现在几点。
    expect(later.clock).toBeGreaterThan(dead.clock);
  });
});

describe('刚发生的事优先于抽签', () => {
  it('刚吃完那一拍就在吃，而不是等下一次抽签', () => {
    // 饿到会吃、碗里有粮，把世界推到进食发生的那个整步。
    const hungry = makeWorld({
      hour: 17,
      patch: { bowl: 2, needs: { hunger: 10, energy: 80, mood: 60 } },
    });
    let w = hungry;
    let ate = false;
    for (let i = 0; i < 4 && !ate; i++) {
      const r = step(w, TICK);
      w = r.world;
      ate = kinds(r.events).some((k) => k === 'ate' || k === 'ateGreedy');
    }
    expect(ate).toBe(true);
    expect(w.activity).toBe('eat');
  });

  it('刚醒来那一拍在伸懒腰', () => {
    // 精力充足 + 黄昏（节律压力低）→ 很快会醒，醒的那一步应当伸懒腰。
    let w = makeWorld({
      hour: 17,
      patch: { sleeping: true, needs: { hunger: 70, energy: 95, mood: 60 } },
    });
    let woke = false;
    for (let i = 0; i < 20 && !woke; i++) {
      const r = step(w, TICK);
      w = r.world;
      woke = kinds(r.events).includes('woke') || (!w.sleeping && w.activity === 'stretch');
    }
    expect(woke).toBe(true);
    expect(w.sleeping).toBe(false);
    expect(w.activity).toBe('stretch');
  });
});
