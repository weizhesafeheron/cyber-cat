import { W as CAT_W } from '../render/index.js';
import { clamp } from '../render/rng.js';
import {
  PROP_DEFAULT_VISIBLE,
  PROP_EDGE_MARGIN_PX,
  PROP_GAP_PX,
  PROP_RIGHT_TO_LEFT,
  PROP_REACH_SPRITE,
  PROP_SPRITE,
  propWindowSize,
} from './constants.js';
import { PROP_KINDS } from './types.js';
import type { PropKind, PropPlacement, PropsState, ScreenRect } from './types.js';

/**
 * 挂件的摆放几何。
 *
 * 纯函数，只做屏幕坐标的算术，不碰窗口也不碰存档 - 因此「猫该站到食盆哪一侧」
 * 这类手感判断可以直接测（test/props/layout.test.ts），不需要真机。
 *
 * 坐标一律是**屏幕逻辑坐标**（CSS 像素，桌面左上角为原点），与运动层同一个坐标系。
 * 挂件的 `x` / `y` 指窗口客户区左上角，不是贴图中心 - 窗口位置是我们唯一能
 * 直接下发给系统的量，以它为准就不会出现「两份位置真相」。
 */

/**
 * 挂件贴图中心的屏幕 x。
 *
 * 用**标称窗口宽度**算，不用画布的实际宽度：分数 dpi 下画布会被整数缩放规则钳
 * 小一档（见 propDeviceScale），但画布在窗口里是居中的，中心不动。
 * 反过来若按实际画布宽算，同一个挂件在 100% 与 150% 缩放的屏幕上会给出不同的
 * 中心，猫的落点就会跟着抖。
 */
export function propCenterX(kind: PropKind, placement: PropPlacement): number {
  return placement.x + propWindowSize(kind).w / 2;
}

/**
 * 让挂件的**最后一个精灵行**落在猫脚下的地面线上时，窗口客户区的 y。
 *
 * 挂件与猫是两个窗口，各自贴着自己的位置，所以「站在同一条地上」这件事必须靠
 * 算术对齐 - 差几个像素就会读成挂件浮空或者陷进地里。
 * `groundY` 取运动层的 `groundScreenY(geom)`，`spriteScale` 取同一份几何，
 * 两个窗口在同一块屏幕上会拿到同一个整数缩放，因此对得上。
 */
export function groundedY(kind: PropKind, groundY: number, spriteScale: number): number {
  return groundY + spriteScale - PROP_SPRITE[kind].h * spriteScale;
}

/**
 * 首次启动时的摆放：全部踩在地面线上，并排贴住工作区右边缘。
 *
 * 横向位置由 PROP_RIGHT_TO_LEFT 的顺序累加算出来，**不是每件独立算一个比例** -
 * 独立算的话两件家具的间隔会随屏幕宽度变化，窄屏上会叠在一起。
 * 这里的间隔是固定像素，屏幕再窄也只是一起往左挤，最后由 clampPlacement 收住。
 *
 * **贴边不能贴到猫站不进去的地方。** 猫的锚点是它精灵的横向中心，而精灵不能出屏，
 * 所以它能站到的最右位置离工作区右沿有半个身子。真按 PROP_EDGE_MARGIN_PX 贴死，
 * 猫窝的中心会落在那条线之外 - 猫要睡在垫子正中间，结果是歪 30 像素躺在垫子边上。
 * 所以整组算完之后再统一往左让出这段身位（整组一起挪，间隔与贴边的相对关系不变）。
 */
export function defaultPropsState(
  work: ScreenRect,
  groundY: number,
  spriteScale: number,
): PropsState {
  const xs: Partial<Record<PropKind, number>> = {};
  let right = work.x + work.w - PROP_EDGE_MARGIN_PX;
  for (const kind of PROP_RIGHT_TO_LEFT) {
    const w = propWindowSize(kind).w;
    xs[kind] = right - w;
    right -= w + PROP_GAP_PX;
  }

  // 超出「猫走得到」那一段的部分整组左移，间隔与贴边的相对关系不变。
  let overflow = 0;
  for (const kind of PROP_KINDS) {
    const x = xs[kind];
    if (x === undefined) throw new Error(`PROP_RIGHT_TO_LEFT 漏了 ${kind}`);
    overflow = Math.max(overflow, x - propBounds(kind, work, spriteScale).max);
  }

  const out: Partial<Record<PropKind, PropPlacement>> = {};
  for (const kind of PROP_KINDS) {
    const b = propBounds(kind, work, spriteScale);
    out[kind] = clampPlacement(
      kind,
      {
        x: clamp(Math.round(xs[kind]! - overflow), b.min, b.max),
        y: Math.round(groundedY(kind, groundY, spriteScale)),
        visible: PROP_DEFAULT_VISIBLE,
      },
      work,
    );
  }
  return out as PropsState;
}

