import type { AdoptedIdentity } from '../adopt/identity.js';
import { createWorld } from '../world/index.js';
import type { World } from '../world/index.js';

/**
 * 启动时的分岔：**有存档就接着养，没有存档才去领养。**
 *
 * 这一段以前是 main.ts 顶上写死的占位猫（ticket 04 的 PLACEHOLDER_SEED）。
 * 做成注入端口的纯逻辑，是因为它同时决定两件事：首次启动是否进领养流程，
 * 以及猫的身份怎么落到存档里 - 两件都不该靠反复删存档重启真机来验。
 *
 * 时钟与时区在这里取、注入给世界层。世界层从不自己读时钟（ADR 0001）。
 */

export interface AdoptionGate {
  /** 读存档。null = 没有存档，或者存档已经解析不出来（见 persist.ts）。 */
  readonly loadWorld: () => Promise<World | null>;
  /** 走一遍领养流程，拿回用户选定并起好名字的那只猫。 */
  readonly adopt: () => Promise<AdoptedIdentity>;
  readonly saveWorld: (world: World) => Promise<void>;
  /** 现在几点，epoch ms。 */
  readonly now: () => number;
  /** 本地时区偏移，分钟（东八区 = 480）。 */
  readonly tzOffsetMinutes: () => number;
}

/**
 * 拿到这次启动要养的那个世界。
 *
 * 领养失败**不兜底**：随手给一只猫顶上是这里最危险的实现 - 用户会得到一只不是
 * 他选的猫，而且再也回不到领养流程（存档已经建好了）。宁可启动失败。
 *
 * 新领养的猫立刻存一次盘：领养是用户花了心思的一步，不能因为紧接着的一次崩溃
 * 或者关机就要求他重新挑一遍。
 */
export async function ensureWorld(gate: AdoptionGate): Promise<World> {
  const saved = await gate.loadWorld();
  if (saved) return saved;

  const identity = await gate.adopt();
  const world = createWorld({
    breed: identity.breed,
    seed: identity.seed,
    name: identity.name,
    bornAt: gate.now(),
    tzOffsetMinutes: gate.tzOffsetMinutes(),
  });
  await gate.saveWorld(world);
  return world;
}

export interface AdoptionWindowPorts {
  /** 挂上「等领养结果」的监听，返回的 Promise 在用户选定后落地。 */
  readonly waitForAdopted: () => Promise<AdoptedIdentity>;
  /** 打开领养窗口。 */
  readonly openAdoption: () => Promise<void>;
}

/**
 * 打开领养窗口并等结果。
 *
 * **先挂监听再开窗口。** 反过来会漏掉事件：窗口是另一个 webview，它加载完就能
 * 立刻发消息，而这边的 listen 是一次异步 IPC - 顺序错了就会永远等一只已经
 * 交回来的猫。
 */
export function requestAdoption(ports: AdoptionWindowPorts): Promise<AdoptedIdentity> {
  const waiting = ports.waitForAdopted();
  return ports.openAdoption().then(
    () => waiting,
    (err: unknown) => {
      // 开窗口失败时这条等待永远不会落地，主动接住它免得留下一个悬空的 rejection。
      void waiting.catch(() => undefined);
      throw err;
    },
  );
}
