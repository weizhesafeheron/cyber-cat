import {
  ACTION_KEYS,
  ART_TUNING_CONTROLS,
  MOTION_TUNING_CONTROLS,
  hasBreed,
  hasMarkingVariant,
  normalizeArtTuning,
  normalizeMotionTuning,
} from '../render/index.js';
import type {
  ActionKey,
  BreedKey,
  CatArtTuning,
  MarkingChoice,
  MotionProfile,
  Personality,
} from '../render/index.js';
import { SEED_SPACE } from './constants.js';
import { normalizeName } from './name.js';

/**
 * 领养窗口与宠物窗口之间的握手。
 *
 * 两个窗口是两个 webview，各自独立的 JS 世界，中间只有一条事件通道。
 * 于是这里同时是**协议定义**与**系统边界**：
 * 载荷会紧接着交给 createWorld 写进存档，一个坏掉的 Seed（NaN、小数、字符串）
 * 会变成一只无法重建的猫 - makeCat 照着 NaN 生成一团东西，下次启动读存档时
 * 又生成另一团。宁可在这里可见地失败。
 *
 * 新载荷会传完整的封存档案；旧的三字段载荷仍能解析，供旧版本握手兼容。
 * 出生时间由宠物窗口注入 - 世界层不读时钟，取时钟是平台层的事。
 */

/** 领养完成事件。带上前缀避免与将来的其他事件名撞车。 */
export const ADOPTED_EVENT = 'cyber-cat://adopted';

/** 领养窗口交回来的封存档案；出生时间由宠物窗口补上。 */
export interface AdoptedIdentity {
  readonly breed: BreedKey;
  readonly seed: number;
  readonly name: string;
  /** 缺省仅用于兼容旧窗口/旧测试；新领养一定携带完整快照。 */
  readonly personality?: Personality;
  readonly marking?: MarkingChoice;
  readonly art?: CatArtTuning;
  readonly motion?: MotionProfile;
}

export class AdoptionPayloadError extends Error {
  constructor(message: string) {
    super(`领养结果无效：${message}`);
    this.name = 'AdoptionPayloadError';
  }
}

/**
 * 解析跨窗口收到的领养结果。校验失败抛 AdoptionPayloadError。
 *
 * 逐字段重建而不是断言类型：多余字段会被丢掉（不会被顺手写进存档），
 * 缺失字段立刻炸。这与 world/save.ts 解析存档的取法是同一条理由。
 */
export function parseAdopted(raw: unknown): AdoptedIdentity {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new AdoptionPayloadError('载荷应为对象');
  }
  const p = raw as Record<string, unknown>;

  const breed = p['breed'];
  if (typeof breed !== 'string' || !hasBreed(breed)) {
    throw new AdoptionPayloadError(`未知品种 ${JSON.stringify(breed)}`);
  }

  const seed = p['seed'];
  if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed >= SEED_SPACE) {
    throw new AdoptionPayloadError(`Seed 应为 [0, ${SEED_SPACE}) 内的整数，实际为 ${String(seed)}`);
  }

  const name = p['name'];
  if (typeof name !== 'string') throw new AdoptionPayloadError('名字应为字符串');
  // 复核而不是信任：领养窗口已经规范化过一次，但那是另一个 webview 的承诺。
  const checked = normalizeName(name);
  if (!checked.ok) throw new AdoptionPayloadError(checked.reason);

  const hasProfile =
    p['personality'] !== undefined ||
    p['marking'] !== undefined ||
    p['art'] !== undefined ||
    p['motion'] !== undefined;
  if (!hasProfile) return { breed, seed, name: checked.name };

  const personalityRaw = p['personality'];
  let personality: Personality | undefined;
  if (personalityRaw !== undefined) {
    if (typeof personalityRaw !== 'object' || personalityRaw === null || Array.isArray(personalityRaw)) {
      throw new AdoptionPayloadError('personality 应为对象');
    }
    const personalitySource = personalityRaw as Record<string, unknown>;
    const trait = (key: keyof Personality): number => {
      const value = personalitySource[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
        throw new AdoptionPayloadError(`personality.${key} 应为 0 到 1`);
      }
      return value;
    };
    personality = { active: trait('active'), clingy: trait('clingy'), greedy: trait('greedy') };
  }

  const markingRaw = p['marking'];
  let marking: MarkingChoice | undefined;
  if (markingRaw !== undefined) {
    if (typeof markingRaw !== 'object' || markingRaw === null || Array.isArray(markingRaw)) {
      throw new AdoptionPayloadError('marking 应为对象');
    }
    const source = markingRaw as Record<string, unknown>;
    const variant = source['variant'];
    const markingSeed = source['seed'];
    if (typeof variant !== 'string' || !hasMarkingVariant(breed, variant)) {
      throw new AdoptionPayloadError(`marking.variant 不是 ${breed} 的已知花纹`);
    }
    if (
      typeof markingSeed !== 'number' ||
      !Number.isInteger(markingSeed) ||
      markingSeed < 0 ||
      markingSeed >= SEED_SPACE
    ) {
      throw new AdoptionPayloadError(`marking.seed 应为 [0, ${SEED_SPACE}) 内的整数`);
    }
    marking = { variant, seed: markingSeed };
  }

  const artRaw = p['art'];
  let art: CatArtTuning | undefined;
  if (artRaw !== undefined) {
    if (typeof artRaw !== 'object' || artRaw === null || Array.isArray(artRaw)) {
      throw new AdoptionPayloadError('art 应为对象');
    }
    const artSource = artRaw as Record<string, unknown>;
    for (const { key } of ART_TUNING_CONTROLS) {
      const value = artSource[key];
      // 新版本可以继续增加安全调参字段；旧档案缺少时按 0（品种原设定）迁移。
      if (value === undefined) continue;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < -1 || value > 1) {
        throw new AdoptionPayloadError(`art.${key} 应为 -1 到 1`);
      }
    }
    art = normalizeArtTuning(artSource as unknown as CatArtTuning);
  }

  const motionRaw = p['motion'];
  let motion: MotionProfile | undefined;
  if (motionRaw !== undefined) {
    if (typeof motionRaw !== 'object' || motionRaw === null || Array.isArray(motionRaw)) {
      throw new AdoptionPayloadError('motion 应为对象');
    }
    motion = {};
    for (const [action, rawTuning] of Object.entries(motionRaw as Record<string, unknown>)) {
      if (!ACTION_KEYS.includes(action as ActionKey)) {
        throw new AdoptionPayloadError(`motion 包含未知动作 ${JSON.stringify(action)}`);
      }
      if (typeof rawTuning !== 'object' || rawTuning === null || Array.isArray(rawTuning)) {
        throw new AdoptionPayloadError(`motion.${action} 应为对象`);
      }
      const source = rawTuning as Record<string, unknown>;
      for (const { key } of MOTION_TUNING_CONTROLS) {
        const value = source[key];
        if (value === undefined) continue;
        if (typeof value !== 'number' || !Number.isFinite(value) || value < -1 || value > 1) {
          throw new AdoptionPayloadError(`motion.${action}.${key} 应为 -1 到 1`);
        }
      }
      motion[action as ActionKey] = normalizeMotionTuning(source);
    }
  }

  return {
    breed,
    seed,
    name: checked.name,
    ...(personality ? { personality } : {}),
    ...(marking ? { marking } : {}),
    ...(art ? { art } : {}),
    ...(motion ? { motion } : {}),
  };
}