/**
 * 把挂件整个钳进工作区。
 *
 * **只在启动摆放与读档时用，不在用户拖动之后用。** 用户把食盆拖到哪儿是他的
 * 决定（ADR 0004 的「布置领地」），当场纠回去只会让人觉得窗口在跟自己抢。
 * 读档时必须钳：上次是在 4K 外接屏上摆的，这次只有笔记本屏，不钳的话挂件在
 * 屏幕外，用户既看不见也拖不回来。
 */
export function clampPlacement(
  kind: PropKind,
  placement: PropPlacement,
  work: ScreenRect,
): PropPlacement {
  const size = propWindowSize(kind);
  return {
    x: clamp(placement.x, work.x, work.x + Math.max(0, work.w - size.w)),
    y: clamp(placement.y, work.y, work.y + Math.max(0, work.h - size.h)),
    visible: placement.visible,
  };
}

export function clampPropsState(state: PropsState, work: ScreenRect): PropsState {
  return {
    bowl: clampPlacement('bowl', state.bowl, work),
    bed: clampPlacement('bed', state.bed, work),
  };
}

/**
 * 猫要走到哪个屏幕 x 才算「在这个挂件跟前」。
 *
 * 食盆在猫的**近侧**停下（`PROP_REACH_SPRITE`），于是猫低头的方向正好朝着盆口 -
 * 走过去的那一侧决定朝向，朝向决定低头的方向，三者自然一致。
 * 猫窝的 reach 是 0，猫直接站到垫子中间。
 *
 * `limits` 是猫横向可达的屏幕 x 区间。近侧落点越界时改从另一侧靠近 -
 * 食盆贴着屏幕右边缘时，猫只能从左边过去。两侧都越界就钳住，剩下的由运动层的
 * 「走不动了就算到了」兜住，不会让猫永远走不到而一直播走路。
 */
export function approachX(
  kind: PropKind,
  placement: PropPlacement,
  catX: number,
  limits: { readonly min: number; readonly max: number },
  spriteScale: number,
): number {
  const center = propCenterX(kind, placement);
  const reach = PROP_REACH_SPRITE[kind] * spriteScale;
  if (reach === 0) return clamp(center, limits.min, limits.max);
  const side = catX >= center ? 1 : -1;
  const near = center + side * reach;
  if (near >= limits.min && near <= limits.max) return near;
  const far = center - side * reach;
  if (far >= limits.min && far <= limits.max) return far;
  return clamp(near, limits.min, limits.max);
}

/**
 * 世界层说猫想去某个挂件时，运动层该把它送到的屏幕 x。
 *
 * 挂件隐藏时返回 null - 没有这个空间锚点，猫就照旧自己漫游。
 * **失效方向是「猫不去了」而不是「猫走到一个不存在的位置」**：用户把食盆藏起来
 * 之后，猫在原地吃饭并不奇怪（画面上根本没有盆），而走去屏幕上某个空位置吃饭
 * 就成了灵异现象。
 */
export function anchorScreenX(
  kind: PropKind,
  state: PropsState,
  catX: number,
  limits: { readonly min: number; readonly max: number },
  spriteScale: number,
): number | null {
  const placement = state[kind];
  if (!placement.visible) return null;
  return approachX(kind, placement, catX, limits, spriteScale);
}

/** 换掉一个挂件的摆放，返回新的整体状态。不改原对象。 */
export function withPlacement(
  state: PropsState,
  kind: PropKind,
  patch: Partial<PropPlacement>,
): PropsState {
  return { ...state, [kind]: { ...state[kind], ...patch } };
}

