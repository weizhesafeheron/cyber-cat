import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ALL_MICRO_ON,
  PAW_LIFE_MS,
  SCROLL_EDGE,
  applyMicroSwitches,
  catInStage,
  createMotion,
  faceDir,
  microOptsFor,
  pawsInStage,
  settleStage,
  stepMotion,
} from '../../src/app/motion.js';
import type { MotionState, ScreenPoint, StageGeometry } from '../../src/app/motion.js';
import { STAGE_H, STAGE_W } from '../../src/app/stage.js';
import {
  ACTIONS,
  ACTION_KEYS,
  CatRenderer,
  GROUND,
  H,
  W,
  makeCat,
  makeMicro,
  mulberry32,
  stepMicro,
} from '../../src/render/index.js';
import type { ActionKey, Cat } from '../../src/render/index.js';
import { step } from '../../src/world/index.js';
import { TICK, feedEvery, findSeed, makeWorld } from '../world/helpers.js';

/**
 * 运动层（[ADR 0007](../../docs/adr/0007-stage-window-and-motion-layer.md)）。
 *
 * 只测**外部可观察行为**：位置怎么变、朝向怎么翻、什么时候挪窗口、爪印在哪、
 * 播的是哪个动作。内部字段（strideLeft、restS 这类）不直接断言 -
 * 它们是实现细节，锁死了就没法调手感。
 *
 * 猫一律用 makeCat 造真的，不手搓假数据：性格的取值范围、体型与动作库的
 * travel 都参与运算，假数据测出来的结论对真机不成立。
 */

/** 一个 1920x1080 的桌面，舞台贴在下沿。 */
const DESKTOP = { x: 0, y: 0, w: 1920, h: 1080 } as const;
const SPRITE_SCALE = 3;

function geom(patch: Partial<StageGeometry> = {}): StageGeometry {
  return { w: STAGE_W, h: STAGE_H, spriteScale: SPRITE_SCALE, work: DESKTOP, ...patch };
}

/** 舞台贴在桌面下沿、水平居中时的原点。 */
function centeredStage(g: StageGeometry = geom()): ScreenPoint {
  return { x: Math.round((g.work.w - g.w) / 2), y: g.work.y + g.work.h - g.h };
}

const NORMAL = makeCat('orange', 20260728);
/** 活跃度落在两端的两只真猫。与 test/world/personality.test.ts 同一套挑法。 */
const LAZY = makeCat('orange', findSeed('orange', (p) => p.active < 0.08));
const BUSY = makeCat('cow', findSeed('cow', (p) => p.active > 0.9));

interface RunOpts {
  frames: number;
  /** 帧时长，秒。默认 60fps。 */
  dt?: number;
  action?: ActionKey | null;
  cat?: Cat;
  g?: StageGeometry;
  /** 起始时刻，毫秒。 */
  now?: number;
  /** 随机源种子。 */
  seed?: number;
}

interface Frame {
  state: MotionState;
  /** 这一帧走了多远（屏幕 CSS 像素）。 */
  moved: number;
}

function run(
  start: MotionState,
  opts: RunOpts,
): { end: MotionState; frames: Frame[]; now: number } {
  const dt = opts.dt ?? 1 / 60;
  const cat = opts.cat ?? NORMAL;
  const g = opts.g ?? geom();
  const rnd = mulberry32(opts.seed ?? 1);
  let state = start;
  let now = opts.now ?? 0;
  const frames: Frame[] = [];
  for (let i = 0; i < opts.frames; i++) {
    now += dt * 1000;
    const before = state;
    state = stepMotion(state, {
      dt,
      now,
      action: opts.action === undefined ? 'walk' : opts.action,
      cat,
      geom: g,
      rnd,
    });
    frames.push({ state, moved: Math.abs(state.x - before.x) });
  }
  return { end: state, frames, now };
}

