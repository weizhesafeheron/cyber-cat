import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * 「用户主动打开的窗口必须置前」这条约束。
 *
 * 起因是真机上的一句反馈：「猫咪日记打开的时候默认窗口不聚焦，没有在最上层」。
 * 根因不是没写 `.focused(true)` - 那一行是有的，但**对这条路径无效**：
 * 四个窗口都以 `visible: false` 建出来防白闪，等前端画完第一屏才 show，
 * 而那时 build 时的聚焦意图早就过期了，`show()` 本身既不聚焦也不置前。
 * 症状是「点了托盘的日记，什么都没出现」- 窗口其实开在别的窗口后面。
 *
 * 这个文件读源码断言，因为这条约束跨了 Rust 与四个入口页，没有一个纯函数能表达它。
 * 值得这么测：它的失效方式是「窗口开了但用户看不见」，在真机上很容易被当成没反应。
 */

const read = (p: string): string => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

describe('content_ready 的聚焦意图由调用方声明', () => {
  const libRs = read('src-tauri/src/lib.rs');

  it('Rust 侧收下 focus 参数，并且只在为真时才聚焦', () => {
    expect(libRs).toMatch(/fn content_ready\(window: WebviewWindow, focus: bool\)/);
    expect(libRs).toContain('set_focus()');
    // 有 early return，不是无条件聚焦 - 宠物窗口绝不能抢焦点
    expect(libRs).toMatch(/if !focus \{\s*return;/);
  });

  it('宠物窗口不要焦点 - 桌面宠物抢焦点等于打断用户', () => {
    // 不传参数就是不要焦点（默认 false）
    expect(read('src/app/main.ts')).toContain('await contentReady();');
  });

  it('用户主动打开的三页都要焦点 - 不置前等于没打开', () => {
    for (const page of ['src/diary/main.ts', 'src/adopt/main.ts', 'src/farewell/main.ts']) {
      expect(read(page), `${page} 没有要求置前`).toMatch(/contentReady\(true\)/);
    }
  });

  it('那三页确实都是「先隐藏、画完再显示」的窗口 - 否则上面的约束没有意义', () => {
    for (const rs of ['src-tauri/src/diary.rs', 'src-tauri/src/adopt.rs', 'src-tauri/src/farewell.rs']) {
      expect(read(rs), `${rs} 不是隐藏建窗`).toContain('.visible(false)');
    }
  });
});
