/**
 * 拖右下角把手时窗口该变成多大。纯函数。
 *
 * **为什么要自己算，而不是用系统的缩放**：
 * 无边框窗口在 Windows 上会被 tao 摘掉 `WS_THICKFRAME`
 * （tao 0.35 platform_impl/windows/window_state.rs:307），而 `WS_THICKFRAME`
 * 正是 `DefWindowProc` 执行缩放循环的前提 - 少了它，四边拖不动，
 * Tauri 的 `startResizeDragging` 也一样没反应（它就是往窗口投一条
 * `WM_NCLBUTTONDOWN`/`HTBOTTOMRIGHT`）。macOS 那边无边框窗口还留着
 * `NSWindowStyleMask::Resizable`，四边其实能拖，但为一个平台留一条路、
 * 另一个平台走另一条，等于两套都要在真机上验。所以两个平台都走这一条：
 * 前端按指针位移算出新尺寸，落到应用自己的命令上（与挂件拖拽同一条做法）。
 *
 * 位移一律用**屏幕坐标**算：窗口尺寸正在跟着指针变，用客户区坐标会形成
 * 「窗口变大 → 客户区坐标变小 → 又算出更大的窗口」的正反馈，表现为一拖就飞出屏幕。
 */

export interface Size {
  readonly w: number;
  readonly h: number;
}

export interface ResizeLimits {
  readonly minW: number;
  readonly minH: number;
  readonly maxW: number;
  readonly maxH: number;
}

/**
 * 按位移算出新尺寸，并钳进上下限。
 *
 * 取整是硬要求：非整数的窗口尺寸会让 webview 的布局落在半个物理像素上，
 * 像素风的边框当场变成两像素的灰边（与 display.ts 的取整是同一条约束）。
 *
 * 上限比下限先钳，下限最后钳：窗口比屏幕还小的时候，
 * 顺序颠倒会让「上限小于下限」的病态输入返回一个小于 min 的尺寸。
 */
export function resizedTo(start: Size, dx: number, dy: number, limits: ResizeLimits): Size {
  const w = Math.min(Math.round(start.w + dx), limits.maxW);
  const h = Math.min(Math.round(start.h + dy), limits.maxH);
  return {
    w: Math.max(w, limits.minW),
    h: Math.max(h, limits.minH),
  };
}

/** 尺寸没变就不必发那条跨进程命令。拖动过程中每个 pointermove 都会问一次。 */
export function sameSize(a: Size, b: Size): boolean {
  return a.w === b.w && a.h === b.h;
}