describe('位置随时间推进', () => {
  it('世界层说走路时，猫的屏幕位置真的在变', () => {
    const start = createMotion(geom(), centeredStage());
    const { end } = run(start, { frames: 60 });
    expect(end.x).not.toBe(start.x);
    expect(end.playing).toBe('walk');
  });

  it('走路中途换成别的动作，位移必须立刻停住', () => {
    // 回归保护：即时反馈（点猫播伸懒腰）曾经只覆盖渲染、没有喂给运动层，
    // 结果是「一边伸懒腰一边横向漂移」。位移的唯一开关是喂进来的动作。
    const start = createMotion(geom(), centeredStage());
    // 先真的走起来，确认位移在发生
    const walking = run(start, { frames: 40 });
    expect(Math.abs(walking.end.x - start.x)).toBeGreaterThan(0);

    // 换成任何非走路动作，之后每一帧的位移都必须是 0
    for (const action of ACTION_KEYS.filter((a) => a !== 'walk')) {
      const held = run(walking.end, { frames: 30, action, now: walking.now });
      const maxMoved = Math.max(...held.frames.map((f) => f.moved));
      expect(maxMoved, `播 ${action} 时仍在位移`).toBe(0);
      expect(held.end.playing, `播 ${action} 时 playing 不对`).toBe(action);
    }
  });

  it('走路中途换成别的动作，位移必须立刻停住', () => {
    // 回归保护：即时反馈（点猫播伸懒腰）曾经只覆盖渲染、没有喂给运动层，
    // 结果是「一边伸懒腰一边横向漂移」。位移的唯一开关是喂进来的动作。
    const start = createMotion(geom(), centeredStage());
    // 先真的走起来，确认位移在发生
    const walking = run(start, { frames: 40 });
    expect(Math.abs(walking.end.x - start.x)).toBeGreaterThan(0);

    // 换成任何非走路动作，之后每一帧的位移都必须是 0
    for (const action of ACTION_KEYS.filter((a) => a !== 'walk')) {
      const held = run(walking.end, { frames: 30, action, now: walking.now });
      const maxMoved = Math.max(...held.frames.map((f) => f.moved));
      expect(maxMoved, `播 ${action} 时仍在位移`).toBe(0);
      expect(held.end.playing, `播 ${action} 时 playing 不对`).toBe(action);
    }
  });

  it('走的距离与时间成正比：两倍时长走两倍远（对照组：同一个随机流）', () => {
    const start = createMotion(geom(), centeredStage());
    // 只统计真的在走的那些帧，休息段不该计入。
    const dist = (frames: Frame[]): number =>
      frames.reduce((sum, f) => sum + (f.state.playing === 'walk' ? f.moved : 0), 0);
    const short = dist(run(start, { frames: 30 }).frames);
    const long = dist(run(start, { frames: 60 }).frames);
    expect(long / short).toBeGreaterThan(1.9);
    expect(long / short).toBeLessThan(2.1);
  });

  it('原地动作不改变位置', () => {
    const start = createMotion(geom(), centeredStage());
    const still = ACTION_KEYS.filter((k) => k !== 'walk');
    for (const action of still) {
      const { end } = run(start, { frames: 120, action });
      expect(end.x, `${action} 改变了位置`).toBe(start.x);
      expect(end.playing).toBe(action);
    }
  });

  it('掉帧（dt 很大）不会把猫甩出活动范围', () => {
    const g = geom();
    const { frames } = run(createMotion(g, centeredStage(g)), {
      frames: 40,
      dt: 0.5,
    });
    for (const f of frames) {
      expect(f.state.x).toBeGreaterThanOrEqual(g.work.x);
      expect(f.state.x).toBeLessThanOrEqual(g.work.x + g.work.w);
    }
  });
});

describe('朝向', () => {
  it('走路时朝向始终是目标所在的一侧', () => {
    const { frames } = run(createMotion(geom(), centeredStage()), {
      frames: 3000,
      seed: 7,
    });
    let checked = 0;
    for (const f of frames) {
      if (f.state.playing !== 'walk' || f.state.targetX == null) continue;
      const side = f.state.targetX > f.state.x ? 1 : -1;
      expect(f.state.dir).toBe(side);
      checked++;
    }
    // 对照组：确实有足够多的帧在走路，否则上面的循环是空转。
    expect(checked).toBeGreaterThan(500);
  });

  it('长时间漫游会往两个方向都走（不是单向直线跑掉）', () => {
    const { frames } = run(createMotion(geom(), centeredStage()), {
      frames: 6000,
      seed: 3,
    });
    const dirs = new Set(frames.map((f) => f.state.dir));
    expect(dirs).toEqual(new Set([1, -1]));
  });

  it('朝左时把「朝前」的偏移量一并翻转，否则会面朝左往右扑', () => {
    const pose = { dx: 10, legOx: [4, 3, -3, -4], pupilDX: 1, headDX: 2 } as const;
    expect(faceDir(pose, 1)).toEqual({ ...pose, dir: 1 });
    const left = faceDir(pose, -1);
    expect(left.dir).toBe(-1);
    expect(left.dx).toBe(-10);
    expect(left.legOx).toEqual([-4, -3, 3, 4]);
    expect(left.pupilDX).toBe(-1);
    // headDX 不能翻：渲染层已经替它乘过 dir，再翻一次就抵消了。
    expect(left.headDX).toBe(2);
  });

  it('没设过的偏移量不会被凭空补成 0', () => {
    expect(faceDir({ form: 'sit' }, -1)).toEqual({ form: 'sit', dir: -1 });
  });
});

