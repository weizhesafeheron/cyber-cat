/**
 * 桌面挂件层的公开类型。
 *
 * 挂件是「从废弃的房间里保留下来的道具」（CONTEXT.md），按 ADR 0004 各自是一个
 * 独立的透明小窗口，位置由用户拖动决定。MVP 只有两个：食盆与猫窝。
 *
 * 这个文件是**纯数据**，不依赖 DOM、不依赖 Tauri，因此挂件的几何与摆放规则
 * 可以直接测（test/props/）。
 *
 * `PropKind` 同时是世界层的词汇：世界层用它表达「猫此刻想去哪个挂件」
 * （`RenderIntent.anchor`）。词汇定义在这一层而不是世界层，与 `ActionKey`
 * 定义在渲染层是同一个道理 - **谁拥有这个概念，谁定义它的名字**。
 * 世界层只 import 类型，不 import 任何几何。
 */

/** MVP 的两个挂件。数量必须克制，挂件多了就是桌面垃圾（CONTEXT.md）。 */
export type PropKind = 'bowl' | 'bed';

/**
 * 屏幕逻辑坐标上的一个矩形（通常是桌面可用区）。
 *
 * 与运动层的 `ScreenRect` 结构相同、可以互相赋值。刻意各声明一份而不是共享：
 * 挂件层不该依赖应用层（运动层在 src/app/ 下），而这个形状只有四个数，
 * 为它建一个公共模块的耦合成本比重复声明高。
 */
export interface ScreenRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** 遍历用的固定顺序。存档与菜单都按它排，顺序稳定才好比对。 */
export const PROP_KINDS: readonly PropKind[] = ['bowl', 'bed'];

/**
 * 一个挂件的摆放。
 *
 * `x` / `y` 是**挂件窗口客户区左上角的屏幕逻辑坐标**（CSS 像素，桌面左上角为原点），
 * 与运动层的 `ScreenPoint` 同一个坐标系。
 *
 * **不进世界存档。** 屏幕坐标是平台相关的量，塞进 World 会让世界层不再平台无关，
 * 离线推演的可回放性当场失效（ADR 0001）。挂件摆放单独存一份文件。
 */
export interface PropPlacement {
  readonly x: number;
  readonly y: number;
  /** 是否显示。挂件可隐藏，隐藏时猫就没有这个空间锚点了。 */
  readonly visible: boolean;
}

/** 全部挂件的摆放。整体可 JSON 往返（test/props/save.test.ts）。 */
export type PropsState = Readonly<Record<PropKind, PropPlacement>>;

/**
 * 一张挂件贴图。字段名与渲染层的 `RenderResult` 对齐，因此可以直接喂给
 * `hit.ts` 的命中判定 - 挂件窗口也要做逐像素穿透（ADR 0006），不能在用户
 * 桌面上留一块矩形死区。
 */
export interface PropSprite {
  readonly width: number;
  readonly height: number;
  /** RGBA，长度 width * height * 4。 */
  readonly pixels: Uint8ClampedArray;
  /** 命中掩膜，长度 width * height，每字节 255 或 0。 */
  readonly alphaMask: Uint8Array;
}
