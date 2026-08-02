import {
  BREED_KEYS,
  hasBreed,
  randomPersonality,
  type BreedKey,
  type Personality,
} from '../render/index.js';
import { SEED_SPACE } from './constants.js';
import type { AdoptedIdentity } from './identity.js';
import { normalizeName } from './name.js';

/**
 * 领养中的候选猫。用户只选择品种；外观与动作由品种的完整帧美术固定提供，
 * 性格在 beginAdoption 时只抽一次且不会因为切换品种而重抽。
 */
export interface Candidate {
  readonly breed: BreedKey;
  readonly seed: number;
  readonly personality: Personality;
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

export function beginAdoption(rnd: () => number): AdoptionFlow {
  const breedIndex = Math.min(BREED_KEYS.length - 1, Math.max(0, Math.floor(rnd() * BREED_KEYS.length)));
  const breed = BREED_KEYS[breedIndex]!;
  const seed = nextSeed(rnd);
  return {
    phase: 'meeting',
    candidate: {
      breed,
      seed,
      personality: randomPersonality(rnd),
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
      name: checked.name,
    },
  };
}
