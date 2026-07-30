import { describe, expect, it } from 'vitest';
import { STAGE_H, STAGE_W } from '../../src/app/stage.js';
import {
  footScreenY,
  initialPerchDesire,
  maxPerchLift,
  nextPerchDesire,
  perchAllowed,
  perchStartOk,
  perchSurfaceOf,
} from '../../src/app/perch.js';
import type { ForegroundWindow, PerchDesire } from '../../src/app/perch.js';
import { groundScreenY, reachableX } from '../../src/app/motion.js';
import type { PerchSurface, StageGeometry } from '../../src/app/motion.js';
import { W, makeCat, mulberry32 } from '../../src/render/index.js';
import { findSeed } from '../world/helpers.js';

/**
 * 「猫爬到前台窗口上」的判断层（ticket 12，ADR 0012）。
 *
 * 这个文件测的是**几何与闸门**：什么样的窗口能站、这一刻要不要上去。
 * 真机上这些条件几乎无法逐个复现（要一个正好 200 像素宽的窗口、要一块 150% 的
 * 外接屏、要把窗口最大化再还原），所以它们必须在这一层被断言。
 *
 * 跳上去之后的动作与位移在 test/app/motion.test.ts（「爬到前台窗口上」那一组）。
 */

/** 一个 1920x1080 的桌面，与 motion.test.ts 同一套脚手架。 */
const DESKTOP = { x: 0, y: 0, w: 1920, h: 1080 } as const;
const SPRITE_SCALE = 3;

function geom(patch: Partial<StageGeometry> = {}): StageGeometry {
  return { w: STAGE_W, h: STAGE_H, spriteScale: SPRITE_SCALE, work: DESKTOP, ...patch };
}

/** 一块 150% 缩放的屏：工作区尺寸相同，猫的贴图缩放会变。 */
const G = geom();
const GROUND = groundScreenY(G);

/** 一个普通窗口：横在桌面中间，上沿离地面线一大截。 */
function win(patch: Partial<ForegroundWindow> = {}): ForegroundWindow {
  return { id: 7, pid: 999, x: 400, y: 500, w: 800, h: 400, scale: 1, ...patch };
}

