import { describe, expect, it } from 'vitest';
import { diaryDayLabel, diaryText, diaryTimeLabel, groupDiary } from '../../src/diary/index.js';
import { makeCat } from '../../src/render/index.js';
import type { Cat } from '../../src/render/index.js';
import type { BreedKey } from '../../src/render/types.js';
import type { WorldEvent, WorldEventKind } from '../../src/world/index.js';
import { HOUR, findSeed, makeWorld, runTicks } from '../world/helpers.js';

/**
 * 日记文案的渲染。
 *
 * 三件事要守住：
 * - 每种事件都渲染得出句子（漏一种在界面上是一条空白，而且只有那种事件真的
 *   发生过才看得见）。
 * - 同一条事件每次渲染出同一句话（否则打开两次日记会看到两种说法）。
 * - **文案按性格分岔，而且不是恒真的分岔** - 下面每条差异断言都配了对照组。
 */

const ALL_KINDS: readonly WorldEventKind[] = [
  'adopted',
  'woke',
  'sleptAtNight',
  'napped',
  'ate',
  'ateGreedy',
  'fedByOwner',
  'petted',
  'petRefused',
  'gazedOutWindow',
  'groomed',
  'scratched',
  'zoomies',
  'hungry',
  'starving',
  'fellSick',
  'sickLingers',
  'medicated',
  'cured',
  'recoveredFromWeakness',
  'died',
];

const BASE = Date.UTC(2026, 6, 29, 0, 0, 0);

/** 一条覆盖全部事件种类、时刻各不相同的事件列。 */
function everyKind(): WorldEvent[] {
  return ALL_KINDS.map((kind, i) => ({
    kind,
    at: BASE + i * 30 * 60_000,
    important: false,
    ...(kind === 'died' ? { data: { days: 12 } } : {}),
  }));
}

/** 同一批事件在若干个时刻上重复，用来看候选措辞有没有真的轮换。 */
function repeated(kind: WorldEventKind, times: number): WorldEvent[] {
  return Array.from({ length: times }, (_, i) => ({
    kind,
    at: BASE + i * 30 * 60_000,
    important: false,
  }));
}

const orange = makeCat('orange', 20260728);

describe('每种事件都有文案', () => {
  it('全部 21 种事件都渲染出非空句子', () => {
    for (const e of everyKind()) {
      const text = diaryText(e, orange);
      expect(text.length, `${e.kind} 没有文案`).toBeGreaterThan(0);
      // 占位符必须已经填掉，界面上不该出现 {days} 这种东西。
      expect(text, `${e.kind} 残留占位符`).not.toMatch(/\{\w+\}/);
    }
  });

  it('死亡那条把陪伴天数填进去了', () => {
    const text = diaryText(
      { kind: 'died', at: BASE, important: true, data: { days: 37 } },
      orange,
    );
    expect(text).toContain('37');
  });

  it('文案是第一人称的猫的口吻，只有死亡那条是旁白', () => {
    // 「猫咪日记是猫的日记」（CONTEXT.md）。日记里不该出现把猫称作「它」的句子 -
    // 那是旁白在写猫，不是猫在写日记。唯一的例外是最后一页（见 VOICES.died）。
    for (const e of everyKind()) {
      if (e.kind === 'died') {
        expect(diaryText(e, orange)).toContain('它');
        continue;
      }
      expect(diaryText(e, orange), e.kind).not.toContain('它');
    }
  });

  it('作息与玩闹两类的题材词不串台', () => {
    // 这条守着 text.ts 里那条写作约束：作息句一律带「睡/醒/眠」，玩闹句一律带
    // 「跑/冲/爪/抓/磨」，两边不交叉。串台过一次（「跑累了，趴下歇一会儿」把
    // 活跃猫的休息条目写成了玩闹），所以留一条测试盯着。
    const REST_KINDS = ['woke', 'sleptAtNight', 'napped'] as const;
    const PLAY_KINDS = ['zoomies', 'scratched'] as const;
    const REST = /睡|醒|眠/;
    const PLAY = /跑|冲|爪|抓|磨/;
    // 两个档位的猫都要检查：分岔出来的两套句子都得守规矩。
    const cats = [
      catWith('orange', { active: 'low', clingy: 'low', greedy: 'low' }),
      catWith('cow', { active: 'high', clingy: 'high', greedy: 'high' }),
    ];
    for (const cat of cats) {
      for (const kind of REST_KINDS) {
        for (const e of repeated(kind, 12)) {
          const t = diaryText(e, cat);
          expect(t, `${kind}: ${t}`).toMatch(REST);
          expect(t, `${kind} 串到玩闹: ${t}`).not.toMatch(PLAY);
        }
      }
      for (const kind of PLAY_KINDS) {
        for (const e of repeated(kind, 12)) {
          const t = diaryText(e, cat);
          expect(t, `${kind}: ${t}`).toMatch(PLAY);
          expect(t, `${kind} 串到作息: ${t}`).not.toMatch(REST);
        }
      }
    }
  });
});

