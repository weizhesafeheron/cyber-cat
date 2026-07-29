import { DIARY_BUBBLE_AWAY_HOURS, MS_PER_HOUR } from '../world/index.js';
import type { WorldEvent } from '../world/index.js';
import {
  BUBBLE_BASE_SPRITE_Y,
  BUBBLE_BOB_PERIOD_S,
  BUBBLE_BOB_SPRITE,
  BUBBLE_H_SPRITE,
  BUBBLE_LIFE_MS,
  BUBBLE_W_SPRITE,
  BUBBLE_X0_SPRITE,
  SPRITE_H,
} from './constants.js';

/**
 * 回归气泡的判定与几何。纯函数，没有 DOM、没有时钟。
 *
 * 产品要求（CONTEXT.md 的「猫咪日记」+ ADR 0004）：离开超过阈值后重新启动，
 * 猫头顶冒一个**可点的**小气泡，点开才展开日记。**不弹窗、不拦用户。**
 *
 * 两条实现约束：
 * - **「离开了多久」不在这一层算，也不在渲染层读 Date.now()。** 它由启动时的
 *   离线补算给出（main.ts 的 catchUp 本来就知道补了多少毫秒），所以这里只收一个
 *   数。读时钟的版本没法测，而且会在「补算跨过阈值但气泡该不该出现」这个边界上
 *   与世界层的时间口径分岔。
 * - **气泡的位置用精灵像素表达，相对精灵左上角。** 猫在舞台里来回走，猫的画布
 *   靠 transform 偏移（display.place），所以「相对精灵」这个坐标系里的固定矩形
 *   就是「跟着猫头顶走」- 不需要任何逐帧跟随的代码，也就不会与猫脱节。
 */

/**
 * 一个矩形命中区，精灵像素坐标，`x0/y0` 含、`x1/y1` 不含。
 *
 * **y 可以是负的**：气泡在猫头顶，也就是在 72×56 那个缓冲**之上**。
 * 与 app/hit.ts 的 `HitRect` 同形，但两边刻意不互相 import - 命中层不该认识气泡，
 * 气泡也不该依赖命中层的类型。结构类型让它们在调用点自然对上。
 */
export interface SpriteRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** 回来时该不该冒气泡的输入。全部由平台层的补算结果给出。 */
export interface OfferInput {
  /** 这次启动补算了多少毫秒。 */
  readonly awayMs: number;
  /** 补算之前世界的「现在」。用来筛出离开期间产生的日记。 */
  readonly since: number;
  /** 补算之后的日记。 */
  readonly diary: readonly WorldEvent[];
  /** 猫是否已经离开。 */
  readonly dead: boolean;
}

/**
 * 回来时该不该冒气泡。
 *
 * 三个条件都要成立：
 * 1. 离开超过阈值。短暂关掉再打开不该有提示 - 那几分钟里日记大概只多了一条。
 * 2. 离开期间**真的产生了**日记。补算了六小时但一条没记（比如猫整夜在睡且抽签
 *    都没中）时冒气泡，用户点开会看到一片旧内容，那比不提示更糟。
 * 3. 猫还在。死掉的猫由告别页承接（ticket 13），那一页本身就要翻日记，
 *    再在桌面上冒一个气泡是两个入口抢同一件事。
 */
export function shouldOfferDiary(input: OfferInput): boolean {
  if (input.dead) return false;
  if (input.awayMs < DIARY_BUBBLE_AWAY_HOURS * MS_PER_HOUR) return false;
  return input.diary.some((e) => e.at > input.since);
}

/**
 * 气泡此刻还在不在。
 *
 * `armedAtMs` 是它冒出来的时刻（帧时钟，`performance.now`），null = 没冒过或已经点掉。
 * 时刻由调用方注入，所以这一层仍然不读时钟，也仍然可测。
 *
 * 用帧时钟而不是墙上时钟是有意的：这是一个 UI 元素的寿命，和爪印
 * （motion.ts 的 PAW_LIFE_MS）、点猫的即时反馈（main.ts 的 reactionUntilMs）同一族。
 * 墙上时钟被系统改动时那三样都不该跟着跳。
 */
export function bubbleAlive(armedAtMs: number | null, nowMs: number): boolean {
  if (armedAtMs === null) return false;
  return nowMs - armedAtMs < BUBBLE_LIFE_MS;
}

/**
 * 气泡当前的上下浮动偏移，精灵像素。
 *
 * 取整到 0 或 1：非整数偏移会让整块气泡在物理像素上重采样，像素风当场破功
 * （与 display.ts 的取整是同一条约束）。所以这不是正弦缓动而是两格之间的方波，
 * 在 72×56 这个尺度上两者看起来一样。
 */
export function bubbleBob(tSeconds: number): number {
  if (!Number.isFinite(tSeconds)) return 0;
  const phase = ((tSeconds / BUBBLE_BOB_PERIOD_S) % 1 + 1) % 1;
  return phase < 0.5 ? 0 : BUBBLE_BOB_SPRITE;
}

/**
 * 气泡此刻占的矩形，精灵像素坐标。
 *
 * **画和判定用的是同一个矩形**，这是刻意的：分成两份（画一个、判一个）迟早会
 * 差一像素，而症状是「看起来点在气泡上但没反应」，在真机之外看不出来。
 */
export function bubbleSpriteRect(bob = 0): SpriteRect {
  const y1 = BUBBLE_BASE_SPRITE_Y - bob;
  return {
    x0: BUBBLE_X0_SPRITE,
    y0: y1 - BUBBLE_H_SPRITE,
    x1: BUBBLE_X0_SPRITE + BUBBLE_W_SPRITE,
    y1,
  };
}

/** 点是否落在矩形内。坐标是精灵像素，与 render 的 hitTest 同一个坐标系。 */
export function hitsRect(rect: SpriteRect, x: number, y: number): boolean {
  return x >= rect.x0 && x < rect.x1 && y >= rect.y0 && y < rect.y1;
}

/** 舞台内的一个矩形，CSS 像素，用于画气泡。 */
export interface StageRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * 精灵坐标的矩形换算成舞台内的 CSS 矩形。
 *
 * 两个已知量把这次换算钉死了：猫的画布贴着舞台下沿（index.html 的 `bottom: 0`），
 * 且它在舞台里的横向偏移是 `originCss`（display.place 写进 transform 的那个值，
 * 已经对齐到整数物理像素）。所以精灵 y = SPRITE_H 就是舞台下沿。
 *
 * **横向偏移必须取自 display，不能在这里按运动层的 x 重算一遍** - 那等于把定位
 * 规则抄第二份，两份一旦不同步（比如整像素对齐）气泡就会与猫错开，而且只在真机上
 * 看得出来。这条与 main.ts 里 toSprite 的注释是同一条理由。
 */
export function bubbleStageRect(
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
