import { describe, expect, it } from 'vitest';
import { QUIET_ACTION, restrainedAction, restraint } from '../../src/app/restraint.js';
import { DEFAULT_SETTINGS, parseSettings, withQuiet } from '../../src/app/settings.js';
import { trayIconState } from '../../src/app/status.js';
import type { CatStatus } from '../../src/world/index.js';

/**
 * 两个全局兜底：安静模式与让开规则（issue #15）。
 *
 * 这一层全是纯函数，所以「安静模式下猫还会不会扑光标」是可断言的 -
 * 而如果把这三处判断散在 main.ts 的帧循环里各写一个 if，漏掉一处就没有任何测试
 * 碰得到，症状是「安静模式下猫偶尔还是会动」。
 */

describe('安静模式：猫在，但只趴着', () => {
  it('不响应光标、不爬窗口、不闲逛，但没有藏起来', () => {
    const r = restraint(true, false, false);
    expect(r.hidden).toBe(false);
    expect(r.tease).toBe(false);
    expect(r.perch).toBe(false);
    expect(r.roam).toBe(false);
  });

  it('压住的是玩与闲逛，不压住吃饭', () => {
    // 世界层的进食不要求猫真的走到碗边（那一步只是呈现），所以拦住走位不会让猫饿死，
    // 但会让画面变成「猫趴在屏幕另一头对着空气咀嚼」。
    expect(restraint(true, false, true).roam).toBe(true);
    // 去吃饭不等于可以顺便玩：另外两条仍然关着。
    expect(restraint(true, false, true).tease).toBe(false);
    expect(restraint(true, false, true).perch).toBe(false);
  });

  it('动作被改写成趴着，而不是睡着', () => {
    // 睡着是「猫睡着了」的读数，安静模式下猫是醒着的、只是被要求别闹。
    // 让它睡着会让托盘图标、日记与状态摘要一起撒谎。
    expect(QUIET_ACTION).toBe('lie');
    expect(restrainedAction('walk', false)).toBe('lie');
    expect(restrainedAction('groom', false)).toBe('lie');
    // 世界层没给动作时也要趴下 - null 的含义是「按运动层自己的节奏来」，
    // 而那正是会让猫走起来的那条路。
    expect(restrainedAction(null, false)).toBe('lie');
  });

  it('允许走动时一个字都不改', () => {
    for (const a of ['walk', 'idle', 'sleep', null] as const) {
      expect(restrainedAction(a, true)).toBe(a);
    }
  });
});

describe('让开规则：猫整只消失', () => {
  it('藏起来的同时所有主动行为都关掉', () => {
    const r = restraint(false, true, false);
    expect(r).toEqual({ hidden: true, tease: false, perch: false, roam: false });
  });

  it('让开优先于安静，也优先于「要去吃饭」', () => {
    // 藏着的猫不该为了吃饭走出来 - 那一步只是呈现，世界层照样在喂它。
    expect(restraint(true, true, true)).toEqual({
      hidden: true,
      tease: false,
      perch: false,
      roam: false,
    });
  });
});

describe('两个都没开：什么都允许', () => {
  it('默认状态不限制任何行为', () => {
    expect(restraint(false, false, false)).toEqual({
      hidden: false,
      tease: true,
      perch: true,
      roam: true,
    });
  });
});

describe('开关的存档', () => {
  it('默认不开安静模式 - 默认开着的猫会被当成坏了', () => {
    expect(DEFAULT_SETTINGS.quiet).toBe(false);
  });

  it('读坏了退回默认值，不抛', () => {
    // 这份文件里没有不可再生的东西（与 memorial.json 相反），
    // 一个开关读不出来就让猫起不来是不成比例的。
    for (const bad of [null, undefined, 42, 'quiet', [], { quiet: 'yes' }, {}]) {
      expect(parseSettings(bad)).toEqual(DEFAULT_SETTINGS);
    }
  });

  it('只认字面的 true', () => {
    expect(parseSettings({ quiet: true }).quiet).toBe(true);
    // 1 与 'true' 都不算：那说明写盘的一方换了格式，此时按默认值继续更安全。
    expect(parseSettings({ quiet: 1 }).quiet).toBe(false);
  });

  it('翻转开关不改原对象，值没变时返回同一个引用', () => {
    const off = DEFAULT_SETTINGS;
    const on = withQuiet(off, true);
    expect(off.quiet).toBe(false);
    expect(on.quiet).toBe(true);
    expect(withQuiet(on, true)).toBe(on);
  });
});

describe('托盘图标画哪一档', () => {
  it('「在挨饿」与「饿了」共用一张图', () => {
    // 两者的区别是一个倒计时，18×18 上没有第二个记号的位置。
    // 那条信息由 summaryLine 承担（它会写「还有 N 小时后会生病」）。
    expect(trayIconState('starving')).toBe('hungry');
    expect(trayIconState('hungry')).toBe('hungry');
  });

  it('其余四档原样对应', () => {
    for (const s of ['ok', 'sleeping', 'sick', 'dead'] as const) {
      expect(trayIconState(s)).toBe(s);
    }
  });

  it('六档状态每一档都有图可画 - 漏一档托盘就会停在上一张', () => {
    const all: CatStatus[] = ['ok', 'sleeping', 'hungry', 'starving', 'sick', 'dead'];
    for (const s of all) {
      expect(trayIconState(s)).toBeTruthy();
    }
  });
});