describe('抵达目标后交还控制', () => {
  it('走到目标就停下改播站立呼吸，不再推进位置', () => {
    const start = createMotion(geom(), centeredStage());
    const { frames } = run(start, { frames: 600 });
    const arrival = frames.findIndex((f) => f.state.playing === 'idle');
    // 对照组：这段时间里确实到过一次目标。
    expect(arrival).toBeGreaterThan(0);
    expect(frames[arrival - 1]!.state.playing).toBe('walk');
    expect(frames[arrival]!.state.targetX).toBeNull();
    // 抵达那一帧正好停在目标上，不多走也不瞬移。
    expect(frames[arrival]!.state.x).toBe(frames[arrival - 1]!.state.targetX);
    // 之后位置不再变，直到下一段路开始。
    const rested = frames.slice(arrival + 1).findIndex((f) => f.state.playing === 'walk');
    expect(rested).toBeGreaterThan(0);
    for (let i = arrival + 1; i <= arrival + rested; i++) {
      expect(frames[i]!.moved).toBe(0);
    }
  });

  it('世界层改主意时立刻放弃当前目标', () => {
    const walked = run(createMotion(geom(), centeredStage()), { frames: 30 }).end;
    expect(walked.targetX).not.toBeNull();
    const { end } = run(walked, { frames: 1, action: 'sit' });
    expect(end.targetX).toBeNull();
    expect(end.playing).toBe('sit');
  });

  it('走到活动范围尽头会停下来，不会贴着墙一直播走路', () => {
    // 舞台钉在桌面最左边，猫只能在半个舞台宽里活动。
    const g = geom();
    const stage = { x: g.work.x, y: g.work.y + g.work.h - g.h };
    const { frames } = run(createMotion(g, stage), { frames: 2000, seed: 11 });
    const stuck = frames.filter((f) => f.state.playing === 'walk' && f.moved === 0);
    expect(stuck).toHaveLength(0);
  });
});