/**
 * 挂件贴图的设备缩放倍数：目标倍数 × dpr 后取整，并按窗口客户区钳住。
 *
 * 与 display.ts 的 `deviceScaleFor` 是同一条约束的另一份实例：**每个源像素必须
 * 占据整数个物理像素**，否则 dpr = 1.5 时 3 × 1.5 = 4.5，单个像素横跨非整数个
 * 物理像素，像素风立刻破功（mvp-scope 第 8 节）。
 *
 * 没有直接复用那个函数，是因为它把精灵尺寸写成了模块级的 72×56 常量 -
 * 那是猫的尺寸，挂件各有自己的。共用的是规则，不是尺寸。
 */
export function propDeviceScale(
  sprite: { readonly w: number; readonly h: number },
  targetScale: number,
  dpr: number,
  box: { readonly w: number; readonly h: number },
): number {
  const fit = Math.min(
    Math.floor((box.w * dpr) / sprite.w),
    Math.floor((box.h * dpr) / sprite.h),
  );
  return Math.max(1, Math.min(Math.max(1, Math.round(targetScale * dpr)), Math.max(1, fit)));
}

/** 该设备缩放下贴图占的 CSS 尺寸。 */
export function propCssSize(
  sprite: { readonly w: number; readonly h: number },
  deviceScale: number,
  dpr: number,
): { w: number; h: number } {
  return { w: (sprite.w * deviceScale) / dpr, h: (sprite.h * deviceScale) / dpr };
}

/** 两份摆放是否一致。用来避免把没变化的位置反复写盘、反复下发窗口移动。 */
export function samePlacement(a: PropPlacement, b: PropPlacement): boolean {
  return a.x === b.x && a.y === b.y && a.visible === b.visible;
}

export function samePropsState(a: PropsState, b: PropsState): boolean {
  return PROP_KINDS.every((kind) => samePlacement(a[kind], b[kind]));
}

/**
 * 挂件的 x 允许落在哪一段：**中心必须在猫走得到的范围内**。
 *
 * 猫的锚点是它精灵的横向中心，而精灵不能出屏，所以它能站到的位置两端各差半个身子
 * （与 motion.ts 的 reachableX 是同一条算法，那边是给运动层用的）。
 * 挂件被拖出这段的后果很直观：猫窝拖到屏幕最右边，猫躺下时中心到不了垫子中心，
 * 于是**一半睡在床外**；食盆同理，猫会站在盆旁边够不着。
 *
 * 所以这不是「贴边好不好看」的问题，而是挂件只有落在这段里才是可用的家具。
 * 默认摆放、拖动、松手补间隔全部走这一个约束。
 *
 * 屏幕窄到连一个身位都放不下时退回整个工作区 - 那种屏幕上猫本来就没法正常活动，
 * 至少别把挂件推到看不见的地方。
 */
export function propBounds(
  kind: PropKind,
  work: ScreenRect,
  spriteScale: number,
): { min: number; max: number } {
  const w = propWindowSize(kind).w;
  const catHalf = (CAT_W * spriteScale) / 2;
  const min = work.x + catHalf - w / 2;
  const max = work.x + work.w - catHalf - w / 2;
  if (min > max) return { min: work.x, max: work.x + work.w - w };
  return { min: Math.ceil(min), max: Math.floor(max) };
}

/**
 * 拖动过程中的结果：**只动横向，跟手，允许暂时重合**。
 *
 * 纵向不给用户动，因为挂件是**放在地上的东西** - 纵向位置由地面线唯一决定
 * （groundedY）。放开纵向的代价立刻就能看见：食盆会被拖到猫脚下面的空处浮着，
 * 而猫走过去吃饭时仍然按地面线站，两者对不上。
 * 猫本身也只有 x、没有 y，永远走在同一条线上，所以「所有东西共用一条地面线」
 * 是这套空间模型的唯一不变量（另一面见 art-and-motion-decisions 的脚踩实地）。
 *
 * **「不许重合」是静止状态的约束，不是拖动过程中的约束。**
 * 被否决的前一版就是把它当成过程约束：拖动时按间隔挡住不许压上去。结果是挂件
 * 停在间隔外不动、而光标还在往前走，中间有一百多像素的死区不跟手，走到尽头再
 * 突然交换 - 产品负责人的原话是「交换的时候会感觉卡顿一下」，那个卡顿就是死区
 * 末端的跳变。拖动是直接操作，东西不跟手才是错的。
 * 静止时的间隔由 settleDrag 在松手时补上。
 *
 * 交换的触发点是**两者中心交错**，也就是「差不多各重叠一半」的那一刻。
 * 被交换的那件直接落到我来的那一侧、留出间隔，于是交换之后两者立刻是分开的。
 */
