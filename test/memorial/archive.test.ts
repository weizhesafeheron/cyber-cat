import { describe, expect, it } from 'vitest';
import {
  MEMORIAL_MAX_CATS,
  MEMORIAL_SAVE_VERSION,
  emptyMemorial,
  enshrine,
  entryOf,
  latestEntry,
  lifespanDays,
  sameCat,
} from '../../src/memorial/index.js';
import type { MemorialEntry } from '../../src/memorial/index.js';
import type { World } from '../../src/world/index.js';
import { DAY, HOUR, makeWorld } from '../world/helpers.js';

/**
 * 入档这一步。
 *
 * 全是纯函数，所以这里能直接断言那两条真正要紧的性质：
 * **只有死了的猫进档案**，以及**同一只猫不会进两次**（重启会再走一遍入档）。
 */

function deadWorld(patch: Partial<World> = {}): World {
  const base = makeWorld({
    hour: 9,
    patch: { stats: { feedCount: 12, petCount: 40 } },
  });
  return { ...base, dead: true, diedAt: base.clock + 30 * DAY, ...patch };
}

describe('入档', () => {
  it('活着的猫不进档案 - 档案是「养过的猫」，不是当前这只', () => {
    const alive = makeWorld({ hour: 9 });
    expect(entryOf(alive)).toBeNull();
    expect(enshrine(emptyMemorial(), alive).cats).toHaveLength(0);
  });

  it('dead 为真但没有死亡时刻的世界也不进档案（存档被改坏的情况）', () => {
    expect(entryOf({ ...makeWorld({ hour: 9 }), dead: true, diedAt: null })).toBeNull();
  });

  it('死了的猫带着身份、生卒、陪伴记录与一生的日记进档案', () => {
    const world = deadWorld();
    const entry = entryOf(world);
    expect(entry).not.toBeNull();
    expect(entry!.identity).toEqual(world.identity);
    expect(entry!.diedAt).toBe(world.diedAt);
    expect(entry!.stats).toEqual({ feedCount: 12, petCount: 40 });
    expect(entry!.diary).toEqual(world.diary);
  });

  it('日记是快照，之后改 world 不会连带改档案里的那一份', () => {
    const world = deadWorld();
    const entry = entryOf(world)!;
    const before = entry.diary.length;
    world.diary.push({ kind: 'petted', at: world.clock, important: false });
    expect(entry.diary).toHaveLength(before);
  });

  it('同一只猫入档两次只留一条 - 每次启动都会再走一遍入档', () => {
    const world = deadWorld();
    const once = enshrine(emptyMemorial(), world);
    const twice = enshrine(once, world);
    expect(once.cats).toHaveLength(1);
    expect(twice.cats).toHaveLength(1);
    expect(twice).toEqual(once);
  });

  it('第二只猫死了之后档案里有两条，历任猫按离开顺序排', () => {
    const first = deadWorld();
    const second = {
      ...deadWorld({ diedAt: first.diedAt! + 60 * DAY }),
      identity: { ...first.identity, seed: first.identity.seed + 1, name: '第二只' },
    };
    const archive = enshrine(enshrine(emptyMemorial(), first), second);
    expect(archive.cats.map((c) => c.identity.name)).toEqual([first.identity.name, '第二只']);
    expect(latestEntry(archive)?.identity.name).toBe('第二只');
  });

  it('入档不改动传进来的那份档案（纯函数）', () => {
    const before = emptyMemorial();
    enshrine(before, deadWorld());
    expect(before.cats).toHaveLength(0);
  });

  it('超过上限时丢最早的那只，版本号保持不变', () => {
    let archive = emptyMemorial();
    const base = deadWorld();
    for (let i = 0; i < MEMORIAL_MAX_CATS + 3; i++) {
      archive = enshrine(archive, {
        ...base,
        identity: { ...base.identity, seed: 1000 + i, name: `猫${i}` },
        diedAt: base.diedAt! + i * DAY,
      });
    }
    expect(archive.cats).toHaveLength(MEMORIAL_MAX_CATS);
    expect(archive.cats[0]!.identity.name).toBe('猫3');
    expect(archive.version).toBe(MEMORIAL_SAVE_VERSION);
  });
});

describe('两条记录是不是同一只猫', () => {
  const entry = (seed: number, bornAt: number): MemorialEntry => ({
    identity: { breed: 'orange', seed, bornAt, name: '小猫' },
    diedAt: bornAt + DAY,
    stats: { feedCount: 0, petCount: 0 },
    diary: [],
  });

  it('身份四元组里的 Seed 与出生时间一致就是同一只', () => {
    expect(sameCat(entry(7, 100).identity, entry(7, 100).identity)).toBe(true);
  });

  it('同一个 Seed 但出生时间不同是两只猫 - 用户可能真的又领养了一只一样的', () => {
    expect(sameCat(entry(7, 100).identity, entry(7, 200).identity)).toBe(false);
  });

  it('不同 Seed 是两只猫', () => {
    expect(sameCat(entry(7, 100).identity, entry(8, 100).identity)).toBe(false);
  });
});

describe('陪伴天数', () => {
  it('按出生到离开算，不足一天算一天 - 告别页上「陪了你 0 天」说不过去', () => {
    const entry: MemorialEntry = {
      identity: { breed: 'black', seed: 3, bornAt: 0, name: '影子' },
      diedAt: 3 * HOUR,
      stats: { feedCount: 0, petCount: 0 },
      diary: [],
    };
    expect(lifespanDays(entry)).toBe(1);
  });

  it('三十天就是三十天', () => {
    const entry: MemorialEntry = {
      identity: { breed: 'black', seed: 3, bornAt: 0, name: '影子' },
      diedAt: 30 * DAY,
      stats: { feedCount: 0, petCount: 0 },
      diary: [],
    };
    expect(lifespanDays(entry)).toBe(30);
  });
});
