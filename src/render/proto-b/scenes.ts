/**
 * 六个判决场景的程序 tween 驱动。纯函数：(scene, t, 参数) → Frame。
 *
 * 动作原则（调研结论）：
 * - 局部静止是分层的原生能力：只给需要动的部件写姿态，其余不出现在 poses 里。
 * - 优先位移/图层交换，旋转只给尾巴、头这类关节部件，且角度克制。
 * - 转场（拎起落地、蹲坐起身）走缓动的拼接时间线，不做跨姿态插值。
 */
import { blinkOpenness, easeInOutQuad, easeInQuad, easeOutBack, lerp, phaseAt } from './tween.js';
import type { PartPose } from './transform.js';
import type { Frame, SceneKey } from './types.js';

export interface SceneOpts {
  /** 眨眼节奏与个体微差的种子。 */
  seed: number;
  /** 活跃度 0..1，影响步频与尾巴摆速。 */
  active: number;
  /** 对比页传入的睁眼度（0..1），提供时覆盖内置眨眼时间线。 */
  eyeOpen?: number;
}

const TAU = Math.PI * 2;

/** 站立装配的公共部分。 */
function standVariants(): Record<string, string> {
  return {
    body: 'stand',
    tail: 'stand',
    head: 'base',
    'ear-back': 'base',
    'ear-front': 'base',
    eyes: 'open',
    mouth: 'idle',
    'leg-near-front': 'stand',
    'leg-near-back': 'stand',
    'leg-far-front': 'stand',
    'leg-far-back': 'stand',
  };
}

function eyesFor(t: number, opts: SceneOpts): 'open' | 'half' | 'closed' {
  const open = opts.eyeOpen ?? blinkOpenness(t, opts.seed);
  return open > 0.6 ? 'open' : open > 0.22 ? 'half' : 'closed';
}

/** 偶发的耳朵抖动：每 ~6s 一次 0.22s 的小脉冲。 */
function earFlick(t: number, seed: number): number {
  const period = 5.2 + (Math.abs(seed) % 5) * 0.7;
  const u = ((t % period) + period) % period;
  if (u > 0.22) return 0;
  return Math.sin((u / 0.22) * Math.PI);
}

function standBlink(t: number, opts: SceneOpts): Frame {
  const variants = standVariants();
  variants.eyes = eyesFor(t, opts);
  const bob = Math.sin((TAU * t) / 3.6) > 0 ? -1 : 0;
  const flick = earFlick(t, opts.seed);
  const poses: Record<string, PartPose | undefined> = {
    body: { dy: bob },
    tail: { rot: 0.11 * Math.sin((TAU * t) / (4.8 - opts.active * 1.6)) },
  };
  if (flick > 0) poses['ear-front'] = { rot: -0.22 * flick };
  return { variants, poses, shadow: 1 };
}

function walk(t: number, opts: SceneOpts): Frame {
  const cycle = lerp(0.62, 0.42, opts.active);
  const u = ((t % cycle) + cycle) % cycle / cycle;
  const a = u < 0.5;
  const variants = standVariants();
  variants.eyes = eyesFor(t, opts);
  variants['leg-near-front'] = a ? 'fwd' : 'back';
  variants['leg-near-back'] = a ? 'back' : 'fwd';
  variants['leg-far-front'] = a ? 'back' : 'fwd';
  variants['leg-far-back'] = a ? 'fwd' : 'back';
  const step = u % 0.5;
  const bob = step > 0.22 ? -1 : 0;
  return {
    variants,
    poses: {
      body: { dy: bob },
      head: { dy: bob === 0 ? 0 : 1, rot: 0.02 * Math.sin(TAU * u) },
      tail: { rot: -0.14 + 0.1 * Math.sin(TAU * t * 1.1) },
    },
    shadow: 1,
  };
}

function sleep(t: number, opts: SceneOpts): Frame {
  const breathPeriod = 4.2;
  const inhale = Math.sin((TAU * t) / breathPeriod) > 0;
  // 头趴在卷成一团的身体前侧。眼睛/嘴/耳是头的子节点，跟着落位。
  const headPose: PartPose = { dx: -9, dy: 26 };
  return {
    variants: {
      body: inhale ? 'curl1' : 'curl0',
      head: 'base',
      'ear-back': 'base',
      'ear-front': 'base',
      eyes: 'closed',
      mouth: 'idle',
    },
    poses: {
      head: headPose,
    },
    zzz: t + (Math.abs(opts.seed) % 7) * 0.3,
    shadow: 1.12,
    shadowCx: 68,
  };
}

function eat(t: number, opts: SceneOpts): Frame {
  const phases = [0.55, 1.7, 0.45, 0.9] as const; // 低头 / 埋头吃 / 抬头 / 站着咀嚼
  const ph = phaseAt(t, phases);
  let down: number;
  let munch = false;
  if (ph.index === 0) down = easeInOutQuad(ph.u);
  else if (ph.index === 1) {
    down = 1;
    munch = true;
  } else if (ph.index === 2) down = 1 - easeInOutQuad(ph.u);
  else down = 0;

  const variants = standVariants();
  variants.bowl = 'base';
  const chew = Math.sin(TAU * t * 3.2) > 0;
  variants.mouth = munch || (ph.index === 3 && chew) ? 'open' : 'idle';
  variants.eyes = down > 0.7 ? 'half' : eyesFor(t, opts);
  return {
    variants,
    poses: {
      head: { dx: 4 * down, dy: 17 * down, rot: 0.32 * down },
      tail: { rot: 0.07 * Math.sin((TAU * t) / 3.1) },
      // 根节点前倾会把后脚抬离地面，后腿用局部位移抵消，脚掌钉在地上。
      'leg-near-back': { dy: 3.6 * down },
      'leg-far-back': { dy: 4.1 * down },
    },
    root: down > 0 ? { rot: 0.13 * down } : undefined,
    rootPivot: [88, 101],
    shadow: 1,
  };
}

