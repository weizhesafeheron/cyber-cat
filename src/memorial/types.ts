import type { CatIdentity, WorldEvent, WorldStats } from '../world/index.js';

/**
 * 猫的档案（CONTEXT.md）：玩家养过的所有猫的列表，死亡的猫在此留档。
 *
 * **为什么是独立的一份存档，不是 World 的一个字段**，见
 * [ADR 0010](../../docs/adr/0010-memorial-archive-separate-save.md)。
 * 一句话：world.json 是「当前这只猫」，领养新猫时它会被整份覆盖 -
 * 档案的生命周期比任何一只猫都长，塞进去等于每换一只猫就把历任猫抹掉一次。
 */

/**
 * 一只已经离开的猫在档案里的那一条。
 *
 * 身份整份保留：新身份包含无法由 Seed 重建的性格与调参快照（ADR 0015）。
 * 陪伴天数仍由 bornAt 与 diedAt 算出来，不另存派生值。
 *
 * 日记必须存：world.json 被新猫覆盖之后，那只猫的一生就只剩这里一份了
 * （CONTEXT.md 的「猫咪日记」：死后可在猫的档案中回看）。
 */
export interface MemorialEntry {
  readonly identity: CatIdentity;
  /** 死亡时刻，epoch ms。 */
  readonly diedAt: number;
  /** 陪伴记录。告别页的喂食次数与抚摸次数就是它。 */
  readonly stats: WorldStats;
  /** 它的一生。就是死亡时 world.diary 的那一份快照。 */
  readonly diary: readonly WorldEvent[];
}

/** 整份档案。按入档顺序排列，最后一条是最近离开的那只。 */
export interface Memorial {
  readonly version: number;
  readonly cats: readonly MemorialEntry[];
}
