import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * 前端构建配置。
 *
 * 两个入口页都要进产物：
 * - `index.html` 是宠物窗口（label = pet，Tauri 启动时加载）。
 * - `adopt.html` 是领养窗口（label = adopt，首次启动时由 Rust 按需建出来）。
 *
 * **领养页必须显式列进 input。** Rollup 只从 index.html 出发抓依赖图，
 * 漏掉的话开发时（devUrl 直接给文件）一切正常，打包之后领养窗口是一片空白 -
 * 而那条路只有删掉存档重新启动打包版才走得到。
 *
 * dev/index.html 是渲染核心的人工验证页，开发时访问 /dev/ 即可，不进产物。
 */
const page = (name: string): string => fileURLToPath(new URL(name, import.meta.url));

export default defineConfig({
  // Tauri 期望固定端口，且失败要报错而不是静默换端口
  server: {
    port: 5273,
    strictPort: true,
  },
  // Tauri 在自己的窗口里加载页面，不需要浏览器自动打开
  clearScreen: false,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: { pet: page('index.html'), adopt: page('adopt.html') },
    },
  },
});