describe('前台窗口 → 能站的表面', () => {
  it('普通窗口：脚落在窗口上沿，两端各留出爪子踩得住的余量', () => {
    const s = perchSurfaceOf(win(), G, 1);
    expect(s).not.toBeNull();
    // 猫的脚就踩在窗口的可见上沿那条线上 - 差一点就是浮空或者陷进标题栏。
    expect(s!.y).toBe(500);
    // 锚点是精灵的横向中心，所以两端各内缩一点，否则半只猫悬在窗口外。
    expect(s!.min).toBeGreaterThan(400);
    expect(s!.max).toBeLessThan(1200);
    // 而且内缩得很有限：可走的那一段仍然占窗口的绝大部分。
    expect(s!.max - s!.min).toBeGreaterThan(800 * 0.9);
  });

  it('上沿离地面线太近就不值得爬（对照组：抬高一点就能爬）', () => {
    // 地面线上方 30 像素：站上去与站在桌面上看不出区别，却要付一次跳上跳下。
    expect(perchSurfaceOf(win({ y: GROUND - 30 }), G, 1)).toBeNull();
    expect(perchSurfaceOf(win({ y: GROUND - 300 }), G, 1)).not.toBeNull();
  });

  it('比猫窄的窗口站不上去（对照组：刚好比猫宽就能站）', () => {
    const catW = W * SPRITE_SCALE;
    expect(perchSurfaceOf(win({ w: catW - 1 }), G, 1)).toBeNull();
    expect(perchSurfaceOf(win({ w: catW * 2 }), G, 1)).not.toBeNull();
  });

  it('大半在屏幕外的窗口：可走的那一段太短就不上去', () => {
    // 窗口宽 800，但只有最右边 60 像素落在桌面内 - 猫上去连一步都走不了
    // （舞台不能被拖出工作区，所以猫的活动范围先被工作区夹住）。
    expect(perchSurfaceOf(win({ x: -740, w: 800 }), G, 1)).toBeNull();
    // 对照组：露出足够宽的一段就能上去，而且可走范围被工作区夹住。
    const s = perchSurfaceOf(win({ x: -400, w: 800 }), G, 1);
    expect(s).not.toBeNull();
    expect(s!.min).toBe(reachableX(G).min);
  });

  it('太高的窗口爬不上去 - 舞台一升出工作区，猫就会被屏幕顶端裁掉', () => {
    // 这条是舞台几何的硬结果，不是可调的手感：猫贴着舞台下沿（ADR 0007），
    // 让它升高只能整块窗口上移。
    const limit = maxPerchLift(G);
    // 正好够得着的高度：可以爬。
    expect(perchSurfaceOf(win({ y: GROUND - limit }), G, 1)).not.toBeNull();
    // 再高一点就不行了。
    expect(perchSurfaceOf(win({ y: GROUND - limit - 1 }), G, 1)).toBeNull();
  });

  it('最大化窗口的上沿爬不上去（已知取舍，见 ADR 0012）', () => {
    // 最大化窗口的上沿就在工作区顶端，猫站上去时整只猫都在工作区之外。
    // 这条断言存在的意义是把这个取舍钉在测试里：哪天想支持它，
    // 必须先解决「猫的身高不能超出上沿到屏幕顶端的距离」，而不是偷偷放宽闸门。
    const maximized = win({ x: DESKTOP.x, y: DESKTOP.y, w: DESKTOP.w, h: DESKTOP.h });
    expect(perchSurfaceOf(maximized, G, 1)).toBeNull();
    // 同一个窗口往下挪到猫的身高之外，就可以爬了 - 证明上一条不是被别的闸门挡掉的。
    expect(perchSurfaceOf({ ...maximized, y: GROUND - maxPerchLift(G) }, G, 1)).not.toBeNull();
  });

  it('没有前台窗口时没有表面', () => {
    expect(perchSurfaceOf(null, G, 1)).toBeNull();
  });
});

describe('跨 DPI', () => {
  /**
   * platform.rs 在 Windows 上做的那次换算：DWM 给的是物理像素，按**目标窗口所在
   * 显示器**的 DPI 折算成逻辑像素。
   *
   * 这里照抄一份是因为那段是 Rust，测试导不进来。**只有换算之后的这一半在测**，
   * Rust 那半只能靠真机（报告里列了怎么看）。抄一份仍然有意义：它把「该用谁的 DPI」
   * 这个判断固定成可执行的形式，下面那条对照组就是拿错 DPI 的后果。
   */
  const asRustDoes = (
    physical: { x: number; y: number; w: number; h: number },
    dpi: number,
  ): ForegroundWindow => {
    const scale = dpi / 96;
    return {
      id: 42,
      pid: 999,
      x: physical.x / scale,
      y: physical.y / scale,
      w: physical.w / scale,
      h: physical.h / scale,
      scale,
    };
  };

  // 实测数据（docs/research/2026-07-29-window-position-apis.md 的 2.4.3）：
  // 同一个窗口从 150% 的主屏挪到 100% 的副屏，**物理尺寸变了，逻辑尺寸没变**。
  const on150 = { x: 200, y: 160, w: 900, h: 650 };
  const on100 = { x: 200, y: 160, w: 600, h: 433 };

  it('按目标屏的 DPI 换算之后，同一个窗口的逻辑尺寸一致', () => {
    const a = asRustDoes(on150, 144);
    const b = asRustDoes(on100, 96);
    expect(a.w).toBeCloseTo(b.w, 0);
    expect(a.h).toBeCloseTo(b.h, 0);
    // 对照组：用宠物窗口自己的 DPI（这里假设它在 100% 那块屏上）换算 150% 屏上的
    // 窗口，尺寸会大出 50% - 这正是「必须按目标窗口所在显示器的 DPI 缩放」
    // 那条验收项在说的错误。
    const wrong = on150.w / 1;
    expect(wrong / b.w).toBeCloseTo(1.5, 1);
  });

  it('表面几何只取决于逻辑矩形，不再二次乘缩放', () => {
    // 同一个逻辑矩形、同一个舞台缩放，无论目标屏报的是哪个 scale，
    // 算出来的表面必须一样 - 否则就是在前端又乘了一次 DPI。
    const logical = { x: 400, y: 500, w: 800, h: 400 };
    const a = perchSurfaceOf({ ...logical, id: 1, pid: 9, scale: 2 }, G, 2);
    const b = perchSurfaceOf({ ...logical, id: 1, pid: 9, scale: 1 }, G, 1);
    expect(a).toEqual(b);
  });

  it('目标窗口在另一个缩放的屏上时不上去', () => {
    // 猫的贴图缩放由**舞台窗口所在屏**决定（display.ts 的整数缩放规则），
    // 与目标屏不同时猫与窗口的比例会失配。MVP 不做多屏穿越，所以直接不上去。
    expect(perchSurfaceOf(win({ scale: 1.5 }), G, 1)).toBeNull();
    expect(perchSurfaceOf(win({ scale: 1 }), G, 1.5)).toBeNull();
    // 对照组：同一块屏（缩放相同）照常上去。
    expect(perchSurfaceOf(win({ scale: 1.5 }), G, 1.5)).not.toBeNull();
  });
});

