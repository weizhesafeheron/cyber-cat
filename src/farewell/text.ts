import { BREEDS, materializeCat } from '../render/index.js';
import { MS_PER_DAY, MS_PER_MINUTE } from '../world/index.js';
import { lifespanDays } from '../memorial/index.js';
import type { Memorial, MemorialEntry } from '../memorial/index.js';
import { diaryText } from '../diary/index.js';

/**
 * 告别页的文案。
 *
 * 与 app/status.ts 同一条理由：世界层与档案层只产出结构化数据，怎么说给人听
 * 是呈现的事。放在这里而不是 main.ts 里，是因为**告别页上的每个数字都会被
 * 用户逐字读**（陪伴了多少天、喂了多少次），算错一个就毁掉这一页的分量，
 * 而 DOM 里的字符串拼接测不了。
 *
 * 呈现基调（issue #13 的验收项）：**安静，不恐怖，不搞笑。**
 * 落到文案上就是：陈述句、不用感叹号、不写「永远怀念」这类抬高的话，
 * 也不拿死亡开玩笑。数字自己就够重了。
 */

/**
 * 某个时刻在本地时区的日期，`YYYY-MM-DD`。
 *
 * 先加时区偏移再取 UTC 的日期部分，**不用 toLocaleDateString**：
 * 那个函数读的是运行机器的时区与区域设置，同一份档案在改过时区的机器上会显示成
 * 另一个日子，测试也会随 TZ 环境变量飘。世界层拿本地小时也是这么处理的
 * （world/clock.ts），两边保持一致。
 */
export function formatDay(atMs: number, tzOffsetMinutes: number): string {
  return new Date(atMs + tzOffsetMinutes * MS_PER_MINUTE).toISOString().slice(0, 10);
}

/** 本地日序号。与 world/clock.ts 的 localDayIndex 同一条算式，用来数「第几天」。 */
function dayIndex(atMs: number, tzOffsetMinutes: number): number {
  return Math.floor((atMs + tzOffsetMinutes * MS_PER_MINUTE) / MS_PER_DAY);
}

/** 品种与生卒。「这是谁」那一行。 */
export function lifeLine(entry: MemorialEntry, tzOffsetMinutes: number): string {
  const breed = BREEDS[entry.identity.breed].label;
  const born = formatDay(entry.identity.bornAt, tzOffsetMinutes);
  const died = formatDay(entry.diedAt, tzOffsetMinutes);
  return `${breed} · ${born} - ${died}`;
}

/**
 * 陪伴记录。**验收项要求的三项都在这一行里**：陪伴天数、喂食次数、抚摸次数。
 *
 * 次数为 0 也照实写。藏起来是一种讨好 - 而这一页的分量恰恰来自它说的是实话。
 */
export function companionLine(entry: MemorialEntry): string {
  return `陪伴 ${lifespanDays(entry)} 天 · 喂食 ${entry.stats.feedCount} 次 · 抚摸 ${entry.stats.petCount} 次`;
}

export interface DiaryLine {
  /** 已渲染好的一句话。 */
  readonly text: string;
  /** 事件发生的时刻，epoch ms。呈现层排序与显示时刻用。 */
  readonly at: number;
  /** 重要事件（生病、死亡、领养）。呈现上给一点强调，但不加惊叹号。 */
  readonly important: boolean;
}

export interface DiaryDay {
  /** `YYYY-MM-DD`。 */
  readonly day: string;
  /** 这是它到家后的第几天，从 1 起。 */
  readonly nth: number;
  readonly lines: readonly DiaryLine[];
}

/**
 * 一生的日记，按天分组。
 *
 * **按时刻重排而不是照数组顺序**：日记数组本身是按写入顺序的，正常情况下就是
 * 时间顺序，但档案是长期数据，一次手工编辑或者将来的合并就可能打乱它。
 * 排一遍的代价是几百条的一次 sort，收益是这一页永远不会出现「第 3 天在第 5 天后面」。
 *
 * 「第几天」按出生日算，不按日记里的第一条算 - 领养事件的时刻就是出生时刻，
 * 但档案里的日记有上限（DIARY_MAX_ENTRIES），活得久的猫最早那几条已经被丢掉了。
 */
export function diaryByDay(entry: MemorialEntry, tzOffsetMinutes: number): DiaryDay[] {
  const bornDay = dayIndex(entry.identity.bornAt, tzOffsetMinutes);
  const cat = materializeCat(entry.identity);
  const sorted = [...entry.diary].sort((a, b) => a.at - b.at);

  const days: DiaryDay[] = [];
  let current: { day: string; nth: number; lines: DiaryLine[] } | null = null;
  for (const event of sorted) {
    const day = formatDay(event.at, tzOffsetMinutes);
    if (current === null || current.day !== day) {
      current = { day, nth: dayIndex(event.at, tzOffsetMinutes) - bornDay + 1, lines: [] };
      days.push(current);
    }
    current.lines.push({
      // 文案按性格分化（ticket 13），所以要从封存档案重建那只猫。
      text: diaryText(event, cat),
      at: event.at,
      important: event.important,
    });
  }
  return days;
}

export interface ArchiveRow {
  readonly name: string;
  readonly breed: string;
  /** 生卒，`YYYY-MM-DD - YYYY-MM-DD`。 */
  readonly span: string;
  readonly days: number;
  /**
   * 在 Memorial.cats 里的下标。点一行要能翻到那只猫的日记，
   * 而这个列表是倒序的 - 带上原下标比让调用方再算一次减法安全。
   */
  readonly index: number;
}

/**
 * 档案列表，**最近离开的排最前**。
 *
 * 档案里是按离开顺序追加的，展示要反过来：用户打开这一页时最想看的是刚离开的那只，
 * 更早的猫往下翻。
 */
export function archiveRows(archive: Memorial, tzOffsetMinutes: number): ArchiveRow[] {
  return archive.cats
    .map((entry, index) => ({
      name: entry.identity.name,
      breed: BREEDS[entry.identity.breed].label,
      span: [
        formatDay(entry.identity.bornAt, tzOffsetMinutes),
        formatDay(entry.diedAt, tzOffsetMinutes),
      ].join(' - '),
      days: lifespanDays(entry),
      index,
    }))
    .reverse();
}
