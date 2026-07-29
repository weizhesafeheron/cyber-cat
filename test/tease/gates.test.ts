import { describe, expect, it } from 'vitest';
import {
  BORED_AFTER_POUNCES,
  BORED_COOLDOWN_MS,
  CHASES_PER_HOUR_ACTIVE,
  CHASES_PER_HOUR_LAZY,
  DROWSY_AFTER_MEAL_MS,
  FULL_ENOUGH,
  INITIAL_TEASE,
  MOOD_MIN_TO_PLAY,
  NOTICE_RADIUS_PX,
  POUNCE_GAP_MS,
  POUNCE_OFFSET_PX,
  PREY_SPEED_MIN,
  TYPING_IDLE_S,
  afterPounce,
  interruptTease,
  pounceLandingX,
  preyLike,
  quotaFor,
  reactDelayMs,
  refreshTease,
  teaseVerdict,
} from '../../src/tease/index.js';
import type { CursorPoint, Gate, TeaseInput } from '../../src/tease/index.js';

/**
 * 六道闸门。
 *
 * 票上的验收标准是「六条逐条可被缝一测试断言」，所以这个文件按闸门组织，
 * **每一条都要有一个「只有这一道不满足」的用例** - 六道用同一个布尔值返回时，
 * 任何一道单独失效都会被掩盖过去，所以 teaseVerdict 返回的是「被哪一道拦住」。
 *
 * 另一半同样重要：每一道都要有对照组证明「解除这一道之后就能追了」。
 * 少了对照组，一个「永远返回 false」的实现也能让全部六条通过。
 */

const NOW = 1_000_000;

/** 一段「像猎物」的轨迹：够快、方向来回变。 */
function preyTrail(now = NOW, cx = 500, cy = 500): CursorPoint[] {
  // 每 60ms 一个点，来回甩，速度远超阈值
  const pts: CursorPoint[] = [];
  for (let i = 0; i < 6; i++) {
    pts.push({ x: cx + (i % 2 === 0 ? -40 : 40), y: cy + i * 6, t: now - (5 - i) * 60 });
  }
  return pts;
}

/** 一段「用户在正常操作」的轨迹：同样快，但是直线。 */
function straightTrail(now = NOW, cx = 500, cy = 500): CursorPoint[] {
  const pts: CursorPoint[] = [];
  for (let i = 0; i < 6; i++) {
    pts.push({ x: cx - 200 + i * 60, y: cy, t: now - (5 - i) * 60 });
  }
  return pts;
}

/** 一份「六道全过」的输入。每条测试只改它的一个字段。 */
function ok(patch: Partial<TeaseInput> = {}): TeaseInput {
  const trail = preyTrail();
  const last = trail[trail.length - 1]!;
  return {
    status: 'ok',
    mood: 70,
    hunger: 60,
    lastMealAt: null,
    keyboardIdleS: 30,
    catX: last.x + 40,
    catY: last.y,
    trail,
    pouncesInARow: 0,
    boredUntil: null,
    lastPounceAt: null,
    recentChases: [],
    quotaPerHour: 8,
    now: NOW,
    ...patch,
  };
}

const blockedBy = (patch: Partial<TeaseInput>): Gate | null => teaseVerdict(ok(patch)).blockedBy;

describe('基准：六道全过时能追', () => {
  it('这份输入必须能追 - 它是下面每条测试的对照组', () => {
    expect(teaseVerdict(ok())).toEqual({ ok: true, blockedBy: null });
  });
});

describe('一、状态闸门', () => {
  it('睡着、生病、饿、死都不理光标', () => {
    for (const status of ['sleeping', 'sick', 'hungry', 'starving', 'dead'] as const) {
      expect(blockedBy({ status }), `${status} 时仍然会追`).toBe('state');
    }
  });

  it('心情很差不理', () => {
    expect(blockedBy({ mood: MOOD_MIN_TO_PLAY - 1 })).toBe('state');
    // 对照组：心情刚够就能追
    expect(blockedBy({ mood: MOOD_MIN_TO_PLAY })).toBeNull();
  });

  it('刚吃饱犯困不理', () => {
    const justAte = { lastMealAt: NOW - 1000, hunger: FULL_ENOUGH + 5 };
    expect(blockedBy(justAte)).toBe('state');
    // 对照组一：犯困期过了就能追
    expect(blockedBy({ ...justAte, lastMealAt: NOW - DROWSY_AFTER_MEAL_MS - 1 })).toBeNull();
    // 对照组二：吃过但没吃饱（比如只吃了一口就被打断）不算犯困
    expect(blockedBy({ ...justAte, hunger: FULL_ENOUGH - 20 })).toBeNull();
  });
});

