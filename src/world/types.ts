/**
 * 世界层的公开类型。
 *
 * 平台无关、可序列化。这一层只依赖渲染层的**词汇**（动作键与姿态形状），
 * 不依赖渲染层的实现 - renderIntent 要能被渲染层直接消费，就必须说同一种话。
 */
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
  /** 不满一个模拟步长的时间余额，毫秒。 */
  carryMs: number;

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

  /** 这一步猫主要在做什么。renderIntent 的动作就是它的投影。 */
  activity: ActionKey;

  /** 随机源状态。见 world/rng.ts。 */
  rngState: number;

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
}

export interface StepResult {
  world: World;
  /** 这一步内发生的事件，按时间顺序。 */
  events: readonly WorldEvent[];
  renderIntent: RenderIntent;
}
