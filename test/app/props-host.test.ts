import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PropsHost } from '../../src/app/props.js';
import type { PropsPorts } from '../../src/app/props.js';
import type { StageGeometry } from '../../src/app/motion.js';
import { STAGE_H, STAGE_W } from '../../src/app/stage.js';
import {
  PROP_EVENT_CLICKED,
  PROP_EVENT_MOVED,
  PROP_EVENT_READY,
  PROP_KINDS,
} from '../../src/props/index.js';
import type { PropKind, PropsState } from '../../src/props/index.js';

/**
 * 挂件宿主：什么时候该给挂件窗口下发什么。
 *
 * 这个文件是补的。这一层原先没有任何测试，因为它直接 import 了平台模块 -
 * 而它做的事全是「跨进程下发」，真机之外看不见。代价是一个 bug 一路溜到真机：
 * 首次摆放时把另一个挂件误标成「已下发」，于是**猫窝永远不显示**，
 * 窗口建出来了却停在默认位置、`visible` 一直是 false，并且没有任何报错。
 *
 * 改成注入端口之后，那类「漏发一次跨进程调用」的 bug 就变成可断言的了。
 */

const DESKTOP = { x: 0, y: 0, w: 1920, h: 1080 } as const;
const GEOM: StageGeometry = { w: STAGE_W, h: STAGE_H, spriteScale: 3, work: DESKTOP };

interface Placed {
  kind: PropKind;
  x: number;
  y: number;
  visible: boolean;
}

function ports(saved: PropsState | null = null) {
  const placed: Placed[] = [];
  const menu: [boolean, boolean][] = [];
  const emitted: { label: string; name: string; payload: unknown }[] = [];
  const saves: PropsState[] = [];
  const handlers = new Map<string, (payload: unknown) => void>();

  const p: PropsPorts = {
    loadProps: () => Promise.resolve(saved),
    saveProps: (state) => {
      saves.push(state);
      return Promise.resolve();
    },
    placeProp: (kind, x, y, visible) => {
      placed.push({ kind, x, y, visible });
      return Promise.resolve();
    },
    pushPropMenu: (bowlVisible, bedVisible) => {
      menu.push([bowlVisible, bedVisible]);
      return Promise.resolve();
    },
    emitToWindow: (label, name, payload) => {
      emitted.push({ label, name, payload });
      return Promise.resolve();
    },
    listenEvent: <T>(name: string, handler: (payload: T) => void) => {
      handlers.set(name, handler as (payload: unknown) => void);
      return Promise.resolve();
    },
  };
  return { p, placed, menu, emitted, saves, handlers };
}

describe('首次摆放', () => {
  it('两个挂件都必须各被下发一次，而且都是可见的', async () => {
    // 这就是那个溜到真机的 bug：只有食盆被下发，猫窝被去重跳过。
    const io = ports();
    await new PropsHost(GEOM, io.p).boot(GEOM);

    expect(io.placed.map((x) => x.kind).sort()).toEqual([...PROP_KINDS].sort());
    for (const kind of PROP_KINDS) {
      const call = io.placed.find((x) => x.kind === kind);
      expect(call, `${kind} 一次都没下发`).toBeDefined();
      expect(call?.visible, `${kind} 下发时不可见`).toBe(true);
    }
  });

  it('两个挂件落在不同的位置上，不会摆成一叠', async () => {
    const io = ports();
    await new PropsHost(GEOM, io.p).boot(GEOM);
    const [a, b] = io.placed;
    expect(a?.x).not.toBe(b?.x);
  });

  it('两个挂件窗口都会收到一次视图状态 - 那是它们停止重试报到的唯一回音', async () => {
    const io = ports();
    await new PropsHost(GEOM, io.p).boot(GEOM);
    const labels = io.emitted.map((e) => e.label);
    expect(new Set(labels).size).toBe(PROP_KINDS.length);
  });

  it('托盘的勾选状态跟着对齐一次', async () => {
    const io = ports();
    await new PropsHost(GEOM, io.p).boot(GEOM);
    expect(io.menu).toEqual([[true, true]]);
  });
});

