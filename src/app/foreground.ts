import { probeForeground } from './ipc.js';
import type { ForegroundWindow } from './perch.js';

/**
 * 前台窗口的轮询（ticket 12）。
 *
 * 这一层是平台胶水：**什么时候问一次 Rust、问到的东西存哪儿**。
 * 「那个矩形能不能站」在 app/perch.ts，「怎么爬上去」在运动层。
 *
 * 为什么要节流：读窗口几何不是零成本。实测（docs/research/2026-07-29-window-position-apis.md）
 * macOS 上锁定 windowID 的增量查询 0.072 ms、全量枚举 0.369 ms，Windows 三个调用
 * 合计约 0.076 ms。10 Hz 下前者可以忽略，但一只 24 小时常驻的挂件不值得在猫趴着
 * 不动的时候白烧电，尤其是电池供电时（Apple 自己在 CGWindowListCopyWindowInfo
 * 的文档里写了「generating the dictionaries is a relatively expensive operation」）。
 *
 * **睡眠与锁屏时停止**这一条不是靠定时器判断的，而是结构保证：轮询由帧循环驱动
 * （main.ts 的 frame），而 requestAnimationFrame 对隐藏/被遮挡的窗口不触发 -
 * 屏幕睡眠、锁屏、窗口被完全遮挡时帧循环自己就停了。真机上这条已经踩过一次
 * （在窗口还是 visible: false 时启动循环，回调一直排队不执行）。
 * `hidden` 那个入参是第二道保险，也让这件事在测试里可断言。
 */

/**
 * 这一层用到的全部平台能力，注入而非直接 import。
 *
 * 与 PropsPorts（app/props.ts）同一条理由：**为了可测**。读前台窗口在真机之外
 * 完全看不见，而这里的逻辑全是「什么时候该问」- 没有注入点的话，
 * 「静止时降频」「失败之后不要每帧重试」这些只能靠盯着真机的活动监视器判断。
 */
export interface ForegroundPorts {
  readonly probe: () => Promise<ForegroundWindow | null>;
}

/** 真机上那套端口。 */
export const tauriForegroundPorts: ForegroundPorts = { probe: probeForeground };

/** 猫在动（走路、正在上/下窗口、在窗口上走）时的轮询间隔。10 Hz。 */
export const FOREGROUND_POLL_ACTIVE_MS = 100;

/**
 * 猫静止时的轮询间隔。2 Hz。
 *
 * 趴着不动的猫不需要知道窗口挪了几像素 - 它反正不会跟过去。真正需要高频的只有
 * 「猫正在窗口上」（窗口一动它得跟着走）与「猫正在走动」（随时可能起跳）。
 */
export const FOREGROUND_POLL_IDLE_MS = 500;

/**
 * 连续失败之后的退避间隔。
 *
 * 失败通常是系统性的（命令名写错、平台不支持、权限被撤），每 100ms 重试一次
 * 只会刷屏并白烧 IPC。退到 5 秒一次，仍然能在环境恢复后自己回来。
 */
export const FOREGROUND_POLL_BACKOFF_MS = 5_000;

/** 连续失败这么多次之后进入退避。 */
const BACKOFF_AFTER_FAILURES = 3;

/** 这一帧该隔多久问一次。纯函数，供调用方与测试共用一份规则。 */
export function foregroundPollMs(active: boolean, failures: number): number {
  if (failures >= BACKOFF_AFTER_FAILURES) return FOREGROUND_POLL_BACKOFF_MS;
  return active ? FOREGROUND_POLL_ACTIVE_MS : FOREGROUND_POLL_IDLE_MS;
}

/** 帧循环每帧问它一次；到点了它才真的发一次 IPC。 */
export interface ForegroundPollOpts {
  /** 猫正在动或已经在窗口上。决定用高频还是低频。 */
  readonly active: boolean;
  /** 宠物窗口此刻不可见（锁屏、被完全遮挡）。此时一律不轮询。 */
  readonly hidden: boolean;
}

export class ForegroundWatcher {
  private win: ForegroundWindow | null = null;
  private lastMs: number | null = null;
  private inFlight = false;
  private failures = 0;
  private logged = 0;

  constructor(private readonly ports: ForegroundPorts = tauriForegroundPorts) {}

  /**
   * 最近一次读到的前台窗口。null = 没有可用读数。
   *
   * 刻意不做「上一次的值先凑着用」的缓存过期逻辑：读不到的失效方向应当是
   * 「猫从窗口上下来」，而不是「猫留在一个可能已经不存在的矩形上」。
   */
  get window(): ForegroundWindow | null {
    return this.win;
  }

  /**
   * 问一次（可能什么都不做）。**不等返回** - 帧循环不能等一次跨进程调用，
   * 与 setPassThrough 是同一条理由。
   */
  poll(nowMs: number, opts: ForegroundPollOpts): void {
    if (opts.hidden) {
      // 窗口不可见：丢掉读数并且不再问。锁屏期间猫在哪没人看得见，
      // 而醒来之后那个矩形很可能已经过期了 - 宁可让猫回到地面重新来。
      this.win = null;
      this.lastMs = null;
      return;
    }
    if (this.inFlight) return;
    const due = foregroundPollMs(opts.active, this.failures);
    if (this.lastMs !== null && nowMs - this.lastMs < due) return;
    this.lastMs = nowMs;
    this.inFlight = true;
    void this.ports
      .probe()
      .then((win) => {
        this.win = win;
        this.failures = 0;
      })
      .catch((err: unknown) => {
        this.win = null;
        this.failures++;
        // 只报前几次：见 FOREGROUND_POLL_BACKOFF_MS。
        if (this.logged < 3) {
          this.logged++;
          console.error('[cyber-cat] 读前台窗口失败，猫暂时不会爬窗口：', err);
        }
      })
      .finally(() => {
        this.inFlight = false;
      });
  }
}
