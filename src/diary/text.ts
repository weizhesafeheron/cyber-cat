import type { Cat } from '../render/index.js';
import { localDayIndex } from '../world/index.js';
import type { WorldEvent, WorldEventKind } from '../world/index.js';

/**
 * 猫咪日记的文案渲染。
 *
 * **纯函数：`(event, cat) -> string`。** 没有 DOM、没有时钟、没有随机源，
 * 因此可以直接测（test/diary/text.test.ts），也可以被告别页复用。
 *
 * 为什么文案不进存档（world/types.ts 也写了这条）：同一件事对懒猫和活跃猫要说成
 * 不同的话，而性格是由「品种 + Seed」重建的。文案存进去就锁死了 - 之后改一个字，
 * 老存档里的旧句子会跟新句子混在一起，而且再也调不动。
 * 存档里只有结构化事件，句子在每次呈现时算出来。
 *
 * 四条写作约束：
 * - **第一人称。** 「猫咪日记是猫的日记」（CONTEXT.md），主语是「我」，
 *   用户是「你」。这也是为什么用户自己的动作根本不进日记（world/tick.ts 的 emit）。
 * - **不总结、不升华。** 一条就是一件事，允许一句话说完。
 * - **同一件事的措辞按性格分岔**，而不是只在句尾加个形容词。
 * - **题材词不许串台。** 作息那几种事件的每一句都带「睡 / 醒 / 眠」，玩闹那几种
 *   带「跑 / 冲 / 爪 / 抓 / 磨」，两边不交叉。这不是文风洁癖，是为了让
 *   「懒猫的日记以睡觉为主、活跃猫鸡飞狗跳」这句验收标准**可度量**：
 *   test/diary/text.test.ts 就是按这两组词统计两只猫日记的题材占比的。
 *   曾经写成「跑累了，趴下歇一会儿」，结果活跃猫的休息条目被算进了玩闹，
 *   两只猫的占比反了过来。
 */

/**
 * 性格分档的阈值。
 *
 * 三条性格参数都是 0..1（active 被夹在 0.05..0.95，clingy / greedy 是均匀分布），
 * 所以 0.5 把种子空间大致对半分。**只分两档是刻意的**：分三档的话中间档会拿到
 * 一套「不偏不倚」的句子，读起来最像模板，而那一档恰好覆盖最多的猫。
 */
const TRAIT_SPLIT = 0.5;

/** 按一条性格参数选一组措辞。低档在前，高档在后。 */
function byTrait(
  value: number,
  low: readonly string[],
  high: readonly string[],
): readonly string[] {
  return value < TRAIT_SPLIT ? low : high;
}

/**
 * 每种事件的候选措辞。
 *
 * 分岔用哪条性格参数是按事件的语义选的，不是随手挑的：
 * 作息看活跃度、吃饭看贪吃度、与人有关的看粘人度。
 * 挑错参数的后果是「明明是只贪吃猫，日记里吃饭那条却在讲它多活跃」。
 */
/** 认不出的事件用它。不写「未知事件」这种词，那会把实现细节漏给用户。 */
const FALLBACK = '这一天过去了。';

