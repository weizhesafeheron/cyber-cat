import { SaveFormatError, parseWorld, serializeWorld } from '../world/index.js';
import { inTauri } from './ipc.js';
import type { World } from '../world/index.js';

/**
 * 存档的应用层适配。
 *
 * 世界层负责「World ↔ 文本」，Rust 侧负责「文本 ↔ 应用数据目录里的文件」，
 * 这里只是把两段接起来，并决定读坏了怎么办。
 */

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

let cachedInvoke: Invoke | null = null;

async function getInvoke(): Promise<Invoke> {
  if (!cachedInvoke) {
    const mod = await import('@tauri-apps/api/core');
    cachedInvoke = mod.invoke as Invoke;
  }
  return cachedInvoke;
}

/**
 * 读存档。
 *
 * 返回 null 表示「该领养一只新猫了」，只有两种情况会走到这里：还没有存档，
 * 或者存档已经解析不出来。后者会大声报错但不抛出 - 一份坏存档不该让应用启动不了，
 * 但也绝不能静默，否则用户的猫无声无息地换了一只。
 */
export async function loadWorld(): Promise<World | null> {
  if (!inTauri) return null;
  let text: string | null;
  try {
    const invoke = await getInvoke();
    text = await invoke<string | null>('load_world');
  } catch (err) {
    console.error('[cyber-cat] 读取存档失败，本次启动不加载：', err);
    return null;
  }
  if (text == null) return null;

  try {
    return parseWorld(text);
  } catch (err) {
    if (err instanceof SaveFormatError) {
      console.error('[cyber-cat] 存档无法解析，将按新猫启动：', err.message);
      return null;
    }
    throw err;
  }
}

/** 写存档。失败只记录不抛出 - 存档写不进去不该打断猫的日常运行。 */
export async function saveWorld(world: World): Promise<void> {
  if (!inTauri) return;
  try {
    const invoke = await getInvoke();
    await invoke('save_world', { contents: serializeWorld(world) });
  } catch (err) {
    console.error('[cyber-cat] 写存档失败：', err);
  }
}

// 显示窗口的 pet_ready 封装在 ipc.ts - IPC 层只保留一份，避免两处各自维护
// 「是否在 Tauri 里」的判断与错误处理策略。

export interface TrayStatusPayload {
  summary: string;
  hunger: string;
  energy: string;
  mood: string;
  bond: string;
  sick: boolean;
}

/** 刷新托盘菜单上的状态文案。 */
export async function pushTrayStatus(payload: TrayStatusPayload): Promise<void> {
  if (!inTauri) return;
  try {
    const invoke = await getInvoke();
    await invoke('update_tray', payload as unknown as Record<string, unknown>);
  } catch (err) {
    console.error('[cyber-cat] 刷新托盘状态失败：', err);
  }
}

/** 订阅托盘菜单里的动作项（喂食、喂药）。 */
export async function onTrayAction(handler: (id: string) => void): Promise<void> {
  if (!inTauri) return;
  try {
    const { listen } = await import('@tauri-apps/api/event');
    await listen<string>('tray-action', (event) => handler(event.payload));
  } catch (err) {
    console.error('[cyber-cat] 订阅托盘动作失败，菜单里的喂食将无效：', err);
  }
}
