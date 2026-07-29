import { defineConfig } from 'vite';

/**
 * 开发用的验证页配置。
 *
 * root 指向 dev/ - 那里只有渲染核心的人工验证页，不是产品入口。
 * 产品入口会在 Tauri 骨架（ticket 03）落地时另行建立。
 */
export default defineConfig({
  root: 'dev',
  server: { port: 5273, open: false },
});
