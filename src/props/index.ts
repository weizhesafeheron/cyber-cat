/**
 * 桌面挂件层。
 *
 * 挂件是猫的**空间锚点**：食盆让「喂食」、猫窝让「睡觉」从菜单操作变成空间行为
 * （ADR 0004）。这一层只有纯逻辑 - 像素画、摆放几何、摆放存档，
 * 没有窗口也没有 IPC，那些在 src/app/props.ts 与 src/props/main.ts。
 *
 * 分层的落点：
 * - **世界层**决定猫想去哪个挂件（`RenderIntent.anchor`），它只说名字不说坐标。
 * - **挂件层**（这里）把名字换算成屏幕 x。
 * - **运动层**负责把猫送到那个 x，到了才播世界层要的动作。
 *
 * 平台侧在 src/app/：`props.ts` 是宠物窗口这一边的管理，
 * `prop-main.ts` 是挂件窗口自己的入口。这一层不 import 它们 - 依赖只能是单向的。
 */
export * from './types.js';
export * from './constants.js';
export * from './art.js';
export * from './layout.js';
export { parseProps, serializeProps, PropsSaveError } from './save.js';
