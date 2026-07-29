import { defineConfig } from 'vite';

/**
 * 前端构建配置。
 *
 * 根目录的 index.html 是宠物窗口的入口（Tauri 加载它）。
 * dev/index.html 是渲染核心的人工验证页，开发时访问 /dev/ 即可，不进产物。
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
  },
});