describe('二、打字免打扰', () => {
  it('刚敲过键盘就完全无视光标', () => {
    expect(blockedBy({ keyboardIdleS: 0 })).toBe('typing');
    expect(blockedBy({ keyboardIdleS: TYPING_IDLE_S - 0.1 })).toBe('typing');
  });

  it('对照组：停手之后能追', () => {
    expect(blockedBy({ keyboardIdleS: TYPING_IDLE_S })).toBeNull();
  });
});

describe('三、玩腻', () => {
  it('连续扑中够数之后就不追了', () => {
    expect(blockedBy({ pouncesInARow: BORED_AFTER_POUNCES })).toBe('bored');
    // 对照组：差一次还能追
    expect(blockedBy({ pouncesInARow: BORED_AFTER_POUNCES - 1 })).toBeNull();
  });

  it('冷却期内不追，冷却完了能追', () => {
    expect(blockedBy({ boredUntil: NOW + 1000 })).toBe('bored');
    expect(blockedBy({ boredUntil: NOW })).toBeNull();
  });
});

describe('四、两次扑跳之间的最小间隔', () => {
  it('刚扑过不会立刻再扑 - 防的是同一次挥动里连扑好几下', () => {
    expect(blockedBy({ lastPounceAt: NOW - 1 })).toBe('gap');
    expect(blockedBy({ lastPounceAt: NOW - POUNCE_GAP_MS + 1 })).toBe('gap');
  });

  it('对照组：间隔够了能追', () => {
    expect(blockedBy({ lastPounceAt: NOW - POUNCE_GAP_MS })).toBeNull();
  });
});

describe('五、全局节流', () => {
  it('一小时内追够上限就不追了', () => {
    const full = Array.from({ length: 8 }, (_, i) => NOW - i * 1000);
    expect(blockedBy({ recentChases: full, quotaPerHour: 8 })).toBe('quota');
  });

  it('对照组：差一次还能追', () => {
    const almost = Array.from({ length: 7 }, (_, i) => NOW - i * 1000);
    expect(blockedBy({ recentChases: almost, quotaPerHour: 8 })).toBeNull();
  });

  it('活跃度高的猫上限更高 - 不是全局常量', () => {
    expect(quotaFor(0)).toBe(CHASES_PER_HOUR_LAZY);
    expect(quotaFor(1)).toBe(CHASES_PER_HOUR_ACTIVE);
    expect(quotaFor(0.5)).toBeGreaterThan(quotaFor(0.1));
  });
});

describe('六、距离闸门', () => {
  it('光标在注意范围外就不理', () => {
    const trail = preyTrail();
    const last = trail[trail.length - 1]!;
    expect(blockedBy({ trail, catX: last.x + NOTICE_RADIUS_PX + 10, catY: last.y })).toBe(
      'distance',
    );
  });

  it('对照组：进了注意范围就能追', () => {
    const trail = preyTrail();
    const last = trail[trail.length - 1]!;
    expect(blockedBy({ trail, catX: last.x + NOTICE_RADIUS_PX - 10, catY: last.y })).toBeNull();
  });

  it('没有任何光标数据时不追 - 不能把「不知道」当成「在旁边」', () => {
    expect(blockedBy({ trail: [] })).toBe('distance');
  });
});

