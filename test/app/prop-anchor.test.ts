import { describe, expect, it } from 'vitest';
import {
  createMotion,
  groundScreenY,
  reachableX,
  stepMotion,
} from '../../src/app/motion.js';
import type { MotionState, StageGeometry } from '../../src/app/motion.js';
import { STAGE_H, STAGE_W } from '../../src/app/stage.js';
import {
  PROP_REACH_SPRITE,
  PROP_SPRITE,
  anchorScreenX,
  defaultPropsState,
  propCenterX,
  withPlacement,
} from '../../src/props/index.js';
import type { PropKind, PropsState } from '../../src/props/index.js';
import { W, makeCat, mulberry32 } from '../../src/render/index.js';
import type { ActionKey } from '../../src/render/index.js';
import { BEATS_PER_TICK, step } from '../../src/world/index.js';
import type { World } from '../../src/world/index.js';
import { findSeed, makeWorld } from '../world/helpers.js';

/**
 * 「进食与睡觉是空间行为」这条跨层契约的自动化部分（ticket 08）。
 *
 * 三层一起跑：世界层决定吃不吃、睡不睡（只说挂件的名字），挂件层把名字换算成
 * 屏幕 x，运动层把猫送过去。这里断言的是**那个只能在真机上看的画面里可以量化的
 * 部分**：猫播吃饭的每一帧，它离食盆有多远。
 *
 * 手工验收仍然必要（走过去好不好看、低头的位置对不对），但
 * 「猫在屏幕左边、食盆在右边，猫却在原地吃了」这种事不需要人眼来发现。
 */

const DESKTOP = { x: 0, y: 0, w: 1920, h: 1080 } as const;
const SPRITE_SCALE = 3;
const GEOM: StageGeometry = {
  w: STAGE_W,
  h: STAGE_H,
  spriteScale: SPRITE_SCALE,
  work: DESKTOP,
};
const GROUND_Y = groundScreenY(GEOM);

/** 半个精灵宽。猫的锚点是精灵横向中心，判定距离时要把它算进去。 */
const HALF_CAT = (W * SPRITE_SCALE) / 2;

/** 贪吃度接近上限 / 下限的两只真猫。与 invitation.test.ts 同一套挑法。 */
const GREEDY_SEED = findSeed('orange', (p) => p.greedy > 0.93);
const PICKY_SEED = findSeed('orange', (p) => p.greedy < 0.07);

interface Sample {
  /** 这一帧运动层真正在播的动作。 */
  readonly playing: ActionKey | null;
  /** 猫锚点的屏幕 x。 */
  readonly x: number;
  /** 世界层这一帧的意图动作。 */
  readonly wanted: ActionKey | null;
  /** 世界层这一帧说的锚点。 */
  readonly anchor: PropKind | null;
  /** 这一帧世界层有没有判定「吃了」。 */
  readonly ate: boolean;
}

interface CoupleOpts {
  world: World;
  props?: PropsState;
  /** 帧数。默认跑到世界层的下一个模拟步之后。 */
  frames?: number;
  /** 猫的起始屏幕 x。默认贴着桌面左边。 */
  catX?: number;
  /**
   * 关掉锚点。用作对照组 - 没有锚点时猫会在离食盆很远的地方吃，
   * 那正是这一票要消灭的画面。
   */
  noAnchor?: boolean;
  seed?: number;
}

