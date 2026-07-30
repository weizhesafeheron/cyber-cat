/**
 * 托盘层。
 *
 * 只有美术：把猫的状态画成一张 18×18 的位图。**这里不认识 Tauri，也不认识世界层** -
 * 「现在是哪一档状态」由应用层从 `CatStatus` 映射过来（那是呈现的判断，
 * 和托盘文案在同一处，见 src/app/status.ts），把位图递给 Rust 也在应用层。
 * 这一层保持纯函数，才能在 node 里逐像素地测。
 */

export { TRAY_ICON_SIZE, trayIcon } from './icon.js';
export type { TrayIconBitmap, TrayIconState } from './icon.js';