describe('舞台滚动的滞后', () => {
  const g = geom();

  /** 舞台原点变了的那些帧的下标。平台层就是靠这个信号下发窗口移动的。 */
  const scrollsIn = (frames: Frame[]): number[] =>
    frames.flatMap((f, i) =>
      i > 0 && f.state.stage !== frames[i - 1]!.state.stage ? [i] : [],
    );

  it('猫在舞台中部时窗口不动', () => {
    const start = createMotion(g, centeredStage(g));
    const { frames } = run(start, { frames: 60 });
    for (const f of frames) {
      // 对照组：猫确实在动，只是还没走到边上。
      const local = catInStage(f.state);
      expect(local).toBeGreaterThan(g.w * SCROLL_EDGE);
      expect(local).toBeLessThan(g.w * (1 - SCROLL_EDGE));
      expect(f.state.stage).toBe(start.stage);
    }
    expect(frames[frames.length - 1]!.state.x).not.toBe(start.x);
  });

  it('接近边缘才挪，而且一次走够远才挪第二次', () => {
    const start = createMotion(g, centeredStage(g));
    const { frames } = run(start, { frames: 1200, seed: 5 });
    const scrolls = scrollsIn(frames);
    // 对照组：这段时间里确实挪过。
    expect(scrolls.length).toBeGreaterThan(0);

    const first = scrolls[0]!;
    // 触发的那一帧，猫确实已经进了边缘区（用挪之前的舞台算）。
    const localBefore = frames[first]!.state.x - frames[first - 1]!.state.stage.x;
    expect(localBefore < g.w * SCROLL_EDGE || localBefore > g.w * (1 - SCROLL_EDGE)).toBe(true);

    // 两次滚动之间至少隔着「触发线到落点」那段路，不会连着挪。
    // 20 帧 ≈ 0.33 秒是很宽松的下界；真实间隔是几秒。
    for (let i = 1; i < scrolls.length; i++) {
      expect(scrolls[i]! - scrolls[i - 1]!).toBeGreaterThan(20);
    }
  });

  it('挪完之后整只猫都在舞台里，身后留着爪印的空间', () => {
    const start = createMotion(g, centeredStage(g));
    const { frames } = run(start, { frames: 4000, seed: 5 });
    const scrolls = scrollsIn(frames);
    expect(scrolls.length).toBeGreaterThan(1);
    for (const i of scrolls) {
      const state = frames[i]!.state;
      const local = catInStage(state);
      // 整只猫都在舞台里
      expect(local).toBeGreaterThan((W * SPRITE_SCALE) / 2);
      expect(local).toBeLessThan(g.w - (W * SPRITE_SCALE) / 2);
      // 身后（行进方向的反面）至少留出一个精灵宽给爪印
      const behind = state.dir > 0 ? local : g.w - local;
      expect(behind).toBeGreaterThan(W * SPRITE_SCALE);
    }
  });

  it('挪窗口不改变猫的屏幕位置 - 舞台滚动在视觉上应当是看不见的', () => {
    const start = createMotion(g, centeredStage(g));
    const { frames } = run(start, { frames: 1200, seed: 5 });
    const i = scrollsIn(frames)[0]!;
    const before = frames[i - 1]!.state;
    const after = frames[i]!.state;
    // 舞台内位置变了多少，窗口就该反向挪多少 - 两者相加只剩这一帧走的那点距离，
    // 猫看起来才是连续走过去的，而不是跳了一下。
    const dLocal = catInStage(after) - catInStage(before);
    const dStage = after.stage.x - before.stage.x;
    expect(Math.abs(dLocal + dStage)).toBeLessThan(frames[i]!.moved + 1e-6);
    // 而舞台确实挪了一大段（否则上面这条会因为「根本没挪」而恒真）。
    expect(Math.abs(dStage)).toBeGreaterThan(g.w * 0.1);
  });

  it('舞台被工作区钳住，不会挪出屏幕', () => {
    const start = createMotion(g, centeredStage(g));
    const { frames } = run(start, { frames: 8000, seed: 9 });
    for (const f of frames) {
      expect(f.state.stage.x).toBeGreaterThanOrEqual(g.work.x);
      expect(f.state.stage.x + g.w).toBeLessThanOrEqual(g.work.x + g.work.w);
    }
  });

  it('猫始终整只都在舞台里 - 舞台是画布，走出去就会被裁掉半只猫', () => {
    const start = createMotion(g, centeredStage(g));
    const { frames } = run(start, { frames: 8000, seed: 9 });
    const half = (W * SPRITE_SCALE) / 2;
    for (const f of frames) {
      expect(catInStage(f.state)).toBeGreaterThanOrEqual(half);
      expect(catInStage(f.state)).toBeLessThanOrEqual(g.w - half);
    }
  });

  it('工作区变了（程序坞显隐、改分辨率）会把舞台重新贴到下沿', () => {
    const start = createMotion(g, centeredStage(g));
    const shrunk = geom({ work: { x: 0, y: 0, w: 1920, h: 900 } });
    const { end } = run(start, { frames: 1, action: 'sit', g: shrunk });
    expect(end.stage.y).toBe(900 - STAGE_H);
  });

  it('平台层校正舞台原点时，猫的屏幕位置不动', () => {
    const walked = run(createMotion(g, centeredStage(g)), { frames: 300, seed: 5 }).end;
    const corrected = settleStage(walked, { x: walked.stage.x - 120, y: walked.stage.y });
    expect(corrected.x).toBe(walked.x);
    expect(catInStage(corrected)).toBe(catInStage(walked) + 120);
  });
});

