import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { notifyIfSick, sicknessNotice } from '../../src/app/notify.js';
import type { SystemNotice } from '../../src/app/notify.js';
import { NEED_MAX, step } from '../../src/world/index.js';
import type { World, WorldEvent, WorldEventKind } from '../../src/world/index.js';
import { TICK, kinds, makeWorld, runTicks } from '../world/helpers.js';

/**
 * 系统通知。
 *
 * 验收项只有一条，但它是**两个方向**的断言：生病要发，饿了不能发。
 * 后者更容易在实现里被顺手破坏（「顺便也提醒一下饿了吧」），所以这里
 * 拿真实跑出来的事件序列去测，而不是手搓一个 events 数组。
 */

const ev = (kind: WorldEventKind): WorldEvent => ({ kind, at: 0, important: true });

function sickWorld(patch: Partial<World> = {}): World {
  return makeWorld({
    hour: 10,
    patch: { sick: true, sickHours: 2, needs: { hunger: 0, energy: 50, mood: 25 }, ...patch },
  });
}

describe('生病这一级发通知', () => {
  it('刚生病的那一步发一条，带上名字与还剩多久', () => {
    const notice = sicknessNotice([ev('fellSick')], sickWorld({ sickHours: 0 }));
    expect(notice).not.toBeNull();
    expect(notice!.title).toContain('小猫');
    expect(notice!.body).toMatch(/48\s*小时/);
  });

  it('文案里不出现感叹号 - 通知的语气也是产品气质', () => {
    const notice = sicknessNotice([ev('fellSick')], sickWorld())!;
    expect(`${notice.title}${notice.body}`).not.toMatch(/[!！]/);
  });

  it('已经病了好几步、但这一步没有 fellSick 的话不重复发', () => {
    expect(sicknessNotice([], sickWorld({ sickHours: 20 }))).toBeNull();
  });

  it('带着一只病猫启动（没有新事件）不弹通知 - 用户就在屏幕前', () => {
    const launched = step(sickWorld({ sickHours: 20 }), 0);
    expect(sicknessNotice(launched.events, launched.world)).toBeNull();
  });

  it('同一步里生病又被治好（大跨步补算）不发 - 那只猫已经好了', () => {
    const cured = sickWorld({ sick: false, sickHours: 0, weakHours: 6 });
    expect(sicknessNotice([ev('fellSick'), ev('cured')], cured)).toBeNull();
  });

  it('补算跨过整条死亡链时不发「快喂药」，那时该弹的是告别页', () => {
    const dead = sickWorld({ dead: true, diedAt: 1 });
    expect(sicknessNotice([ev('fellSick'), ev('died')], dead)).toBeNull();
  });
});

describe('饿了不发通知', () => {
  it('从满格饿到生病这一整段里，只有生病那一步发出通知', () => {
    const start = makeWorld({ hour: 9, patch: { needs: { hunger: NEED_MAX, energy: 70, mood: 65 } } });
    const run = runTicks(start, 2 * 48 + 40);

    const notices: SystemNotice[] = [];
    for (const s of run.steps) {
      const notice = sicknessNotice(s.events, s.world);
      if (notice) notices.push(notice);
    }

    // 对照组：这一段里确实出现过「饿了」与「在挨饿」两级，也确实病了一次。
    const seq = kinds(run.events);
    expect(seq).toContain('hungry');
    expect(seq).toContain('starving');
    expect(seq).toContain('fellSick');
    // 通知只有一条，且是生病那一条。
    expect(notices).toHaveLength(1);
    expect(notices[0]!.title).toContain('生病');
  });

  it('只是饿了、还没到生病的那些步一律不发', () => {
    for (const hunger of [40, 20, 5, 0]) {
      const r = step(makeWorld({ hour: 10, patch: { needs: { hunger, energy: 60, mood: 50 } } }), TICK);
      expect(sicknessNotice(r.events, r.world)).toBeNull();
    }
  });
});

describe('平台侧接上了', () => {
  // 手法同 test/adopt/window.test.ts：这几条事实全在 Rust 侧，而漏掉任何一条
  // 都只表现为「通知没弹出来」，且要等一只猫真的病一次才看得见。
  const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');
  const libRs = read('../../src-tauri/src/lib.rs');

  it('通知插件注册进了 Builder - 漏了它 notify 命令会在运行期失败', () => {
    expect(libRs).toContain('tauri_plugin_notification::init()');
  });

  it('notify 命令注册进了 invoke_handler', () => {
    expect(libRs).toContain('notify::notify');
  });
});

describe('投递', () => {
  it('有通知就交给端口，没有就一次都不调', async () => {
    const sent: SystemNotice[] = [];
    const ports = {
      notify: async (n: SystemNotice): Promise<void> => {
        sent.push(n);
      },
    };
    await notifyIfSick([ev('fellSick')], sickWorld(), ports);
    expect(sent).toHaveLength(1);

    await notifyIfSick([ev('hungry')], sickWorld(), ports);
    expect(sent).toHaveLength(1);
  });
});
