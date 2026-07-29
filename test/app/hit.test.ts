import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HIT_CONFIG,
  ZERO_VELOCITY,
  initialHitState,
  leadDistance,
  nearMask,
  stepHit,
  velocityOf,
} from '../../src/app/hit.js';
import type { HitFrame, HitState, Velocity } from '../../src/app/hit.js';
import {
  ACTIONS,
  ACTION_KEYS,
  BREED_KEYS,
  CatRenderer,
  H,
  W,
  hitTest,
  makeCat,
} from '../../src/render/index.js';
import { centersAtDistance, distToMask, frameOf, maskCenters, sampleEvenly } from './masks.js';
import type { Point } from './masks.js';

/**
 * 选择性点击穿透的判定行为（ADR 0006）。
 *
 * 判错的后果是两个方向都很糟：判成穿透时猫点不动，判成不穿透时用户在猫旁边的
 * 点击被吃掉。两者都难以靠人眼稳定复现，所以必须有自动化保护。
 *
 * 掩膜全部来自真实渲染结果。
 */

const renderer = new CatRenderer();
const MI = { eyeOpen: 1, earFlickL: 0, earFlickR: 0, tilt: 0 };
const CFG = DEFAULT_HIT_CONFIG;

/** 拿一帧真实掩膜（已拷贝，可跨帧持有）。 */
function frame(breed: (typeof BREED_KEYS)[number], action: keyof typeof ACTIONS, t: number) {
  const cat = makeCat(breed, 20260728);
  return frameOf(renderer.render(cat, ACTIONS[action].make(t, cat, MI)));
}

/** 一次判定：返回「是否应该穿透」。 */
function passThrough(
  f: HitFrame,
  cursor: Point | null,
  velocity: Velocity = ZERO_VELOCITY,
  state: HitState = initialHitState(),
  now = 0,
): boolean {
  return stepHit(state, f, { cursor, velocity, now }, CFG).passThrough;
}

/** 沿 x 轴的速度。 */
function vx(speed: number): Velocity {
  return { vx: speed, vy: 0, speed: Math.abs(speed) };
}

/** 猫身上最宽的那一行，作为「从侧面接近」的参照。 */
function widestRow(f: HitFrame): { y: number; minX: number; maxX: number } {
  let best = { y: -1, minX: 0, maxX: 0, n: 0 };
  for (let y = 0; y < f.height; y++) {
    let n = 0;
    let minX = f.width;
    let maxX = -1;
    for (let x = 0; x < f.width; x++) {
      if (f.alphaMask[y * f.width + x] !== 255) continue;
      n++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
    if (n > best.n) best = { y, minX, maxX, n };
  }
  expect(best.n, '掩膜是空的，测试无法进行').toBeGreaterThan(0);
  return { y: best.y, minX: best.minX, maxX: best.maxX };
}

describe('判定工具自检', () => {
  // 这个项目已经有过四次「工具坏了导致误判」的教训，判定的距离度量必须有对照组。
  it('margin = 0 的 nearMask 与渲染层的 hitTest 完全一致', () => {
    const f = frame('orange', 'sit', 0);
    let hits = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        for (const [ox, oy] of [
          [0.5, 0.5],
          [0.01, 0.99],
        ] as const) {
          const px = x + ox;
          const py = y + oy;
          const own = nearMask(f, px, py, 0);
          const ref = hitTest({ ...f, pixels: new Uint8ClampedArray(0) }, px, py);
          expect(own, `(${px}, ${py}) 两种命中判定不一致`).toBe(ref);
          if (own) hits++;
        }
      }
    }
    expect(hits, '一个命中点都没有，自检是空转的').toBeGreaterThan(100);
  });

  it('测试用的距离度量与被测实现在同一个点上一致', () => {
    const f = frame('cow', 'walk', 0.7);
    for (let y = 0; y < H; y += 3) {
      for (let x = 0; x < W; x += 3) {
        const d = distToMask(f, x + 0.5, y + 0.5);
        // 距离 d 意味着：边距 d + 微量时必命中，边距 d - 微量时必不命中。
        expect(nearMask(f, x + 0.5, y + 0.5, d + 0.01), `(${x}, ${y}) d=${d}`).toBe(true);
        if (d > 0.02) {
          expect(nearMask(f, x + 0.5, y + 0.5, d - 0.01), `(${x}, ${y}) d=${d}`).toBe(false);
        }
      }
    }
  });
});