describe('爪印', () => {
  const g = geom();

  it('走路会留下爪印，站着不会', () => {
    const start = createMotion(g, centeredStage(g));
    expect(run(start, { frames: 120, action: 'sit' }).end.paws).toHaveLength(0);
    expect(run(start, { frames: 120 }).end.paws.length).toBeGreaterThan(0);
  });

  it('按屏幕坐标记录：舞台滚动之后爪印还在原来的屏幕位置', () => {
    const start = createMotion(g, centeredStage(g));
    const walked = run(start, { frames: 240, seed: 5 }).end;
    expect(walked.paws.length).toBeGreaterThan(2);
    const screenXs = walked.paws.map((p) => p.x);
    const localXs = pawsInStage(walked, 0).map((p) => p.x);

    // 手动挪一次舞台
    const shifted = settleStage(walked, { x: walked.stage.x + 200, y: walked.stage.y });
    expect(shifted.paws.map((p) => p.x)).toEqual(screenXs);
    // 屏幕位置不动 → 舞台内坐标必须整体反向平移，画出来才留在原地
    const moved = pawsInStage(shifted, 0).map((p) => p.x);
    localXs.forEach((x, i) => expect(moved[i]!).toBeCloseTo(x - 200, 9));
  });

  it('爪印落在猫脚下的地面线上', () => {
    const start = createMotion(g, centeredStage(g));
    const walked = run(start, { frames: 240, seed: 5 }).end;
    const groundLocal = g.h - (H - GROUND) * g.spriteScale;
    for (const paw of pawsInStage(walked, 0)) {
      expect(paw.y).toBe(groundLocal);
    }
  });

  it('几秒后淡去并消失，不会无限累积', () => {
    const g2 = geom();
    const lifeFrames = Math.ceil((PAW_LIFE_MS / 1000) * 60);
    // 连着走十倍爪印寿命的时长，中途按寿命取样。时间必须连续往前 -
    // 时间戳一旦倒流，「过期」的判定就永远不成立，这条测试会变成恒真。
    let state = createMotion(g2, centeredStage(g2));
    let now = 0;
    const counts: number[] = [];
    for (let i = 0; i < 10; i++) {
      const r = run(state, { frames: lifeFrames, now, seed: 5 });
      state = r.end;
      now = r.now;
      counts.push(state.paws.length);
    }
    expect(Math.min(...counts)).toBeGreaterThan(0);
    // 稳定在「一个寿命内能走出的枚数」量级，不随时间增长
    expect(Math.max(...counts)).toBeLessThan(counts[0]! * 3);
    expect(Math.max(...counts)).toBeLessThan(40);

    // 停下来之后全部淡完
    const stopped = run(state, { frames: 4, dt: PAW_LIFE_MS / 1000 / 2, action: 'sit', now });
    expect(stopped.end.paws).toHaveLength(0);
  });

  it('不透明度从 1 淡到 0', () => {
    const g2 = geom();
    const walked = run(createMotion(g2, centeredStage(g2)), { frames: 60, seed: 5 }).end;
    const paw = walked.paws[0]!;
    expect(pawsInStage(walked, paw.at)[0]!.alpha).toBe(1);
    const mid = pawsInStage(walked, paw.at + PAW_LIFE_MS * 0.7)[0]!.alpha;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(pawsInStage(walked, paw.at + PAW_LIFE_MS)[0]!.alpha).toBe(0);
  });
});

describe('性格影响行为', () => {
  const g = geom();
  const start = (): MotionState => createMotion(g, centeredStage(g));

  /** 走路时的平均速度（CSS 像素/秒），只取真的在走的帧。 */
  function walkSpeedOf(cat: Cat): number {
    const dt = 1 / 60;
    const { frames } = run(start(), { frames: 3000, cat, seed: 4 });
    const walking = frames.filter((f) => f.state.playing === 'walk');
    const dist = walking.reduce((s, f) => s + f.moved, 0);
    return dist / (walking.length * dt);
  }

  it('对照组：两只猫的活跃度确实落在两端', () => {
    expect(BUSY.personality.active - LAZY.personality.active).toBeGreaterThan(0.7);
  });

  it('活跃的猫走得更快', () => {
    expect(walkSpeedOf(BUSY)).toBeGreaterThan(walkSpeedOf(LAZY) * 1.2);
  });

  it('懒猫在同一段「走路」时段里站着不动的时间明显更多', () => {
    const idleShare = (cat: Cat): number => {
      const { frames } = run(start(), { frames: 3000, cat, seed: 4 });
      return frames.filter((f) => f.state.playing === 'idle').length / frames.length;
    };
    const lazy = idleShare(LAZY);
    const busy = idleShare(BUSY);
    // 对照组：两边都确实走了一部分时间，不是一方全程站着。
    expect(lazy).toBeLessThan(0.9);
    expect(busy).toBeGreaterThan(0);
    expect(lazy).toBeGreaterThan(busy * 1.5);
  });
});

