import { CHROME_H, GRIP_H } from './constants.js';
import { resizedTo, sameSize } from './resize.js';
import type { ResizeLimits, Size } from './resize.js';
import './chrome.css';

/**
 * 自绘的像素标题条。领养、日记、告别三扇窗共用。
 *
 * 职责边界：这个文件只搭 DOM 与接事件。**判断不在这里** -
 * 尺寸怎么算在 resize.ts，关掉窗口意味着什么由各页自己给（见 ChromeSpec.close）。
 *
 * 标题文字取 `document.title`，不再传一份进来：每个页面的 <title> 已经写着它了，
 * Rust 建窗时也写了同一句（adopt.rs 的 `.title(...)`）。第三份必然会先对不上。
 *
 * 拖动交给 Tauri 的 `data-tauri-drag-region`（属性写 "deep"，整条子及其子元素都能拖），
 * 而不是自己按指针位移调窗口位置：那条路是系统的窗口拖拽，自带贴边与跨屏，
 * 每次拖动只有一次跨进程调用。它需要 `core:window:allow-start-dragging`，
 * 见 src-tauri/capabilities/chrome.json。
 * drag.js 里对 BUTTON 有专门的判定（可点击元素默认挡住拖动），所以关闭按钮
 * 不需要额外声明 `data-tauri-drag-region="false"`。
 */

/** 关闭按钮的语义。三扇窗各不相同，所以由页面给。 */
export interface CloseSpec {
  /** 鼠标悬停时的提示。要说清关掉之后会发生什么 - 领养窗口关掉是会退出应用的。 */
  readonly hint: string;
  readonly close: () => void;
}

/** 缩放把手。只有日记窗口给这一项，其余两扇窗口不可缩放。 */
export interface ResizeSpec {
  readonly minW: number;
  readonly minH: number;
  /** 落到窗口上。走应用自己的 Rust 命令，理由见 resize.ts 顶部。 */
  readonly apply: (w: number, h: number) => void;
}

export interface ChromeSpec {
  readonly close: CloseSpec;
  readonly resize?: ResizeSpec;
}

/** 12×12 的像素爪印。四个脚趾加一块掌垫，crispEdges 保证放大时不被抗锯齿抹圆。 */
const PAW = `<svg class="chrome-paw" viewBox="0 0 12 12" shape-rendering="crispEdges" aria-hidden="true">
  <g fill="currentColor">
    <rect x="1" y="3" width="2" height="3"/><rect x="4" y="1" width="2" height="3"/>
    <rect x="7" y="1" width="2" height="3"/><rect x="10" y="3" width="2" height="3"/>
    <rect x="3" y="6" width="6" height="5"/><rect x="2" y="7" width="8" height="3"/>
  </g>
</svg>`;

/**
 * 7×7 的像素叉。
 *
 * 不用文字的 × ：字形的行盒高度跟着字体走，在 22 像素的方框里会差出几像素，
 * 而那几像素在真机上表现为「叉不居中」或者被裁掉一角。一格一格画出来就没有这个问题。
 */
const CROSS = `<svg viewBox="0 0 7 7" width="9" height="9" shape-rendering="crispEdges" aria-hidden="true">
  <g fill="currentColor">
    <rect x="0" y="0" width="1" height="1"/><rect x="1" y="1" width="1" height="1"/>
    <rect x="2" y="2" width="1" height="1"/><rect x="3" y="3" width="1" height="1"/>
    <rect x="4" y="4" width="1" height="1"/><rect x="5" y="5" width="1" height="1"/>
    <rect x="6" y="6" width="1" height="1"/>
    <rect x="6" y="0" width="1" height="1"/><rect x="5" y="1" width="1" height="1"/>
    <rect x="4" y="2" width="1" height="1"/><rect x="2" y="4" width="1" height="1"/>
    <rect x="1" y="5" width="1" height="1"/><rect x="0" y="6" width="1" height="1"/>
  </g>
</svg>`;

