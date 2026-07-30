import type { WorldActionKey } from '../render/index.js';

/**
 * 这一刻猫被允许做什么。
 *
 * 两个「全局兜底」在这里合成一张真值表（issue #15）：
 *
 * - **安静模式**：用户拨的开关。猫还在桌面上，但只趴着休息 - 不响应光标、
 *   不爬前台窗口、不主动走动。跨重启保持（settings.json）。
 * - **让开规则**：检测到全屏应用或投屏演示。猫**整只藏起来**，退出该状态后恢复。
 *   临时的，不持久化 - 它描述的是此刻的桌面，不是用户的偏好。
 *
 * **为什么不塞进世界层**：世界层是纯函数、可离线回放（ADR 0001），
 * 而这两件事都不是时间的函数 - 一个是用户某一刻拨的开关，一个是此刻别的应用在做什么。
 * 塞进去会让「同一段时间推演出同一个结果」当场失效，而那条不变量是离线追平的全部依据。
 *
 * 代价是**猫的状态在安静模式与让开期间继续照常推演**：它照样会饿、会困、会生病。
 * 这恰恰是票上要的（「隐藏与恢复期间猫的状态继续正常推演，不丢失」）- 桌面上看不见它
 * 不等于它不在过日子。藏起来时 rAF 不触发，回来那一帧靠离线追平补齐（ADR 0001）。
 */

export interface Restraint {
  /** 整只藏起来。让开规则唯一的表现。 */
  readonly hidden: boolean;
  /** 允许响应光标（逗猫棒的第七道闸门，与 tease/gates.ts 的六道求与）。 */
  readonly tease: boolean;
  /** 允许爬到前台窗口上（与 perch.ts 的 perchAllowed 求与）。 */
  readonly perch: boolean;
  /** 允许按世界层给的动作走动、换姿态。false 时一律趴着。 */
  readonly roam: boolean;
}

/**
 * 安静模式下猫做什么：**趴着**。
 *
 * 不用 `sleep`：那是「猫睡着了」的读数，而安静模式下猫是醒着的，只是被要求别闹。
 * 让它睡着会让托盘图标、日记与状态摘要一起撒谎。
 * 也不用 `idle`（站着呼吸）：站着的猫随时会走，趴着才读得出「它知道你在忙」。
 */
export const QUIET_ACTION: WorldActionKey = 'lie';

/**
 * 合成这一刻的许可。
 *
 * **让开优先于安静**：两者同时成立时猫是藏起来的，那时另外三项已经没有意义
 * （藏起来的猫不可能扑光标），但仍然把它们置为 false - 让「藏着的时候不做任何主动行为」
 * 是这张表本身保证的，而不是靠调用方记得先查 hidden。
 *
 * `errand` = 世界层这一刻给了挂件锚点（要去吃饭、要回窝睡）。
 * **安静模式压住的是玩与闲逛，不压住吃饭**：
 * 世界层的进食本来就不要求猫真的走到碗边（那一步只是呈现），所以拦住走位并不会让猫饿死，
 * 但会让画面变成「猫趴在屏幕另一头对着空气咀嚼」。让它走过去更诚实，
 * 而「去吃饭」也确实不是闲逛 - 这与「饿了会盖过作息」（HUNGER_WAKES_THRESHOLD）
 * 是同一族的取舍：需求可以盖过节奏。
 */
export function restraint(quiet: boolean, presenting: boolean, errand: boolean): Restraint {
  if (presenting) {
    return { hidden: true, tease: false, perch: false, roam: false };
  }
  if (quiet) {
    return { hidden: false, tease: false, perch: false, roam: errand };
  }
  return { hidden: false, tease: true, perch: true, roam: true };
}

/**
 * 按许可改写世界层给的动作。
 *
 * 只在**不允许走动**时接管，而且只改姿态、不改任何世界状态 - 世界层照常推演，
 * 它只是这一刻不被播出来。安静模式退出之后猫接着做它本来在做的事。
 */
export function restrainedAction(
  action: WorldActionKey | null,
  allowRoam: boolean,
): WorldActionKey | null {
  if (allowRoam) return action;
  return QUIET_ACTION;
}
