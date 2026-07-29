import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * 告别页窗口的形态：**小尺寸居中窗口，用完即关，不常驻**（mvp-scope 第 7 节）。
 *
 * 手法与 test/adopt/window.test.ts 相同（直接读源文件），理由也相同：这几条事实
 * 全在 Rust 侧与构建配置里，而告别页那条路径比领养更难走一遍 -
 * 要先让一只猫真的死掉，等 88 小时。
 */

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

const farewellRs = read('../../src-tauri/src/farewell.rs');
const trayRs = read('../../src-tauri/src/tray.rs');
const libRs = read('../../src-tauri/src/lib.rs');
const viteConfig = read('../../vite.config.ts');
const capabilities = JSON.parse(read('../../src-tauri/capabilities/farewell.json')) as {
  windows: string[];
  permissions: string[];
};
const tauriConf = JSON.parse(read('../../src-tauri/tauri.conf.json')) as {
  app: { windows: { label: string }[] };
};

describe('告别页是居中的小窗口', () => {
  it('建窗时调用了 center()', () => {
    expect(farewellRs).toContain('.center()');
  });

  it('不可缩放 - 里面两块列表各自滚动，窗口尺寸按内容排好', () => {
    expect(farewellRs).toContain('.resizable(false)');
  });

  it('尺寸由前端传入，不在 Rust 里另写一份', () => {
    expect(farewellRs).toContain('.inner_size(width, height)');
  });

  it('以 visible: false 建出来，画好整页才显示 - 深色页面白闪格外突兀', () => {
    expect(farewellRs).toContain('.visible(false)');
  });
});

describe('用完即关，不常驻', () => {
  it('有一条关掉自己的路径', () => {
    expect(farewellRs).toContain('fn close_farewell');
    expect(farewellRs).toContain('.close()');
  });

  it('不在 tauri.conf.json 的窗口列表里 - 配置里的窗口每次启动都会建出来', () => {
    const labels = tauriConf.app.windows.map((w) => w.label);
    expect(labels).not.toContain('farewell');
  });

  it('两个命令都注册进了 invoke_handler', () => {
    expect(libRs).toContain('farewell::open_farewell');
    expect(libRs).toContain('farewell::close_farewell');
  });
});

describe('关掉告别页不退出应用', () => {
  it('Destroyed 处理器里没有 exit', () => {
    // 与领养窗口刻意不同：领养没走完就没有猫可养，而告别页关掉之后
    // 托盘里还能再打开它，退出等于把「再养一只」这条路一起关掉。
    expect(farewellRs).not.toContain('exit(0)');
  });

  it('托盘里有再打开它的入口 - 否则关掉之后就没有领养新猫的路了', () => {
    expect(trayRs).toContain('"memorial"');
    expect(libRs).toContain('farewell::open_farewell');
  });
});

describe('打包产物里有告别页', () => {
  it('四个入口页都显式列进了 rollup 的入口', () => {
    // 漏掉它：开发时一切正常，打包后告别页一片空白，而且不报错。
    const input = /input:\s*\{([^}]*)\}/.exec(viteConfig)?.[1] ?? '';
    for (const page of ['index.html', 'adopt.html', 'farewell.html', 'prop.html']) {
      expect(input, `${page} 不在 rollup 的 input 里`).toContain(page);
    }
  });

  it('告别页在权限清单里，且只要事件总线', () => {
    // 漏掉它：emit 被权限系统拦掉，表现为点了「再养一只」什么都没发生。
    expect(capabilities.windows).toContain('farewell');
    // 它是只读视图，读档案与关窗都走应用自己的命令（不受 ACL 管）。
    expect(capabilities.permissions).toEqual(['core:event:default']);
  });
});
