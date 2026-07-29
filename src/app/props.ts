import {
  PROP_EVENT_CLICKED,
  PROP_EVENT_DRAG,
  PROP_EVENT_DROP,
  PROP_EVENT_MOVED,
  PROP_EVENT_READY,
  PROP_EVENT_SYNC,
  PROP_KINDS,
  anchorScreenX,
  clampPropsState,
  defaultPropsState,
  dragResult,
  settleDrag,
  groundedPropsState,
  propWindowLabel,
  samePlacement,
  samePropsState,
  withPlacement,
} from '../props/index.js';
import type {
  PropDragPayload,
  PropKind,
  PropMovedPayload,
  PropPlacement,
  PropsState,
  ScreenRect,
} from '../props/index.js';
import { emitToWindow, listenEvent, placeProp, pushPropMenu } from './ipc.js';
import { groundScreenY, reachableX } from './motion.js';
import type { StageGeometry } from './motion.js';
import { loadProps, saveProps } from './persist.js';

/**
 * 宠物窗口这一侧的挂件管理。
 *
 * 职责边界：这个文件是平台胶水 - 摆放状态的持有者、窗口移动的下发者、
 * 与两个挂件窗口之间的事件转接。**所有几何算术都在 src/props/layout.ts**（纯函数、
 * 有测试），这里只负责「什么时候算、算完给谁」。
 *
 * 两条不变量：
 * - **世界状态只有宠物窗口持有。** 点食盆在挂件窗口里只产生一个事件，添粮仍然作为
 *   一次 `UserAction` 走进同一个 `step`（与托盘菜单同理）。挂件窗口不知道饱食度，
 *   也不该知道。
 * - **摆放不进世界存档。** 屏幕坐标进 World 会让世界层不再平台无关（ADR 0001）。
 */

/** 拖动之后延迟这么久才写盘。用户连着挪几下不该写几次文件。 */
const PERSIST_DEBOUNCE_MS = 1000;

/**
 * 这一层用到的全部平台能力，注入而非直接 import。
 *
 * 不是为了「可替换实现」- 只有一个实现。是为了**可测**：这里的逻辑全是
 * 「什么时候该给窗口下发什么」，而下发本身跨进程，真机之外看不见。
 * 曾经因为这一层没有测试，一个「首次摆放时把另一个挂件误标成已下发」的 bug
 * 一路溜到真机，症状是猫窝永远不出现，而且没有任何报错。
 */
export interface PropsPorts {
  readonly loadProps: () => Promise<PropsState | null>;
  readonly saveProps: (state: PropsState) => Promise<void>;
  readonly placeProp: (kind: PropKind, x: number, y: number, visible: boolean) => Promise<void>;
  readonly pushPropMenu: (bowlVisible: boolean, bedVisible: boolean) => Promise<void>;
  readonly emitToWindow: (label: string, name: string, payload: unknown) => Promise<void>;
  readonly listenEvent: <T>(name: string, handler: (payload: T) => void) => Promise<void>;
}

/** 真机上的那套端口。 */
export const tauriPropsPorts: PropsPorts = {
  loadProps,
  saveProps,
  placeProp,
  pushPropMenu,
  emitToWindow,
  listenEvent,
};

export class PropsHost {
  private state: PropsState;
  /**
   * 上一次真的下发给窗口的摆放，**按挂件分别记**。用来跳过没有变化的窗口移动
   * （那是一次跨进程操作）。
   *
   * 只记「确实下发过的那些」，不能拿一整份 PropsState 去兜底：
   * 曾经写成 `applied = { ...(applied ?? state), [kind]: p }`，第一次摆放时
   * `applied` 是空的、于是拿 `state` 兜底 - 而 `state` 里本来就有另一个挂件的
   * 正确摆放，这一句等于宣布它也已经下发过了。症状是**猫窝永远不显示**：
   * 摆食盆时顺手把猫窝标记成已下发，轮到猫窝就被去重跳过，窗口一直停在
   * Tauri 给的默认位置且 visible 仍是 false。
   */
  private applied: Partial<Record<PropKind, PropPlacement>> = {};
  private portions = 0;
  /** 有一次窗口移动在飞。见 pump()。 */
  private flushing = false;
  /** 在飞的那次落地之后还欠一次下发。见 pump()。 */
  private dirty = false;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * 摆放存档读完了没有。
   *
   * 读完之前一律不接受挂件报上来的新位置：那时挂件还停在 Tauri 给的默认位置
   * （屏幕正中），把它当成用户的摆放会连带触发一次写盘，正好把还没读完的
   * 那份存档覆盖掉。这条竞态在真机上表现为「每次重启食盆都回到屏幕中间」。
   */
  private booted = false;

