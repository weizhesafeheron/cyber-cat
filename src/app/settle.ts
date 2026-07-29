import { H, W } from '../render/index.js';

/**
 * 动作切换时的落位过渡。
 *
 * 要解决的现象：换动作那一帧猫会「闪动一下」。原因是两个姿态的形体高度差得多 -
 * 站姿的轮廓顶边在第 13 行，趴姿在第 23 行，睡姿在第 30 行。硬切的话猫的
 * 整个轮廓会在一帧之内上下跳十几个精灵像素，三倍缩放后是屏幕上三四十像素。
 * 以前动作半小时才换一次，这个跳变没人看得见；换成 15 秒的行为节拍之后，
 * 它变成了几十秒一次的可见抖动。
 *
 * 做法是**把新姿态先画在旧姿态的位置上，再在两百毫秒内滑到它真正的位置**。
 * 于是「坐下」读起来是坐下去的过程，而不是瞬间换了个贴图。
 *
 * 两个刻意的选择：
 *
 * 其一，偏移作用在**显示层的 transform**，不作用在姿态上。Pose.dy 只有站姿的
 * 绘制函数在用，坐姿与趴姿压根不读它（见 render/poses.ts 的 drawSit），
 * 拿它当通用的垂直偏移会只对一半动作生效。而且平移整张画布会把影子一起带走，
 * 猫不会在过渡期间悬在自己的影子上方。
 *
 * 其二，落差是**量出来的，不是查表来的**。掩膜每帧都有，重心是现成的一次
 * 累加；写死一张「动作 → 高度」的表则要跟着动作库一起维护，而且它对同一个
 * 动作内部的形变（伸懒腰前后差六个像素）无能为力。
 */

/** 过渡时长。再长就成了慢动作，再短就仍然像跳帧。 */
export const SETTLE_MS = 220;

/**
 * 落差上限，精灵像素。
 *
 * 兜底而非调优项：万一某一帧的掩膜异常（比如动作把猫画到了缓冲之外），
 * 量出来的重心会离谱，没有上限就会把猫甩出画面。
 */
export const SETTLE_MAX_PX = 18;

export interface Settle {
  /** 切换瞬间的垂直落差，精灵像素。正值表示新姿态要从上方滑下来。 */
  from: number;
  /** 过渡开始时刻，performance.now 时间轴。 */
  startedAt: number;
}

export const NO_SETTLE: Settle = { from: 0, startedAt: 0 };

/**
 * 掩膜的垂直重心，精灵像素。空掩膜返回 null。
 *
 * 用重心而不是轮廓顶边：顶边由最靠上的那一个像素决定，耳朵抖一下就跳，
 * 而重心是整只猫的平均位置，对局部形变稳定得多。
 */
export function centroidY(mask: Uint8Array): number | null {
  let sum = 0;
  let n = 0;
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      if (mask[row + x] === 255) {
        sum += y;
        n++;
      }
    }
  }
  return n === 0 ? null : sum / n;
}

/**
 * 开始一次落位过渡。
 *
 * `prevY` 是上一帧猫在屏幕上的重心（含当时未走完的偏移），`nextY` 是新姿态
 * 自己的重心。两者都为 null 时（首帧、猫已离开）不过渡。
 */
export function beginSettle(prevY: number | null, nextY: number | null, now: number): Settle {
  if (prevY === null || nextY === null) return NO_SETTLE;
  const raw = prevY - nextY;
  const from = Math.max(-SETTLE_MAX_PX, Math.min(SETTLE_MAX_PX, raw));
  return { from, startedAt: now };
}

/**
 * 此刻还需要补多少偏移，精灵像素。过渡结束后恒为 0。
 *
 * 用 smoothstep 而不是线性：两端慢、中间快，读起来是猫自己在改变姿势，
 * 线性的话起步和落地都是硬的，仍然有「咔」的一下。
 */
export function settleOffset(settle: Settle, now: number): number {
  if (settle.from === 0) return 0;
  const k = (now - settle.startedAt) / SETTLE_MS;
  if (k >= 1) return 0;
  if (k <= 0) return settle.from;
  const eased = k * k * (3 - 2 * k);
  return settle.from * (1 - eased);
}
