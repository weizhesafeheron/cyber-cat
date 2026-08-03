/**
 * 日记未读判定。只看最后一条的时间，不看数组长度：日记达到 400 条上限后，
 * 新条目会挤掉旧条目，长度不变但仍然必须亮起未读标记。
 */

export interface DiaryStamp {
  readonly at: number;
}

export function newestDiaryAt(diary: readonly DiaryStamp[]): number | null {
  return diary.length === 0 ? null : diary[diary.length - 1]!.at;
}

export function diaryAdvanced(previousNewestAt: number | null, diary: readonly DiaryStamp[]): boolean {
  const newest = newestDiaryAt(diary);
  return newest !== null && (previousNewestAt === null || newest > previousNewestAt);
}