describe('光标压在猫身上', () => {
  it('每个品种的每个动作，掩膜上的点都判为不穿透', () => {
    for (const breed of BREED_KEYS) {
      for (const key of ACTION_KEYS) {
        const f = frame(breed, key, 1.1);
        const pts = sampleEvenly(maskCenters(f), 24);
        expect(pts.length, `${breed} ${key} 没有掩膜像素`).toBeGreaterThan(10);
        for (const p of pts) {
          expect(passThrough(f, p), `${breed} ${key} 在 (${p.x}, ${p.y}) 竟然判为穿透`).toBe(false);
        }
      }
    }
  });

  it('逐个检查一整帧：掩膜内的每个像素都判为不穿透', () => {
    const f = frame('ragdoll', 'sit', 0.4);
    const pts = maskCenters(f);
    expect(pts.length).toBeGreaterThan(300);
    for (const p of pts) expect(passThrough(f, p)).toBe(false);
  });
});

describe('光标在远处的透明区域', () => {
  it('判为穿透', () => {
    const f = frame('orange', 'sit', 0);
    // 阈值取足够远：超过退出边距（baseMargin + exitExtra）再加一像素余量。
    const far = sampleEvenly(centersAtDistance(f, CFG.baseMargin + CFG.exitExtra + 1, Infinity), 40);
    expect(far.length, '没有找到足够远的点，测试是空转的').toBeGreaterThan(20);
    for (const p of far) {
      expect(hitTest({ ...f, pixels: new Uint8ClampedArray(0) }, p.x, p.y)).toBe(false);
      expect(passThrough(f, p), `(${p.x}, ${p.y}) 远离猫却判为不穿透`).toBe(true);
    }
  });

  it('画面四角一律穿透', () => {
    for (const breed of BREED_KEYS) {
      const f = frame(breed, 'idle', 0);
      for (const p of [
        { x: 0.5, y: 0.5 },
        { x: W - 0.5, y: 0.5 },
        { x: 0.5, y: H - 0.5 },
        { x: W - 0.5, y: H - 0.5 },
      ]) {
        expect(passThrough(f, p), `${breed} 的 (${p.x}, ${p.y}) 判为不穿透`).toBe(true);
      }
    }
  });
});

describe('外扩边距：提前关闭穿透', () => {
  it('光标还没压到猫身上、只是进了边距，就已经判为不穿透', () => {
    const f = frame('orange', 'sit', 0);
    // 距离在 (0, baseMargin] 之间：确实不在猫身上，但在边距内。
    const band = centersAtDistance(f, 0.01, CFG.baseMargin);
    expect(band.length, '没有找到边距内的点，测试是空转的').toBeGreaterThan(20);
    for (const p of band) {
      expect(
        hitTest({ ...f, pixels: new Uint8ClampedArray(0) }, p.x, p.y),
        `(${p.x}, ${p.y}) 应该在猫身外`,
      ).toBe(false);
      expect(passThrough(f, p), `(${p.x}, ${p.y}) 在边距内却判为穿透`).toBe(false);
    }
  });

  it('静止时的边距是有限的，不会把整个精灵都圈成不可穿透', () => {
    const f = frame('orange', 'sit', 0);
    let through = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) if (passThrough(f, { x: x + 0.5, y: y + 0.5 })) through++;
    }
    // 一只坐着的猫远远占不满 72x56，绝大多数位置必须仍然穿透。
    expect(through / (W * H)).toBeGreaterThan(0.5);
  });
});

