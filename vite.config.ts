import { defineConfig } from 'vite';

/**
 * 前端构建配置。
 *
 * 根目录的 index.html 是宠物窗口的入口（Tauri 加载它）。
 * prop.html 是两个桌面挂件窗口共用的入口（靠 ?kind= 区分，见 src/app/prop-main.ts）。
 * dev/index.html 是渲染核心的人工验证页，开发时访问 /dev/ 即可，不进产物。
 *
 * **多入口必须显式列出。** vite build 默认只打包根目录的 index.html，
 * 漏掉 prop.html 的症状是开发时挂件正常、打包后两个挂件窗口都白屏 -
 * 而且不报错，因为窗口本来就是透明的。
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
      // 相对路径由 vite 按 root 解析，不要写成绝对路径 - 那会把打包机器上的
      // 目录结构烧进产物的资源路径里。
      input: { pet: 'index.html', prop: 'prop.html' },
    },
  },
});
