/**
 * 自绘标题栏。三扇弹出窗口（领养、日记、告别）共用。
 *
 * 为什么不用系统标题栏：docs/adr/0013-自绘标题栏.md。
 */
export { CHROME_H, GRIP_H, withChrome } from './constants.js';
export { resizedTo, sameSize } from './resize.js';
export type { ResizeLimits, Size } from './resize.js';
export { mountChrome } from './titlebar.js';
export type { ChromeSpec, CloseSpec, ResizeSpec } from './titlebar.js';