/** 把世界层、挂件层、运动层按 60fps 一起推进。 */
function couple(opts: CoupleOpts): { samples: Sample[]; props: PropsState; end: MotionState } {
  const dt = 1 / 60;
  const props = opts.props ?? defaultPropsState(DESKTOP, GROUND_Y, SPRITE_SCALE);
  const rnd = mulberry32(opts.seed ?? 5);
  let world = opts.world;
  const cat = makeCat(world.identity.breed, world.identity.seed);

  // 舞台钉在桌面左边，猫从最左边出发 - 这样「走过去」是一段真的路。
  let motion = createMotion(GEOM, { x: DESKTOP.x, y: GROUND_Y });
  if (opts.catX !== undefined) motion = { ...motion, x: opts.catX };

  const samples: Sample[] = [];
  let now = 0;
  for (let i = 0; i < (opts.frames ?? 2400); i++) {
    now += dt * 1000;
    const r = step(world, dt * 1000, {});
    world = r.world;
    const intent = r.renderIntent;
    const anchorX = opts.noAnchor
      ? null
      : anchorScreenX(
          intent.anchor ?? 'bowl',
          props,
          motion.x,
          reachableX(GEOM),
          SPRITE_SCALE,
        );
    motion = stepMotion(motion, {
      dt: dt * intent.timeScale,
      now,
      action: intent.action,
      anchorX: intent.anchor === null ? null : anchorX,
      cat,
      geom: GEOM,
      rnd,
    });
    samples.push({
      playing: motion.playing,
      x: motion.x,
      wanted: intent.action,
      anchor: intent.anchor,
      ate: r.events.some((e) => e.kind === 'ate' || e.kind === 'ateGreedy'),
    });
  }
  return { samples, props, end: motion };
}

/**
 * 猫离挂件贴图边缘的距离（负数 = 重叠）。
 *
 * 量到贴图边缘而不是中心：「猫在食盆前」这件事在画面上就是猫的身体挨着盆，
 * 中心距离会随挂件宽度变化，读不出来。
 */
function gapTo(kind: PropKind, props: PropsState, catX: number): number {
  const center = propCenterX(kind, props[kind]);
  const halfProp = (PROP_SPRITE[kind].w * SPRITE_SCALE) / 2;
  return Math.abs(catX - center) - halfProp - HALF_CAT;
}

/**
 * 一个碗里有粮、已经达到这只猫开吃阈值的世界。
 *
 * 开吃意愿现在按 5 秒行为节拍响应；世界账本不读屏幕坐标，运动层仍负责先走到
 * 食盆再播放吃饭。因此这个夹具同时覆盖“快速接受邀请”和“不隔空吃饭”。
 *
 * 黄昏 + 精力接近满格：这一段里猫既不会犯困去睡觉，也不会因为精力耗尽倒下 -
 * 否则「去食盆」会被睡眠这个持续状态压过去（advanceBeat 里睡眠优先于一切），
 * 测的就不是进食了。
 */
function aboutToEat(seed: number, hunger: number): World {
  return makeWorld({
    seed,
    hour: 18,
    patch: {
      bowl: 2,
      needs: { hunger, energy: 95, mood: 60 },
    },
  });
}

