import { defineConfig } from 'vite';

/**
 * 前端构建配置。
 *
 * 三个入口页都要进产物：
 * - `index.html` 是宠物窗口（label = pet，Tauri 启动时加载）。
 * - `adopt.html` 是领养窗口（label = adopt，首次启动时由 Rust 按需建出来）。
 * - `prop.html` 是食盆与猫窝共用的挂件入口（靠 `?kind=` 区分，见 src/app/prop-main.ts）。
 *
 * dev/index.html 是渲染核心的人工验证页，开发时访问 /dev/ 即可，不进产物。
 *
 * **多入口必须显式列出。** Rollup 只从 index.html 出发抓依赖图，
 * 漏掉的页在开发时（devUrl 直接给文件）一切正常，打包之后是一片空白，
 * 而且不报错 - 挂件窗口本来就是透明的，领养那条路又只有删掉存档重启打包版才走得到。
 *
 * 路径写相对的，由 vite 按 root 解析。绝对路径会把打包机器上的目录结构
 * 烧进产物的资源路径里。
 */
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
      input: { pet: 'index.html', adopt: 'adopt.html', prop: 'prop.html' },
    },
  },
});
