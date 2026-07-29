import { BREEDS } from '../render/index.js';
import type { BreedKey } from '../render/types.js';
import type { WorldEvent, WorldEventKind } from '../world/index.js';
import { MEMORIAL_SAVE_VERSION } from './constants.js';
import type { Memorial, MemorialEntry } from './types.js';

/**
 * 档案存档的序列化与解析。
 *
 * 与 world/save.ts 与 props/save.ts 是同一套做法（解析即验证、逐字段重建），
 * 但**版本不一致的处理不同**：那两份坏了或过期了都可以丢 - 世界会重新领养一只猫，
 * 挂件会回到默认位置。档案丢了就是把用户养过的所有猫一起抹掉，且不可再生。
 * 所以这里只做「可见地失败」，绝不在解析层丢弃；要不要退回空档案由调用方决定，
 * 而 app/farewell.ts 的决定是**不退回**（见那边的注释）。
 */

export class MemorialSaveError extends Error {
  constructor(message: string) {
    super(`猫的档案存档无效：${message}`);
    this.name = 'MemorialSaveError';
  }
}

export function serializeMemorial(archive: Memorial): string {
  return JSON.stringify({
    version: MEMORIAL_SAVE_VERSION,
    cats: archive.cats.map((c) => ({
      identity: {
        breed: c.identity.breed,
        seed: c.identity.seed,
        bornAt: c.identity.bornAt,
        name: c.identity.name,
      },
      diedAt: c.diedAt,
      stats: { feedCount: c.stats.feedCount, petCount: c.stats.petCount },
      // data 缺省时不写这个键，往返之后才与原对象严格相等（`{}` 与 undefined 不同）。
      diary: c.diary.map((e) =>
        e.data
          ? { kind: e.kind, at: e.at, important: e.important, data: e.data }
          : { kind: e.kind, at: e.at, important: e.important },
      ),
    })),
  });
}

function record(raw: unknown, where: string): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new MemorialSaveError(`${where} 应为对象`);
  }
  return raw as Record<string, unknown>;
}

function num(source: Record<string, unknown>, key: string, where: string): number {
  const v = source[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new MemorialSaveError(`${where}.${key} 应为有限数值，实际为 ${JSON.stringify(v)}`);
  }
  return v;
}

function str(source: Record<string, unknown>, key: string, where: string): string {
  const v = source[key];
  if (typeof v !== 'string') {
    throw new MemorialSaveError(`${where}.${key} 应为字符串，实际为 ${JSON.stringify(v)}`);
  }
  return v;
}

/**
 * 一条日记。
 *
 * **只验结构，不验 kind 是否认识。** WorldEventKind 是个类型联合，没有对应的运行时
 * 名单；为了这里造一份就等于把同一份名单写两遍，而两遍迟早不同步。
 * 认不出来的 kind 交给文案渲染兜底（渲染层本来就要有 fallback，日记文案会随版本增删），
 * 代价只是那一条显示成一句泛泛的话，而不是整份档案打不开。
 */
function diaryEntry(raw: unknown, where: string): WorldEvent {
  const e = record(raw, where);
  const kind = str(e, 'kind', where) as WorldEventKind;
  const important = e['important'];
  if (typeof important !== 'boolean') {
    throw new MemorialSaveError(`${where}.important 应为布尔值`);
  }
  const at = num(e, 'at', where);
  const data = e['data'];
  if (data === undefined) return { kind, at, important };

  const src = record(data, `${where}.data`);
  const out: Record<string, number> = {};
  for (const key of Object.keys(src)) out[key] = num(src, key, `${where}.data`);
  return { kind, at, important, data: out };
}

function entry(raw: unknown, index: number): MemorialEntry {
  const where = `cats[${index}]`;
  const c = record(raw, where);
  const identity = record(c['identity'], `${where}.identity`);
  const breed = identity['breed'];
  if (typeof breed !== 'string' || !(breed in BREEDS)) {
    throw new MemorialSaveError(`${where}.identity.breed 是未知品种 ${JSON.stringify(breed)}`);
  }
  const stats = record(c['stats'], `${where}.stats`);
  const diary = c['diary'];
  if (!Array.isArray(diary)) throw new MemorialSaveError(`${where}.diary 应为数组`);

  return {
    identity: {
      breed: breed as BreedKey,
      seed: num(identity, 'seed', `${where}.identity`),
      bornAt: num(identity, 'bornAt', `${where}.identity`),
      name: str(identity, 'name', `${where}.identity`),
    },
    // 档案里只有离开了的猫，所以 diedAt 必须是个真实的时刻，不接受 null。
    diedAt: num(c, 'diedAt', where),
    stats: {
      feedCount: num(stats, 'feedCount', `${where}.stats`),
      petCount: num(stats, 'petCount', `${where}.stats`),
    },
    diary: diary.map((e, i) => diaryEntry(e, `${where}.diary[${i}]`)),
  };
}

/** 解析档案。校验失败抛 MemorialSaveError。 */
export function parseMemorial(text: string): Memorial {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new MemorialSaveError(`不是合法 JSON（${String(err)}）`);
  }
  const w = record(raw, '顶层');
  const version = num(w, 'version', '顶层');
  if (version !== MEMORIAL_SAVE_VERSION) {
    throw new MemorialSaveError(`版本 ${version} 与当前 ${MEMORIAL_SAVE_VERSION} 不一致`);
  }
  const cats = w['cats'];
  if (!Array.isArray(cats)) throw new MemorialSaveError('cats 应为数组');
  return { version, cats: cats.map(entry) };
}