describe('世界层的两道闸门', () => {
  it('要吃饭或睡觉时不上去 - 食盆与猫窝都在桌面那条地面线上', () => {
    expect(perchAllowed('ok', 'bowl')).toBe(false);
    expect(perchAllowed('ok', 'bed')).toBe(false);
    expect(perchAllowed('ok', null)).toBe(true);
  });

  it('只有状态正常的猫才爬窗口', () => {
    expect(perchAllowed('ok', null)).toBe(true);
    for (const status of ['sick', 'dead', 'hungry', 'starving', 'sleeping'] as const) {
      expect(perchAllowed(status, null), `${status} 不该去爬窗口`).toBe(false);
    }
  });

  it('站立与被动休息姿势可以自然转去起跳，明确动作不会被打断', () => {
    expect(perchStartOk('walk')).toBe(true);
    expect(perchStartOk('idle')).toBe(true);
    // 坐下与趴下都是循环姿势，没有必须等到的收尾帧；收到邀请后运动层会先站起来走。
    expect(perchStartOk('sit')).toBe(true);
    expect(perchStartOk('lie')).toBe(true);
    // 这些动作有明确内容，中途插一次起跳读起来才是真正被打断。
    for (const a of ['yawn', 'stretch', 'groom', 'eat', 'sleep', 'pounce'] as const) {
      expect(perchStartOk(a), `${a} 时不该起跳`).toBe(false);
    }
    expect(perchStartOk(null)).toBe(false);
  });
});

