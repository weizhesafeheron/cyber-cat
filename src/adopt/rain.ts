import { RAIN_ALPHA, RAIN_DROPS, RAIN_LEN, RAIN_SPEED, RAIN_WIND } from './constants.js';

/**
 * 雨。
 *
 * ADR 0004 废掉了虚拟场景，但**领养的雨夜是保留项**：世界观载体从背景画面转移到
 * 「猫本身与文案」之后，这一步的雨是仅剩的一处氛围（mvp-scope 第 1、7 节）。
 * 所以这里只有雨 - 没有房间，没有家具，不要把被否决的「赛博公寓一角」搬回来。
 *
 * 纯逻辑，注入随机源与 dt，因此可测。画到 canvas 上是 sky.ts 的事，
 * 与运动层（motion.ts）／爪印画布（paws.ts）的分法一致。
 */

/** 一滴雨。速度、长度、不透明度三项各自随机，纵深感就来自它们的组合。 */
export interface Drop {
  readonly x: number;
  readonly y: number;
  readonly len: number;
  readonly speed: number;
  readonly alpha: number;
}

export interface RainField {
  readonly drops: readonly Drop[];
}

/** 雨下在多大的一块地方，CSS 像素。 */
export interface RainBox {
  readonly w: number;
  readonly h: number;
}

const between = (range: readonly [number, number], rnd: () => number): number =>
  range[0] + (range[1] - range[0]) * rnd();

/** 造一滴雨。`fromTop` 为真时从画面上方进场，否则散在整块画面里（初始化用）。 */
function spawn(box: RainBox, rnd: () => number, fromTop: boolean): Drop {
  const len = between(RAIN_LEN, rnd);
  return {
    // 横向多给一个 len 的余量：斜雨从侧边进场，否则画面一侧会有一条无雨的空带
    x: rnd() * (box.w + len * 2) - len,
    y: fromTop ? -len - rnd() * box.h * 0.2 : rnd() * box.h,
    len,
    speed: between(RAIN_SPEED, rnd),
    alpha: between(RAIN_ALPHA, rnd),
  };
}

export function makeRain(box: RainBox, rnd: () => number): RainField {
  const drops: Drop[] = [];
  for (let i = 0; i < RAIN_DROPS; i++) drops.push(spawn(box, rnd, false));
  return { drops };
}

/**
 * 推进一帧。
 *
 * 落到画面下沿之外的雨滴**重新造一滴**送回顶上，不是简单地把 y 减掉画面高度：
 * 重造顺带换掉速度、长度与横向位置，雨才不会显出周期。
 * 不回收的话几秒之后画面上就没有雨了 - 那是个只有在真机上看几十秒才会发现的 bug。
 */
export function stepRain(field: RainField, dt: number, box: RainBox, rnd: () => number): RainField {
  const step = Math.max(0, dt);
  const drops = field.drops.map((d) => {
    const y = d.y + d.speed * step;
    if (y > box.h) return spawn(box, rnd, true);
    return { ...d, x: d.x + d.speed * step * RAIN_WIND, y };
  });
  return { drops };
}