describe('边距随速度扩大', () => {
  it('高速接近时提前关闭穿透，低速则不', () => {
    const f = frame('orange', 'idle', 0);
    const row = widestRow(f);
    const start = { x: row.minX - 20, y: row.y + 0.5 };
    const d = distToMask(f, start.x, start.y);
    // 起点必须真的在静止边距之外，否则这条测试测不到速度的作用。
    expect(d, `起点距离 ${d} 不适合做接近测试`).toBeGreaterThan(8);
    expect(d).toBeLessThan(25);

    expect(passThrough(f, start, ZERO_VELOCITY), '静止时应当穿透').toBe(true);
    expect(passThrough(f, start, vx(40)), '慢速接近时前探距离不够，应当仍穿透').toBe(true);

    // 前探距离刚好覆盖 d 所需的速度
    const fast = (d + 4) / CFG.leadTimeS;
    expect(fast * CFG.leadTimeS).toBeLessThanOrEqual(CFG.maxLead);
    expect(passThrough(f, start, vx(fast)), '高速接近时应当提前关闭穿透').toBe(false);
  });

  it('高速远离时不提前关闭穿透 - 边距只沿运动方向前探', () => {
    const f = frame('orange', 'idle', 0);
    const row = widestRow(f);
    const start = { x: row.minX - 20, y: row.y + 0.5 };
    const d = distToMask(f, start.x, start.y);
    const fast = (d + 4) / CFG.leadTimeS;
    // 同样的速度大小、相反方向：等比例放大边距会误判成不穿透，
    // 那样高速掠过时整个窗口都会变成死区。
    expect(passThrough(f, start, vx(-fast))).toBe(true);
  });

  it('前探距离随速度单调增长并封顶', () => {
    const speeds = [0, 10, 50, 100, 300, 600, 1200, 5000];
    let prev = -1;
    for (const s of speeds) {
      const lead = leadDistance(s, CFG);
      expect(lead).toBeGreaterThanOrEqual(prev);
      expect(lead).toBeLessThanOrEqual(CFG.maxLead);
      prev = lead;
    }
    expect(leadDistance(0, CFG)).toBe(0);
    expect(leadDistance(5000, CFG)).toBe(CFG.maxLead);
    expect(leadDistance(200, CFG)).toBeCloseTo(200 * CFG.leadTimeS);
  });
});

describe('命中形状跟随当前帧的掩膜', () => {
  it('同一个光标位置，伸懒腰时不穿透、蜷睡时穿透', () => {
    const stretch = frame('orange', 'stretch', 1.2);
    const sleep = frame('orange', 'sleep', 1.2);

    // 找一个「伸懒腰时在猫身上、蜷睡时远离猫」的点。
    // 伸懒腰横向拉长、蜷睡缩成一团，这样的点必然存在。
    const candidates = maskCenters(stretch).filter(
      (p) => distToMask(sleep, p.x, p.y) > CFG.baseMargin + CFG.exitExtra + 1,
    );
    expect(candidates.length, '两个姿态的掩膜差异不足，测试是空转的').toBeGreaterThan(10);

    for (const p of sampleEvenly(candidates, 20)) {
      expect(passThrough(stretch, p), `伸懒腰时 (${p.x}, ${p.y}) 应当不穿透`).toBe(false);
      expect(passThrough(sleep, p), `蜷睡时 (${p.x}, ${p.y}) 应当穿透`).toBe(true);
    }
  });

  it('换帧后判定跟着换，不会沿用上一帧的掩膜', () => {
    const stretch = frame('orange', 'stretch', 1.2);
    const sleep = frame('orange', 'sleep', 1.2);
    const p = maskCenters(stretch).find(
      (q) => distToMask(sleep, q.x, q.y) > CFG.baseMargin + CFG.exitExtra + 1,
    )!;

    // 先在伸懒腰的帧上关掉穿透
    let st = stepHit(initialHitState(), stretch, { cursor: p, velocity: ZERO_VELOCITY, now: 0 }, CFG);
    expect(st.passThrough).toBe(false);

    // 换成蜷睡的帧，光标没动。退出延迟从这一帧起算，走完后必须恢复穿透。
    st = stepHit(st, sleep, { cursor: p, velocity: ZERO_VELOCITY, now: 10 }, CFG);
    expect(st.passThrough, '退出延迟内不该立刻切换').toBe(false);
    st = stepHit(
      st,
      sleep,
      { cursor: p, velocity: ZERO_VELOCITY, now: 10 + CFG.leaveDelayMs },
      CFG,
    );
    expect(st.passThrough, '换帧后应当按新掩膜恢复穿透').toBe(true);
  });

  it('动作过程中掩膜在变，判定也随之变化', () => {
    const cat = makeCat('cow', 20260728);
    const seen = new Set<boolean>();
    // 取身体上方的一点：伸懒腰会把身体压低又抬起，固定一点上的判定必然翻转。
    // 原先用的是扑跳的横向位移，那个位移已经移交给运动层了（动作库不再产出 dx），
    // 所以这里改用同样明显、但完全由形体本身产生的纵向变化。
    const p = { x: 40.5, y: 17.5 };
    for (const t of [0, 0.3, 0.7, 1.2, 1.9, 2.6, 3.2, 3.7]) {
      const f = frameOf(renderer.render(cat, ACTIONS.stretch.make(t, cat, MI)));
      seen.add(passThrough(f, p));
    }
    expect(seen.size, '整个伸懒腰过程中判定一成不变，说明命中形状退化成了静态矩形').toBe(2);
  });
});

