import { makeCat } from '../../src/render/index.js';
import type { BreedKey, Personality } from '../../src/render/types.js';
import { BEAT_MS, createWorld, step, TICK_MS } from '../../src/world/index.js';
import type { StepResult, World, WorldEvent, WorldInputs } from '../../src/world/index.js';

/**
 * 缝一测试的公共脚手架。
 *
 * 两条约定：
 * - **时区固定为 0**，这样「本地小时」等于 UTC 小时，测试不随运行机器的 TZ 飘。
 *   世界层本来就不读系统时区，这里只是让断言好写。
 * - 世界状态直接按字段构造。World 是公开的可序列化数据，不是内部实现，
 *   直接摆出一个「挨饿了 23.5 小时的猫」比用几十步把它演化出来更清楚。
 */

export const HOUR = 3_600_000;
export const DAY = 86_400_000;
export const TICK = TICK_MS;
/** 一个行为节拍 15 秒。时钟的最小前进单位。 */
export const BEAT = BEAT_MS;

/** 2026-07-29 00:00 UTC。测试里所有时刻都相对它。 */
export const BASE = Date.UTC(2026, 6, 29, 0, 0, 0);

export interface WorldOpts {
  breed?: BreedKey;
  seed?: number;
  /** 世界起始的本地小时（时区 0，所以就是 UTC 小时）。 */
  hour?: number;
  patch?: Partial<World>;
}

/** 造一个世界。hour 决定起始的本地时刻。 */
export function makeWorld(opts: WorldOpts = {}): World {
  const seed = opts.seed ?? 20260728;
  const at = BASE + (opts.hour ?? 8) * HOUR;
  const base = createWorld({
    breed: opts.breed ?? 'orange',
    seed,
    name: '小猫',
    bornAt: at,
    tzOffsetMinutes: 0,
  });
  const patch = opts.patch ?? {};
  return {
    ...base,
    ...patch,
    needs: { ...base.needs, ...(patch.needs ?? {}) },
    stats: { ...base.stats, ...(patch.stats ?? {}) },
  };
}

export interface RunResult {
  world: World;
  events: WorldEvent[];
  /** 每一步的结果，按顺序。 */
  steps: StepResult[];
}

/** 连续跑 n 个模拟步，每步都是恰好一个步长。 */
export function runTicks(
  world: World,
  n: number,
  inputsAt: (tickIndex: number, world: World) => WorldInputs = () => ({}),
): RunResult {
  let current = world;
  const events: WorldEvent[] = [];
  const steps: StepResult[] = [];
  for (let i = 0; i < n; i++) {
    const r = step(current, TICK, inputsAt(i, current));
    current = r.world;
    events.push(...r.events);
    steps.push(r);
  }
  return { world: current, events, steps };
}

/** 在种子空间里找一只性格满足条件的猫。makeCat 是确定性的，所以结果稳定。 */
export function findSeed(
  breed: BreedKey,
  accept: (p: Personality) => boolean,
  limit = 20_000,
): number {
  for (let seed = 1; seed <= limit; seed++) {
    if (accept(makeCat(breed, seed).personality)) return seed;
  }
  throw new Error(`在 ${limit} 个种子里找不到满足条件的 ${breed}`);
}

export function personalityOf(breed: BreedKey, seed: number): Personality {
  return makeCat(breed, seed).personality;
}

/** 事件种类序列。断言事件序列时比整个对象数组好读。 */
export function kinds(events: readonly WorldEvent[]): string[] {
  return events.map((e) => e.kind);
}

export function countBy(values: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

/** 每 everyTicks 步添一次粮。用来在长跑测试里让猫活着。 */
export function feedEvery(everyTicks: number): (i: number) => WorldInputs {
  return (i) => (i % everyTicks === 0 ? { actions: [{ type: 'fillBowl' }] } : {});
}
