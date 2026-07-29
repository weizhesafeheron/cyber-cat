/**
 * 告别页与宠物窗口之间的交接。
 *
 * 只有一个方向、一件事：**用户说要再养一只。**
 * 载荷是空的 - 挑哪只猫是领养窗口的事，这里只是把「开始领养」这个意图递过去。
 *
 * 为什么不由告别页自己走领养流程：**世界状态只有宠物窗口持有**
 * （与挂件窗口同一条不变量，见 app/props.ts）。告别页是一个只读的视图，
 * 它读档案文件、显示、然后报一声。多一条改世界的路，离线推演的等价性
 * 就没法再保证了（ADR 0001）。
 */

/** 「再养一只」事件。带前缀避免与将来的事件名撞车，与 ADOPTED_EVENT 同一格式。 */
export const ADOPT_ANOTHER_EVENT = 'cyber-cat://adopt-another';

export interface FarewellHandoffPorts {
  /** 告诉宠物窗口开始领养。 */
  readonly announce: () => Promise<void>;
  /** 关掉告别页。一次性流程，用完即关（mvp-scope 第 7 节）。 */
  readonly close: () => Promise<void>;
}

/**
 * **先报一声，再关窗。** 与 adopt/handoff.ts 是同一条经验：
 * 反过来的话窗口在事件送达之前就没了，宠物窗口收不到，用户点了按钮什么都不会发生。
 *
 * 报不出去时**不关窗口**并抛出去：告别页是「领养新猫」唯一的入口，
 * 关掉之后用户只能去托盘里重新找一遍。留着窗口至少还能再点一次。
 * 反过来，关窗失败不算失败 - 领养窗口马上就会盖在它上面，顶多多一个窗口。
 */
export async function requestAnotherCat(ports: FarewellHandoffPorts): Promise<void> {
  await ports.announce();
  try {
    await ports.close();
  } catch (err) {
    console.error('[cyber-cat] 关闭告别页失败，领养流程已经开始：', err);
  }
}