describe('进入与退出的双阈值', () => {
  it('关着穿透时，退出用的边距更大', () => {
    const f = frame('orange', 'sit', 0);
    // 距离落在 (baseMargin, baseMargin + exitExtra] 的点：
    // 从穿透态看它在边距外，从不穿透态看它还在边距内。
    const band = centersAtDistance(f, CFG.baseMargin + 0.01, CFG.baseMargin + CFG.exitExtra);
    expect(band.length, '没有找到双阈值之间的点，测试是空转的').toBeGreaterThan(5);
    for (const p of band) {
      expect(passThrough(f, p, ZERO_VELOCITY, initialHitState())).toBe(true);
      expect(passThrough(f, p, ZERO_VELOCITY, { passThrough: false, leavingSince: null })).toBe(
        false,
      );
    }
  });

  it('离开后要等退出延迟走完才开启穿透', () => {
    const f = frame('orange', 'sit', 0);
    const far = centersAtDistance(f, CFG.baseMargin + CFG.exitExtra + 1, Infinity)[0]!;
    let st: HitState = { passThrough: false, leavingSince: null };

    st = stepHit(st, f, { cursor: far, velocity: ZERO_VELOCITY, now: 1000 }, CFG);
    expect(st.passThrough, '刚离开就切换会让边界抖动引发反复切换').toBe(false);

    st = stepHit(st, f, { cursor: far, velocity: ZERO_VELOCITY, now: 1000 + CFG.leaveDelayMs - 1 }, CFG);
    expect(st.passThrough).toBe(false);

    st = stepHit(st, f, { cursor: far, velocity: ZERO_VELOCITY, now: 1000 + CFG.leaveDelayMs }, CFG);
    expect(st.passThrough).toBe(true);
  });

  it('退出计时期间光标又回到猫身上，计时被取消', () => {
    const f = frame('orange', 'sit', 0);
    const far = centersAtDistance(f, CFG.baseMargin + CFG.exitExtra + 1, Infinity)[0]!;
    const on = maskCenters(f)[0]!;
    let st: HitState = { passThrough: false, leavingSince: null };

    st = stepHit(st, f, { cursor: far, velocity: ZERO_VELOCITY, now: 0 }, CFG);
    expect(st.leavingSince).toBe(0);
    st = stepHit(st, f, { cursor: on, velocity: ZERO_VELOCITY, now: 40 }, CFG);
    expect(st.leavingSince).toBe(null);
    st = stepHit(st, f, { cursor: far, velocity: ZERO_VELOCITY, now: 90 }, CFG);
    // 若计时没被取消，90 - 0 已经超过 80ms，这里就会错误地切成穿透。
    expect(st.passThrough).toBe(false);
  });
});