export function dragResult(
  kind: PropKind,
  desiredX: number,
  state: PropsState,
  work: ScreenRect,
  spriteScale: number,
): PropsState {
  const w = propWindowSize(kind).w;
  const inBounds = (v: number, k: PropKind): number => {
    const b = propBounds(k, work, spriteScale);
    return clamp(Math.round(v), b.min, b.max);
  };
  const x = inBounds(desiredX, kind);
  const center = x + w / 2;
  const centerNow = state[kind].x + w / 2;

  let next = { ...state, [kind]: { ...state[kind], x } } as PropsState;

  for (const other of PROP_KINDS) {
    if (other === kind) continue;
    // 隐藏的挂件不参与交换：看不见的东西突然跳一下更莫名。
    if (!state[other].visible) continue;
    const o = state[other];
    const ow = propWindowSize(other).w;
    const oCenter = o.x + ow / 2;
    if (centerNow < oCenter === center < oCenter) continue;

    // 中心交错了。被交换的那件落到我来的那一侧，紧邻我并留出间隔 -
    // 用「我现在在哪」算而不是「我原来在哪」，这样连续拖动时它的落点是稳定的。
    const parked = center < oCenter ? x + w + PROP_GAP_PX : x - PROP_GAP_PX - ow;
    next = { ...next, [other]: { ...o, x: inBounds(parked, other) } } as PropsState;
  }

  return next;
}

/**
 * 松手之后把间隔补上：**静止状态永不重合**。
 *
 * 拖动过程中允许重合（见 dragResult），所以松手的那一刻可能正压在另一件上。
 * 往哪一侧推由中心的相对位置决定 - 推到「看起来更近」的那一侧，用户才不会觉得
 * 东西自己跑了。两侧都放不下（屏幕太窄）就留在原地，宁可挨着也不要推出屏幕外。
 */
export function settleDrag(
  kind: PropKind,
  state: PropsState,
  work: ScreenRect,
  spriteScale: number,
): PropsState {
  const w = propWindowSize(kind).w;
  const { min: minX, max: maxX } = propBounds(kind, work, spriteScale);
  let x = state[kind].x;

  for (const other of PROP_KINDS) {
    if (other === kind) continue;
    if (!state[other].visible) continue;
    const o = state[other];
    const ow = propWindowSize(other).w;
    const gap = x < o.x ? o.x - (x + w) : x - (o.x + ow);
    if (gap >= PROP_GAP_PX) continue;

    const toLeft = o.x - PROP_GAP_PX - w;
    const toRight = o.x + ow + PROP_GAP_PX;
    const leftOk = toLeft >= minX;
    const rightOk = toRight <= maxX;
    if (leftOk && rightOk) x = x + w / 2 < o.x + ow / 2 ? toLeft : toRight;
    else if (leftOk) x = toLeft;
    else if (rightOk) x = toRight;
  }

  if (x === state[kind].x) return state;
  return { ...state, [kind]: { ...state[kind], x: clamp(x, minX, maxX) } } as PropsState;
}

/**
 * 把每件挂件的纵向位置拉回地面线。
 *
 * 读存档之后必须走一遍：**y 是派生量**，由地面线与贴图高度算出来，不是用户的选择。
 * 存档里可能留着旧版本写下的任意 y（早先的实现允许纵向拖动），照用的结果是
 * 挂件浮在半空。工作区也可能变了（换屏、程序坞显隐），地面线跟着变。
 */
export function groundedPropsState(
  state: PropsState,
  groundY: number,
  spriteScale: number,
): PropsState {
  const out: Partial<Record<PropKind, PropPlacement>> = {};
  for (const kind of PROP_KINDS) {
    out[kind] = { ...state[kind], y: Math.round(groundedY(kind, groundY, spriteScale)) };
  }
  return out as PropsState;
}
