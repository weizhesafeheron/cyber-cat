import { BREED_KEYS } from '../render/index.js';
import type { BreedKey } from '../render/index.js';
import { SEED_SPACE } from './constants.js';
import type { AdoptedIdentity } from './identity.js';
import { normalizeName } from './name.js';

/**
 * 领养流程的纯逻辑。
 *
 * 分工：这里只回答「现在是哪只猫、下一步能做什么」，**不碰 DOM、不取时钟、
 * 不自己产随机数**（随机源注入）。按钮回调里只有状态迁移的调用。
 *
 * 为什么必须是纯的：验收项里有「七个品种都能被抽到」与「同品种不同 Seed 的猫
 * 明显不同」。埋在点击回调里的话，这两条只能靠人手点几十次去撞，撞不到也不知道
 * 是运气差还是实现错。
 *
 * 术语按 CONTEXT.md 的「领养」：猫**主动走来**，用户可以让它再等等（重新抽取），
 * 直到遇到想留下的那只。代码里叫「来客」不叫「候选项」，是为了别在写界面文案时
 * 顺手写出「生成一只猫」。
 */

/** 一只来访的猫。「品种 + Seed」就足以完整重建它的外观与性格（ADR 0002）。 */
export interface Candidate {
  readonly breed: BreedKey;
  readonly seed: number;
}

/** meeting = 正在打量这只猫；naming = 已经决定留下它，正在起名。 */
export type AdoptionPhase = 'meeting' | 'naming';

export interface AdoptionFlow {
  readonly phase: AdoptionPhase;
  readonly candidate: Candidate;
  /**
   * 还没发完的那副牌。
   *
   * **不是「每次随机挑一个品种」。** 均匀随机允许连着来七只橘猫 - 概率虽小，
   * 但落到某个用户头上他看到的就是「这游戏只有橘猫」。一副洗好的牌发完再洗，
   * 保证任意连续七只覆盖全部七个品种。
   */
  readonly bag: readonly BreedKey[];
  /** 已经来过几只（含当前这只）。呈现上用来区分「第一只」与「又来了一只」。 */
  readonly met: number;
}

/** 洗一副新牌。`avoid` 是上一只的品种，洗完不让它排在第一张。 */
function shuffle(rnd: () => number, avoid?: BreedKey): BreedKey[] {
  const bag = BREED_KEYS.slice();
  for (let i = bag.length - 1; i > 0; i--) {
    // rnd 的契约是 [0, 1)，但注入的实现可能是别人写的 - 越界一次就丢一个品种。
    const j = Math.min(i, Math.max(0, Math.floor(rnd() * (i + 1))));
    const tmp = bag[i]!;
    bag[i] = bag[j]!;
    bag[j] = tmp;
  }
  // 连着来两只同品种会让人以为品种就那么几个，和上一只重了就换到队尾去。
  if (avoid !== undefined && bag[0] === avoid && bag.length > 1) {
    const last = bag.length - 1;
    const tmp = bag[0]!;
    bag[0] = bag[last]!;
    bag[last] = tmp;
  }
  return bag;
}

/** Seed 取整数：mulberry32 吃的是整数，小数会让两个不同的 Seed 落到同一只猫。 */
function nextSeed(rnd: () => number): number {
  return Math.floor(Math.min(Math.max(rnd(), 0), 0.999999999) * SEED_SPACE);
}

function deal(
  bag: readonly BreedKey[],
  rnd: () => number,
  avoid?: BreedKey,
): { candidate: Candidate; bag: readonly BreedKey[] } {
  const pool = bag.length > 0 ? bag : shuffle(rnd, avoid);
  return { candidate: { breed: pool[0]!, seed: nextSeed(rnd) }, bag: pool.slice(1) };
}

/** 第一只猫走来。 */
export function beginAdoption(rnd: () => number): AdoptionFlow {
  const { candidate, bag } = deal([], rnd);
  return { phase: 'meeting', candidate, bag, met: 1 };
}

/**
 * 再等等，换下一只。**不限次数**（验收项）。
 *
 * 所以这里没有任何计数上限，也没有「稀有度」之类的暗门 - 用户想看多久看多久。
 */
export function meetNext(flow: AdoptionFlow, rnd: () => number): AdoptionFlow {
  const { candidate, bag } = deal(flow.bag, rnd, flow.candidate.breed);
  return { phase: 'meeting', candidate, bag, met: flow.met + 1 };
}

/** 就是它了：留下这只，进入起名。 */
export function accept(flow: AdoptionFlow): AdoptionFlow {
  return { ...flow, phase: 'naming' };
}

/** 再想想：从起名退回来继续看这只猫。**不换猫** - 退回来还是刚才那只。 */
export function resumeMeeting(flow: AdoptionFlow): AdoptionFlow {
  return { ...flow, phase: 'meeting' };
}

export type NamingResult =
  | { readonly ok: true; readonly identity: AdoptedIdentity }
  | { readonly ok: false; readonly reason: string };

/**
 * 给它起名，得到完整身份。
 *
 * 只在 naming 阶段有效：还在打量的阶段就能起名意味着界面上存在一条能绕过
 * 「决定留下」的通路，那一步是这个流程的全部意义所在。
 */
export function nameIt(flow: AdoptionFlow, raw: string): NamingResult {
  if (flow.phase !== 'naming') return { ok: false, reason: '还没决定留下它' };
  const checked = normalizeName(raw);
  if (!checked.ok) return { ok: false, reason: checked.reason };
  return {
    ok: true,
    identity: { breed: flow.candidate.breed, seed: flow.candidate.seed, name: checked.name },
  };
}
