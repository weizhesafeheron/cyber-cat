import { describe, expect, it } from 'vitest';
import { FarewellHost } from '../../src/app/farewell.js';
import type { FarewellPorts } from '../../src/app/farewell.js';
import { emptyMemorial, enshrine } from '../../src/memorial/index.js';
import type { Memorial } from '../../src/memorial/index.js';
import type { World } from '../../src/world/index.js';
import { DAY, makeWorld } from '../world/helpers.js';

/**
 * 「猫死了之后怎么办」这段平台胶水。
 *
 * 只测时序与幂等，那是这一层唯一的内容：入档一次、告别页开一次、
 * 读坏了绝不覆盖。三条错了都只在真机上等一只猫死掉才看得见。
 */

interface Fake {
  ports: FarewellPorts;
  saved: Memorial[];
  opened: number;
  /** 让 loadMemorial 抛错，模拟一份坏掉的档案。 */
  breakLoad(): void;
  /** 让 saveMemorial 抛错。 */
  breakSave(): void;
  /** 让 openFarewell 抛错。 */
  breakOpen(): void;
}

function fake(initial: Memorial | null = null): Fake {
  let stored = initial;
  let loadFails = false;
  let saveFails = false;
  let openFails = false;
  const f: Fake = {
    saved: [],
    opened: 0,
    breakLoad: () => {
      loadFails = true;
    },
    breakSave: () => {
      saveFails = true;
    },
    breakOpen: () => {
      openFails = true;
    },
    ports: {
      loadMemorial: async () => {
        if (loadFails) throw new Error('档案坏了');
        return stored;
      },
      saveMemorial: async (archive) => {
        if (saveFails) throw new Error('磁盘满了');
        stored = archive;
        f.saved.push(archive);
      },
      openFarewell: async () => {
        if (openFails) throw new Error('建窗失败');
        f.opened++;
      },
    },
  };
  return f;
}

function deadWorld(patch: Partial<World> = {}): World {
  const base = makeWorld({ hour: 9, patch: { stats: { feedCount: 7, petCount: 20 } } });
  return { ...base, dead: true, diedAt: base.clock + 15 * DAY, ...patch };
}

describe('发现猫死了', () => {
  it('活着的时候什么都不做 - 每帧都会调到这里', async () => {
    const f = fake();
    const host = new FarewellHost(f.ports);
    expect(await host.observe(makeWorld({ hour: 9 }))).toBe(false);
    expect(f.saved).toHaveLength(0);
    expect(f.opened).toBe(0);
  });

  it('dead 为真但没有死亡时刻时不动作（存档被改坏的情况）', async () => {
    const f = fake();
    const host = new FarewellHost(f.ports);
    expect(await host.observe({ ...makeWorld({ hour: 9 }), dead: true, diedAt: null })).toBe(false);
    expect(f.opened).toBe(0);
  });

  it('死了就入档并开一次告别页', async () => {
    const f = fake();
    const host = new FarewellHost(f.ports);
    const world = deadWorld();
    expect(await host.observe(world)).toBe(true);
    expect(f.opened).toBe(1);
    expect(f.saved).toHaveLength(1);
    expect(f.saved[0]!.cats).toHaveLength(1);
    expect(f.saved[0]!.cats[0]!.stats).toEqual({ feedCount: 7, petCount: 20 });
  });

  it('之后每帧再调也只开过那一次窗，也不再写盘', async () => {
    const f = fake();
    const host = new FarewellHost(f.ports);
    const world = deadWorld();
    for (let i = 0; i < 50; i++) await host.observe(world);
    expect(f.opened).toBe(1);
    expect(f.saved).toHaveLength(1);
  });

  it('重启后再次发现同一只猫死了：告别页照开，但档案里不会多一条', async () => {
    const world = deadWorld();
    const already = enshrine(emptyMemorial(), world);
    const f = fake(already);
    const host = new FarewellHost(f.ports);

    expect(await host.observe(world)).toBe(true);
    expect(f.opened).toBe(1);
    expect(f.saved).toHaveLength(0);
  });

  it('领养了新猫之后，这一只死掉时会重新走一遍', async () => {
    const f = fake();
    const host = new FarewellHost(f.ports);
    const first = deadWorld();
    await host.observe(first);

    host.reset();
    const second = {
      ...first,
      identity: { ...first.identity, seed: first.identity.seed + 1, bornAt: first.diedAt!, name: '第二只' },
      diedAt: first.diedAt! + 20 * DAY,
    };
    expect(await host.observe(second)).toBe(true);
    expect(f.opened).toBe(2);
    expect(f.saved).toHaveLength(2);
    expect(f.saved[1]!.cats.map((c) => c.identity.name)).toEqual([first.identity.name, '第二只']);
  });
});

describe('三种失败都不能连带毁掉别的东西', () => {
  it('档案读坏了：不写盘（否则历任猫被一次覆盖），但告别页照开', async () => {
    const f = fake();
    f.breakLoad();
    const host = new FarewellHost(f.ports);
    await host.observe(deadWorld());
    expect(f.saved).toHaveLength(0);
    expect(f.opened).toBe(1);
  });

  it('档案写不进去：告别页照开 - 那是这只猫留给用户的最后一面', async () => {
    const f = fake();
    f.breakSave();
    const host = new FarewellHost(f.ports);
    await host.observe(deadWorld());
    expect(f.opened).toBe(1);
  });

  it('告别页开不出来：入档已经完成，不会抛到帧循环里', async () => {
    const f = fake();
    f.breakOpen();
    const host = new FarewellHost(f.ports);
    await expect(host.observe(deadWorld())).resolves.toBe(true);
    expect(f.saved).toHaveLength(1);
  });
});

describe('从托盘再打开告别页', () => {
  it('直接再开一次窗，不重复入档', async () => {
    const f = fake();
    const host = new FarewellHost(f.ports);
    await host.observe(deadWorld());
    await host.reopen();
    expect(f.opened).toBe(2);
    expect(f.saved).toHaveLength(1);
  });
});