function heldLand(t: number, opts: SceneOpts): Frame {
  const phases = [2.6, 0.38, 0.32, 1.2] as const; // 悬空 / 下落 / 落地压缩回弹 / 站定
  const ph = phaseAt(t, phases);
  const variants = standVariants();
  variants.eyes = ph.index <= 1 ? 'open' : eyesFor(t, opts);

  if (ph.index === 0) {
    variants['leg-near-front'] = 'dangle';
    variants['leg-near-back'] = 'dangle';
    variants['leg-far-front'] = 'dangle';
    variants['leg-far-back'] = 'dangle';
    const sway = Math.sin((TAU * ph.local) / 2.2);
    return {
      variants,
      poses: {
        tail: { rot: 0.55 + 0.08 * Math.sin(TAU * ph.local * 0.7) },
        head: { rot: -0.05 * sway },
      },
      root: { dy: -14 - 2 * Math.sin((TAU * ph.local) / 1.8), rot: 0.05 * sway },
      rootPivot: [86, 44],
      shadow: 0.3,
    };
  }
  if (ph.index === 1) {
    variants['leg-near-front'] = 'dangle';
    variants['leg-near-back'] = 'dangle';
    variants['leg-far-front'] = 'dangle';
    variants['leg-far-back'] = 'dangle';
    const k = easeInQuad(ph.u);
    return {
      variants,
      poses: { tail: { rot: lerp(0.55, 0.1, ph.u) } },
      root: { dy: -16 * (1 - k) },
      rootPivot: [86, 44],
      shadow: lerp(0.3, 1, k),
    };
  }
  if (ph.index === 2) {
    const k = easeOutBack(ph.u);
    const sy = lerp(0.86, 1, Math.min(1, k));
    return {
      variants,
      poses: { tail: { rot: lerp(0.1, 0, ph.u) } },
      root: { sy, sx: lerp(1.07, 1, Math.min(1, k)), dy: 0 },
      rootPivot: [72, 101],
      shadow: lerp(1.25, 1, ph.u),
    };
  }
  return standBlink(ph.local + 7.3, opts);
}

function sitRise(t: number, opts: SceneOpts): Frame {
  const phases = [2.5, 0.55, 1.95] as const; // 蹲坐 / 起身 / 站定
  const ph = phaseAt(t, phases);
  if (ph.index === 0) {
    const flick = earFlick(ph.local + 1.7, opts.seed);
    const poses: Record<string, PartPose | undefined> = {
      head: { dx: -6, dy: -17, rot: 0.03 * Math.sin((TAU * ph.local) / 3.4) },
    };
    if (flick > 0) poses['ear-front'] = { rot: -0.22 * flick };
    return {
      variants: {
        body: 'sit',
        tail: 'sit',
        head: 'base',
        'ear-back': 'base',
        'ear-front': 'base',
        eyes: eyesFor(t, opts),
        mouth: 'idle',
      },
      poses,
      shadow: 1.05,
      shadowCx: 66,
    };
  }
  if (ph.index === 1) {
    const u = easeInOutQuad(ph.u);
    if (u < 0.45) {
      // 前倾蓄力：整只猫绕前爪小角度前倾，头开始归位。
      const k = u / 0.45;
      return {
        variants: {
          body: 'sit',
          tail: 'sit',
          head: 'base',
          'ear-back': 'base',
          'ear-front': 'base',
          eyes: 'open',
          mouth: 'idle',
        },
        poses: { head: { dx: lerp(-6, -3, k), dy: lerp(-17, -6, k) } },
        root: { rot: 0.1 * k },
        rootPivot: [86, 99],
        shadow: 1.05,
        shadowCx: 66,
      };
    }
    // 换到站立装配，从压低状态弹起来。
    const k = (u - 0.45) / 0.55;
    const rise = easeOutBack(k);
    const variants = standVariants();
    variants.eyes = 'open';
    return {
      variants,
      poses: { tail: { rot: 0.2 * (1 - k) } },
      root: { sy: lerp(0.9, 1, Math.min(1, rise)), dy: 0 },
      rootPivot: [72, 101],
      shadow: lerp(1.05, 1, k),
    };
  }
  return standBlink(ph.local + 3.1, opts);
}

export function sceneFrame(scene: SceneKey, t: number, opts: SceneOpts): Frame {
  switch (scene) {
    case 'stand-blink':
      return standBlink(t, opts);
    case 'walk':
      return walk(t, opts);
    case 'sleep':
      return sleep(t, opts);
    case 'eat':
      return eat(t, opts);
    case 'held-land':
      return heldLand(t, opts);
    case 'sit-rise':
      return sitRise(t, opts);
  }
}
