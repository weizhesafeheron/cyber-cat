import { MS_PER_DAY } from '../world/index.js';
import type { CatIdentity, World } from '../world/index.js';
import { MEMORIAL_MAX_CATS, MEMORIAL_SAVE_VERSION } from './constants.js';
import type { Memorial, MemorialEntry } from './types.js';

/**
 * 档案的读写逻辑。**纯函数**，不碰文件也不读时钟。
 *
 * 落盘在 app/farewell.ts（注入端口），文本编解码在 ./save.ts。
 * 分开的理由与 props 那一套相同：入档这件事真正容易出错的地方是
 * 「什么时候该入」「同一只会不会入两次」，那些只有做成纯函数才测得动。
 */

export function emptyMemorial(): Memorial {
  return { version: MEMORIAL_SAVE_VERSION, cats: [] };
}

/**
 * 两条记录是不是同一只猫。
 *
 * 比 Seed **加上出生时间**，不只比 Seed：Seed 空间是 2^31，撞车概率低但不是零，
 * 而且用户完全可能在领养时反复「再等等」直到又遇到一只同 Seed 的猫。
 * 名字不参与比较 - 它是身份的一部分，但重名不代表同一只。
 */
export function sameCat(a: CatIdentity, b: CatIdentity): boolean {
  return a.seed === b.seed && a.bornAt === b.bornAt;
}

/**
 * 从世界里取出一条档案记录。**活着的猫返回 null。**
 *
 * `diedAt` 为 null 也返回 null：那说明存档被改坏了（dead 与 diedAt 本该同时写），
 * 硬造一个死亡时刻会让告别页上的生卒年月是编出来的。
 */
export function entryOf(world: World): MemorialEntry | null {
  if (!world.dead || world.diedAt == null) return null;
  return {
    identity: { ...world.identity },
    diedAt: world.diedAt,
    stats: { ...world.stats },
    // 拷一份：world.diary 是可变数组，档案要的是死亡那一刻的快照。
    diary: world.diary.slice(),
  };
}

/**
 * 把一只已经离开的猫放进档案。已经在里面的不再放第二次。
 *
 * **幂等是必需的，不是保险。** 入档发生在宠物窗口发现猫死了的时候，而「猫死了」
 * 这个状态会在每次启动时重新被发现 - 不去重的话档案里会攒出一串同一只猫。
 */
export function enshrine(archive: Memorial, world: World): Memorial {
  const entry = entryOf(world);
  if (entry === null) return archive;
  if (archive.cats.some((c) => sameCat(c.identity, entry.identity))) return archive;

  const cats = [...archive.cats, entry];
  return {
    version: MEMORIAL_SAVE_VERSION,
    cats: cats.length > MEMORIAL_MAX_CATS ? cats.slice(cats.length - MEMORIAL_MAX_CATS) : cats,
  };
}

/** 最近离开的那只。告别页默认展示它。 */
export function latestEntry(archive: Memorial): MemorialEntry | null {
  return archive.cats.length === 0 ? null : archive.cats[archive.cats.length - 1]!;
}

/**
 * 陪伴天数。与 world/clock.ts 的 companionDays 是同一条算式，
 * 只是数据来自档案而不是活着的世界（那时 world 已经被新猫覆盖了）。
 */
export function lifespanDays(entry: MemorialEntry): number {
  return Math.max(1, Math.round((entry.diedAt - entry.identity.bornAt) / MS_PER_DAY));
}
