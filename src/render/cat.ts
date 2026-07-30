import { BREED_KEYS, getBreed } from './breeds.js';
import { hasMarkingVariant } from './marking-variants.js';
import { RAGDOLL_POINTS } from './palette.js';
import { clamp, lerp, mulberry32 } from './rng.js';
import type { BreedKey, Cat, CowPatch, MarkingChoice, Marks } from './types.js';

/**
 * 由「品种 + Seed」确定性地生成一只猫。
 *
 * 相同入参永远得到完全相同的基础猫。新领养会在它之上叠加封存的独立性格与
 * 语义调参；旧存档仍可只靠品种 + Seed 恢复。
 *
 * **随机数的调用顺序就是这只猫的身份。**
 * 在中间插入或删除任何一次 rnd() 调用，都会让所有既有存档的猫变成另一只猫。
 * 要新增随机参数，只能追加在对应品种分支的末尾。
 */
export function makeCat(breed: BreedKey, seed: number, marking?: MarkingChoice): Cat {
  const B = getBreed(breed);
  const rnd = mulberry32((seed * 7919 + BREED_KEYS.indexOf(breed) * 104729) >>> 0);
  const R = (range: readonly [number, number]): number => lerp(range[0], range[1], rnd());
  const choice = marking && hasMarkingVariant(breed, marking.variant) ? marking : undefined;

  const marks: Marks = {};

  // 注意：以下的取值顺序与 rnd() 消耗顺序必须保持不变，见上方说明。
  const bodyRW = R(B.bodyRW);
  const bodyRH = R(B.bodyRH);
  const headR = R(B.headR);
  const earH = R(B.earH);
  const earW = R(B.earW);
  const tailLen = Math.round(R(B.tailLen));
  const tailThick = R(B.tailThick);
  const legLen = R(B.legLen);
  let fluff = B.fluff * (0.7 + rnd() * 0.6);
  const earSpread = B.earSpread ? R(B.earSpread) : 0;
  const personality = {
    active: clamp(B.active + (rnd() - 0.5) * 0.55, 0.05, 0.95),
    clingy: rnd(),
    greedy: rnd(),
  };
  // 新领养把花纹随机源与体型 Seed 分开；缺省继续消费旧 rnd，保证旧存档逐像素兼容。
  const markRnd = choice ? mulberry32(choice.seed >>> 0) : rnd;

  let pal = B.palette;

  if (B.markingAdapter === 'tabby') {
    marks.stripeFreq =
      choice?.variant === 'bold'
        ? 1.55 + markRnd() * 0.5
        : choice?.variant === 'spotted'
          ? 3.2 + markRnd() * 0.8
          : 2.5 + markRnd() * 1.5;
    // 条纹宽度以相位占比表示。等距斜竖纹，不做边缘抖动 -
    // 抖动版本已被否决（在 72x56 尺度下读起来是脏，不是毛）。
    marks.stripeW =
      choice?.variant === 'bold' ? 0.44 + markRnd() * 0.1 : 0.22 + markRnd() * 0.12;
    marks.stripePhase = markRnd();
    if (choice) marks.stripeStyle = choice.variant === 'spotted' ? 'spots' : 'lines';
    marks.headStripes = choice ? choice.variant !== 'spotted' : markRnd() > 0.25;
    marks.tailRings = true;
  }
  if (B.markingAdapter === 'classic-tabby') {
    marks.stripeFreq =
      choice?.variant === 'mackerel'
        ? 3.2 + markRnd() * 0.7
        : choice?.variant === 'spotted'
          ? 2.6 + markRnd() * 0.8
          : 2 + markRnd() * 1.2;
    marks.stripeW =
      choice?.variant === 'mackerel' ? 0.22 + markRnd() * 0.08 : 0.34 + markRnd() * 0.12;
    marks.stripePhase = markRnd();
    if (choice) marks.stripeStyle = choice.variant === 'spotted' ? 'spots' : 'lines';
    marks.headStripes = true;
    marks.tailRings = true;
  }
  if (B.markingAdapter === 'wavy') {
    marks.speck =
      choice?.variant === 'marble'
        ? 0.18 + markRnd() * 0.05
        : choice?.variant === 'ripple'
          ? 0.11 + markRnd() * 0.04
          : 0.05 + markRnd() * 0.05;
    if (choice) {
      marks.waveScale =
        choice.variant === 'marble' ? 0.62 : choice.variant === 'ripple' ? 1.2 : 1.9;
      marks.wavePhase = markRnd() * Math.PI * 2;
    }
  }
  if (B.markingAdapter === 'ticked') {
    marks.tick =
      choice?.variant === 'speckled'
        ? 0.26 + markRnd() * 0.08
        : choice?.variant === 'backline'
          ? 0.035 + markRnd() * 0.035
          : 0.09 + markRnd() * 0.07;
  }
  if (B.markingAdapter === 'solid') {
    marks.whiteToe = choice ? choice.variant !== 'solid' : markRnd() > 0.6;
    marks.locket = choice ? choice.variant === 'tuxedo' : markRnd() > 0.8;
  }
  if (B.markingAdapter === 'patches') {
    const n = choice?.variant === 'harlequin' ? 3 : 2 + Math.floor(markRnd() * 2);
    const patches: CowPatch[] = [];
    for (let i = 0; i < n; i++) {
      patches.push({
        u: markRnd() * 1.6 - 0.8,
        v: markRnd() * 1.2 - 0.8,
        r: 0.22 + markRnd() * 0.32,
        e: 0.7 + markRnd() * 0.7,
        s: Math.floor(markRnd() * 997),
      });
    }
    if (choice?.variant === 'saddle') {
      patches[0] = { u: -0.48, v: -0.38, r: 0.62, e: 0.7, s: patches[0]!.s };
      patches[1] = { u: 0.35, v: -0.52, r: 0.3, e: 0.82, s: patches[1]!.s };
    } else if (choice?.variant === 'mask') {
      patches[0] = { u: -0.62, v: 0.12, r: 0.34, e: 1.05, s: patches[0]!.s };
      patches[1] = { u: 0.15, v: 0.42, r: 0.28, e: 0.8, s: patches[1]!.s };
    } else if (choice?.variant === 'harlequin') {
      patches[0] = { u: -0.58, v: -0.3, r: 0.52, e: 1.08, s: patches[0]!.s };
      patches[1] = { u: 0.05, v: 0.25, r: 0.42, e: 0.72, s: patches[1]!.s };
      patches[2] = { u: 0.55, v: -0.12, r: 0.32, e: 1.15, s: patches[2]!.s };
    }
    marks.patches = patches;
    marks.headPatch = choice?.variant === 'saddle'
      ? null
      : choice?.variant === 'mask'
        ? { side: markRnd() > 0.5 ? 1 : -1, r: 0.82, s: Math.floor(markRnd() * 997) }
        : markRnd() > 0.25
        ? {
            side: markRnd() > 0.5 ? 1 : -1,
            r: 0.5 + markRnd() * 0.35,
            s: Math.floor(markRnd() * 997),
          }
        : null;
    marks.earL = choice?.variant === 'harlequin' ? true : markRnd() > 0.5;
    marks.earR = choice?.variant === 'mask' ? true : markRnd() > 0.5;
    marks.tailBlack = choice?.variant === 'mask' ? false : choice?.variant === 'saddle' || markRnd() > 0.3;

    // 保底可见性：第一块斑钳制到坐姿可见的后臀区（头与胸在 +u 侧会挡住），
    // 否则会随机出现一只看起来是纯白猫的「奶牛猫」。
    const first = patches[0]!;
    first.u = clamp(first.u, -0.85, -0.15);
    first.v = clamp(first.v, -0.55, 0.3);
    first.r = Math.max(first.r, 0.42);
    // 兜底：头部与双耳都没抽中时，强制给左耳与尾巴上色。
    if (!marks.headPatch && !marks.earL && !marks.earR) {
      marks.earL = true;
      marks.tailBlack = true;
    }
  }
  if (B.markingAdapter === 'color-point') {
    marks.maskDepth = !choice
      ? 0.02 + markRnd() * 0.55
      : choice.variant === 'blue'
        ? 0.08 + markRnd() * 0.18
        : choice.variant === 'chocolate'
          ? 0.28 + markRnd() * 0.2
          : 0.4 + markRnd() * 0.15;
    marks.mitts = markRnd() > 0.25;
    marks.ruffR = 0.8 + markRnd() * 2.6;
    fluff = 0.55 * (0.55 + markRnd() * 0.9);
    // 重点色色系由 Seed 抽取，这是拉开布偶个体差异最有效的手段。
    const pointIndex =
      choice?.variant === 'seal' ? 0 : choice?.variant === 'blue' ? 1 : choice?.variant === 'chocolate' ? 2 : Math.floor(markRnd() * RAGDOLL_POINTS.length);
    pal = { ...pal, mark: RAGDOLL_POINTS[pointIndex]! };
  }

  return {
    breed,
    markingAdapter: B.markingAdapter,
    ...(choice ? { markingVariant: choice.variant, markingSeed: choice.seed } : {}),
    plumeTail: !!B.plumeTail,
    whiskerPixels: B.whiskerPixels !== false,
    seed,
    bodyRW,
    bodyRH,
    headR,
    earH,
    earW,
    tailLen,
    tailThick,
    legLen,
    fluff,
    eyeBig: B.eyeBig,
    // 坐姿宽窄：腿长的猫坐得更高更瘦，腿短的猫坐成一坨。
    sitW: B.sitW ?? 0.75,
    earSet: B.earSet ?? 0.55,
    earSpread,
    earRound: !!B.earRound,
    earDrop: B.earDrop ?? 0,
    eyeLiner: !!B.eyeLiner,
    pal,
    personality,
    marks,
  };
}