describe('猫走到食盆前才吃', () => {
  it('播吃饭的每一帧，猫都紧挨着食盆', () => {
    // 这是「不能出现猫在屏幕左边、食盆在右边、猫却在原地吃了」的硬约束。
    const { samples, props } = couple({ world: aboutToEat(GREEDY_SEED, 60) });
    const eating = samples.filter((s) => s.playing === 'eat');
    // 对照组：这段时间里确实吃上了，否则下面的循环是空转。
    expect(eating.length).toBeGreaterThan(60);
    for (const s of eating) {
      // 落点是「盆心 ± reach」，reach 是 18 个精灵像素，比半个精灵宽（36）还小，
      // 所以猫的身体一定与盆重叠 - gap 为负。
      expect(gapTo('bowl', props, s.x), `在离食盆 ${gapTo('bowl', props, s.x)} 像素处吃饭`).toBeLessThan(0);
    }
  });

  it('够饿时世界层按短节拍接受食物，画面仍然走到盆前才动嘴', () => {
    // 世界账本不再为了屏幕上的路程等待半小时；屏幕坐标仍只归运动层，
    // 所以账本可以先结算，但任何一帧吃饭画面都必须等到猫抵达。
    const { samples, props } = couple({ world: aboutToEat(GREEDY_SEED, 60) });
    const at = samples.findIndex((s) => s.ate);
    expect(at, '这段时间里世界层没有判定进食').toBeGreaterThan(0);
    expect(at, '进食仍然被 30 分钟模拟步拖住').toBeLessThanOrEqual(60 * 5);
    expect(gapTo('bowl', props, samples[at]!.x)).toBeGreaterThan(0);

    const visual = samples.findIndex((s) => s.playing === 'eat');
    expect(visual, '画面没有播放吃饭动作').toBeGreaterThan(at);
    expect(gapTo('bowl', props, samples[visual]!.x)).toBeLessThan(0);
  });

  it('世界已经接受进食邀请后，猫在盆前不会停成站立等待', () => {
    const { samples, props } = couple({ world: aboutToEat(GREEDY_SEED, 60) });
    const arrival = samples.findIndex(
      (sample) => sample.anchor === 'bowl' && gapTo('bowl', props, sample.x) < 0,
    );
    expect(arrival, '猫没有走到食盆前').toBeGreaterThan(0);
    const eating = samples.findIndex((sample, index) => index >= arrival && sample.playing === 'eat');
    expect(eating, '猫到了食盆前仍没有播放吃饭').toBeGreaterThanOrEqual(arrival);
    for (const sample of samples.slice(arrival, eating)) {
      expect(sample.playing, '猫在走到精确落点之前先停成了站立等待').toBe('walk');
    }
  });

  it('走过去的那段路真的走了 - 不是一开始就站在盆边', () => {
    const { samples, props } = couple({ world: aboutToEat(GREEDY_SEED, 60) });
    // 起点离食盆很远
    expect(gapTo('bowl', props, samples[0]!.x)).toBeGreaterThan(400);
    // 中间有一大段在走
    expect(samples.filter((s) => s.playing === 'walk').length).toBeGreaterThan(300);
    // 走的方向是朝食盆去的：位置单调靠近
    const first = samples[0]!.x;
    const arrival = samples.find((s) => s.playing === 'eat')!;
    expect(Math.abs(arrival.x - propCenterX('bowl', props.bowl))).toBeLessThan(
      Math.abs(first - propCenterX('bowl', props.bowl)),
    );
  });

  it('对照组：没有锚点时猫会在离食盆很远的地方吃 - 这才是要消灭的画面', () => {
    const { samples, props } = couple({ world: aboutToEat(GREEDY_SEED, 60), noAnchor: true });
    const eating = samples.filter((s) => s.playing === 'eat');
    expect(eating.length).toBeGreaterThan(60);
    // 至少有一帧是在远处吃的。（没有锚点时猫在漫游，位置随机，
    // 所以只断言「存在」而不是「全部」。）
    expect(Math.max(...eating.map((s) => gapTo('bowl', props, s.x)))).toBeGreaterThan(200);
  });

  it('食盆被藏起来时猫照旧在原地吃 - 画面上没有盆，走过去反而是灵异现象', () => {
    const base = defaultPropsState(DESKTOP, GROUND_Y, SPRITE_SCALE);
    const hidden = withPlacement(base, 'bowl', { visible: false });
    const { samples } = couple({ world: aboutToEat(GREEDY_SEED, 60), props: hidden });
    const eating = samples.filter((s) => s.playing === 'eat');
    expect(eating.length).toBeGreaterThan(60);
    // 锚点仍然是 bowl（世界层不知道挂件藏没藏），但挂件层给不出坐标，
    // 于是猫没有被拽向任何地方。
    expect(samples.some((s) => s.anchor === 'bowl')).toBe(true);
  });
});