describe('七、运动特征闸门', () => {
  it('匀速直线不算邀请 - 那是用户在操作', () => {
    const trail = straightTrail();
    const last = trail[trail.length - 1]!;
    expect(blockedBy({ trail, catX: last.x + 40, catY: last.y })).toBe('motion');
  });

  it('对照组：同样快但方向来回变就算邀请', () => {
    expect(blockedBy({})).toBeNull();
  });

  it('慢慢来回晃也不算 - 两个条件必须同时满足', () => {
    // 方向变化足够，但速度远低于阈值
    const slow: CursorPoint[] = [];
    for (let i = 0; i < 6; i++) {
      slow.push({ x: 500 + (i % 2 === 0 ? -3 : 3), y: 500, t: NOW - (5 - i) * 60 });
    }
    expect(preyLike(slow, NOW)).toBe(false);
  });

  it('采样点太少一律不算 - 不能拿两个点判定方向', () => {
    const few: CursorPoint[] = [
      { x: 300, y: 500, t: NOW - 60 },
      { x: 600, y: 500, t: NOW },
    ];
    expect(preyLike(few, NOW)).toBe(false);
  });

  it('过期的采样点不参与判定', () => {
    // 全部点都在窗口之外
    const stale = preyTrail(NOW - 5000);
    expect(preyLike(stale, NOW)).toBe(false);
  });

  it('速度按走过的路程算，不按首尾直线距离 - 来回甩的首尾距离很小', () => {
    // 来回甩：首尾几乎回到原点，但路程很长
    const shake: CursorPoint[] = [];
    for (let i = 0; i < 8; i++) {
      shake.push({ x: 500 + (i % 2 === 0 ? -60 : 60), y: 500, t: NOW - (7 - i) * 50 });
    }
    const straightDist = Math.hypot(
      shake[shake.length - 1]!.x - shake[0]!.x,
      shake[shake.length - 1]!.y - shake[0]!.y,
    );
    const seconds = (shake[shake.length - 1]!.t - shake[0]!.t) / 1000;
    // 按首尾算速度远低于阈值，按路程算远高于阈值
    expect(straightDist / seconds).toBeLessThan(PREY_SPEED_MIN);
    expect(preyLike(shake, NOW)).toBe(true);
  });
});

describe('落点不压住光标', () => {
  it('落在光标旁边，不在光标上', () => {
    expect(Math.abs(pounceLandingX(800, 600) - 800)).toBe(POUNCE_OFFSET_PX);
  });

  it('停在猫来的那一侧 - 穿过光标再回头会读成扑失手了', () => {
    // 猫在光标左边：落点也在左边
    expect(pounceLandingX(800, 600)).toBeLessThan(800);
    // 猫在光标右边：落点在右边
    expect(pounceLandingX(800, 1000)).toBeGreaterThan(800);
  });
});

describe('反应快慢由性格缩放', () => {
  it('懒猫慢半拍，活跃的猫说走就走', () => {
    expect(reactDelayMs(0)).toBeGreaterThan(reactDelayMs(1));
    expect(reactDelayMs(0.5)).toBeGreaterThan(reactDelayMs(0.9));
  });

  it('不是零 - 零延迟读起来是程序在响应事件，不是一只猫动了心', () => {
    expect(reactDelayMs(1)).toBeGreaterThan(50);
  });
});

describe('运行期状态的推进', () => {
  it('扑一次：连续计数加一、记下时刻、进节流账本', () => {
    const s = afterPounce(INITIAL_TEASE, NOW);
    expect(s.pouncesInARow).toBe(1);
    expect(s.lastPounceAt).toBe(NOW);
    expect(s.recentChases).toEqual([NOW]);
    expect(s.boredUntil).toBeNull();
  });

  it('扑够数就进冷却', () => {
    let s = INITIAL_TEASE;
    for (let i = 0; i < BORED_AFTER_POUNCES; i++) s = afterPounce(s, NOW + i * POUNCE_GAP_MS);
    expect(s.boredUntil).not.toBeNull();
    expect(s.boredUntil!).toBeGreaterThan(NOW + BORED_COOLDOWN_MS - 1);
  });

  it('冷却走完把连续计数归零，但**不清**一小时的额度账本', () => {
    let s = INITIAL_TEASE;
    for (let i = 0; i < BORED_AFTER_POUNCES; i++) s = afterPounce(s, NOW + i * 100);
    const chasesBefore = s.recentChases.length;
    const after = refreshTease(s, s.boredUntil! + 1);
    expect(after.pouncesInARow).toBe(0);
    expect(after.boredUntil).toBeNull();
    // 玩腻与全局节流是两条独立的闸门，混在一起清会让玩腻一次就重置一小时的额度
    expect(after.recentChases).toHaveLength(chasesBefore);
  });

  it('超出统计窗口的追逐记录会被丢掉', () => {
    const old = { ...INITIAL_TEASE, recentChases: [NOW - 4_000_000, NOW - 1000] };
    expect(refreshTease(old, NOW).recentChases).toEqual([NOW - 1000]);
  });

  it('被别的事打断就清连续计数 - 睡一觉起来又扑三次是两串，不是六次', () => {
    const s = { ...INITIAL_TEASE, pouncesInARow: 2 };
    expect(interruptTease(s).pouncesInARow).toBe(0);
    // 没有变化时返回同一个对象，每帧新建是白烧垃圾回收
    const zero = { ...INITIAL_TEASE, pouncesInARow: 0 };
    expect(interruptTease(zero)).toBe(zero);
  });
});
