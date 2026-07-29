import type { BreedKey } from '../render/types.js';
import {
  INITIAL_BOND,
  INITIAL_ENERGY,
  INITIAL_HUNGER,
  INITIAL_MOOD,
  WORLD_VERSION,
} from './constants.js';
import { localDayIndex } from './clock.js';
import { seedRngState } from './rng.js';
import type { World, WorldEvent } from './types.js';

export interface AdoptionSpec {
  breed: BreedKey;
  seed: number;
  name: string;
  /** 出生时刻，epoch ms。由平台层注入。 */
  bornAt: number;
  /** 本地时区偏移，分钟（东八区 = 480）。由平台层注入。 */
  tzOffsetMinutes: number;
}

/**
 * 领养一只猫，得到初始世界。
 *
 * 时钟与时区都由调用方给 - 世界层从不自己取现在几点。
 */
export function createWorld(spec: AdoptionSpec): World {
  const adopted: WorldEvent = { kind: 'adopted', at: spec.bornAt, important: true };

  return {
    version: WORLD_VERSION,
    identity: {
      breed: spec.breed,
      seed: spec.seed,
      bornAt: spec.bornAt,
      name: spec.name,
    },
    clock: spec.bornAt,
    carryMs: 0,
    tzOffsetMinutes: spec.tzOffsetMinutes,
    needs: { hunger: INITIAL_HUNGER, energy: INITIAL_ENERGY, mood: INITIAL_MOOD },
    bond: INITIAL_BOND,
    bowl: 0,
    sleeping: false,
    starveHours: 0,
    sick: false,
    sickHours: 0,
    weakHours: 0,
    dead: false,
    diedAt: null,
    playGlow: 0,
    lastInteractionAt: spec.bornAt,
    activity: 'idle',
    rngState: seedRngState(spec.seed),
    diaryDay: localDayIndex(spec.bornAt, spec.tzOffsetMinutes),
    // 领养是重要事件，不占当天的日常额度。
    diaryCount: 0,
    diary: [adopted],
    stats: { feedCount: 0, petCount: 0 },
  };
}

/**
 * 深拷贝一份可改写的草稿。
 *
 * `step` 内部改的是草稿，**调用方传进来的 world 从不被修改** -
 * 这是纯函数承诺的实际含义。草稿在一次 step 里被连续推进几十步，
 * 逐步都重建整个对象只是徒增垃圾，没有额外的正确性收益。
 */
export function draftOf(world: World): World {
  return {
    ...world,
    identity: { ...world.identity },
    needs: { ...world.needs },
    stats: { ...world.stats },
    diary: world.diary.slice(),
  };
}
