/**
 * 世界层的公开类型。
 *
 * 平台无关、可序列化。这一层只依赖渲染层与挂件层的**词汇**（动作键、姿态形状、
 * 挂件种类），不依赖它们的实现 - renderIntent 要能被那两层直接消费，
 * 就必须说同一种话。
 *
 * 特别是：挂件的词汇只有种类名（`'bowl' | 'bed'`），**没有任何屏幕坐标**。
 * 世界层说「它想去食盆」，由挂件层查出食盆在哪、运动层把猫送过去。
 * 坐标一旦进到这一层，同一份存档在不同分辨率的机器上就会演化出不同的猫，
 * 离线推演的可回放性当场失效（ADR 0001）。
 */
import type { PropKind } from '../props/types.js';
import type { ActionKey, MicroOpts } from '../render/index.js';
import type { BreedKey, Pose } from '../render/types.js';

/**
 * 猫的身份。
 *
 * 「品种 + Seed + 出生时间 + 名字」四元组唯一确定一只猫，外观与性格都能由它
 * 完整重建（makeCat）。因此存档里不存任何外观或性格的派生值 -
 * 存了就有两份真相，迟早不一致。
 */
export interface CatIdentity {
  breed: BreedKey;
  seed: number;
  /** epoch ms。由平台层注入，世界层不读时钟。 */
  bornAt: number;
  name: string;
}

/** 三条需求，量表 0..100。 */
export interface Needs {
  /** 饱食度。持续下降，进食恢复。 */
  hunger: number;
  /** 精力。醒着下降，睡觉恢复。玩家不直接控制。 */
  energy: number;
  /** 心情。向基线回落，抚摸拉升。 */
  mood: number;
}

/** 陪伴记录。告别页要用。 */
export interface WorldStats {
  /** 添粮次数。 */
  feedCount: number;
  /** 抚摸成功次数（摸到睡着的猫不算）。 */
  petCount: number;
}

/**
 * 猫的总体状态。托盘图标与状态气泡的唯一依据 -
 * 「不打开任何界面就知道猫大致怎么样了」靠的是这一个枚举。
 */
export type CatStatus = 'ok' | 'sleeping' | 'hungry' | 'starving' | 'sick' | 'dead';

/**
 * 叙事事件。日记文案由它渲染，因此这里只放**结构化数据**，不放文案 -
 * 文案要按性格与语气变化，存进存档就锁死了。
 */
export type WorldEventKind =
  | 'adopted'
  | 'woke'
  | 'sleptAtNight'
  | 'napped'
  | 'ate'
  | 'ateGreedy'
  | 'fedByOwner'
  | 'petted'
  | 'petRefused'
  | 'gazedOutWindow'
  | 'groomed'
  | 'scratched'
  | 'zoomies'
  | 'hungry'
  | 'starving'
  | 'fellSick'
  | 'sickLingers'
  | 'medicated'
  | 'cured'
  | 'recoveredFromWeakness'
  | 'died';

export interface WorldEvent {
  kind: WorldEventKind;
  /** 事件发生的世界时刻，epoch ms。 */
  at: number;
  /**
   * 重要事件。不受每日日记条数上限约束，必然出现在日记里。
   * 生病与死亡属于此类 - 用户不该因为当天日记满了就错过它。
   */
  important: boolean;
  /** 文案填空用的数值，如陪伴天数。 */
  data?: Readonly<Record<string, number>>;
}

/**
 * 完整的世界状态。**必须整体可 JSON 往返**（issue #6 验收项）。
 *
 * 所以这里只有基本类型、数组与纯数据对象 - 没有闭包、没有 Map、没有 Date、
 * 没有渲染层对象。随机源也摊成了 rngState（见 world/rng.ts）。
 */
export interface World {
  /** 存档格式版本。 */
  version: number;
  identity: CatIdentity;

  /**
   * 世界已推进到的时刻，epoch ms。**只按整个模拟步长前进。**
   *
   * 真正的「现在」是 clock + carryMs，见 worldNow()。把不满一步的余额单独
   * 存起来，是为了让任意切分的 elapsedMs 累计后与一次性大跨步完全等价 -
   * 这是离线推演等价性（ADR 0001）的算术基础。
   */
  clock: number;
  /** 不满一个行为节拍的时间余额，毫秒。 */
  carryMs: number;
  /**
   * 本模拟步内已走过的行为节拍数，0..BEATS_PER_TICK-1。
   *
   * 时间由节拍（15 秒）驱动，模拟步（30 分钟）靠数够节拍数来触发，所以这个
   * 计数器必须进存档：不然重启会把「已经走了 29 分钟」这件事忘掉，
   * 需求演化的相位每次启动都被重置，离线推演也不再可回放。
   */
  beatsInTick: number;

  /**
   * 本地时区偏移，分钟（东八区 = 480）。
   *
   * 作息节律要的是本地小时，而纯函数不能读系统时区 - 读了的话同一份存档在
   * 不同机器上会演化出不同的作息，测试也会随运行环境飘。
   */
  tzOffsetMinutes: number;

