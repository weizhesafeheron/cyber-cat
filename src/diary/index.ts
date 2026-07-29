/**
 * 猫咪日记。
 *
 * 三块纯逻辑，都不碰 DOM、不读时钟：
 * - `text.ts`：把 `WorldEvent` 渲染成中文句子，按性格分岔。告别页（ticket 13）
 *   翻看日记用的就是这里的 `diaryText` / `groupDiary`。
 * - `bubble.ts`：回归气泡的判定与几何。
 * - `art.ts`：气泡的像素画。
 *
 * 窗口那一半在 `main.ts`（页面入口）与 `../app/bubble.ts`（舞台里的画布）。
 */
export * from './constants.js';
export * from './text.js';
export * from './bubble.js';
export { BUBBLE_SPRITE, type BubbleSprite } from './art.js';
