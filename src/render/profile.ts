import type { ActionKey } from './actions.js';
import {
  normalizeArtTuning,
  tuneCatArt,
  type CatArtTuning,
} from './art-tuning.js';
import { makeCat } from './cat.js';
import {
  DEFAULT_MOTION_TUNING,
  normalizeMotionTuning,
  type CatMotionTuning,
} from './motion-tuning.js';
import type { BreedKey, Cat, MarkingChoice, Personality } from './types.js';

export type MotionProfile = Partial<Record<ActionKey, CatMotionTuning>>;

/** 领养确认后封存的猫咪档案；世界运行期没有修改这份数据的命令。 */
export interface CatProfile {
  breed: BreedKey;
  seed: number;
  personality: Personality;
  marking: MarkingChoice;
  art: CatArtTuning;
  motion: MotionProfile;
}

export function randomPersonality(rnd: () => number): Personality {
  const next = () => Math.min(1, Math.max(0, rnd()));
  return { active: next(), clingy: next(), greedy: next() };
}

export function normalizeProfile(profile: CatProfile): CatProfile {
  const personality = {
    active: Math.min(1, Math.max(0, profile.personality.active)),
    clingy: Math.min(1, Math.max(0, profile.personality.clingy)),
    greedy: Math.min(1, Math.max(0, profile.personality.greedy)),
  };
  const motion: MotionProfile = {};
  for (const [key, value] of Object.entries(profile.motion) as [ActionKey, CatMotionTuning][]) {
    motion[key] = normalizeMotionTuning(value);
  }
  return {
    breed: profile.breed,
    seed: profile.seed,
    personality,
    marking: { ...profile.marking },
    art: normalizeArtTuning(profile.art),
    motion,
  };
}

export function materializeCat(profile: Pick<CatProfile, 'breed' | 'seed'> & Partial<CatProfile>): Cat {
  const base = makeCat(profile.breed, profile.seed, profile.marking);
  const withPersonality = profile.personality ? { ...base, personality: { ...profile.personality } } : base;
  // 缺少 art 的旧存档必须逐像素保持旧耳位；新领养的完整档案启用轮廓吸附。
  if (!profile.art) return withPersonality;
  const art = normalizeArtTuning(profile.art);
  const tuned = tuneCatArt(withPersonality, art);
  const earVertical = Math.max(2, tuned.earH - 1);
  const baseAngle = (Math.atan2(earVertical, base.earSpread) * 180) / Math.PI;
  const targetAngle = art.earSpread >= 0 ? 45 : 105;
  const earAngle = baseAngle + (targetAngle - baseAngle) * Math.abs(art.earSpread);
  return {
    ...tuned,
    attachEarsToFace: true,
    earAngle: Math.min(105, Math.max(45, earAngle)),
    earAxisLength: Math.hypot(earVertical, base.earSpread),
  };
}

export function motionTuningFor(
  profile: Pick<CatProfile, 'motion'> | undefined,
  action: ActionKey,
): CatMotionTuning {
  return normalizeMotionTuning(profile?.motion[action] ?? DEFAULT_MOTION_TUNING);
}
