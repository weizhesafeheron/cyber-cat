import type { ActionKey } from '../render/index.js';

/**
 * 入场与离场的时间线。
 *
 * 「猫从雨夜里走来并停下」是领养这一步的核心呈现（CONTEXT.md 的「领养」），
 * 所以它是一个纯函数：给一个局部时间，回答此刻猫在哪、朝哪、播什么动作。
 *
 * 与宠物窗口的运动层（app/motion.ts）分工一致 - **动作库只负责形体，位移永远在
 * 外面记**。这里不复用运动层是因为运动层的职责是「在整个桌面上漫游」：它带着
 * 舞台滚动、爪印、工作区钳制，而领养窗口只需要一段固定的直线。
 */

export interface WalkSpec {
  /** 起点与终点，画面内 CSS x（猫锚点 = 精灵横向中心）。 */
  readonly from: number;
  readonly to: number;
  /** 地面速度，CSS 像素每秒。由性格决定，见 motion.ts 的 walkSpeedFor。 */
  readonly speed: number;
  /**
   * 走到位之后站多久才坐下，秒。
   *
   * 不给就一直站着 - 离场的猫不该在半路坐下，而入场的猫需要「站着打量你一会」
   * 才读得出它在决定要不要留下来。
   */
  readonly settleS?: number;
}

export interface WalkFrame {
  /** 猫锚点此刻的 CSS x。 */
  readonly x: number;
  readonly dir: 1 | -1;
  readonly action: ActionKey;
  /** 入场是「停下了」，离场是「走出画面了」。 */
  readonly done: boolean;
}

/**
 * 这一刻走到哪儿了。`t` 是这一段的局部时间，秒。
 *
 * 抵达之后 x **精确等于** to，不冲过去再拉回来 - 那是一次肉眼可见的抽动
 * （与 motion.ts 里「最后一帧只走到目标为止」是同一条）。
 *
 * 速度非正（配置错、除零）时直接算抵达：失效方向是「少一段入场动画」，
 * 而不是「领养窗口里空荡荡没有猫」。
 */
export function walkFrame(t: number, spec: WalkSpec): WalkFrame {
  const { from, to, speed, settleS } = spec;
  const dir: 1 | -1 = to >= from ? 1 : -1;
  const distance = Math.abs(to - from);
  const usable = Number.isFinite(speed) && speed > 0;
  const arriveS = usable ? distance / speed : 0;
  const elapsed = Math.max(0, t);

  if (!usable || elapsed >= arriveS) {
    const rested = elapsed - arriveS;
    const sits = settleS !== undefined && rested >= settleS;
    return { x: to, dir, action: sits ? 'sit' : 'idle', done: true };
  }
  return { x: from + dir * speed * elapsed, dir, action: 'walk', done: false };
}
