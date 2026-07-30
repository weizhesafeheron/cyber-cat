import { defineConfig } from 'vite';

const csp =
  "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ipc: ws://localhost:5273";

/**
 * 前端构建配置。
 *
 * 四个入口页都要进产物：
 * - `index.html` 是宠物窗口（label = pet，Tauri 启动时加载）。
 * - `adopt.html` 是领养窗口（label = adopt，首次启动时由 Rust 按需建出来）。
 * - `farewell.html` 是告别页（label = farewell，猫死后由 Rust 按需建出来）。
 * - `prop.html` 是食盆与猫窝共用的挂件入口（靠 `?kind=` 区分，见 src/app/prop-main.ts）。
 * - `diary.html` 是猫咪日记（label = diary，托盘菜单或猫头顶的气泡按需建出来）。
 *
 * dev/index.html 是渲染核心的人工验证页，开发时访问 /dev/ 即可，不进产物。
 *
 * **多入口必须显式列出。** Rollup 只从 index.html 出发抓依赖图，
 * 漏掉的页在开发时（devUrl 直接给文件）一切正常，打包之后是一片空白，
 * 而且不报错 - 挂件窗口本来就是透明的，领养那条路又只有删掉存档重启打包版才走得到，
 * 告别页更难撞上：要先让一只猫真的死掉。
 *
 * 路径写相对的，由 vite 按 root 解析。绝对路径会把打包机器上的目录结构
 * 烧进产物的资源路径里。
 */
export default defineConfig({
  // Tauri 期望固定端口，且失败要报错而不是静默换端口
  server: {
    port: 5273,
    strictPort: true,
    // 生产构建由 Tauri 注入同一条 CSP。开发页也必须阻止 Windows WebView2
    // 请求 http://ipc.localhost，Tauri 才会立即回退到原生 postMessage IPC。
    headers: {
      'Content-Security-Policy': csp,
    },
    // Windows 在 Rust 链接 build_script_build.exe 时会独占该文件；Vite 若递归
    // 监听 src-tauri/target，会因 EBUSY 直接退出并连带终止 `tauri dev`。
    // target 是编译产物，本来也不该触发前端热更新。
    watch: {
      ignored: ['**/src-tauri/target/**'],
    },
  },
  // Tauri 在自己的窗口里加载页面，不需要浏览器自动打开
  clearScreen: false,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: {
        pet: 'index.html',
        adopt: 'adopt.html',
        farewell: 'farewell.html',
        prop: 'prop.html',
        diary: 'diary.html',
      },
    },
  },
});