describe('三种性格在画面上真的不一样', () => {
  it('贪吃的立刻冲过来：刚添完粮就出发', () => {
    const { samples } = couple({ world: aboutToEat(GREEDY_SEED, 60) });
    // 第一帧世界层就说「去食盆」，猫当场开始走。
    expect(samples[0]!.anchor).toBe('bowl');
    expect(samples[0]!.playing).toBe('walk');
  });

  it('不饿的晚点再说：同样的饥饿度，挑食的猫压根不动身', () => {
    const { samples, props } = couple({ world: aboutToEat(PICKY_SEED, 60) });
    // 60 高于它的开吃阈值（贪吃度接近 0 时阈值约 45），所以没有锚点。
    expect(samples[0]!.anchor).toBeNull();
    // 这段时间里它没吃，也没被拽到食盆边。
    expect(samples.some((s) => s.playing === 'eat')).toBe(false);
    expect(gapTo('bowl', props, samples[samples.length - 1]!.x)).toBeGreaterThan(0);
  });

  it('挑食的猫饿透了也会去 - 阈值是「晚点」不是「不吃」', () => {
    const { samples, props } = couple({ world: aboutToEat(PICKY_SEED, 20) });
    expect(samples[0]!.anchor).toBe('bowl');
    const eating = samples.filter((s) => s.playing === 'eat');
    expect(eating.length).toBeGreaterThan(0);
    for (const s of eating) expect(gapTo('bowl', props, s.x)).toBeLessThan(0);
  });

  it('睡着的可能睡完这觉：添粮不会把它拽到食盆边', () => {
    // 深夜 + 精力不足，所以这一段里它不会醒。
    const asleep = makeWorld({
      seed: GREEDY_SEED,
      hour: 2,
      patch: {
        bowl: 2,
        sleeping: true,
        needs: { hunger: 40, energy: 40, mood: 60 },
        beatsInTick: BEATS_PER_TICK - 4,
      },
    });
    const { samples, props } = couple({ world: asleep });
    expect(samples.every((s) => s.wanted === 'sleep')).toBe(true);
    expect(samples.some((s) => s.playing === 'eat')).toBe(false);
    // 它走的是猫窝，不是食盆。
    expect(samples[0]!.anchor).toBe('bed');
    expect(gapTo('bowl', props, samples[samples.length - 1]!.x)).toBeGreaterThan(0);
  });
});

describe('猫困了走回猫窝睡', () => {
  it('播睡觉的每一帧，猫都在垫子上', () => {
    const asleep = makeWorld({
      hour: 2,
      patch: { sleeping: true, needs: { hunger: 70, energy: 40, mood: 60 } },
    });
    const { samples, props } = couple({ world: asleep, frames: 3000 });
    const sleeping = samples.filter((s) => s.playing === 'sleep');
    expect(sleeping.length).toBeGreaterThan(60);
    const center = propCenterX('bed', props.bed);
    for (const s of sleeping) {
      // 猫窝的 reach 是 0：猫站到垫子正中间才躺下。
      expect(Math.abs(s.x - center)).toBeLessThan(1e-6);
    }
  });

  it('走回窝之前一直在走，不会在半路上躺下', () => {
    const asleep = makeWorld({
      hour: 2,
      patch: { sleeping: true, needs: { hunger: 70, energy: 40, mood: 60 } },
    });
    const { samples } = couple({ world: asleep, frames: 3000 });
    const firstSleep = samples.findIndex((s) => s.playing === 'sleep');
    expect(firstSleep).toBeGreaterThan(0);
    for (const s of samples.slice(0, firstSleep)) {
      expect(s.playing, '还没到窝就睡了').toBe('walk');
    }
  });

  it('生病的猫不会爬起来走回窝 - 蔫着趴在原地才是病的读数', () => {
    const sick = makeWorld({
      hour: 12,
      patch: { sick: true, sickHours: 6, needs: { hunger: 30, energy: 50, mood: 20 } },
    });
    const { samples } = couple({ world: sick, frames: 600 });
    expect(samples.every((s) => s.anchor === null)).toBe(true);
    expect(samples.every((s) => s.playing === 'lie')).toBe(true);
    // 一步没动
    expect(new Set(samples.map((s) => s.x)).size).toBe(1);
  });
});

describe('reach 的量级', () => {
  it('食盆的 reach 小于半个精灵宽 - 猫的身体一定与盆重叠', () => {
    // 大于半个精灵宽的话，猫会停在盆外面对着空气低头。
    expect(PROP_REACH_SPRITE.bowl * SPRITE_SCALE).toBeLessThan(HALF_CAT);
  });

  it('猫窝的 reach 是 0 - 睡在窝里而不是窝旁边', () => {
    expect(PROP_REACH_SPRITE.bed).toBe(0);
  });
});