const VOICES: Record<WorldEventKind, (cat: Cat) => readonly string[]> = {
  adopted: () => ['雨停了。我跟着你走进这间屋子，然后决定留下。'],

  woke: (c) =>
    byTrait(
      c.personality.active,
      ['我睁开一只眼，屋里什么都没变，又眯回去睡了。', '我不太想醒。可是眼睛自己就开了。'],
      ['我一醒就想找点事做。', '醒了。我先把屋子从这头看到那头。'],
    ),

  sleptAtNight: (c) =>
    byTrait(
      c.personality.active,
      ['天黑了，我把自己叠起来睡了。', '夜里最好。我几乎是一躺下就睡着了。'],
      ['外面有点动静，我听了一会儿才睡。', '本来还想再折腾一会儿，站着就睡着了。'],
    ),

  napped: (c) =>
    byTrait(
      c.personality.active,
      ['白天很长，我睡掉了大半。', '光挪到哪儿我就跟到哪儿，然后睡过去。'],
      ['折腾累了，睡一小会儿。只是一小会儿。', '我睡了一小段，起来天还亮着，有点亏。'],
    ),

  ate: (c) =>
    byTrait(
      c.personality.greedy,
      ['先绕着碗看了一圈，才开始吃。', '吃了一些。剩下的留着，我不着急。'],
      ['碗里有东西。我三口就吃完了。', '闻到味道就过去了，没有犹豫。'],
    ),

  ateGreedy: () => ['碗还没放稳，我已经在吃了。', '我一口气吃完，碗底也舔干净了。'],

  fedByOwner: () => ['你往碗里添了粮。'],

  petted: (c) =>
    byTrait(
      c.personality.clingy,
      ['你摸了我。我让你摸了。'],
      ['你摸我的时候我蹭了回去，蹭了好几下。'],
    ),

  petRefused: () => ['睡着的时候被摸了。尾巴甩了一下，你应该懂。'],

  // 拎起来与放下（ticket 10）。世界层走 emit 不进日记，所以这两条实际不会出现在
  // 日记里；文案表按 WorldEventKind 全覆盖（漏一个就编译不过），所以照样给。
  // 「进不进日记」是世界层的决定，不该靠这张表少写一行来表达。
  pickedUp: (c) =>
    byTrait(
      c.personality.clingy,
      ['我被整只端了起来。我不喜欢这样，但没挣。', '两只脚离了地。我在空中等这件事结束。'],
      ['被你抱起来了。虽然姿势不对，但是你抱的。', '我被拎起来的时候正好在看你。'],
    ),

  dropped: (c) =>
    byTrait(
      c.personality.clingy,
      ['放我下来之后我走开了。这不算生气，只是要走一走。', '落地。我抖了抖，去别处趴下。'],
      ['落地之后我又蹭回你手边。你别得意。', '我先甩了一下尾巴，然后回到你脚边。'],
    ),

  gazedOutWindow: (c) =>
    byTrait(
      c.personality.clingy,
      ['窗外有东西在动。我看了很久，没打算过去。', '外面在下雨。看雨是件正经事。'],
      ['趴在窗边看了很久。外面没有你。', '看着窗外，耳朵一直朝着门那边。'],
    ),

  groomed: (c) =>
    byTrait(
      c.personality.active,
      ['我从头到尾把自己理了一遍，理得很慢。'],
      ['身上有点味道，我处理掉了，然后接着找事做。'],
    ),

  scratched: (c) =>
    byTrait(
      c.personality.active,
      ['我伸出爪子抓了两下，够了。'],
      ['我找了个地方磨爪子，磨得很起劲，留下了痕迹。'],
    ),

  zoomies: (c) =>
    byTrait(
      c.personality.active,
      ['半夜莫名想跑，我跑了两步就算了。', '深夜我起来跑了一小圈，然后又趴回去。'],
      ['半夜里我从这头冲到那头，来回好几趟。', '深夜是我的。我跑得很快，没人看见。'],
    ),

  hungry: () => ['碗是空的。我去看了三次，还是空的。', '有点饿。碗里什么都没有。'],

  starving: () => ['我在碗边坐了很久。你要是回来就好了。', '很饿。我叫了几声，屋里没有人。'],

  fellSick: () => ['身上不太对。我趴着，不想动。', '今天走两步就想躺下。哪里出问题了。'],

  sickLingers: () => ['还是不舒服。我一直趴在同一个地方。', '眼睛睁不太开。时间过得很慢。'],

  medicated: () => ['你给我喂了药。'],

  cured: () => ['吃了你给的东西，好一些了。', '今天能站起来走路了。'],

  recoveredFromWeakness: () => ['身上终于有劲了。', '好像整个都回来了。'],

  // 死亡这一条**不是猫的口吻**。它是日记的最后一页，由旁白收尾 -
  // 让一只猫自己写下「我死了」既不真也不体面。
  died: () => ['（这一页之后，日记没有再写下去。它陪了你 {days} 天。）'],
};

/**
 * 从事件时刻推出一个稳定的候选序号。
 *
 * 三条要求同时成立才行：**确定性**（同一条事件每次渲染出同一句话，否则打开两次
 * 日记会看到两种说法）、**纯**（不能用 Math.random，见 world/step.ts 的约定）、
 * 以及**相邻事件要错开**。
 *
 * 最后一条是这里必须做散列而不是直接取模的原因：事件时刻一律落在模拟步的整数倍
 * 上（30 分钟），`at / 15000 % 2` 对任意两条事件都给出同一个值，两句候选里的
 * 第二句永远不会出现。先散列再取模才真的在两句之间交替。
 */
