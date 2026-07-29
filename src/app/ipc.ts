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
 * 读**调用方自己那个窗口**的位置、尺寸与工作区。
 *
 * 与 probeStage 是同一个 Rust 命令 - 那边取的本来就是发起调用的窗口
 * （Tauri 会把它注入命令），所以挂件窗口用它读自己的位置是免费的。
 * 换个名字导出是为了让调用点读得懂：挂件窗口不该看起来在读舞台。
 */
export const probeSelf = probeStage;

/**
 * 把某个挂件窗口摆到桌面上的某个逻辑坐标，并决定显示还是隐藏。
 *
 * 位置与可见性一次下发：分两次调用会在「先显示、后挪位置」的顺序下让用户看见
 * 挂件在屏幕上跳一下 - 与舞台窗口先摆位置再显示是同一条经验（见 main.ts 的启动顺序）。
 */
export async function placeProp(
  kind: string,
  x: number,
  y: number,
  visible: boolean,
): Promise<void> {
  if (!inTauri) return;
  const invoke = await invoker();
  await invoke<void>('place_prop', { kind, x, y, visible });
}

/**
 * 开始拖动**调用方自己那个窗口**。
 *
 * 必须由 Rust 侧的 `start_dragging` 来做：之后窗口交给操作系统的拖拽循环，
 * 前端既收不到 pointermove 也不会收到「拖完了」的回调。
 * 因此挂件窗口得靠回读位置（probeSelf）才知道自己被挪到哪儿了。
 */
export async function dragSelf(): Promise<void> {
  if (!inTauri) return;
  const invoke = await invoker();
  await invoke<void>('drag_prop');
}

/** 刷新托盘里两个挂件的显示/隐藏勾选状态。 */
export async function pushPropMenu(bowl: boolean, bed: boolean): Promise<void> {
  if (!inTauri) return;
  try {
    const invoke = await invoker();
    await invoke<void>('update_prop_menu', { bowl, bed });
  } catch (err) {
    console.error('[cyber-cat] 刷新挂件菜单失败：', err);
  }
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

/**
 * 订阅一个窗口间事件。
 *
 * 宠物窗口与两个挂件窗口是三个独立的 webview，各有自己的 JS 世界；
 * 它们之间唯一的通路就是 Tauri 的事件总线。分工是刻意的：
 * **世界状态只有宠物窗口持有**，挂件窗口是纯粹的视图 - 点了食盆就报一声，
 * 添粮这件事仍然作为一次 `UserAction` 走进同一个 `step`（与托盘菜单同理）。
 * 多一条改状态的路，离线推演的等价性就没法再保证了（ADR 0001）。
 */
export async function listenEvent<T>(
  name: string,
  handler: (payload: T) => void,
): Promise<void> {
  if (!inTauri) return;
  try {
    const { listen } = await import('@tauri-apps/api/event');
    await listen<T>(name, (event) => handler(event.payload));
  } catch (err) {
    console.error(`[cyber-cat] 订阅事件 ${name} 失败：`, err);
  }
}

/** 给某个窗口发一个事件。失败只记录 - 收不到的后果由各自的重试兜住。 */
export async function emitToWindow(
  label: string,
  name: string,
  payload: unknown,
): Promise<void> {
  if (!inTauri) return;
  try {
    const { emitTo } = await import('@tauri-apps/api/event');
    await emitTo(label, name, payload);
  } catch (err) {
    console.error(`[cyber-cat] 向 ${label} 发送事件 ${name} 失败：`, err);
  }
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
