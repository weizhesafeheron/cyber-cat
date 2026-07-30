import {
  ART_TUNING_CONTROLS,
  BREED_KEYS,
  DEFAULT_ART_TUNING,
  hasBreed,
  markingChoiceFor,
  markingVariantsFor,
  normalizeArtTuning,
  normalizeMotionTuning,
  randomPersonality,
  type ActionKey,
  type BreedKey,
  type CatArtTuning,
  type CatMotionTuning,
  type MotionProfile,
  type MarkingChoice,
  type Personality,
} from '../render/index.js';
import { SEED_SPACE } from './constants.js';
import type { AdoptedIdentity } from './identity.js';
import { normalizeName } from './name.js';

/**
 * 领养中的可编辑草稿。性格在 beginAdoption 时只抽一次；所有外观操作都必须原样保留它。
 * 确认并起名后，草稿随身份一起进入存档，运行环境没有再编辑的入口。
 */
export interface Candidate {
  readonly breed: BreedKey;
  readonly seed: number;
  readonly personality: Personality;
  readonly marking: MarkingChoice;
  readonly art: CatArtTuning;
  readonly motion: MotionProfile;
}

export type AdoptionPhase = 'meeting' | 'naming';

export interface AdoptionFlow {
  readonly phase: AdoptionPhase;
  readonly candidate: Candidate;
  /** 兼容自动化样本采集；产品界面不再把猫一只只赶走。 */
  readonly met: number;
}

function nextSeed(rnd: () => number): number {
  return Math.floor(Math.min(Math.max(rnd(), 0), 0.999999999) * SEED_SPACE);
}

function randomTuningValue(rnd: () => number): number {
  const unit = Math.min(Math.max(rnd(), 0), 1);
  return Math.round((unit * 2 - 1) * 100) / 100;
}

export function beginAdoption(rnd: () => number): AdoptionFlow {
  const breedIndex = Math.min(BREED_KEYS.length - 1, Math.max(0, Math.floor(rnd() * BREED_KEYS.length)));
  const breed = BREED_KEYS[breedIndex]!;
  const seed = nextSeed(rnd);
  // 初次花纹 Seed 从体型 Seed 做确定性扰动，不额外消费领养随机流；这样新增档案字段
  // 不会改变后续来访猫的 Seed 序列。之后点“换个花纹”才会单独重抽它。
  const markingSeed = ((seed ^ 0x6d2b79f5) >>> 0) % SEED_SPACE;
  return {
    phase: 'meeting',
    candidate: {
      breed,
      seed,
      personality: randomPersonality(rnd),
      marking: markingChoiceFor(breed, markingSeed),
      art: { ...DEFAULT_ART_TUNING },
      motion: {},
    },
    met: 1,
  };
}

export function selectBreed(flow: AdoptionFlow, breed: BreedKey): AdoptionFlow {
  if (!hasBreed(breed)) return flow;
  return {
    ...flow,
    candidate: {
      ...flow.candidate,
      breed,
      marking: markingChoiceFor(breed, flow.candidate.marking.seed),
    },
  };
}

/** 只换花纹模板与模板内 Seed；体型、性格和用户已经调过的参数都不变。 */
export function rerollAppearance(flow: AdoptionFlow, rnd: () => number): AdoptionFlow {
  const variants = markingVariantsFor(flow.candidate.breed);
  const current = variants.findIndex((entry) => entry.key === flow.candidate.marking.variant);
  const seed = nextSeed(rnd);
  let next = seed % variants.length;
  if (next === current) next = (next + 1) % variants.length;
  return {
    ...flow,
    candidate: {
      ...flow.candidate,
      marking: { variant: variants[next]!.key, seed },
    },
  };
}

/**
 * 从完整品种目录重新抽一只，并随机所有外观参数。
 * 性格属于这次相遇的猫本身，不随定制按钮重抽；动作统一恢复默认，避免随机组合
 * 让猫的行为失去协调感。
 */
export function randomizeVisuals(flow: AdoptionFlow, rnd: () => number): AdoptionFlow {
  const breedIndex = Math.min(BREED_KEYS.length - 1, Math.max(0, Math.floor(rnd() * BREED_KEYS.length)));
  const breed = BREED_KEYS[breedIndex]!;
  const seed = nextSeed(rnd);
  const markingSeed = nextSeed(rnd);
  const art = { ...DEFAULT_ART_TUNING };
  for (const { key } of ART_TUNING_CONTROLS) art[key] = randomTuningValue(rnd);
  return {
    ...flow,
    candidate: {
      breed,
      seed,
      personality: flow.candidate.personality,
      marking: markingChoiceFor(breed, markingSeed),
      art,
      motion: {},
    },
  };
}

/**
 * 旧的“下一只”采样接口。产品界面已经改为选品种 + 换花纹，但保留它供渲染回归
 * 测试均衡采样；它同样不会重抽性格。
 */
export function meetNext(flow: AdoptionFlow, rnd: () => number): AdoptionFlow {
  const current = BREED_KEYS.indexOf(flow.candidate.breed);
  const breed = BREED_KEYS[(current + 1 + BREED_KEYS.length) % BREED_KEYS.length]!;
  return {
    phase: 'meeting',
    met: flow.met + 1,
    candidate: {
      ...flow.candidate,
      breed,
      seed: nextSeed(rnd),
      marking: markingChoiceFor(breed, flow.candidate.marking.seed),
    },
  };
}

export function setArtTuning(
  flow: AdoptionFlow,
  patch: Partial<CatArtTuning>,
): AdoptionFlow {
  return {
    ...flow,
    candidate: {
      ...flow.candidate,
      art: normalizeArtTuning({ ...flow.candidate.art, ...patch }),
    },
  };
}

export function setMotionTuning(
  flow: AdoptionFlow,
  action: ActionKey,
  patch: Partial<CatMotionTuning>,
): AdoptionFlow {
  return {
    ...flow,
    candidate: {
      ...flow.candidate,
      motion: {
        ...flow.candidate.motion,
        [action]: normalizeMotionTuning({ ...flow.candidate.motion[action], ...patch }),
      },
    },
  };
}

export function accept(flow: AdoptionFlow): AdoptionFlow {
  return { ...flow, phase: 'naming' };
}

export function resumeMeeting(flow: AdoptionFlow): AdoptionFlow {
  return { ...flow, phase: 'meeting' };
}

export type NamingResult =
  | { readonly ok: true; readonly identity: AdoptedIdentity }
  | { readonly ok: false; readonly reason: string };

export function nameIt(flow: AdoptionFlow, raw: string): NamingResult {
  if (flow.phase !== 'naming') return { ok: false, reason: '还没决定留下它' };
  const checked = normalizeName(raw);
  if (!checked.ok) return { ok: false, reason: checked.reason };
  return {
    ok: true,
    identity: {
      breed: flow.candidate.breed,
      seed: flow.candidate.seed,
      personality: { ...flow.candidate.personality },
      marking: { ...flow.candidate.marking },
      art: { ...flow.candidate.art },
      motion: { ...flow.candidate.motion },
      name: checked.name,
    },
  };
}