describe('要不要上去、待多久', () => {
  const SURFACE: PerchSurface = { id: 7, y: 500, min: 418, max: 1182 };
  const NORMAL = makeCat('orange', 20260728);
  const LAZY = makeCat('orange', findSeed('orange', (p) => p.active < 0.08));
  const BUSY = makeCat('cow', findSeed('cow', (p) => p.active > 0.9));

  interface RunOpts {
    seconds: number;
    dt?: number;
    active?: number;
    surface?: PerchSurface | null | ((tS: number) => PerchSurface | null);
    allowed?: boolean | ((tS: number) => boolean);
    startOk?: boolean;
    seed?: number;
    /** 猫这一刻在表面上（含正在上去）。默认「一被邀请就算上去了」。 */
    from?: PerchDesire;
  }

  /** 跑一段时间，返回每一帧的邀请状态与时间戳。 */
  function run(opts: RunOpts): { frames: { tS: number; desire: PerchDesire }[]; end: PerchDesire } {
    const dt = opts.dt ?? 1 / 60;
    const rnd = mulberry32(opts.seed ?? 1);
    const fixedSurface =
      typeof opts.surface === 'function' ? null : opts.surface === undefined ? SURFACE : opts.surface;
    const surfaceOf =
      typeof opts.surface === 'function' ? opts.surface : (): PerchSurface | null => fixedSurface;
    const fixedAllowed = typeof opts.allowed === 'function' ? true : opts.allowed ?? true;
    const allowedAt =
      typeof opts.allowed === 'function' ? opts.allowed : (): boolean => fixedAllowed;
    let desire = opts.from ?? initialPerchDesire();
    const frames: { tS: number; desire: PerchDesire }[] = [];
    let tS = 0;
    for (let i = 0; i < Math.round(opts.seconds / dt); i++) {
      tS += dt;
      desire = nextPerchDesire(desire, {
        dt,
        allowed: allowedAt(tS),
        startOk: opts.startOk ?? true,
        surface: surfaceOf(tS),
        active: opts.active ?? NORMAL.personality.active,
        rnd,
      });
      frames.push({ tS, desire });
    }
    return { frames, end: desire };
  }

  /** 第一次发出邀请是第几秒。没有邀请过则为 null。 */
  const firstOfferAt = (frames: { tS: number; desire: PerchDesire }[]): number | null =>
    frames.find((f) => f.desire.offer !== null)?.tS ?? null;

  it('前台有个能站的窗口，猫最终会上去', () => {
    const at = firstOfferAt(run({ seconds: 600, active: 1 }).frames);
    expect(at).not.toBeNull();
  });

  it('首次看到合格窗口不会额外等待重复冷却，并且最迟约 16 秒发出邀请', () => {
    // rnd 永远返回 1：性格抽签一次也不会提前命中，只能靠最长等待兜底。
    let desire = initialPerchDesire();
    let offeredAt: number | null = null;
    const dt = 1 / 60;
    for (let tS = dt; tS <= 20; tS += dt) {
      desire = nextPerchDesire(desire, {
        dt,
        allowed: true,
        startOk: true,
        surface: SURFACE,
        active: 0,
        rnd: () => 1,
      });
      if (desire.offer !== null) {
        offeredAt = tS;
        break;
      }
    }
    expect(offeredAt).not.toBeNull();
    expect(offeredAt!).toBeGreaterThanOrEqual(16);
    expect(offeredAt!).toBeLessThan(17);
  });

  it('窗口刚切到前台的那一秒内绝不起跳 - 不做跟随前台窗口的 UI 控件', () => {
    // 把另外两道闸门都拧到不可能成为解释的位置：冷却早就过了（restS 很大），
    // 频率高到平均每秒都想上去（active 给一个现实中不存在的值）。
    // 于是「头一秒里没有邀请」只能由「窗口要先站稳一段时间」这一条解释 -
    // 去掉那条闸门这个断言会立刻红。
    const warm: PerchDesire = { ...initialPerchDesire(), restS: 999 };
    for (let seed = 1; seed <= 20; seed++) {
      const at = firstOfferAt(run({ seconds: 1, active: 100, seed, from: warm }).frames);
      expect(at, `seed=${seed} 在窗口站稳前就上去了`).toBeNull();
    }
    // 对照组：再多等一会儿就上去了，所以上面不是「永远不上去」。
    const later = firstOfferAt(run({ seconds: 3, active: 100, seed: 1, from: warm }).frames);
    expect(later).not.toBeNull();
    expect(later!).toBeGreaterThan(1);
  });

  it('没有表面就不会有邀请', () => {
    expect(run({ seconds: 600, surface: null, active: 1 }).end.offer).toBeNull();
  });

  it('世界层不允许时不会有邀请（生病、该去吃饭）', () => {
    expect(run({ seconds: 600, allowed: false, active: 1 }).end.offer).toBeNull();
  });

  it('这一刻不能起跳（正在打哈欠）就不邀请，但能起跳之后照样会上去', () => {
    expect(run({ seconds: 600, startOk: false, active: 1 }).end.offer).toBeNull();
    expect(firstOfferAt(run({ seconds: 600, startOk: true, active: 1 }).frames)).not.toBeNull();
  });

  it('上去之后待一会儿就自己收回邀请 - 猫不会永久住在窗口上', () => {
    const { frames } = run({ seconds: 900, active: 1, seed: 3 });
    const start = frames.findIndex((f) => f.desire.offer !== null);
    expect(start).toBeGreaterThan(0);
    const end = frames.findIndex((f, i) => i > start && f.desire.offer === null);
    expect(end, '邀请一直没收回').toBeGreaterThan(start);
    const stayS = frames[end]!.tS - frames[start]!.tS;
    // 待的时间是「有意思」的量级：够走几趟，又不到十分钟。
    expect(stayS).toBeGreaterThan(15);
    expect(stayS).toBeLessThan(180);
  });

  it('下来之后有明显的冷却，不会立刻又跳上去', () => {
    const { frames } = run({ seconds: 900, active: 1, seed: 3 });
    const offers = frames.filter((f) => f.desire.offer !== null).map((f) => f.tS);
    const gaps: number[] = [];
    for (let i = 1; i < offers.length; i++) {
      const gap = offers[i]! - offers[i - 1]!;
      if (gap > 1) gaps.push(gap);
    }
    // 对照组：这段时间里确实上去过不止一次。
    expect(gaps.length).toBeGreaterThan(0);
    expect(Math.min(...gaps)).toBeGreaterThan(10);
  });

  it('换了前台窗口要重新站稳，不会顺势跳过去', () => {
    // 前 5 秒是窗口 A，之后换成窗口 B。换的那一刻起计时要重来。
    const other: PerchSurface = { ...SURFACE, id: 8 };
    const { frames } = run({
      seconds: 6,
      active: 1,
      seed: 5,
      surface: (tS) => (tS < 5 ? SURFACE : other),
    });
    const swap = frames.findIndex((f) => f.tS >= 5);
    const justAfter = frames[swap + 30]!; // 换窗口之后半秒
    expect(justAfter.desire.offer).toBeNull();
    expect(justAfter.desire.id).toBe(8);
    expect(justAfter.desire.readyS).toBeLessThan(1);
  });

  it('活跃的猫比懒猫更早上去（对照组：同一个随机流）', () => {
    // 「爬窗口是自主行为」的可验证形式：频率随活跃度变化，不是有窗口就上。
    const trials = 24;
    const meanFirst = (active: number): number => {
      let sum = 0;
      for (let seed = 1; seed <= trials; seed++) {
        const at = firstOfferAt(run({ seconds: 1200, active, seed }).frames);
        sum += at ?? 1200;
      }
      return sum / trials;
    };
    expect(meanFirst(BUSY.personality.active)).toBeLessThan(meanFirst(LAZY.personality.active));
  });

  it('起跳的频率与帧率无关', () => {
    // 抽签按 dt 折算成每帧概率。写成「每帧一个固定概率」的话，
    // 120fps 的机器上猫会爬得比 30fps 的机器勤一倍。
    const meanFirst = (dt: number): number => {
      let sum = 0;
      const trials = 40;
      for (let seed = 1; seed <= trials; seed++) {
        sum += firstOfferAt(run({ seconds: 2400, dt, active: 0.5, seed }).frames) ?? 2400;
      }
      return sum / trials;
    };
    const fast = meanFirst(1 / 120);
    const slow = meanFirst(1 / 30);
    expect(Math.abs(fast - slow) / fast).toBeLessThan(0.35);
  });

  it('纯函数：不改动传进来的状态', () => {
    const prev = initialPerchDesire();
    const snapshot = JSON.stringify(prev);
    nextPerchDesire(prev, {
      dt: 1 / 60,
      allowed: true,
      startOk: true,
      surface: SURFACE,
      active: 1,
      rnd: mulberry32(1),
    });
    expect(JSON.stringify(prev)).toBe(snapshot);
  });
});

describe('脚底线', () => {
  it('站在地上时就是地面线，站在窗口上时跟着抬高', () => {
    expect(footScreenY(G, 0)).toBe(GROUND);
    expect(footScreenY(G, 200)).toBe(GROUND - 200);
    // 负数不会把脚按到地下去。
    expect(footScreenY(G, -50)).toBe(GROUND);
  });
});
