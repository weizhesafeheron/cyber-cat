import { SICK_TO_DEATH_HOURS } from '../world/index.js';
import type { World, WorldEvent } from '../world/index.js';
import { sendNotification } from './ipc.js';

/**
 * 系统通知。
 *
 * **只有生病这一级会发**（issue #13 的验收项）。饿了不发、挨饿不发、
 * 日常小事不发 - 一个每天提醒你喂猫的桌面宠物，气质就从陪伴变成了催促，
 * 而催促最终的结果是用户把通知关掉，连生病也收不到了。
 *
 * 死亡也不发通知：告别页本身就是一个居中弹出的窗口，比通知重得多，
 * 再加一条通知只是把同一件事说两遍。
 *
 * 判定做成纯函数、投递做成注入端口，是因为「什么时候发」全部的错误都长得一样 -
 * 该发的没发、不该发的发了，而两者在真机上都要等一只猫真的病一次才看得见。
 */

export interface SystemNotice {
  readonly title: string;
  readonly body: string;
}

/**
 * 这一步要不要发一条生病通知。
 *
 * 三个条件必须同时成立：
 *
 * 1. 这一步里**刚发生**了 fellSick。只看 `world.sick` 会让每一步都发一条，
 *    也会让「带着一只病猫启动」在开机时弹一条 - 那时用户就在屏幕前，
 *    托盘和猫本身都已经在说这件事了。
 * 2. 结算之后**还病着**。同一次 step 可能跨过好几天（离线补算是一次大跨步），
 *    病完又被喂药治好的情况下再通知只会让人回头去找一只已经好了的猫。
 * 3. **没死**。补算跨过整条死亡链时 fellSick 与 died 会出现在同一批事件里，
 *    此时该弹的是告别页，不是一条「快喂药」。
 */
export function sicknessNotice(
  events: readonly WorldEvent[],
  world: World,
): SystemNotice | null {
  if (!events.some((e) => e.kind === 'fellSick')) return null;
  if (!world.sick || world.dead) return null;

  const left = Math.max(0, Math.round(SICK_TO_DEATH_HOURS - world.sickHours));
  return {
    title: `${world.identity.name}生病了`,
    // 说清怎么办与还有多久，不用惊叹号也不用「快！」这类词 -
    // 通知的语气也是产品气质的一部分。
    body: `它趴在角落不太动。托盘菜单里可以喂药，还有大约 ${left} 小时。`,
  };
}

export interface NotifyPorts {
  /** 发一条系统通知。失败只该被记录，不该打断帧循环。 */
  readonly notify: (notice: SystemNotice) => Promise<void>;
}

/** 真机上的那套端口。 */
export const tauriNotifyPorts: NotifyPorts = {
  notify: (notice) => sendNotification(notice.title, notice.body),
};

/** 有该发的通知就发出去。没有则什么都不做。 */
export async function notifyIfSick(
  events: readonly WorldEvent[],
  world: World,
  ports: NotifyPorts,
): Promise<void> {
  const notice = sicknessNotice(events, world);
  if (notice === null) return;
  await ports.notify(notice);
}
