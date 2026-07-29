import { BREEDS, BREED_KEYS } from './breeds.js';
import { PALETTES, RAGDOLL_POINTS } from './palette.js';
import { clamp, lerp, mulberry32 } from './rng.js';
import type { BreedKey, Cat, CowPatch, Marks } from './types.js';

/**
 * 由「品种 + Seed」确定性地生成一只猫。
 *
 * 相同入参永远得到完全相同的猫 - 这是身份模型的基础：存档只需存
 * 品种 + Seed + 出生时间 + 名字，即可完整重建外观与性格。
 *
 * **随机数的调用顺序就是这只猫的身份。**
 * 在中间插入或删除任何一次 rnd() 调用，都会让所有既有存档的猫变成另一只猫。
 * 要新增随机参数，只能追加在对应品种分支的末尾。
 */
export function makeCat(breed: BreedKey, seed: number): Cat {
  const B = BREEDS[breed];
  const rnd = mulberry32((seed * 7919 + BREED_KEYS.indexOf(breed) * 104729) >>> 0);
  const R = (range: readonly [number, number]): number => lerp(range[0], range[1], rnd());

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

  let pal = PALETTES[breed];

  if (breed === 'orange') {
    marks.stripeFreq = 2.5 + rnd() * 1.5;
    // 条纹宽度以相位占比表示。等距斜竖纹，不做边缘抖动 -
    // 抖动版本已被否决（在 72x56 尺度下读起来是脏，不是毛）。
    marks.stripeW = 0.22 + rnd() * 0.12;
    marks.stripePhase = rnd();
    marks.headStripes = rnd() > 0.25;
    marks.tailRings = true;
  }
  if (breed === 'amshort') {
    marks.stripeFreq = 2 + rnd() * 1.2;
    marks.stripeW = 0.34 + rnd() * 0.12; // 美短虎斑比橘猫粗
    marks.stripePhase = rnd();
    marks.headStripes = true;
    marks.tailRings = true;
  }
  if (breed === 'devon') {
    marks.speck = 0.05 + rnd() * 0.05; // 波浪卷毛纹的密度
  }
  if (breed === 'aby') {
    marks.tick = 0.09 + rnd() * 0.07; // ticked 渐层斑点密度
  }
  if (breed === 'black') {
    marks.whiteToe = rnd() > 0.6;
    marks.locket = rnd() > 0.8; // 胸口小白斑
  }
  if (breed === 'cow') {
    const n = 2 + Math.floor(rnd() * 2);
    const patches: CowPatch[] = [];
    for (let i = 0; i < n; i++) {
      patches.push({
        u: rnd() * 1.6 - 0.8,
        v: rnd() * 1.2 - 0.8,
        r: 0.22 + rnd() * 0.32,
        e: 0.7 + rnd() * 0.7,
        s: Math.floor(rnd() * 997),
      });
    }
    marks.patches = patches;
    marks.headPatch =
      rnd() > 0.25
        ? { side: rnd() > 0.5 ? 1 : -1, r: 0.5 + rnd() * 0.35, s: Math.floor(rnd() * 997) }
        : null;
    marks.earL = rnd() > 0.5;
    marks.earR = rnd() > 0.5;
    marks.tailBlack = rnd() > 0.3;

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
  if (breed === 'ragdoll') {
    marks.maskDepth = 0.02 + rnd() * 0.55; // 从几乎全白脸到深面罩
    marks.mitts = rnd() > 0.25;
    marks.ruffR = 0.8 + rnd() * 2.6;
    fluff = 0.55 * (0.55 + rnd() * 0.9);
    // 重点色色系由 Seed 抽取，这是拉开布偶个体差异最有效的手段。
    pal = { ...pal, mark: RAGDOLL_POINTS[Math.floor(rnd() * RAGDOLL_POINTS.length)]! };
  }

  return {
    breed,
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