describe('失效方向与异常输入', () => {
  it('初始状态是穿透 - 还没判定过就绝不能截获桌面点击', () => {
    expect(initialHitState().passThrough).toBe(true);
  });

  it('光标位置未知时走向穿透', () => {
    const f = frame('orange', 'sit', 0);
    expect(passThrough(f, null)).toBe(true);
    // 已经关着穿透时也会在退出延迟后恢复
    let st: HitState = { passThrough: false, leavingSince: null };
    st = stepHit(st, f, { cursor: null, velocity: ZERO_VELOCITY, now: 0 }, CFG);
    st = stepHit(st, f, { cursor: null, velocity: ZERO_VELOCITY, now: 500 }, CFG);
    expect(st.passThrough).toBe(true);
  });

  it('越界与异常坐标不崩，且一律判为穿透', () => {
    const f = frame('orange', 'sit', 0);
    const bad: Point[] = [
      { x: -1, y: -1 },
      { x: -1000, y: -1000 },
      { x: W, y: H },
      { x: W + 500, y: H + 500 },
      { x: -0.0001, y: H / 2 },
      { x: Number.NaN, y: 10 },
      { x: 10, y: Number.NaN },
      { x: Number.POSITIVE_INFINITY, y: Number.NEGATIVE_INFINITY },
      { x: 1e308, y: 1e308 },
    ];
    for (const p of bad) {
      expect(passThrough(f, p), `(${p.x}, ${p.y}) 应当判为穿透`).toBe(true);
    }
  });

  it('异常速度不崩', () => {
    const f = frame('orange', 'sit', 0);
    const on = maskCenters(f)[0]!;
    const weird: Velocity[] = [
      { vx: Number.NaN, vy: 0, speed: Number.NaN },
      { vx: 0, vy: 0, speed: Number.POSITIVE_INFINITY },
      { vx: Number.POSITIVE_INFINITY, vy: 0, speed: Number.POSITIVE_INFINITY },
      { vx: 0, vy: 0, speed: -100 },
    ];
    for (const v of weird) {
      // 压在猫身上时无论速度多离谱都必须不穿透
      expect(passThrough(f, on, v)).toBe(false);
      expect(typeof passThrough(f, { x: 0.5, y: 0.5 }, v)).toBe('boolean');
    }
  });

  it('掩膜为空（没有猫）时一律穿透', () => {
    const empty: HitFrame = { width: W, height: H, alphaMask: new Uint8Array(W * H) };
    for (let y = 0; y < H; y += 7) {
      for (let x = 0; x < W; x += 7) {
        expect(passThrough(empty, { x: x + 0.5, y: y + 0.5 }, vx(600))).toBe(true);
      }
    }
  });
});

describe('速度估算', () => {
  it('由相邻两次采样算出速度', () => {
    const v = velocityOf({ x: 0, y: 0, t: 0 }, { x: 10, y: 0, t: 100 });
    expect(v.vx).toBeCloseTo(100);
    expect(v.speed).toBeCloseTo(100);
  });

  it('没有前一次采样时速度为零', () => {
    expect(velocityOf(null, { x: 1, y: 2, t: 3 }).speed).toBe(0);
  });

  it('时间没有前进或倒流时速度为零', () => {
    expect(velocityOf({ x: 0, y: 0, t: 5 }, { x: 9, y: 9, t: 5 }).speed).toBe(0);
    expect(velocityOf({ x: 0, y: 0, t: 9 }, { x: 9, y: 9, t: 5 }).speed).toBe(0);
  });

  it('两次采样间隔过久时不拿它算速度', () => {
    // 平均速度已经不代表当前速度，宁可当作未知（只用静止边距）。
    expect(velocityOf({ x: 0, y: 0, t: 0 }, { x: 100, y: 0, t: 1000 }).speed).toBe(0);
  });

  it('位置没变时速度为零', () => {
    expect(velocityOf({ x: 4, y: 4, t: 0 }, { x: 4, y: 4, t: 16 }).speed).toBe(0);
  });
});