function variantIndex(at: number, kind: WorldEventKind, count: number): number {
  if (count <= 1) return 0;
  // 取秒而不是毫秒：毫秒的 epoch 超过 2^31，位运算会截断高位。秒到 2038 年前都安全。
  let h = (Math.floor(at / 1000) ^ kindSeed(kind)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h = (h ^ (h >>> 15)) >>> 0;
  return h % count;
}

/** 事件种类混进散列，免得同一时刻的两条事件挑到同一个序号（读起来会像复制粘贴）。 */
function kindSeed(kind: WorldEventKind): number {
  let h = 0;
  for (let i = 0; i < kind.length; i++) h = (Math.imul(h, 31) + kind.charCodeAt(i)) | 0;
  return h;
}

/** 把 {key} 换成事件带的数值。缺数值时留着占位符会比显示 undefined 更好查。 */
function fill(text: string, data: Readonly<Record<string, number>> | undefined): string {
  if (!data) return text;
  return text.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const v = data[key];
    return v === undefined ? whole : String(Math.round(v));
  });
}

/**
 * 一条事件的日记文案。
 *
 * 这是本模块的核心，也是告别页翻看日记时要用的那一个函数。
 */
export function diaryText(event: WorldEvent, cat: Cat): string {
  // 认不出的事件要兜底，**不能抛**。存档可以比代码新（用户降级了版本），
  // 而档案里还留着历任猫的日记 - 一条认不出的事件抛出去，整个日记窗口或告别页
  // 就渲染不出来了，用户丢的是全部而不是一条。
  const voice = VOICES[event.kind] as ((c: Cat) => readonly string[]) | undefined;
  if (voice === undefined) return FALLBACK;
  const voices = voice(cat);
  const pick = voices[variantIndex(event.at, event.kind, voices.length)] ?? voices[0]!;
  return fill(pick, event.data);
}

/** 本地时刻，`HH:MM`。 */
export function diaryTimeLabel(atMs: number, tzOffsetMinutes: number): string {
  const d = shifted(atMs, tzOffsetMinutes);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;

/** 分组标题，如「7 月 29 日 · 周三」。 */
export function diaryDayLabel(atMs: number, tzOffsetMinutes: number): string {
  const d = shifted(atMs, tzOffsetMinutes);
  return `${d.getUTCMonth() + 1} 月 ${d.getUTCDate()} 日 · ${WEEKDAYS[d.getUTCDay()]!}`;
}

/**
 * 把时刻挪到本地时区，之后一律用 UTC 取值。
 *
 * **不用 Date 的本地取值方法**：那会读运行环境的时区设置，而日记的日界必须与
 * 世界层的 localDayIndex 用同一个偏移（world.tzOffsetMinutes），否则「哪天的事」
 * 在界面上和在存档里会是两天。
 */
function shifted(atMs: number, tzOffsetMinutes: number): Date {
  return new Date(atMs + tzOffsetMinutes * 60_000);
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 渲染好的一条。 */
export interface DiaryEntry {
  readonly at: number;
  readonly time: string;
  readonly text: string;
  readonly important: boolean;
}

/** 按本地日分组之后的一天。 */
export interface DiaryDay {
  /** 本地日序号，与 world.diaryDay 同一套。 */
  readonly day: number;
  readonly label: string;
  readonly entries: readonly DiaryEntry[];
}

/**
 * 把事件列渲染成按天倒序的日记。
 *
 * 倒序是因为「回来看猫做了什么」问的是最近发生的事；每天之内仍然按时间正序，
 * 那一天读起来才是连着的。
 *
 * `limit` 只截最近的这么多条，早年的不再渲染 - 存档里最多 400 条，全铺出来
 * 滚动条会长得没有参考意义（见 constants.ts 的 DIARY_VISIBLE_ENTRIES）。
 */
export function groupDiary(
  events: readonly WorldEvent[],
  cat: Cat,
  tzOffsetMinutes: number,
  limit = Number.POSITIVE_INFINITY,
): readonly DiaryDay[] {
  const recent = events.length > limit ? events.slice(events.length - limit) : events;
  const order: number[] = [];
  const byDay = new Map<number, DiaryEntry[]>();
  for (const e of recent) {
    const day = localDayIndex(e.at, tzOffsetMinutes);
    const entry: DiaryEntry = {
      at: e.at,
      time: diaryTimeLabel(e.at, tzOffsetMinutes),
      text: diaryText(e, cat),
      important: e.important,
    };
    const bucket = byDay.get(day);
    if (bucket) {
      bucket.push(entry);
    } else {
      byDay.set(day, [entry]);
      order.push(day);
    }
  }
  // 事件本来就是按时间追加的，所以天的顺序也是正序，倒过来即可。
  return order
    .map((day) => {
      const entries = byDay.get(day)!;
      return { day, label: diaryDayLabel(entries[0]!.at, tzOffsetMinutes), entries };
    })
    .reverse();
}
