import { parseMemorial, serializeMemorial } from '../memorial/index.js';
import { PropsSaveError, parseProps, serializeProps } from '../props/index.js';
import { SaveFormatError, parseWorld, serializeWorld } from '../world/index.js';
import { inTauri } from './ipc.js';
import { DEFAULT_SETTINGS, parseSettings } from './settings.js';
import type { Memorial } from '../memorial/index.js';
import type { PropsState } from '../props/index.js';
import type { World } from '../world/index.js';
import type { Settings } from './settings.js';

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

/**
 * 读挂件摆放。
 *
 * 返回 null 表示「按默认位置摆」。**摆放与世界分两个文件**：屏幕坐标不能进 World
 * （那会让世界层不再平台无关，见 props/save.ts 的说明），而且家具的生命周期比猫长 -
 * 换一只猫不该让用户重新摆一遍食盆。
 *
 * 与读世界存档同样的策略：读坏了大声报错但不抛出，退回默认摆放。
 * 一份坏掉的摆放不该让应用起不来，但也绝不能静默 - 否则用户会以为自己摆的位置
 * 无声无息地被忘了。
 */
export async function loadProps(): Promise<PropsState | null> {
  if (!inTauri) return null;
  let text: string | null;
  try {
    const invoke = await getInvoke();
    text = await invoke<string | null>('load_props');
  } catch (err) {
    console.error('[cyber-cat] 读取挂件摆放失败，本次按默认位置摆：', err);
    return null;
  }
  if (text == null) return null;

  try {
    return parseProps(text);
  } catch (err) {
    if (err instanceof PropsSaveError) {
      console.error('[cyber-cat] 挂件摆放无法解析，按默认位置摆：', err.message);
      return null;
    }
    throw err;
  }
}

/** 写挂件摆放。失败只记录不抛出 - 摆放写不进去不该打断猫的日常运行。 */
export async function saveProps(state: PropsState): Promise<void> {
  if (!inTauri) return;
  try {
    const invoke = await getInvoke();
    await invoke('save_props', { contents: serializeProps(state) });
  } catch (err) {
    console.error('[cyber-cat] 写挂件摆放失败：', err);
  }
}

/**
 * 读猫的档案。返回 null 表示还没有档案（第一只猫）。
 *
 * **与另外两份存档的失败处理不同：读坏了要抛，不能退回 null。**
 * world.json 与 props.json 坏了都可以丢 - 世界会重新领养一只猫，挂件回到默认位置。
 * 档案丢了是把用户养过的所有猫一起抹掉，而且不可再生（那些猫都死了）。
 * 返回 null 会让调用方以为「还没有档案」，紧接着写一份新的上去 - 正好是最坏的结果。
 * 谁来兜住这个异常见 app/farewell.ts 的 archive()：它选择**不写盘**，保留坏文件。
 */
export async function loadMemorial(): Promise<Memorial | null> {
  if (!inTauri) return null;
  const invoke = await getInvoke();
  const text = await invoke<string | null>('load_memorial');
  if (text == null) return null;
  return parseMemorial(text);
}

/** 写猫的档案。 */
export async function saveMemorial(archive: Memorial): Promise<void> {
  if (!inTauri) return;
  const invoke = await getInvoke();
  await invoke('save_memorial', { contents: serializeMemorial(archive) });
}

/**
 * 读用户的开关（settings.json）。
 *
 * **读坏了不抛，退回默认值**（parseSettings）：这份文件里没有不可再生的东西，
 * 而一个开关读不出来就让猫起不来是不成比例的 - 与 memorial.json 的策略相反，
 * 那份坏了必须让调用方知道，因为里面的猫都死了、覆盖上去就没了。
 */
export async function loadSettings(): Promise<Settings> {
  if (!inTauri) return DEFAULT_SETTINGS;
  try {
    const invoke = await getInvoke();
    const text = await invoke<string | null>('load_settings');
    if (text == null) return DEFAULT_SETTINGS;
    return parseSettings(JSON.parse(text));
  } catch (err) {
    console.error('[cyber-cat] 读开关失败，按默认值继续：', err);
    return DEFAULT_SETTINGS;
  }
}

/** 写用户的开关。用户拨一次写一次 - 这不是每帧都在变的东西，不需要节流。 */
export async function saveSettings(settings: Settings): Promise<void> {
  if (!inTauri) return;
  const invoke = await getInvoke();
  await invoke('save_settings', { contents: JSON.stringify(settings) });
}

// 显示窗口的 pet_ready 封装在 ipc.ts - IPC 层只保留一份，避免两处各自维护
// 「是否在 Tauri 里」的判断与错误处理策略。

/**
 * 托盘菜单要显示的一切。
 *
 * 两个布尔量是**菜单项的可用性**，不是猫的状态 - 字段名刻意跟着菜单项走
 * （medicate / memorial），条件由 app/status.ts 算好。这样「喂药只在生病时出现」
 * 是一条有测试守着的规则，而不是 Rust 里一句 set_enabled。
 *
 * 字段名都是单个小写词：它们会原样作为参数名交给 Rust 侧的 update_tray，
 * 中间没有任何大小写转换，两边必须字面一致。
 */
export interface TrayStatusPayload {
  summary: string;
  hunger: string;
  energy: string;
  mood: string;
  bond: string;
  /** 喂药项是否可用。 */
  medicate: boolean;
  /** 告别与档案项是否可用。 */
  memorial: boolean;
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