describe('去重只跳过真的没变的那一个', () => {
  it('位置没变时不重复下发（跨进程调用，白发是浪费）', async () => {
    const io = ports();
    const host = new PropsHost(GEOM, io.p);
    await host.boot(GEOM);
    const after = io.placed.length;
    // 工作区没变，reclamp 不该产生任何下发
    host.reclamp(GEOM);
    await Promise.resolve();
    expect(io.placed.length).toBe(after);
  });

  it('挂件窗口重新报到时强制补发，即使位置没变', async () => {
    const io = ports();
    const host = new PropsHost(GEOM, io.p);
    host.listen(() => undefined);
    await host.boot(GEOM);
    const before = io.placed.length;

    io.handlers.get(PROP_EVENT_READY)?.('bed');
    await Promise.resolve();
    await Promise.resolve();

    const added = io.placed.slice(before);
    expect(added.some((x) => x.kind === 'bed')).toBe(true);
  });

  it('读档之前报到一律不摆 - 那时的兜底几何会把挂件摆到屏幕上方', async () => {
    // 真机上撞到的：领养流程停在那里等用户挑猫，而挂件窗口一加载就报到，
    // 于是按「宠物窗口自己的客户区当桌面」那份兜底值摆了出来，落在屏幕上方
    // 一个既没有地面也没有猫的位置，并且持续整个领养过程。
    const io = ports();
    const host = new PropsHost(GEOM, io.p);
    host.listen(() => undefined);

    // 还没 boot：两个挂件都抢先报到
    io.handlers.get(PROP_EVENT_READY)?.('bowl');
    io.handlers.get(PROP_EVENT_READY)?.('bed');
    await Promise.resolve();
    await Promise.resolve();
    expect(io.placed, '读档之前就把挂件摆出去了').toHaveLength(0);

    // boot 之后自己会把两件都摆一遍，不需要报到那条路补发
    await host.boot(GEOM);
    expect(io.placed.map((x) => x.kind).sort()).toEqual([...PROP_KINDS].sort());
  });

  it('切换可见性会真的下发一次', async () => {
    const io = ports();
    const host = new PropsHost(GEOM, io.p);
    await host.boot(GEOM);
    const before = io.placed.length;

    await host.toggle('bowl');

    const added = io.placed.slice(before);
    expect(added).toHaveLength(1);
    expect(added[0]?.kind).toBe('bowl');
    expect(added[0]?.visible).toBe(false);
    expect(io.menu.at(-1)).toEqual([false, true]);
  });
});

describe('读档', () => {
  it('存档里的位置会被钳进工作区 - 上次可能摆在外接屏上', async () => {
    const far: PropsState = {
      bowl: { x: 5000, y: 4000, visible: true },
      bed: { x: -800, y: -600, visible: true },
    };
    const io = ports(far);
    const host = new PropsHost(GEOM, io.p);
    await host.boot(GEOM);

    for (const kind of PROP_KINDS) {
      const p = host.placements[kind];
      expect(p.x, `${kind} 的 x 在工作区外`).toBeGreaterThanOrEqual(DESKTOP.x);
      expect(p.x).toBeLessThan(DESKTOP.x + DESKTOP.w);
      expect(p.y, `${kind} 的 y 在工作区外`).toBeGreaterThanOrEqual(DESKTOP.y);
      expect(p.y).toBeLessThan(DESKTOP.y + DESKTOP.h);
    }
  });

  it('存档里的隐藏状态要还原，并且反映到托盘勾选上', async () => {
    const hidden: PropsState = {
      bowl: { x: 100, y: 900, visible: false },
      bed: { x: 400, y: 900, visible: true },
    };
    const io = ports(hidden);
    await new PropsHost(GEOM, io.p).boot(GEOM);
    expect(io.placed.find((x) => x.kind === 'bowl')?.visible).toBe(false);
    expect(io.menu).toEqual([[false, true]]);
  });
});

describe('读档完成前不接受挂件报上来的位置', () => {
  it('那时挂件还停在 Tauri 的默认位置，当成用户摆放会把存档覆盖掉', async () => {
    const saved: PropsState = {
      bowl: { x: 123, y: 900, visible: true },
      bed: { x: 456, y: 900, visible: true },
    };
    const io = ports(saved);
    const host = new PropsHost(GEOM, io.p);
    host.listen(() => undefined);

    // 还没 boot：挂件抢先报了一个「屏幕正中」的位置
    io.handlers.get(PROP_EVENT_MOVED)?.({ kind: 'bowl', x: 960, y: 540 });
    expect(host.placements.bowl.x).not.toBe(960);

    await host.boot(GEOM);
    expect(host.placements.bowl.x).toBe(123);
  });
});

describe('点食盆是邀请，不是喂食', () => {
  it('点食盆只触发一次回调，点猫窝什么都不做', async () => {
    const io = ports();
    const host = new PropsHost(GEOM, io.p);
    const onFeed = vi.fn();
    host.listen(onFeed);
    await host.boot(GEOM);

    io.handlers.get(PROP_EVENT_CLICKED)?.('bed');
    expect(onFeed).not.toHaveBeenCalled();
    io.handlers.get(PROP_EVENT_CLICKED)?.('bowl');
    expect(onFeed).toHaveBeenCalledTimes(1);
  });
});

describe('写盘节流', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    return () => vi.useRealTimers();
  });

  it('连着挪几下只写一次盘，写的是最后那个位置', async () => {
    const io = ports();
    const host = new PropsHost(GEOM, io.p);
    host.listen(() => undefined);
    await host.boot(GEOM);

    for (const x of [200, 300, 400]) {
      io.handlers.get(PROP_EVENT_MOVED)?.({ kind: 'bowl', x, y: 900 });
    }
    expect(io.saves).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(2000);
    expect(io.saves).toHaveLength(1);
    expect(io.saves[0]?.bowl.x).toBe(400);
  });
});
