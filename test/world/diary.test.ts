import { describe, expect, it } from 'vitest';
import {
  DIARY_MAX_ENTRIES,
  DIARY_MAX_PER_DAY,
  localDayIndex,
  step,
} from '../../src/world/index.js';
import type { WorldEvent } from '../../src/world/index.js';
import { TICK, feedEvery, kinds, makeWorld, runTicks } from './helpers.js';

/**
 * 猫咪日记的两条产品约束（mvp-scope 与 CONTEXT.md）：
 * 重要事件一定会出现，日常事件不会啰嗦到每天几十条。
 */

describe('重要事件必然进日记', () => {
  /**
   * 把当天的日记额度先打满，再让重要事件发生。
   * 这是唯一能真正验证「不受上限约束」的构造 - 正常跑一遍的话额度没满，
   * 事件本来就会进去，测不到豁免。
   */
  function saturatedDiaryWorld(): ReturnType<typeof makeWorld> {
    const w = makeWorld({
      hour: 10,
      patch: {
        needs: { hunger: 0, energy: 60, mood: 40 },
        starveHours: 23.5,
      },
    });
    return { ...w, diaryDay: localDayIndex(w.clock, w.tzOffsetMinutes), diaryCount: 9999 };
  }

  it('日记额度打满后，生病照样记下来', () => {
    const r = step(saturatedDiaryWorld(), TICK);
    expect(r.world.sick).toBe(true);
    expect(kinds(r.events)).toContain('fellSick');
    expect(r.world.diary.map((e) => e.kind)).toContain('fellSick');
  });

  it('对照组：同样的额度下，日常事件被挡掉了', () => {
    // 换一只不会生病的猫，同样把额度打满，此时日常事件必须消失。
    const w = makeWorld({ hour: 10 });
    const saturated = {
      ...w,
      diaryDay: localDayIndex(w.clock, w.tzOffsetMinutes),
      diaryCount: 9999,
      bowl: 2,
      needs: { hunger: 30, energy: 80, mood: 60 },
    };
    const r = step(saturated, TICK);
    expect(kinds(r.events)).not.toContain('ate');
  });

  it('死亡也一样不受上限约束', () => {
    const w = makeWorld({
      hour: 10,
      patch: { needs: { hunger: 0, energy: 60, mood: 20 }, sick: true, sickHours: 47.5 },
    });
    const saturated = { ...w, diaryDay: localDayIndex(w.clock, w.tzOffsetMinutes), diaryCount: 9999 };
    const r = step(saturated, TICK);
    expect(r.world.dead).toBe(true);
    expect(kinds(r.events)).toContain('died');
  });

  it('跨过午夜后额度重置', () => {
    const w = makeWorld({ hour: 23 });
    const saturated = { ...w, diaryDay: localDayIndex(w.clock, w.tzOffsetMinutes), diaryCount: 9999 };
    const after = runTicks(saturated, 6);
    // 进入第二天以后又能记日常事件了。
    expect(after.world.diaryCount).toBeLessThan(9999);
  });
});

describe('日常事件条数克制', () => {
  const run = runTicks(makeWorld({ hour: 0 }), 8 * 48, feedEvery(8));

  it('每天的日常条目都不超过上限', () => {
    const perDay = new Map<number, number>();
    for (const e of run.world.diary) {
      if (e.important) continue;
      const day = localDayIndex(e.at, 0);
      perDay.set(day, (perDay.get(day) ?? 0) + 1);
    }
    expect(perDay.size).toBeGreaterThan(5);
    for (const [, count] of perDay) {
      expect(count).toBeLessThanOrEqual(DIARY_MAX_PER_DAY);
      // 产品约束本身：不会啰嗦到每天几十条。上面的常量再怎么调也不能破这条。
      expect(count).toBeLessThan(20);
    }
  });

  it('但也不是空的 - 每天都有几条可读的内容', () => {
    const perDay = new Map<number, number>();
    for (const e of run.world.diary) {
      const day = localDayIndex(e.at, 0);
      perDay.set(day, (perDay.get(day) ?? 0) + 1);
    }
    for (const [, count] of perDay) expect(count).toBeGreaterThan(0);
  });

  it('用户自己的动作不进日记（猫咪日记记的是猫做了什么）', () => {
    const r = step(makeWorld({ hour: 18 }), 0, {
      actions: [{ type: 'fillBowl' }, { type: 'pet' }],
    });
    // 事件仍然发出来 - 应用层要用它做即时反馈。
    expect(kinds(r.events)).toEqual(['fedByOwner', 'petted']);
    // 但日记里只有猫自己的事。
    expect(r.world.diary.map((e) => e.kind)).not.toContain('fedByOwner');
    expect(r.world.diary.map((e) => e.kind)).not.toContain('petted');
  });
});

describe('日记不会无限膨胀', () => {
  it('超过上限后丢最早的条目', () => {
    const w = makeWorld({ hour: 8 });
    const filler: WorldEvent[] = Array.from({ length: DIARY_MAX_ENTRIES }, (_, i) => ({
      kind: 'gazedOutWindow',
      at: w.clock - (DIARY_MAX_ENTRIES - i) * 1000,
      important: false,
    }));
    const stuffed = { ...w, diary: filler, bowl: 2, needs: { hunger: 30, energy: 80, mood: 60 } };

    const after = runTicks(stuffed, 8).world;
    expect(after.diary.length).toBe(DIARY_MAX_ENTRIES);
    // 新条目在尾部，最早的已经被挤掉。
    expect(after.diary.at(-1)!.at).toBeGreaterThan(w.clock);
    expect(after.diary[0]!.at).toBeGreaterThan(filler[0]!.at);
  });
});

describe('事件与日记的一致性', () => {
  it('每一步返回的事件都是日记尾部那几条（不存在只发不记的日常事件）', () => {
    let world = makeWorld({ hour: 0 });
    const feed = feedEvery(8);
    for (let i = 0; i < 4 * 48; i++) {
      const r = step(world, TICK, feed(i));
      const diaryWorthy = r.events.filter(
        (e) => !['fedByOwner', 'petted', 'petRefused', 'medicated'].includes(e.kind),
      );
      const tail = r.world.diary.slice(r.world.diary.length - diaryWorthy.length);
      expect(tail).toEqual(diaryWorthy);
      world = r.world;
    }
  });
});
