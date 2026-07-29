import { SaveFormatError, parseWorld, serializeWorld } from '../world/index.js';
import type { World } from '../world/index.js';

/**
 * 存档的应用层适配。
 *
 * 世界层负责「World ↔ 文本」，Rust 侧负责「文本 ↔ 应用数据目录里的文件」，
 * 这里只是把两段接起来，并决定读坏了怎么办。
 */

/** 是否跑在 Tauri 里。直接用浏览器打开页面调试时为 false。 */
export const inTauri = '__TAURI_INTERNALS__' in window;

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

/** 通知 Rust 侧显示宠物窗口。见 lib.rs 里 pet_ready 的说明。 */
export async function signalReady(): Promise<void> {
  if (!inTauri) return; // 浏览器里单独调试，没有窗口需要显示
  try {
    const invoke = await getInvoke();
    await invoke('pet_ready');
  } catch (err) {
    // 不要静默吞掉：这个调用是窗口能否显示的唯一途径，失败就意味着
    // 猫永远不出现。曾因 CSP 缺少 connect-src 而失败，被宽泛的 catch
    // 掩盖成「应用启动了但看不见窗口」，很难排查。
    console.error('[cyber-cat] pet_ready 调用失败，窗口不会显示：', err);
    throw err;
  }
}

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