  /**
   * 构造时就要有一份摆放，不能等读盘。
   *
   * 读盘是异步的，而帧循环从第一帧起就要问「食盆在哪」；给不出答案的那几帧
   * 猫会先按「没有锚点」漫游，之后突然被拽向食盆。先摆默认位置、读到存档再覆盖，
   * 中间那一下最多是挂件位置变一次，猫的行为是连续的。
   */
  /** 最近一次知道的工作区与精灵缩放。拖拽的钳制要用它们，而拖拽事件里不带几何。 */
  private work: ScreenRect;
  private spriteScale: number;

  constructor(
    geom: StageGeometry,
    private readonly ports: PropsPorts = tauriPropsPorts,
  ) {
    this.work = geom.work;
    this.spriteScale = geom.spriteScale;
    this.state = defaultPropsState(geom.work, groundScreenY(geom), geom.spriteScale);
  }

  get placements(): PropsState {
    return this.state;
  }

  /**
   * 读摆放存档、摆好两个挂件窗口、并把托盘的勾选状态对齐。
   *
   * 要重新传一次工作区与几何：构造时那份是「还没问过 Rust」的兜底值
   * （宠物窗口自己的客户区），真正的桌面尺寸只有 bootStage 之后才知道。
   * 首次启动时默认摆放必须按真实桌面算，否则两个挂件会挤在窗口那 648 像素里。
   *
   * 读到的摆放要**钳进工作区**：上次可能是在外接屏上摆的，这次只有笔记本屏，
   * 不钳的话挂件在屏幕外，用户既看不见也拖不回来。
   */
  async boot(geom: StageGeometry): Promise<void> {
    this.work = geom.work;
    this.spriteScale = geom.spriteScale;
    const saved = await this.ports.loadProps();
    // 读到的摆放要先把 y 拉回地面线再钳进工作区：**y 是派生量**，存档里存的
    // 只是上一次算出来的值，而地面线会随工作区变化（换屏、程序坞显隐）。
    this.state = saved
      ? clampPropsState(
          groundedPropsState(saved, groundScreenY(geom), geom.spriteScale),
          geom.work,
        )
      : defaultPropsState(geom.work, groundScreenY(geom), geom.spriteScale);
    await this.apply();
    for (const kind of PROP_KINDS) await this.sync(kind);
    await this.ports.pushPropMenu(this.state.bowl.visible, this.state.bed.visible);
    this.booted = true;
  }

  /**
   * 接上三条来自挂件窗口的事件。
   *
   * `onFeed` 收到的是「用户点了食盆」这个**邀请**，不是「猫吃了」 -
   * 调用方要把它变成一次 `fillBowl` 的 UserAction。
   */
  listen(onFeed: () => void): void {
    // 挂件窗口起来了：把摆放与碗里的份数补发给它。挂件窗口会重试到收到回音为止，
    // 所以这里不需要关心两个 webview 谁先加载完。
    void this.ports.listenEvent<PropKind>(PROP_EVENT_READY, (kind) => {
      // **读档之前一个都不摆。** 那时 this.state 还是构造函数那份兜底值，
      // 它把「宠物窗口自己的客户区」当成了桌面（648×240），照它摆出去的挂件会
      // 落在屏幕上方一个既没有地面也没有猫的位置。
      //
      // 正常启动时 boot() 几毫秒后就纠正了，看不出来；**但领养流程会停在那里等
      // 用户挑猫**，于是那个错位置持续整个领养过程 - 真机上就是这么撞见的。
      // 更根本的是：领养还没完成时压根不该有挂件，那时还没有猫。
      //
      // 不需要在这里补发：boot() 自己会把两件都摆一遍（apply）。
      if (!this.booted) return;
      void this.applyOne(kind, true);
      void this.sync(kind);
    });
    void this.ports.listenEvent<PropKind>(PROP_EVENT_CLICKED, (kind) => {
      if (kind === 'bowl') onFeed();
    });
    // 拖拽：挂件只报「我想去这个 x」，其余判断在这边做 -
    // 只有这里知道另一件挂件在哪。
    void this.ports.listenEvent<PropDragPayload>(PROP_EVENT_DRAG, (p) => {
      if (!this.booted) return; // 与 onMoved 同一条理由：读档完成前不接受位置
      this.state = dragResult(p.kind, p.x, this.state, this.work, this.spriteScale);
      this.pump();
    });
    // 松手：把间隔补上。拖动过程中是允许重合的（跟手优先），静止时不允许。
    void this.ports.listenEvent<PropKind>(PROP_EVENT_DROP, (kind) => {
      if (!this.booted) return;
      this.state = settleDrag(kind, this.state, this.work, this.spriteScale);
      this.pump();
      this.schedulePersist();
    });
    void this.ports.listenEvent<PropMovedPayload>(PROP_EVENT_MOVED, (p) => {
      if (!this.booted) return; // 见 booted 的注释：读档完成前不接受位置
      // 用户拖过的位置**不再钳回工作区**：他把食盆摆在哪儿是他的决定
      // （ADR 0004 的「布置领地」），当场纠回去只会让人觉得窗口在跟自己抢。
      // **只采纳 x。** 纵向由地面线决定，系统把窗口挪到哪一行都不算用户的意思。
      const next = withPlacement(this.state, p.kind, { x: p.x });
      if (samePropsState(next, this.state)) return;
      this.state = next;
      // 位置是挂件窗口自己报上来的，窗口已经在那儿了，不要再下发一次移动 -
      // 那会和操作系统的拖拽循环打架。
      this.applied = next;
      this.schedulePersist();
    });
  }