describe('动作库全部接上', () => {
  it('十个基础动作都能播出可见的猫', () => {
    expect(ACTION_KEYS).toHaveLength(10);
    const renderer = new CatRenderer();
    const mi = makeMicro(1);
    const g = geom();
    for (const key of ACTION_KEYS) {
      const { end } = run(createMotion(g, centeredStage(g)), { frames: 10, action: key });
      // 运动层要么原样放行，要么在走完一段路后改播站立呼吸。
      expect(end.playing === key || (key === 'walk' && end.playing === 'idle')).toBe(true);
      const pose = ACTIONS[end.playing!].make(1.1, NORMAL, stepMicro(mi, 0.016, {}));
      const res = renderer.render(NORMAL, faceDir(pose, end.dir));
      expect(res.alphaMask.some((v) => v === 255), `${key} 画出来是空的`).toBe(true);
    }
  });

  it('世界层长跑会用到全部十个动作', () => {
    // 40 天，每 4 小时添一次粮。晨昏节律、睡眠、进食、刚醒伸懒腰都在这段里出现。
    const feed = feedEvery(8);
    let world = makeWorld({ breed: 'cow', seed: findSeed('cow', (p) => p.active > 0.9), hour: 5 });
    const seen = new Set<string>();
    for (let i = 0; i < 40 * 48; i++) {
      const r = step(world, TICK, feed(i));
      world = r.world;
      if (world.dead) throw new Error('长跑里猫死了，统计不成立');
      if (r.renderIntent.action) seen.add(r.renderIntent.action);
    }
    expect([...seen].sort()).toEqual([...ACTION_KEYS].sort());
  });

  it('猫已离开时不播任何动作', () => {
    const g = geom();
    const { end } = run(createMotion(g, centeredStage(g)), { frames: 5, action: null });
    expect(end.playing).toBeNull();
  });
});

describe('五个微动作独立开关且与基础动作正交', () => {
  it('眨眼 / 耳抖 / 歪头由开关直接控制', () => {
    expect(microOptsFor(ALL_MICRO_ON, {})).toEqual({ blink: true, ear: true, tilt: false });
    expect(microOptsFor(ALL_MICRO_ON, { tilt: true })).toEqual({
      blink: true,
      ear: true,
      tilt: true,
    });
    expect(microOptsFor({ ...ALL_MICRO_ON, blink: false }, { tilt: true }).blink).toBe(false);
    expect(microOptsFor({ ...ALL_MICRO_ON, ear: false }, {}).ear).toBe(false);
    expect(microOptsFor({ ...ALL_MICRO_ON, tilt: false }, { tilt: true }).tilt).toBe(false);
  });

  it('世界层关掉的微动作不会被总开关重新打开（睡着的猫不歪头）', () => {
    const sleeping = { blink: false, ear: false, tilt: false };
    expect(microOptsFor(ALL_MICRO_ON, sleeping)).toEqual(sleeping);
  });

  it('尾巴与呼吸能单独关掉，且不影响其他姿态量', () => {
    const mi = stepMicro(makeMicro(1), 0.5, {});
    for (const key of ACTION_KEYS) {
      const pose = ACTIONS[key].make(1.7, NORMAL, mi);
      expect(applyMicroSwitches(pose, ALL_MICRO_ON)).toBe(pose);

      const noTail = applyMicroSwitches(pose, { ...ALL_MICRO_ON, tail: false });
      expect(noTail.tailWave).toBe(0);
      expect(noTail.breath).toBe(pose.breath);
      expect(noTail.form).toBe(pose.form);

      const noBreath = applyMicroSwitches(pose, { ...ALL_MICRO_ON, breath: false });
      expect(noBreath.breath).toBe(0);
      expect(noBreath.tailWave).toBe(pose.tailWave);
    }
  });

  it('开关不改动传进来的姿态（正交的前提是不互相污染）', () => {
    const pose = { tailWave: 1.2, breath: 0.05 };
    const copy = { ...pose };
    applyMicroSwitches(pose, { blink: false, ear: false, tilt: false, tail: false, breath: false });
    expect(pose).toEqual(copy);
  });

  it('五个微动作全关掉之后，站立呼吸变成一张静止的图（逐像素对照）', () => {
    // 这是「微动作层是活着的感觉的主要来源」这句话的可验证形式：
    // 关掉之后 idle 的画面完全不随时间变化。
    const renderer = new CatRenderer();
    const ALL_OFF = { blink: false, ear: false, tilt: false, tail: false, breath: false };
    const frameAt = (t: number, sw: typeof ALL_MICRO_ON): string => {
      const mi = stepMicro(makeMicro(1), 0.4, microOptsFor(sw, {}));
      const pose = applyMicroSwitches(ACTIONS.idle.make(t, NORMAL, mi), sw);
      return renderer.render(NORMAL, pose).alphaMask.join('');
    };
    // 对照组：开着的时候一个半呼吸周期之后画面必须不同，否则这条测试恒真。
    expect(frameAt(0, ALL_MICRO_ON)).not.toBe(frameAt(1.6, ALL_MICRO_ON));
    expect(frameAt(0, ALL_OFF)).toBe(frameAt(1.6, ALL_OFF));
    expect(frameAt(0, ALL_OFF)).toBe(frameAt(7.3, ALL_OFF));
  });
});

