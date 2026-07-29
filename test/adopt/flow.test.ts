import { describe, expect, it } from 'vitest';
import { BREED_KEYS, mulberry32 } from '../../src/render/index.js';
import type { BreedKey } from '../../src/render/index.js';
import { SEED_SPACE } from '../../src/adopt/constants.js';
import { accept, beginAdoption, meetNext, nameIt, resumeMeeting } from '../../src/adopt/flow.js';
import type { AdoptionFlow } from '../../src/adopt/flow.js';

/**
 * 领养流程的纯逻辑。
 *
 * 这一层刻意不碰 DOM：「换下一只」「选定」「起名」如果埋在按钮回调里，
 * 「七个品种都能被抽到」这类验收项就只能靠人手点几十次去撞。
 */

/** 收集连续来访的若干只猫。 */
function meetMany(count: number, rnd: () => number): AdoptionFlow[] {
  const out: AdoptionFlow[] = [beginAdoption(rnd)];
  while (out.length < count) out.push(meetNext(out[out.length - 1]!, rnd));
  return out;
}

describe('来访的猫覆盖全部七个品种', () => {
  it('前七只就是七个品种各一只，不靠运气', () => {
    // 均匀随机做不到这条：连着抽七次橘猫的概率虽小，但用户只会看到「只有橘猫」。
    // 所以实现是一副洗好的牌，发完再洗。
    for (const seed of [1, 7, 20260729, 999999937]) {
      const rnd = mulberry32(seed);
      const breeds = meetMany(BREED_KEYS.length, rnd).map((f) => f.candidate.breed);
      const kinds = new Set(breeds).size;
      expect(kinds, `seed ${seed}：前七只只出现了 ${kinds} 个品种`).toBe(BREED_KEYS.length);
    }
  });

  it('随机源退化成常量时依然覆盖七个品种', () => {
    // 洗牌用 rnd 决定下标，若实现写成「随机挑一个品种」，常量随机源会让它永远
    // 只给同一个品种 - 这条就是那种实现的照妖镜。
    for (const fixed of [0, 0.5, 0.999999]) {
      const rnd = (): number => fixed;
      const breeds = meetMany(BREED_KEYS.length, rnd).map((f) => f.candidate.breed);
      const kinds = new Set(breeds).size;
      expect(kinds, `rnd 恒为 ${fixed} 时只出现了 ${kinds} 个品种`).toBe(BREED_KEYS.length);
    }
  });

  it('长时间换下去，七个品种的出现次数大致均衡', () => {
    const rnd = mulberry32(4242);
    const counts = new Map<BreedKey, number>(BREED_KEYS.map((b) => [b, 0]));
    for (const f of meetMany(70, rnd)) {
      counts.set(f.candidate.breed, counts.get(f.candidate.breed)! + 1);
    }
    for (const [breed, n] of counts) {
      expect(n, `${breed} 在 70 只里只出现了 ${n} 次`).toBe(10);
    }
  });

  it('不会连着来两只同品种 - 那会让人以为品种就那么几个', () => {
    const rnd = mulberry32(99);
    const breeds = meetMany(120, rnd).map((f) => f.candidate.breed);
    for (let i = 1; i < breeds.length; i++) {
      expect(breeds[i], `第 ${i} 只与上一只都是 ${breeds[i]}`).not.toBe(breeds[i - 1]);
    }
  });
});

describe('再等等：换下一只不限次数', () => {
  it('连换两百只都拿得到一只有效的猫', () => {
    const rnd = mulberry32(2026);
    let flow = beginAdoption(rnd);
    for (let i = 0; i < 200; i++) {
      flow = meetNext(flow, rnd);
      expect(BREED_KEYS).toContain(flow.candidate.breed);
      expect(Number.isInteger(flow.candidate.seed)).toBe(true);
      expect(flow.phase).toBe('meeting');
    }
  });

  it('每只猫都有自己的 Seed，且落在 mulberry32 能用的整数范围内', () => {
    const rnd = mulberry32(31337);
    const seeds = meetMany(60, rnd).map((f) => f.candidate.seed);
    // 同一个 Seed 撞两次意味着「换下一只」有可能换出一只一模一样的猫
    expect(new Set(seeds).size).toBe(seeds.length);
    for (const s of seeds) {
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(SEED_SPACE);
    }
  });

  it('换下一只不改动原来的状态（返回新对象）', () => {
    const rnd = mulberry32(5);
    const first = beginAdoption(rnd);
    const snapshot = { ...first.candidate };
    const second = meetNext(first, rnd);
    expect(first.candidate).toEqual(snapshot);
    expect(second).not.toBe(first);
  });

  it('已经看过几只是累加的，用于呈现上区分「第一只」与「又来了一只」', () => {
    const rnd = mulberry32(6);
    const flows = meetMany(4, rnd);
    expect(flows.map((f) => f.met)).toEqual([1, 2, 3, 4]);
  });
});

describe('选定与起名', () => {
  const rnd = mulberry32(77);

  it('选定之后进入起名，猫不变', () => {
    const flow = beginAdoption(rnd);
    const naming = accept(flow);
    expect(naming.phase).toBe('naming');
    expect(naming.candidate).toEqual(flow.candidate);
  });

  it('起名界面可以退回去继续看，猫还是那一只', () => {
    const flow = accept(beginAdoption(rnd));
    const back = resumeMeeting(flow);
    expect(back.phase).toBe('meeting');
    expect(back.candidate).toEqual(flow.candidate);
  });

  it('起好名字后拿到完整的身份：品种 + Seed + 名字', () => {
    const flow = accept(beginAdoption(rnd));
    const r = nameIt(flow, '  小橘  ');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.identity.breed).toBe(flow.candidate.breed);
      expect(r.identity.seed).toBe(flow.candidate.seed);
      expect(r.identity.name).toBe('小橘');
    }
  });

  it('名字不合法时拒绝，并且不产出身份', () => {
    const flow = accept(beginAdoption(rnd));
    const r = nameIt(flow, '   ');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.length).toBeGreaterThan(0);
  });

  it('还在看猫的阶段不能起名 - 起名只能是选定之后的一步', () => {
    const flow = beginAdoption(rnd);
    const r = nameIt(flow, '小橘');
    expect(r.ok).toBe(false);
  });
});
