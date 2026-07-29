import type { AdoptedIdentity } from './identity.js';

/**
 * 交接：把选定的猫交回宠物窗口，然后关掉领养窗口。
 *
 * 抽成一个注入端口的函数而不是写在按钮回调里，是因为这里唯一的内容就是
 * **顺序与失败处理**，而两者错了都只表现为「领养完之后什么都没发生」。
 */
export interface HandoffPorts {
  /** 把身份交回宠物窗口。 */
  readonly announce: (identity: AdoptedIdentity) => Promise<void>;
  /** 关掉领养窗口。一次性流程，用完即关，不常驻（mvp-scope 第 7 节）。 */
  readonly close: () => Promise<void>;
}

/**
 * **先交回，再关窗。**
 *
 * 反过来的话窗口在事件送达之前就没了，宠物窗口会一直等一只永远不会来的猫。
 *
 * 交回失败时**不关窗口**并把错误抛出去：此刻宠物窗口还是隐藏的，关掉领养窗口
 * 用户就只剩一个空桌面，连重试的入口都没有。留着窗口至少还能再点一次。
 * 反过来，关窗口失败不算领养失败 - 身份已经送出去了，猫会照常出现，
 * 顶多多一个关不掉的小窗口。
 */
export async function handOff(identity: AdoptedIdentity, ports: HandoffPorts): Promise<void> {
  await ports.announce(identity);
  try {
    await ports.close();
  } catch (err) {
    console.error('[cyber-cat] 关闭领养窗口失败，猫已经领养成功：', err);
  }
}