describe('腾空必须同时处理腿的位置', () => {
  it('扑跳腾空时四脚离地：最低的猫像素比落地时的脚位高出至少两像素', () => {
    const renderer = new CatRenderer();
    const mi = makeMicro(1);
    // 落地时爪子画在 GROUND - 1 那一行（drawLeg 的 bottom）。
    const FOOT_ROW = GROUND - 1;
    let peaks = 0;
    for (const breed of ['orange', 'black', 'cow', 'ragdoll', 'devon', 'amshort', 'aby'] as const) {
      const cat = makeCat(breed, 7);
      for (let i = 0; i <= 24; i++) {
        const t = 1.3 + (i / 24) * 0.55;
        const pose = ACTIONS.pounce.make(t, cat, stepMicro(mi, 0, {}));
        if ((pose.airborne ?? 0) < 4) continue; // 起跳与落地的过渡段脚本来就该挨着地
        peaks++;
        for (const dir of [1, -1] as const) {
          const res = renderer.render(cat, faceDir(pose, dir));
          let lowest = -1;
          for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) if (res.alphaMask[y * W + x] === 255) lowest = y;
          }
          expect(lowest, `${breed} dir=${dir} t=${t.toFixed(2)} 腾空时还有像素贴着地`).toBeLessThan(
            FOOT_ROW - 1,
          );
        }
      }
    }
    // 对照组：确实取到了腾空段的帧。
    expect(peaks).toBeGreaterThan(50);
  });

  it('结构守卫：任何把身体抬离地面的姿态都必须设 airborne', () => {
    const mi = makeMicro(1);
    for (const key of ACTION_KEYS) {
      const period = ACTIONS[key].period ?? 5;
      for (let i = 0; i < 400; i++) {
        const pose = ACTIONS[key].make((i / 400) * period, NORMAL, stepMicro(mi, 0, {}));
        // 走路的 1 像素起伏不算离地 - 那是步态，腿仍然踩在地面线上。
        if ((pose.dy ?? 0) > -2) continue;
        expect(pose.airborne ?? 0, `${key} 抬起了身体但没抬腿`).toBeGreaterThan(0);
      }
    }
  });
});

