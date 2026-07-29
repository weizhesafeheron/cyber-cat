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
    expect(s.sick).toBe(true);
    expect(s.summary).toMatch(/36\s*小时/);
  });

  it('没生病时喂药项应当是灰的', () => {
    const w = world();
    expect(trayStatus(w, statusOf(w)).sick).toBe(false);
  });

  it('碗里有粮会写出来 - 喂过之后用户要能确认', () => {
    const w = world({ bowl: 2, needs: { hunger: 80, energy: 70, mood: 60 } });
    expect(trayStatus(w, statusOf(w)).summary).toContain('碗里有粮');
  });
});