describe('渲染是确定的', () => {
  it('同一条事件渲染两次得到同一句话', () => {
    for (const e of everyKind()) {
      expect(diaryText(e, orange)).toBe(diaryText(e, orange));
    }
  });

  it('相邻时刻的同类事件会在候选措辞之间轮换', () => {
    // 事件时刻一律落在 30 分钟的整数倍上。直接取模的实现会让第二句永远不出现，
    // 这条测试就是那个坑的回归保护。
    const texts = new Set(repeated('napped', 12).map((e) => diaryText(e, orange)));
    expect(texts.size).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// 性格分岔
// ---------------------------------------------------------------------------

/** 在种子空间里找一只三条性格参数都落在指定档位的猫。 */
function catWith(
  breed: 'orange' | 'cow',
  want: { active: 'low' | 'high'; clingy: 'low' | 'high'; greedy: 'low' | 'high' },
  skip = 0,
): Cat {
  const ok = (v: number, side: 'low' | 'high'): boolean => (side === 'low' ? v < 0.5 : v >= 0.5);
  let found = 0;
  for (let seed = 1; seed <= 60_000; seed++) {
    const p = makeCat(breed, seed).personality;
    if (
      ok(p.active, want.active) &&
      ok(p.clingy, want.clingy) &&
      ok(p.greedy, want.greedy)
    ) {
      if (found++ === skip) return makeCat(breed, seed);
    }
  }
  throw new Error('找不到符合档位的猫');
}

describe('同一件事，不同性格说法不同', () => {
  const lazy = catWith('orange', { active: 'low', clingy: 'low', greedy: 'low' });
  const lively = catWith('cow', { active: 'high', clingy: 'high', greedy: 'high' });

  /** 措辞按性格分岔的事件种类。剩下的（生病、死亡、喂药）刻意不分岔。 */
  const BRANCHED: readonly WorldEventKind[] = [
    'woke',
    'sleptAtNight',
    'napped',
    'ate',
    'petted',
    'gazedOutWindow',
    'groomed',
    'scratched',
    'zoomies',
  ];

  it('该分岔的每一种事件都真的分岔了', () => {
    for (const kind of BRANCHED) {
      const e: WorldEvent = { kind, at: BASE, important: false };
      expect(diaryText(e, lazy), kind).not.toBe(diaryText(e, lively));
    }
  });

  it('身体状况那几条刻意不按性格分岔', () => {
    // 生病与死亡不该因为「这是只活跃猫」而说得轻快一点。这一族的语气是固定的。
    for (const kind of ['fellSick', 'sickLingers', 'cured', 'died'] as const) {
      const e: WorldEvent = { kind, at: BASE, important: true, data: { days: 9 } };
      expect(diaryText(e, lazy), kind).toBe(diaryText(e, lively));
    }
  });

  it('对照组：两只同档位的猫，同一批事件渲染出的句子完全一样', () => {
    // 这条证明上面那个断言不是恒真的 - 差异确实来自性格档位，
    // 而不是「随便两只猫就会不一样」。
    const another = catWith('orange', { active: 'low', clingy: 'low', greedy: 'low' }, 3);
    expect(another.seed).not.toBe(lazy.seed);
    for (const e of everyKind()) {
      expect(diaryText(e, another), e.kind).toBe(diaryText(e, lazy));
    }
  });

  it('作息看活跃度、吃饭看贪吃度、与人有关的看粘人度', () => {
    // 只改一条参数所在的档位，就只该影响对应的那一类事件。
    const base = catWith('orange', { active: 'low', clingy: 'low', greedy: 'low' });
    const eater = catWith('orange', { active: 'low', clingy: 'low', greedy: 'high' });
    const nap: WorldEvent = { kind: 'napped', at: BASE, important: false };
    const meal: WorldEvent = { kind: 'ate', at: BASE, important: false };
    expect(diaryText(nap, eater)).toBe(diaryText(nap, base));
    expect(diaryText(meal, eater)).not.toBe(diaryText(meal, base));
  });
});

// ---------------------------------------------------------------------------
// 内容分布：跑真实的世界，看渲染出来的日记读起来是不是两回事
// ---------------------------------------------------------------------------

/**
 * 一只猫跑 days 天（每 4 小时添一次粮）之后，日记里每种句子的出现频率。
 *
 * 量的是**句子的分布**而不是关键词占比。关键词占比试过，量不出东西来：日记记的是
 * 状态转换（入睡、醒来）而不是时长，而转换次数几乎不随活跃度变化 - 懒猫睡得更久
 * 但也醒得更频繁，两头抵消掉了。真正随性格变的是每条事件被说成什么话，
 * 以及贪吃度带来的进食事件构成（见下面 ateGreedy 那条）。
 */
function sentenceProfile(
  breed: BreedKey,
  seed: number,
  days: number,
): { readonly freq: Map<string, number>; readonly texts: readonly string[] } {
  const cat = makeCat(breed, seed);
  const run = runTicks(makeWorld({ breed, seed, hour: 0 }), days * 48, (i) =>
    i % 8 === 0 ? { actions: [{ type: 'fillBowl' }] } : {},
  );
  const texts = run.world.diary.map((e) => diaryText(e, cat));
  const freq = new Map<string, number>();
  for (const t of texts) freq.set(t, (freq.get(t) ?? 0) + 1 / texts.length);
  return { freq, texts };
}

/**
 * 两份分布的重合度（直方图交集），0..1。
 *
 * 1 = 两只猫的日记逐句同频，0 = 没有一句重合。
 * 用它而不是「差异条数」是因为它对**分布**敏感：只改措辞会把重合度打到接近 0，
 * 而两只同档位的猫仍然有八成重合，于是「不同」与「恒不同」能被区分开。
 */
function overlapOf(a: Map<string, number>, b: Map<string, number>): number {
  let sum = 0;
  for (const [text, p] of a) sum += Math.min(p, b.get(text) ?? 0);
  return sum;
}

describe('两只性格反差大的真猫，日记的内容分布确实不同', () => {
  const DAYS = 14;
  /** 三条性格参数都在低档的懒猫，与三条都在高档的活跃猫。 */
  const lazySeed = findSeed('orange', (p) => p.active < 0.15 && p.clingy < 0.3 && p.greedy < 0.3);
  const livelySeed = findSeed('cow', (p) => p.active > 0.85 && p.clingy > 0.7 && p.greedy > 0.7);
  const lazy = sentenceProfile('orange', lazySeed, DAYS);
  const lively = sentenceProfile('cow', livelySeed, DAYS);

  it('两边的日记都足够长，比较才有意义', () => {
    expect(lazy.texts.length).toBeGreaterThan(60);
    expect(lively.texts.length).toBeGreaterThan(60);
  });

  it('句子分布几乎不重合', () => {
    expect(overlapOf(lazy.freq, lively.freq)).toBeLessThan(0.15);
  });

  it('对照组：换成另一只同档位的猫，分布重合大半', () => {
    // 这条是上面那个断言的对照：如果渲染根本不看性格，两组都会重合到接近 1；
    // 如果「不重合」只是种子噪声（不同种子 = 不同随机流 = 不同事件序列），
    // 同档位的两只也会不重合。都不是。
    // 刻意换了品种：布偶与橘猫的骨架、随机流全不一样，只有性格档位相同。
    const otherSeed = findSeed('ragdoll', (p) => p.active < 0.2 && p.clingy < 0.3 && p.greedy < 0.3);
    const other = sentenceProfile('ragdoll', otherSeed, DAYS);
    expect(overlapOf(lazy.freq, other.freq)).toBeGreaterThan(0.6);
  });

  it('贪吃度还改变了事件本身的构成：只有贪吃猫会扑到碗上', () => {
    // 这一条的差异来自世界层（eatThreshold 与 EAT_DASH_GREEDY_THRESHOLD），
    // 不是文案分岔 - 贪吃猫会产出 ateGreedy 事件，不贪吃的猫一条都没有。
    // 日记因此在「内容」层面也不同，而不只是在措辞层面。
    const dash = /碗还没放稳|一口气吃完/;
    expect(lively.texts.some((t) => dash.test(t))).toBe(true);
    expect(lazy.texts.some((t) => dash.test(t))).toBe(false);
  });
});

describe('分组与时刻', () => {
  it('按本地日倒序分组，天内正序', () => {
    const events: WorldEvent[] = [
      { kind: 'woke', at: BASE + 7 * HOUR, important: false },
      { kind: 'napped', at: BASE + 13 * HOUR, important: false },
      { kind: 'zoomies', at: BASE + 26 * HOUR, important: false },
    ];
    const days = groupDiary(events, orange, 0);
    expect(days.length).toBe(2);
    // 最近的一天在前
    expect(days[0]!.entries.map((e) => e.time)).toEqual(['02:00']);
    expect(days[1]!.entries.map((e) => e.time)).toEqual(['07:00', '13:00']);
  });

  it('时刻与日期标题跟着传入的时区偏移走，不读运行环境的时区', () => {
    // 东八区：UTC 的 00:00 就是本地 08:00，日期也不会变。
    expect(diaryTimeLabel(BASE, 480)).toBe('08:00');
    expect(diaryTimeLabel(BASE, 0)).toBe('00:00');
    expect(diaryDayLabel(BASE, 0)).toBe('7 月 29 日 · 周三');
    // 往前挪 8 小时就落到前一天了
    expect(diaryDayLabel(BASE, -480)).toBe('7 月 28 日 · 周二');
  });

  it('limit 只留最近的那些条', () => {
    const events = repeated('napped', 20);
    const days = groupDiary(events, orange, 0, 5);
    const count = days.reduce((n, d) => n + d.entries.length, 0);
    expect(count).toBe(5);
    expect(days[0]!.entries.at(-1)!.at).toBe(events.at(-1)!.at);
  });
});