describe('世界层与运动层接起来跑', () => {
  /**
   * 按 60fps 把世界与运动层一起推进一段真实时长。
   *
   * 这是「连续观察十分钟」那条手工验收里可以自动化的部分：真实的世界演化
   * 驱动真实的运动层，看猫到底动没动。观感本身仍然只能靠真机看。
   */
  function observe(minutes: number, seed: number, breed: 'orange' | 'cow', want?: ActionKey) {
    const g = geom();
    const dt = 1 / 60;
    let world = makeWorld({ breed, seed, hour: 5 });
    // 先把世界推到「猫决定要做这件事」的那个整步上。
    // 世界层半小时才改一次主意，而 walk 只占少数的半小时块（睡觉占掉大半天），
    // 随便取一个时刻观察十分钟很可能什么都没发生 - 这不是缺陷，是晨昏节律。
    if (want) {
      const feed = feedEvery(8);
      let found = false;
      for (let i = 0; i < 48 * 30 && !found; i++) {
        const r = step(world, TICK, feed(i));
        world = r.world;
        found = r.renderIntent.action === want;
      }
      if (!found) throw new Error(`三十天里没等到 ${want}，测试脚手架坏了`);
    }
    const cat = makeCat(breed, seed);
    let motion = createMotion(g, centeredStage(g));
    const rnd = mulberry32(99);
    let now = 0;
    let distance = 0;
    let paws = 0;
    const played = new Set<string>();
    const worldActions = new Set<string>();
    // 最长的单个动作段落，帧数。用来分辨「换得勤」与「分布合理」。
    let longestRun = 0;
    let run = 0;
    let last: string | null = null;
    for (let i = 0; i < minutes * 60 * 60; i++) {
      now += dt * 1000;
      const r = step(world, dt * 1000, {});
      world = r.world;
      const acted = r.renderIntent.action ?? 'none';
      worldActions.add(acted);
      run = acted === last ? run + 1 : 1;
      last = acted;
      longestRun = Math.max(longestRun, run);
      const before = motion;
      motion = stepMotion(motion, {
        dt: dt * r.renderIntent.timeScale,
        now,
        action: r.renderIntent.action,
        cat,
        geom: g,
        rnd,
      });
      distance += Math.abs(motion.x - before.x);
      paws += Math.max(0, motion.paws.length - before.paws.length);
      played.add(motion.playing ?? 'none');
    }
    return { distance, paws, played, worldActions, longestRun, motion };
  }

  const BUSY_SEED = findSeed('cow', (p) => p.active > 0.9);

  it('世界层说走路的那半小时里，猫真的在桌面上走了一段路并留下爪印', () => {
    const busy = observe(10, BUSY_SEED, 'cow', 'walk');
    // 走过的路超过一个舞台宽，也就是说舞台一定滚动过。
    expect(busy.distance).toBeGreaterThan(STAGE_W);
    expect(busy.paws).toBeGreaterThan(20);
  });

  it('连续观察十分钟，世界层自己换过好几种动作', () => {
    // 这是 #7「行为读起来是自主的」那条手工验收里可以自动化的部分。
    //
    // 这条测试原先断言的恰好是反面：「世界层半小时才改一次主意，十分钟里最多
    // 两种动作」。当时把它当成架构特性写了下来，真机上一看才知道是个缺陷 -
    // 猫会一动不动地趴满 30 分钟，读起来就是张静止的贴图。
    // 修法是把「猫在做什么」从 30 分钟的模拟步里拆到 15 秒的行为节拍上
    // （见 constants.ts 的 BEAT_MS）。
    const busy = observe(10, BUSY_SEED, 'cow', 'walk');
    expect(busy.worldActions.size).toBeGreaterThanOrEqual(4);
    // 运动层仍然在世界层之上加自己的层次：走路被拆成「走一段、歇一会」。
    expect(busy.played.size).toBeGreaterThan(1);
  });

  it('十分钟里没有哪个动作独占全场（不是换得勤，是分布合理）', () => {
    // 只数「换过几种」会被一个每拍乱跳的实现骗过去。这条从另一头夹：
    // 最长的单个动作段落不能长到把十分钟吃掉大半。
    const busy = observe(10, BUSY_SEED, 'cow', 'walk');
    const frames = 10 * 60 * 60;
    expect(busy.longestRun).toBeLessThan(frames * 0.5);
    // 也不能碎成节拍器 - 至少有一段动作持续了半分钟以上。
    expect(busy.longestRun).toBeGreaterThan(30 * 60);
  });

  it('静态动作的那半小时里，运动层不会自己加戏', () => {
    // 世界层说睡觉就睡觉。运动层只有在「走路」时才有决定权。
    const busy = observe(10, BUSY_SEED, 'cow', 'sleep');
    expect(busy.distance).toBe(0);
    expect(busy.paws).toBe(0);
    expect([...busy.played]).toEqual(['sleep']);
  });

  it('十分钟结束时猫仍然整只在舞台里、爪印数量有界', () => {
    const busy = observe(10, BUSY_SEED, 'cow', 'walk');
    const half = (W * SPRITE_SCALE) / 2;
    expect(catInStage(busy.motion)).toBeGreaterThanOrEqual(half);
    expect(catInStage(busy.motion)).toBeLessThanOrEqual(STAGE_W - half);
    expect(busy.motion.paws.length).toBeLessThan(40);
  });
});

describe('分层边界', () => {
  it('运动层不引用世界层 - 编译期就断掉回写世界的通路', () => {
    const src = readFileSync(new URL('../../src/app/motion.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/from '\.\.\/world/);
  });

  it('stepMotion 是纯函数：不改动传进来的状态', () => {
    const g = geom();
    const start = createMotion(g, centeredStage(g));
    const snapshot = JSON.stringify(start);
    run(start, { frames: 300 });
    expect(JSON.stringify(start)).toBe(snapshot);
  });

  it('运动层的状态可以整体丢掉重建 - 它本来就不进存档', () => {
    const g = geom();
    const walked = run(createMotion(g, centeredStage(g)), { frames: 300 }).end;
    const fresh = createMotion(g, walked.stage);
    expect(fresh.paws).toHaveLength(0);
    expect(fresh.playing).toBeNull();
    // 重建之后照样能走
    expect(run(fresh, { frames: 60 }).end.x).not.toBe(fresh.x);
  });
});
