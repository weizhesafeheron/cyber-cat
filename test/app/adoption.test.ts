import { describe, expect, it } from 'vitest';
import { ensureWorld, requestAdoption } from '../../src/app/adoption.js';
import type { AdoptionGate } from '../../src/app/adoption.js';
import type { AdoptedIdentity } from '../../src/adopt/identity.js';
import { makeCat, makeMicro } from '../../src/render/index.js';
import { createWorld, parseWorld, serializeWorld } from '../../src/world/index.js';
import type { World } from '../../src/world/index.js';

/**
 * 启动时的分岔：**有存档就接着养，没有存档才去领养。**
 *
 * 这一段以前是 main.ts 里写死的占位猫（PLACEHOLDER_SEED），现在是这个函数。
 * 做成注入端口的纯逻辑是必需的：它同时决定「首次启动是否进领养」「猫的身份怎么
 * 落到存档里」两件事，而两件都不该靠启动一次真机来验。
 */

const IDENTITY: AdoptedIdentity = { breed: 'aby', seed: 7654321, name: '阿比' };
const NOW = 1_800_000_000_000;
const TZ = 480;

interface Recorder {
  readonly gate: AdoptionGate;
  readonly calls: string[];
  readonly saved: World[];
}

function recorder(saved: World | null, identity = IDENTITY): Recorder {
  const calls: string[] = [];
  const written: World[] = [];
  return {
    calls,
    saved: written,
    gate: {
      loadWorld: async () => {
        calls.push('load');
        return saved;
      },
      adopt: async () => {
        calls.push('adopt');
        return identity;
      },
      saveWorld: async (w) => {
        calls.push('save');
        written.push(w);
      },
      now: () => NOW,
      tzOffsetMinutes: () => TZ,
    },
  };
}

const existing = (): World =>
  createWorld({ breed: 'orange', seed: 999, name: '老橘', bornAt: 1000, tzOffsetMinutes: 60 });

describe('有存档时不打扰用户', () => {
  it('直接用存档里的猫，不打开领养窗口', async () => {
    const r = recorder(existing());
    const world = await ensureWorld(r.gate);
    expect(world.identity.name).toBe('老橘');
    expect(r.calls).toEqual(['load']);
  });

  it('不重写存档 - 读一次就跑起来，写盘留给帧循环的节流', async () => {
    const r = recorder(existing());
    await ensureWorld(r.gate);
    expect(r.saved).toHaveLength(0);
  });
});

describe('没有存档时进入领养', () => {
  it('打开领养窗口，用选定的猫建一个新世界并立刻存盘', async () => {
    const r = recorder(null);
    const world = await ensureWorld(r.gate);
    expect(r.calls).toEqual(['load', 'adopt', 'save']);
    expect(world.identity.breed).toBe(IDENTITY.breed);
    expect(world.identity.seed).toBe(IDENTITY.seed);
    expect(world.identity.name).toBe(IDENTITY.name);
    expect(r.saved).toEqual([world]);
  });

  it('出生时间与时区由平台层注入，世界层不读时钟', async () => {
    const r = recorder(null);
    const world = await ensureWorld(r.gate);
    expect(world.identity.bornAt).toBe(NOW);
    expect(world.clock).toBe(NOW);
    expect(world.tzOffsetMinutes).toBe(TZ);
  });

  it('领养这件事本身进了日记', async () => {
    const r = recorder(null);
    const world = await ensureWorld(r.gate);
    expect(world.diary.map((e) => e.kind)).toContain('adopted');
  });

  it('领养失败时可见地失败，不悄悄换一只猫顶上', async () => {
    // 这里最危险的实现是「领养出错就随便给一只」：用户会得到一只不是他选的猫，
    // 而且再也回不到领养流程（存档已经建好了）。
    const r = recorder(null);
    const gate: AdoptionGate = {
      ...r.gate,
      adopt: async () => {
        throw new Error('领养窗口被关掉了');
      },
    };
    await expect(ensureWorld(gate)).rejects.toThrow('领养窗口被关掉了');
    expect(r.saved).toHaveLength(0);
  });
});

describe('身份四元组的持久化', () => {
  it('存档里只有品种、Seed、出生时间、名字四项 - 外观与性格一项都不存', async () => {
    const r = recorder(null);
    const world = await ensureWorld(r.gate);
    expect(Object.keys(world.identity).sort()).toEqual(['bornAt', 'breed', 'name', 'seed']);
  });

  it('存档往返之后外观与性格完全一致', async () => {
    const r = recorder(null);
    const world = await ensureWorld(r.gate);
    const reloaded = parseWorld(serializeWorld(world));

    expect(reloaded.identity).toEqual(world.identity);
    // 「完全一致」的实际含义：由四元组重建出的猫逐字段相等，性格参数也在其中
    const before = makeCat(world.identity.breed, world.identity.seed);
    const after = makeCat(reloaded.identity.breed, reloaded.identity.seed);
    expect(after).toEqual(before);
    expect(after.personality).toEqual(before.personality);
    // 微动作的时序也由 Seed 决定，重启后眨眼节奏不该换成另一只猫的。
    // 只比时序字段：MicroState 里还带着一个闭包，函数只能按引用比。
    const timing = (seed: number): number[] => {
      const m = makeMicro(seed);
      return [m.blinkAt, m.earAt, m.tiltAt];
    };
    expect(timing(reloaded.identity.seed)).toEqual(timing(world.identity.seed));
  });

  it('领养出的猫与占位猫无关 - 品种与 Seed 都来自用户选的那只', async () => {
    // 回归保护：main.ts 里曾经写死 orange / 20260728 的占位猫（ticket 04）。
    const r = recorder(null, { breed: 'devon', seed: 424242, name: '小卷' });
    const world = await ensureWorld(r.gate);
    expect(world.identity.breed).not.toBe('orange');
    expect(world.identity.seed).not.toBe(20260728);
    expect(makeCat(world.identity.breed, world.identity.seed).breed).toBe('devon');
  });
});

describe('打开领养窗口的顺序', () => {
  it('先挂上等待，再开窗口', async () => {
    // 反过来会漏事件：窗口开得很快时用户可能在 listen 挂上之前就点完了。
    const calls: string[] = [];
    const id = await requestAdoption({
      waitForAdopted: async () => {
        calls.push('wait');
        return IDENTITY;
      },
      openAdoption: async () => {
        calls.push('open');
      },
    });
    expect(calls).toEqual(['wait', 'open']);
    expect(id).toEqual(IDENTITY);
  });

  it('开窗口失败时把错误抛出来，而不是永远等下去', async () => {
    await expect(
      requestAdoption({
        waitForAdopted: () => new Promise(() => {}),
        openAdoption: async () => {
          throw new Error('建窗口失败');
        },
      }),
    ).rejects.toThrow('建窗口失败');
  });
});