/** 缩放把手：三道斜排的像素点，桌面系统上通用的那个形状。 */
const GRIP = `<svg viewBox="0 0 12 12" shape-rendering="crispEdges" aria-hidden="true">
  <g fill="currentColor">
    <rect x="9" y="3" width="2" height="2"/>
    <rect x="6" y="6" width="2" height="2"/><rect x="9" y="6" width="2" height="2"/>
    <rect x="3" y="9" width="2" height="2"/><rect x="6" y="9" width="2" height="2"/>
    <rect x="9" y="9" width="2" height="2"/>
  </g>
</svg>`;

/** 当前这扇窗的客户区尺寸，CSS 像素。无边框窗口下它就是整扇窗。 */
function innerSize(): Size {
  return { w: window.innerWidth, h: window.innerHeight };
}

/**
 * 缩放的上限取所在屏幕的可用区（去掉菜单栏与程序坞）。
 *
 * 用 `screen.availWidth/Height` 而不是去问 Rust 要工作区：这条路不需要跨进程，
 * 也不需要在拖动过程中反复问。代价是多屏下它给的是**主屏**的可用区，
 * 窗口挪到副屏上再拉大时上限可能不对 - 那是「拉得过大」，用户再拖回来即可，
 * 而跨屏漫游本来就是 MVP 之后的事（mvp-scope 第 10 节）。
 */
function limitsFor(spec: ResizeSpec): ResizeLimits {
  return {
    minW: spec.minW,
    minH: spec.minH,
    maxW: window.screen.availWidth,
    maxH: window.screen.availHeight,
  };
}

function buildGrip(spec: ResizeSpec): HTMLElement {
  const grip = document.createElement('div');
  grip.className = 'chrome-grip';
  grip.title = '拖动缩放';
  grip.innerHTML = GRIP;

  /** 按下时的那一帧：起始尺寸与起始屏幕坐标。null = 没在拖。 */
  let from: { size: Size; sx: number; sy: number; limits: ResizeLimits } | null = null;
  let last: Size = innerSize();

  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    // 捕获指针：拖动中指针会滑出这个 14×14 的方块，甚至滑出窗口。
    grip.setPointerCapture(e.pointerId);
    const size = innerSize();
    from = { size, sx: e.screenX, sy: e.screenY, limits: limitsFor(spec) };
    last = size;
    e.preventDefault();
  });

  grip.addEventListener('pointermove', (e) => {
    if (from === null) return;
    const next = resizedTo(from.size, e.screenX - from.sx, e.screenY - from.sy, from.limits);
    if (sameSize(next, last)) return;
    last = next;
    spec.apply(next.w, next.h);
  });

  const stop = (e: PointerEvent): void => {
    if (from === null) return;
    from = null;
    if (grip.hasPointerCapture(e.pointerId)) grip.releasePointerCapture(e.pointerId);
  };
  grip.addEventListener('pointerup', stop);
  grip.addEventListener('pointercancel', stop);

  return grip;
}

/**
 * 把标题条挂到页面上。在页面画第一屏之前调 - 窗口是 visible: false 建出来的，
 * 显示由 contentReady 触发（ADR 0003），所以这一层的挂载永远赶在用户看见之前。
 */
export function mountChrome(spec: ChromeSpec): void {
  const root = document.documentElement.style;
  root.setProperty('--chrome-h', `${CHROME_H}px`);
  root.setProperty('--chrome-grip', `${GRIP_H}px`);

  const bar = document.createElement('div');
  bar.className = 'chrome';
  // "deep"：条子里的空白和标题文字都能拖，不必只拖那一条缝
  bar.setAttribute('data-tauri-drag-region', 'deep');
  bar.innerHTML = PAW;

  const title = document.createElement('div');
  title.className = 'chrome-title';
  // textContent 而不是拼 innerHTML：<title> 是我们自己写的，但这条路以后可能
  // 带上猫的名字（用户输入），到那时才想起来就晚了。
  title.textContent = document.title;
  bar.append(title);

  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'chrome-x';
  x.title = spec.close.hint;
  x.setAttribute('aria-label', spec.close.hint);
  x.innerHTML = CROSS;
  x.addEventListener('click', () => spec.close.close());
  bar.append(x);

  const frame = document.createElement('div');
  frame.className = 'chrome-frame';

  document.body.append(bar, frame);
  if (spec.resize !== undefined) document.body.append(buildGrip(spec.resize));
}
