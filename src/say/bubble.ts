import { EAT_CYCLE, H as SPRITE_H } from '../render/index.js';
import type { ActionKey } from '../render/index.js';
import { saySprite } from './art.js';
import type { SaySprite } from './art.js';

/**
 * 台词气泡的时机与位置。纯逻辑，不读时钟、不碰 DOM。
 *
 * 「吃饭时头顶随着低头弹出 yummy」是产品负责人的要求。要点在于**与低头对齐** -
 * 时相不能在这里另抄一份，所以直接用渲染层导出的 EAT_CYCLE（见那里的注释）。
 *
 * 与回归气泡（src/diary/）的分工：那个是可点的入口、有寿命、由「离开够久」触发；
 * 这个是纯装饰，跟着动作的时相走，**永远不进命中掩膜**。
 * 两者位置重合，所以同一时刻只画一个 - 优先让位给可点的那个（见 sayVisible）。
 */

/** 猫吃饭时说的那句。 */
export const EAT_LINE = 'yummy...';

/** 贴图只跟台词有关，算一次就够。 */
export const EAT_SAY_SPRITE: SaySprite = saySprite(EAT_LINE);

/**
 * 气泡下沿（尾巴尖）落在精灵缓冲的第几行。
 *
 * 与回归气泡取同一个值，理由也一样：把七个品种全部动作逐帧渲染过，猫本体最靠上的
 * 像素在第 7 行，取 5 留两行空隙，于是**任何姿态下都不会压到猫**。
 * 这个值在两处各写一遍是有意的 - 它们是两块独立的美术，将来一个改了另一个未必要跟。
 */
export const SAY_BASE_SPRITE_Y = 5;

/**
 * 尾巴尖相对头中心再往前挪多少精灵像素。
 *
 * 不是「气泡该在哪」- 那个由传进来的 headX 决定。这里只是让尖略微偏向鼻子那一侧，
 * 读起来更像话从嘴里出来的。
 *
 * **不要用一个固定偏移量代替 headX。** 头的列位取决于品种的体宽（德文瘦、美短最宽），
 * 第一版拍了 13，在德文身上偏 3.5 个精灵像素 - 那是屏幕上十来个像素，
 * 而这种偏差只有盯着看才发现。测试直接按渲染层的 headColumn 比对。
 */
const SAY_TIP_AHEAD_SPRITE = 1;

/** 一个精灵坐标系里的矩形。y 可以是负数 - 气泡在缓冲之上。 */
export interface SpriteRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/**
 * 这一帧要不要画台词气泡。
 *
 * `animT` 是当前动作的局部时间（秒），与渲染动作用的是同一个值 - 传别的会让气泡
 * 与低头错开。`diaryBubbleShowing` 为真时让位：两个气泡位置重合，而那个是可点的入口。
 */
export function sayVisible(
  action: ActionKey | null,
  animT: number,
  diaryBubbleShowing: boolean,
): boolean {
  if (diaryBubbleShowing) return false;
  if (action !== 'eat') return false;
  const k = (animT % EAT_CYCLE.seconds) / EAT_CYCLE.seconds;
  // 只在头真的埋下去的那一段里显示。抬头嚼的那一秒不显示，于是它是「隔几秒冒一次」
  // 而不是一直挂着 - 一直挂着就成了状态栏，不是台词。
  return k >= EAT_CYCLE.downFrom && k < EAT_CYCLE.downTo;
}

/**
 * 气泡在精灵坐标里的矩形。
 *
 * 用精灵坐标表达是「跟着猫走」的结构保证：猫的画布靠 transform 在舞台里移动，
 * 气泡按同一个原点换算，两者不可能脱节，没有任何逐帧跟随的代码
 * （与回归气泡同一条思路，见 ADR 0011）。
 *
 * `dir` 是猫的朝向（1 朝右）。`bob` 是上下浮动的整数偏移。
 */
export function saySpriteRect(
  sprite: SaySprite,
  headX: number,
  dir: 1 | -1,
  bob: number,
): SpriteRect {
  // 尾巴尖对齐到头那一列，略偏向鼻子一侧。
  //
  // **不钳在精灵缓冲的宽度里。** 气泡画布铺满整个舞台（648 CSS 像素），
  // 不是只有猫那 72 个精灵像素，所以稍微伸出精灵的左右边不会被裁。
  // 第一版钳了，代价是气泡永远对不准头 - 那个钳制的前提本身是错的。
  const tip = headX + dir * SAY_TIP_AHEAD_SPRITE;
  const x0 = Math.round(tip - sprite.tipX);
  const y1 = SAY_BASE_SPRITE_Y + bob;
  return { x0, y0: y1 - sprite.height, x1: x0 + sprite.width, y1 };
}

/**
 * 上下浮动的整数偏移，精灵像素。
 *
 * 取整到 0 或 1：非整数偏移会让整块贴图在物理像素上重采样，像素风当场破功
 * （与 display.ts 的取整是同一条约束）。
 */
export function sayBob(seconds: number): number {
  return Math.sin(seconds * 2.4) > 0 ? 1 : 0;
}

/** 舞台客户区里的 CSS 矩形。 */
export interface StageRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * 精灵坐标 → 舞台客户区 CSS 坐标。
 *
 * `originCss` 是猫的画布在舞台里的左边界（display.originCss，已对齐到整数物理像素），
 * 所以这一步不会引入新的半像素。
 */
export function sayStageRect(
  rect: SpriteRect,
  originCss: number,
  spriteScale: number,
  stageH: number,
): StageRect {
  return {
    x: originCss + rect.x0 * spriteScale,
    y: stageH - (SPRITE_H - rect.y0) * spriteScale,
    w: (rect.x1 - rect.x0) * spriteScale,
    h: (rect.y1 - rect.y0) * spriteScale,
  };
}