  needs: Needs;
  /** 亲密度 0..100。所有互动长期累积，长期不互动缓慢流失。 */
  bond: number;

  /** 食盆里剩余的份数。添粮只改这个，吃不吃由猫决定。 */
  bowl: number;
  sleeping: boolean;

  /** 饱食度归零后的连续挨饿小时数。 */
  starveHours: number;
  sick: boolean;
  /** 已生病小时数。 */
  sickHours: number;
  /** 病后虚弱剩余小时数。 */
  weakHours: number;
  dead: boolean;
  /** 死亡时刻，epoch ms。未死为 null。 */
  diedAt: number | null;

  /** 抚摸带来的心情增益，逐步衰减。 */
  playGlow: number;
  /** 最后一次互动时刻。亲密度的宽限期由它算。 */
  lastInteractionAt: number;

  /** 猫此刻主要在做什么。renderIntent 的动作就是它的投影。 */
  activity: ActionKey;
  /** 当前动作还能持续几拍。归零时下一拍重新选。 */
  activityBeatsLeft: number;

  /** 随机源状态。见 world/rng.ts。 */
  rngState: number;
  /**
   * 行为节拍专用的随机源状态。
   *
   * **和 rngState 分开是刻意的。** 选动作每 15 秒取一次数，需求与日记每 30 分钟
   * 取一次；共用一条流的话，任何对行为节拍的调整（改节拍长度、改持续时长区间）
   * 都会改变需求侧的取数序列，把已定档的死亡链与日记密度一起搅动。
   * 分成两条流之后，行为怎么调都不会碰到那些数值。
   */
  activityRngState: number;

  /** 日记条数节流用的本地日序号。 */
  diaryDay: number;
  /** 当天已记条数。 */
  diaryCount: number;
  /** 日记条目。就是事件本身，文案在呈现时渲染。 */
  diary: WorldEvent[];

  stats: WorldStats;
}

/** 用户动作。全部是邀请：只改环境或发出信号，猫保有决定权。 */
export type UserAction =
  /** 添粮。往食盆里放粮，不直接改饱食度。 */
  | { readonly type: 'fillBowl' }
  /** 抚摸。醒着蹭手心，睡着甩尾巴。 */
  | { readonly type: 'pet' }
  /** 喂药。仅生病时有效。 */
  | { readonly type: 'medicate' };

/**
 * 自上次 step 以来的输入。
 *
 * 时钟不在这里 - 时间以 elapsedMs 的形式单独传入，这样「离线补算」与
 * 「实时逐 tick」只是同一个参数取不同大小，不需要两条代码路径。
 *
 * 光标轨迹与前台窗口矩形属于 ticket 06（自主行为与逗猫），届时扩到这里。
 */
export interface WorldInputs {
  /** 按发生顺序。结算在时间推进之前 - 动作发生在「现在」。 */
  readonly actions?: readonly UserAction[];
}

/**
 * 「现在应该画什么」。渲染层与应用层的唯一接口。
 *
 * 它是 world 的纯投影，没有自己的状态 - 因此离线补算完成后拿到的 intent
 * 与一路实时跑到同一个 world 拿到的 intent 必然相同。
 */
export interface RenderIntent {
  /**
   * 该画哪个动作，渲染层 ACTIONS 的键。
   * null 表示猫已死亡，不该画猫（告别页是 ticket 12 的事）。
   */
  action: ActionKey | null;
  /** 总体状态。托盘图标与气泡用。 */
  status: CatStatus;
  /** 动作局部时间的倍率。生病放慢是「蔫」的主要读数。 */
  timeScale: number;
  /**
   * 叠加在动作产出的 Pose 之上的覆盖，表达**状态**而不是动作。
   * 调用方按 `{ ...ACTIONS[k].make(...), ...intent.pose }` 合并。
   */
  pose: Pose;
  /** 微动作开关。睡着与生病时关掉歪头。 */
  micro: MicroOpts;
  /**
   * 猫此刻想待在哪个挂件跟前。null = 没有空间诉求，随便在哪都行。
   *
   * **这是「进食/睡觉是空间行为」这件事的跨层契约**（ADR 0004 + 0007）。
   * 世界层保留「吃不吃、睡不睡」的全部权威，但它不知道任何屏幕坐标；
   * 运动层负责在世界层说要吃的时候，让猫人在食盆那儿。
   *
   * 为什么是**投影**而不是 World 里的字段：它完全由 world 推导得出，存进去就有
   * 两份真相；而且投影不参与随机序列，加它不会动到任何已定档的数值。
   */
  anchor: PropKind | null;
}

export interface StepResult {
  world: World;
  /** 这一步内发生的事件，按时间顺序。 */
  events: readonly WorldEvent[];
  renderIntent: RenderIntent;
}
