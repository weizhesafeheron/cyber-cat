import { describe, expect, it } from 'vitest';
import { createWorld, statusOf } from '../../src/world/index.js';
import type { World } from '../../src/world/index.js';
import { trayStatus } from '../../src/app/status.js';

/**
 * 托盘上的状态显示。
 *
 * 「不打开任何界面就知道猫大致怎么样了」是产品要求（mvp-scope 3.4），
 * 所以这段文案值得测：四条需求必须都在，且总体那一行要能区分不同状态。
 * 测的是文案里有没有该有的信息，不是文案本身长什么样。
 */

function world(patch: Partial<World> = {}): World {
  const base = createWorld({
    breed: 'orange',
    seed: 1,
    name: '小猫',
    bornAt: Date.UTC(2026, 6, 29, 8, 0, 0),
    tzOffsetMinutes: 0,
  });
  return { ...base, ...patch, needs: { ...base.needs, ...(patch.needs ?? {}) } };
}

describe('托盘状态', () => {
  it('四条需求都有各自的一行，数值以百分比呈现', () => {
    const w = world({ needs: { hunger: 82.4, energy: 61.5, mood: 70 }, bond: 33 });
    const s = trayStatus(w, statusOf(w));
    expect(s.hunger).toContain('饱食度');
    expect(s.hunger).toContain('82%');
    expect(s.energy).toContain('精力');
    expect(s.mood).toContain('心情');
    expect(s.bond).toContain('亲密度');
    expect(s.bond).toContain('33%');
  });

  it('总体那一行带上猫的名字，并区分不同状态', () => {
    const cases: Array<[Partial<World>, string]> = [
      [{ needs: { hunger: 80, energy: 70, mood: 60 } }, '状态不错'],
      [{ sleeping: true, needs: { hunger: 80, energy: 40, mood: 60 } }, '睡着'],
      [{ needs: { hunger: 10, energy: 70, mood: 60 } }, '饿'],
      [{ needs: { hunger: 0, energy: 70, mood: 60 }, starveHours: 6 }, '挨饿'],
      [{ sick: true, sickHours: 12, needs: { hunger: 40, energy: 50, mood: 30 } }, '生病'],
      [{ dead: true, diedAt: Date.UTC(2026, 6, 31, 8, 0, 0) }, '离开'],
    ];
    const seen = new Set<string>();
    for (const [patch, keyword] of cases) {
      const w = world(patch);
      const line = trayStatus(w, statusOf(w)).summary;
      expect(line).toContain('小猫');
      expect(line).toContain(keyword);
      seen.add(line);
    }
    // 对照组：六种状态给出六句不同的话，没有两个状态说同一句。
    expect(seen.size).toBe(cases.length);
  });

  it('生病时报剩余时间，喂药项才有理由亮起来', () => {
    const w = world({ sick: true, sickHours: 12, needs: { hunger: 40, energy: 50, mood: 30 } });
    const s = trayStatus(w, statusOf(w));
    expect(s.medicate).toBe(true);
    expect(s.summary).toMatch(/36\s*小时/);
  });

  it('碗里有粮会写出来 - 喂过之后用户要能确认', () => {
    const w = world({ bowl: 2, needs: { hunger: 80, energy: 70, mood: 60 } });
    expect(trayStatus(w, statusOf(w)).summary).toContain('碗里有粮');
  });
});

/**
 * 喂药入口只在生病时出现（issue #13 的验收项）。
 *
 * 这条规则的落点有两处：Rust 侧建菜单时 `enabled = false`（托盘一起来就是灰的），
 * 以及这里算出来的 `medicate`。前者是一次性的初值，后者每 5 秒推一次 - 真正
 * 决定「什么时候亮」的是后者，所以断言放在这里。
 */
describe('喂药入口只在生病时可用', () => {
  const cases: Array<[string, Partial<World>, boolean]> = [
    ['状态不错', { needs: { hunger: 80, energy: 70, mood: 60 } }, false],
    ['只是饿了', { needs: { hunger: 10, energy: 70, mood: 60 } }, false],
    ['已经在挨饿', { needs: { hunger: 0, energy: 70, mood: 60 }, starveHours: 20 }, false],
    ['睡着了', { sleeping: true, needs: { hunger: 60, energy: 30, mood: 60 } }, false],
    ['生病了', { sick: true, sickHours: 6, needs: { hunger: 0, energy: 40, mood: 25 } }, true],
    ['病后虚弱', { weakHours: 4, needs: { hunger: 70, energy: 50, mood: 45 } }, false],
    // 死亡分支不清 sick（那是它的病历，档案还要用），所以这条是真的能出错。
    ['已经离开', { sick: true, dead: true, diedAt: Date.UTC(2026, 6, 31) }, false],
  ];

  for (const [what, patch, expected] of cases) {
    it(`${what} → ${expected ? '可用' : '灰的'}`, () => {
      const w = world(patch);
      expect(trayStatus(w, statusOf(w)).medicate).toBe(expected);
    });
  }
});

describe('告别与档案的入口只在猫离开后可用', () => {
  it('猫还活着时是灰的', () => {
    const w = world({ sick: true, sickHours: 6, needs: { hunger: 0, energy: 40, mood: 25 } });
    expect(trayStatus(w, statusOf(w)).memorial).toBe(false);
  });

  it('猫离开后可用 - 关掉告别页之后这是再打开它的唯一入口', () => {
    const w = world({ dead: true, diedAt: Date.UTC(2026, 6, 31, 8, 0, 0) });
    expect(trayStatus(w, statusOf(w)).memorial).toBe(true);
  });
});
