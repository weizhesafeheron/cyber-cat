import { BREEDS } from '../render/index.js';
import type { BreedKey } from '../render/types.js';
import { WORLD_VERSION } from './constants.js';
import type { World } from './types.js';

/**
 * 存档的序列化与解析。
 *
 * 落盘的字节由平台层负责（Tauri 的 save_world / load_world 命令），这里只管
 * 「World ↔ 文本」这一段，因此不需要任何平台能力，可以直接测。
 *
 * 解析是系统边界，必须验证：磁盘上的 JSON 可能是旧版本、被手工改坏、
 * 或者压根就是别的文件。宁可可见地失败让调用方重新领养，也不要带着一个
 * 缺字段的 world 跑起来 - 那会在几十步之后变成一个查不出来的 NaN。
 */

export function serializeWorld(world: World): string {
  return JSON.stringify(world);
}

export class SaveFormatError extends Error {
  constructor(message: string) {
    super(`存档格式无效：${message}`);
    this.name = 'SaveFormatError';
  }
}

function num(source: Record<string, unknown>, key: string): number {
  const v = source[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new SaveFormatError(`字段 ${key} 应为有限数值，实际为 ${JSON.stringify(v)}`);
  }
  return v;
}

function bool(source: Record<string, unknown>, key: string): boolean {
  const v = source[key];
  if (typeof v !== 'boolean') {
    throw new SaveFormatError(`字段 ${key} 应为布尔值，实际为 ${JSON.stringify(v)}`);
  }
  return v;
}

function obj(source: Record<string, unknown>, key: string): Record<string, unknown> {
  const v = source[key];
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new SaveFormatError(`字段 ${key} 应为对象`);
  }
  return v as Record<string, unknown>;
}

/**
 * 解析存档。校验失败抛 SaveFormatError。
 *
 * 只校验结构与类型，不校验数值范围 - 越界的数值会被后续的 clamp 收回来，
 * 而缺字段或类型错会静默传播成 NaN。
 */
export function parseWorld(text: string): World {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new SaveFormatError(`不是合法 JSON（${String(err)}）`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SaveFormatError('顶层应为对象');
  }
  const w = raw as Record<string, unknown>;

  const version = num(w, 'version');
  if (version !== WORLD_VERSION) {
    throw new SaveFormatError(`版本 ${version} 与当前 ${WORLD_VERSION} 不一致`);
  }

  const identity = obj(w, 'identity');
  const breed = identity['breed'];
  if (typeof breed !== 'string' || !(breed in BREEDS)) {
    throw new SaveFormatError(`未知品种 ${JSON.stringify(breed)}`);
  }
  const name = identity['name'];
  if (typeof name !== 'string') throw new SaveFormatError('identity.name 应为字符串');

  const needs = obj(w, 'needs');
  const stats = obj(w, 'stats');
  const diary = w['diary'];
  if (!Array.isArray(diary)) throw new SaveFormatError('diary 应为数组');
  const diedAt = w['diedAt'];
  if (diedAt !== null && (typeof diedAt !== 'number' || !Number.isFinite(diedAt))) {
    throw new SaveFormatError('diedAt 应为数值或 null');
  }
  const activity = w['activity'];
  if (typeof activity !== 'string') throw new SaveFormatError('activity 应为字符串');

  // 逐字段重建而不是直接断言类型：这样多余的字段会被丢掉，缺失的字段会立刻炸，
  // 而不是留到几十步之后变成 NaN。
  return {
    version,
    identity: {
      breed: breed as BreedKey,
      seed: num(identity, 'seed'),
      bornAt: num(identity, 'bornAt'),
      name,
    },
    clock: num(w, 'clock'),
    carryMs: num(w, 'carryMs'),
    beatsInTick: num(w, 'beatsInTick'),
    tzOffsetMinutes: num(w, 'tzOffsetMinutes'),
    needs: {
      hunger: num(needs, 'hunger'),
      energy: num(needs, 'energy'),
      mood: num(needs, 'mood'),
    },
    bond: num(w, 'bond'),
    bowl: num(w, 'bowl'),
    sleeping: bool(w, 'sleeping'),
    starveHours: num(w, 'starveHours'),
    sick: bool(w, 'sick'),
    sickHours: num(w, 'sickHours'),
    weakHours: num(w, 'weakHours'),
    dead: bool(w, 'dead'),
    diedAt: diedAt as number | null,
    playGlow: num(w, 'playGlow'),
    lastInteractionAt: num(w, 'lastInteractionAt'),
    activity: activity as World['activity'],
    activityBeatsLeft: num(w, 'activityBeatsLeft'),
    rngState: num(w, 'rngState'),
    activityRngState: num(w, 'activityRngState'),
    diaryDay: num(w, 'diaryDay'),
    diaryCount: num(w, 'diaryCount'),
    diary: diary as World['diary'],
    stats: {
      feedCount: num(stats, 'feedCount'),
      petCount: num(stats, 'petCount'),
    },
  };
}
