/**
 * Rust 侧命令的薄封装。
 *
 * 唯一一处 `@tauri-apps/api` 的导入点：其余模块只依赖普通函数，因此可以在
 * node 里测试，也可以直接用浏览器打开页面调试渲染。
 *
 * 注意：CSP 必须含 `connect-src ... ipc: http://ipc.localhost`，否则这里所有
 * 调用都会失败（tauri.conf.json 里已配好，改动它会让猫连窗口都显示不出来）。
 */

/** 是否跑在 Tauri 里。直接用浏览器打开这个页面调试时为 false。 */
export const inTauri = '__TAURI_INTERNALS__' in globalThis;

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

let cached: Invoke | null = null;

async function invoker(): Promise<Invoke> {
  if (!cached) {
    const mod = await import('@tauri-apps/api/core');
    cached = mod.invoke as Invoke;
  }
  return cached;
}

/** 通知 Rust 侧显示窗口。失败会抛 - 这是窗口能否显示的唯一途径，不能静默。 */
export async function petReady(): Promise<void> {
  const invoke = await invoker();
  await invoke<void>('pet_ready');
}

/**
 * 取光标相对宠物窗口客户区左上角的位置，单位是逻辑像素（等于 CSS 像素）。
 *
 * 光标位置与窗口位置的相减在 Rust 侧做完：分两次 IPC 各取一半，
 * 猫在移动或用户在拖窗口时两个值不是同一时刻的，会错位。
 */
export async function probeCursor(): Promise<{ x: number; y: number } | null> {
  if (!inTauri) return null;
  const invoke = await invoker();
  const [x, y] = await invoke<[number, number]>('cursor_probe');
  return { x, y };
}

/** Rust 侧 `stage_metrics` 的返回形状，逻辑像素。 */
export interface StageMetricsDto {
  x: number;
  y: number;
  w: number;
  h: number;
  work_x: number;
  work_y: number;
  work_w: number;
  work_h: number;
}

/**
 * 读舞台窗口的位置、尺寸与桌面工作区。
 *
 * 位置与工作区一次取回，不分两次 IPC：前端要拿它们做减法，
 * 两次调用之间窗口可能已经挪过（猫会自己走），错位会让猫的屏幕位置整体偏移。
 */
export async function probeStage(): Promise<StageMetricsDto | null> {
  if (!inTauri) return null;
  const invoke = await invoker();
  return invoke<StageMetricsDto>('stage_metrics');
}

/**
 * 把舞台挪到桌面上的某个逻辑坐标。
 *
 * 与 setPassThrough 不同，这里**必须等返回**：画布偏移只有在窗口真的挪到位
 * 之后才能跟着改，否则猫会先跳到别处再跳回来（见 motion.ts 的 settleStage）。
 */
export async function moveStage(x: number, y: number): Promise<void> {
  if (!inTauri) return;
  const invoke = await invoker();
  await invoke<void>('move_stage', { x, y });
}

let passThroughFailures = 0;

/**
 * 下发整窗穿透状态。发出去就不管 - 帧循环不能等一次 IPC 往返。
 *
 * 不等返回是安全的：判定层记住的是「已下发的值」，重复下发同一个值本身被去重了；
 * 真正的风险是 macOS 上的传播延迟，那个靠提前切换解决，等待返回也没用。
 */
export function setPassThrough(on: boolean): void {
  if (!inTauri) return;
  void invoker()
    .then((invoke) => invoke<void>('set_pass_through', { on }))
    .catch((err) => {
      passThroughFailures++;
      // 只报前几次：失败通常是系统性的（权限、命令名写错），刷屏没有信息量。
      if (passThroughFailures <= 3) {
        console.error('[cyber-cat] 切换点击穿透失败，猫可能点不动或挡住桌面：', err);
      }
    });
}