  /** 切换某个挂件的显示。托盘菜单的两个勾选项走这条。 */
  async toggle(kind: PropKind): Promise<void> {
    this.state = withPlacement(this.state, kind, { visible: !this.state[kind].visible });
    await this.applyOne(kind, false);
    await this.sync(kind);
    await this.ports.pushPropMenu(this.state.bowl.visible, this.state.bed.visible);
    this.schedulePersist();
  }

  /** 碗里的份数变了就推给食盆窗口。份数没变时什么都不做 - 每帧发一次是纯浪费。 */
  onBowlPortions(portions: number): void {
    if (portions === this.portions) return;
    this.portions = portions;
    void this.sync('bowl');
  }

  /**
   * 工作区变了（程序坞显隐、改分辨率、插拔显示器）时把挂件拉回屏幕内。
   *
   * 只在真的越界时才动，所以不会覆盖用户的摆放 - 与 onMoved 那条不钳的理由一致：
   * 能看见能拖到的位置一律尊重用户，只有「已经拿不回来了」才出手。
   */
  reclamp(geom: StageGeometry): void {
    this.work = geom.work;
    this.spriteScale = geom.spriteScale;
    // 工作区变了地面线也变了，纵向要跟着回到新的地面线上。
    const next = clampPropsState(
      groundedPropsState(this.state, groundScreenY(geom), geom.spriteScale),
      geom.work,
    );
    if (samePropsState(next, this.state)) return;
    this.state = next;
    void this.apply();
    this.schedulePersist();
  }

  /**
   * 世界层说猫想去某个挂件时，运动层该把它送到的屏幕 x。
   *
   * `catX` 决定从哪一侧靠近食盆（近侧），所以要传当前位置进来。
   * 返回 null 有两种情况：世界层没有空间诉求，或者那个挂件被藏起来了。
   */
  anchorX(anchor: PropKind | null, catX: number, geom: StageGeometry): number | null {
    if (anchor === null) return null;
    return anchorScreenX(anchor, this.state, catX, reachableX(geom), geom.spriteScale);
  }

  private async apply(): Promise<void> {
    // 并行下发。串行等两次跨进程窗口移动，在拖动这种每帧都来的场景下会积压，
    // 表现为挂件跟手发涩。
    await Promise.all(PROP_KINDS.map((kind) => this.applyOne(kind, false)));
  }

  /**
   * 把当前摆放推给窗口，**同一时刻最多只有一次在飞**。
   *
   * 拖动每一次 pointermove 都会到这里，而一次窗口移动是跨进程的。不做合并的话
   * 事件会排队，挂件跟着光标一路追赶、松手之后还在动。做法是：有在飞的就只记一笔
   * 「还欠一次」，等它落地再用**当时最新的**状态补发 - 中间那些位置本来就不需要
   * 画出来，用户看到的只有最新那一个。
   */
  private pump(): void {
    if (this.flushing) {
      this.dirty = true;
      return;
    }
    this.flushing = true;
    void this.apply()
      .catch(() => undefined)
      .finally(() => {
        this.flushing = false;
        if (this.dirty) {
          this.dirty = false;
          this.pump();
        }
      });
  }

  /** 下发一个挂件的位置与可见性。`force` 用于挂件窗口重启后的补发。 */
  private async applyOne(kind: PropKind, force: boolean): Promise<void> {
    const p = this.state[kind];
    const prev = this.applied[kind];
    if (!force && prev !== undefined && samePlacement(prev, p)) return;
    this.applied = { ...this.applied, [kind]: p };
    await this.ports.placeProp(kind, p.x, p.y, p.visible).catch((err: unknown) => {
      // 摆不上去的后果是挂件留在默认位置或者不显示，猫的锚点仍然按我们记的位置算，
      // 于是可能出现「猫走到一个空地方吃饭」。可见地报出来，不要静默。
      console.error(`[cyber-cat] 摆放挂件 ${kind} 失败：`, err);
    });
  }

  /**
   * 把视图状态推给某个挂件窗口。
   *
   * 猫窝用不到份数，但也要收到这条 - 它是挂件窗口「宠物窗口听见我了」的唯一回音
   * （见 prop-main.ts 的 announce），少了它猫窝会一直重试报到。
   */
  private async sync(kind: PropKind): Promise<void> {
    await this.ports.emitToWindow(propWindowLabel(kind), PROP_EVENT_SYNC, {
      portions: this.portions,
      visible: this.state[kind].visible,
    });
  }

  private schedulePersist(): void {
    if (this.persistTimer != null) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.ports.saveProps(this.state);
    }, PERSIST_DEBOUNCE_MS);
  }
}
