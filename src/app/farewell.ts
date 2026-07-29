import { withChrome } from '../chrome/constants.js';
import { FAREWELL_H, FAREWELL_W } from '../farewell/constants.js';
import { emptyMemorial, enshrine, sameCat } from '../memorial/index.js';
import type { Memorial } from '../memorial/index.js';
import type { CatIdentity, World } from '../world/index.js';
import { openFarewell } from './ipc.js';
import { loadMemorial, saveMemorial } from './persist.js';

/**
 * 宠物窗口这一侧的「猫死了之后怎么办」。
 *
 * 职责边界：这个文件是平台胶水 - 决定**什么时候**入档、什么时候开告别页，
 * 入档本身的逻辑全在 src/memorial/archive.ts（纯函数、有测试）。
 *
 * 端口注入而不是直接 import，与 app/props.ts 的 PropsPorts 同一条理由：
 * 这里的全部内容就是时序与幂等，而它们出错的样子只有两种 -
 * 「档案里攒出一串同一只猫」和「告别页没弹出来」，两者都要等一只猫真的死一次
 * 才在真机上看得见。本 session 已经因为「直接 import 平台模块」漏过一个
 * 猫窝永远不显示的 bug。
 */

export interface FarewellPorts {
  /**
   * 读档案。null = 还没有档案（第一只猫）。
   *
   * **读坏了必须抛，不能返回 null。** 返回 null 会让下面这段把一份新档案写上去，
   * 也就是把用户养过的所有猫一次抹掉 - 而这是全局唯一不可再生的数据。
   */
  readonly loadMemorial: () => Promise<Memorial | null>;
  readonly saveMemorial: (archive: Memorial) => Promise<void>;
  /** 打开告别页窗口。按需建窗、用完即关（mvp-scope 第 7 节）。 */
  readonly openFarewell: () => Promise<void>;
}

/** 真机上的那套端口。 */
export const tauriFarewellPorts: FarewellPorts = {
  loadMemorial,
  saveMemorial,
  openFarewell: () => openFarewell(FAREWELL_W, withChrome(FAREWELL_H)),
};

/** 一只猫的身份键。用来记住「这一只的告别页已经处理过了」。 */
function keyOf(identity: CatIdentity): string {
  return `${identity.seed}:${identity.bornAt}`;
}

export class FarewellHost {
  /**
   * 已经处理过告别的那只猫。
   *
   * 按身份记而不是一个布尔值：领养新猫之后这只猫也可能会死，那时要再走一遍。
   * 布尔值需要在领养成功时记得清掉，而「记得清掉」是个迟早会忘的约定。
   */
  private handled: string | null = null;

  constructor(private readonly ports: FarewellPorts) {}

  /**
   * 每帧都可以调。**只有「刚发现这只猫死了」时才真的做事。**
   *
   * 返回是否真的处理了这一次死亡，供调用方决定要不要顺手做别的（例如存一次盘）。
   *
   * 「刚发现」而不是「刚死亡」是有意的：猫也可能是在离线期间死的，甚至是
   * 上一次运行时就死了（用户直接关掉了告别页）。三种情况在这里都是同一条路 -
   * 猫死了而告别页还没给这只猫开过，就开一次。
   */
  async observe(world: World): Promise<boolean> {
    if (!world.dead || world.diedAt == null) return false;
    const key = keyOf(world.identity);
    if (this.handled === key) return false;
    this.handled = key;

    await this.archive(world);
    // 入档失败也要开告别页：档案是资料，告别页是这只猫留给用户的最后一面，
    // 而且它同时是「领养新猫」的唯一入口 - 不开的话用户就困在一个空桌面上。
    await this.ports.openFarewell().catch((err: unknown) => {
      console.error('[cyber-cat] 打开告别页失败：', err);
    });
    return true;
  }

  /**
   * 再打开一次告别页。托盘里那个入口走这条。
   *
   * 需要这个入口的理由很实际：告别页是个能关掉的窗口，而关掉之后
   * 「无惩罚地领养新猫」就没有别的入口了。
   */
  async reopen(): Promise<void> {
    await this.ports.openFarewell();
  }

  /** 领养了新猫：让下一次死亡重新走一遍。 */
  reset(): void {
    this.handled = null;
  }

  /**
   * 把这只猫放进档案。
   *
   * 三件事分别兜住：
   * - **读坏了不写。** 保留那份坏文件，用户还有机会自己看一眼；覆盖掉就没了。
   * - **已经在档案里就不写。** 每次启动都会重新发现「猫死了」，不去重的话
   *   档案里会攒出一串同一只猫（enshrine 自己也去重，这里只是省掉一次写盘）。
   * - **写失败只记录。** 告别页仍然要开。
   */
  private async archive(world: World): Promise<void> {
    let current: Memorial;
    try {
      current = (await this.ports.loadMemorial()) ?? emptyMemorial();
    } catch (err) {
      console.error('[cyber-cat] 读猫的档案失败，本次不写入以免覆盖历任猫：', err);
      return;
    }

    if (current.cats.some((c) => sameCat(c.identity, world.identity))) return;
    const next = enshrine(current, world);
    await this.ports.saveMemorial(next).catch((err: unknown) => {
      console.error('[cyber-cat] 写猫的档案失败：', err);
    });
  }
}
