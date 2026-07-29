import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * 领养窗口的形态：**小尺寸居中窗口，用完即关，不常驻**（验收项 / mvp-scope 第 7 节）。
 *
 * 这几条事实全在 Rust 侧与构建配置里，TypeScript 测试看不见它们，所以这里直接读源文件。
 * 手法很粗，但守住的是几个「只在打包版上、且只在删掉存档之后」才会暴露的坑，
 * 而那条路径没有任何自动化手段能真的走一遍。先例见 test/app/display.test.ts
 * （它同样直接读 tauri.conf.json 来守窗口尺寸）。
 */

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

const adoptRs = read('../../src-tauri/src/adopt.rs');
const libRs = read('../../src-tauri/src/lib.rs');
const viteConfig = read('../../vite.config.ts');
const capabilities = JSON.parse(read('../../src-tauri/capabilities/default.json')) as {
  windows: string[];
};
const tauriConf = JSON.parse(read('../../src-tauri/tauri.conf.json')) as {
  app: { windows: { label: string; visible?: boolean }[] };
};

describe('领养窗口是居中的小窗口', () => {
  it('建窗时调用了 center()', () => {
    expect(adoptRs).toContain('.center()');
  });

  it('不可缩放 - 里面的雨夜画面是按固定尺寸排的', () => {
    expect(adoptRs).toContain('.resizable(false)');
  });

  it('尺寸由前端传入，不在 Rust 里另写一份', () => {
    // 两处各写一份数字的话，改了 adopt/constants.ts 而忘了改 Rust，
    // 症状是窗口里出现一条空白边或者按钮被切掉。
    expect(adoptRs).toContain('.inner_size(width, height)');
  });
});

describe('用完即关，不常驻', () => {
  it('有一条关掉自己的路径', () => {
    expect(adoptRs).toContain('fn close_adoption');
    expect(adoptRs).toContain('.close()');
  });

  it('不在 tauri.conf.json 的窗口列表里 - 配置里的窗口每次启动都会建出来', () => {
    const labels = tauriConf.app.windows.map((w) => w.label);
    expect(labels).toContain('pet');
    expect(labels).not.toContain('adopt');
  });

  it('两个命令都注册进了 invoke_handler', () => {
    expect(libRs).toContain('adopt::open_adoption');
    expect(libRs).toContain('adopt::close_adoption');
  });
});

describe('领养完成前不显示猫', () => {
  it('宠物窗口以 visible: false 启动，由前端在猫就位后才通知显示', () => {
    const pet = tauriConf.app.windows.find((w) => w.label === 'pet');
    expect(pet?.visible).toBe(false);
  });
});

describe('打包产物里有领养页', () => {
  it('adopt.html 显式列进了 rollup 的入口', () => {
    // 漏掉它：开发时一切正常（devUrl 直接给文件），打包后领养窗口一片空白。
    expect(viteConfig).toContain("page('adopt.html')");
  });

  it('领养窗口在权限清单里', () => {
    // 漏掉它：emit 被权限系统拦掉，表现为领养完之后什么都没发生。
    expect(capabilities.windows).toContain('adopt');
  });
});
