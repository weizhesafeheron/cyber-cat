/**
 * 世界层的全部可调数值。
 *
 * **集中在这一个文件里是硬要求**（issue #6、mvp-scope 2.3）。
 * 数值一旦散成字面量，「饱食度满→空约 16 小时」这类产品约束就再也无法从代码里
 * 读出来，也无法被测试直接断言，调优时只能靠全文搜索猜。
 *
 * 下面标了「已定档」的四项来自 docs/mvp-scope.md 2.3（2026-07-29 产品负责人确认，
 * 源自 prototype ④ 的实测设定）。定档指不再等待产品决策，不是禁止调优 -
 * 但改动它们会让 test/world/needs.test.ts 与 death-chain.test.ts 失败，那是期望行为。
 */

import type { ActionKey } from '../render/index.js';

export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;

/**
 * 模拟步长 30 分钟（prototype ④ 验证过的值）。
 *
 * 这个值同时决定了离线推演的粒度与所有「每步」速率的换算基准。
 * 改它会等比改变所有 *_PER_TICK 派生量，但不改变以小时表达的产品节奏。
 */
export const TICK_MS = 30 * MS_PER_MINUTE;
export const TICK_HOURS = TICK_MS / MS_PER_HOUR;

/**
 * 行为节拍 15 秒。**「猫在做什么」按这个粒度换，与模拟步长无关。**
 *
 * 这两件事的天然节奏差了两个数量级：饱食度掉一格是半小时的事，
 * 换个姿势是十几秒的事。最初把选动作写在模拟步里，结果猫会一动不动地
 * 趴满 30 分钟 - 真机上看就是个静止的贴图，完全读不出「它自己在生活」。
 *
 * 必须整除 TICK_MS：节拍循环同时驱动模拟步，除不尽的话步长会漂移，
 * 定档过的「最后一次喂食 → 死亡 88 小时」就不再准。由 test/world/beat.test.ts 守着。
 */
export const BEAT_MS = 15_000;
export const BEATS_PER_TICK = TICK_MS / BEAT_MS;

/** 三条需求与亲密度共用 0..100 量表。 */
export const NEED_MAX = 100;

/** 把「N 小时走完 total」换算成每个模拟步的增量。 */
const perTick = (total: number, hours: number): number => (total * TICK_HOURS) / hours;

// ---------------------------------------------------------------------------
// 饱食度 / 挨饿 / 生病 / 死亡：已定档的四项
// ---------------------------------------------------------------------------

/** 已定档：饱食度满 → 空约 16 小时（一天喂 1 到 2 次）。 */
export const HUNGER_FULL_TO_EMPTY_HOURS = 16;
export const HUNGER_DROP_PER_TICK = perTick(NEED_MAX, HUNGER_FULL_TO_EMPTY_HOURS);

/** 已定档：饱食度归零后连续挨饿 24 小时进入生病。 */
export const STARVE_TO_SICK_HOURS = 24;

/** 已定档：生病后 48 小时未喂药则死亡。 */
export const SICK_TO_DEATH_HOURS = 48;

/**
 * 已定档：最后一次喂食 → 死亡约 3.7 天。
 *
 * 这是上面三项的推论而不是独立参数：16 + 24 + 48 = 88 小时 = 3.67 天。
 * 留在这里是为了让「3.7 天」这个对外承诺在代码里有个落脚点。
 */
export const FED_TO_DEATH_HOURS =
  HUNGER_FULL_TO_EMPTY_HOURS + STARVE_TO_SICK_HOURS + SICK_TO_DEATH_HOURS;

/** 挨饿到这个小时数时在食盆边徘徊（日记里记一条）。 */
export const STARVE_NOTICE_HOURS = 6;
/** 挨饿到这个小时数时对着门口叫。 */
export const STARVE_PLEA_HOURS = 14;

/** 生病期间每隔这么久记一条日记，避免 48 小时里刷满。 */
export const SICK_DIARY_INTERVAL_HOURS = 12;
/** 生病日记的记录概率。生病本身是重要事件，过程条目则克制。 */
export const SICK_DIARY_CHANCE = 0.7;

/** 喂药治愈后的病后虚弱时长。这段经历要留下痕迹，不是一键复原。 */
export const WEAK_AFTER_CURE_HOURS = 6;
/** 病后虚弱期精力消耗的倍率。 */
export const WEAK_ENERGY_DRAIN_MULTIPLIER = 1.4;

/** 饱食度低于此值算「饿了」，有明确可视表现（在食盆边徘徊）。 */
export const HUNGRY_VISIBLE_THRESHOLD = 25;

// ---------------------------------------------------------------------------
// 进食：邀请式，不是命令式
// ---------------------------------------------------------------------------

/** 一次添粮放几份。 */
export const BOWL_PORTIONS_PER_FILL = 2;
/** 食盆容量上限。反复点食盆不该攒出无限存粮。 */
export const BOWL_MAX_PORTIONS = 3;
/** 一份猫粮补多少饱食度。 */
export const MEAL_HUNGER_GAIN = 62;

/**
 * 开吃的饱食度阈值 = 基线 + 贪吃度 × 跨度，落在 [45, 80]。
 *
 * 这是「邀请式交互」在数值上的落点：碗里有粮不等于马上吃，
 * 贪吃的猫在还不太饿时就凑过去，不贪吃的猫要等真饿了才动。
 */
export const EAT_THRESHOLD_BASE = 45;
export const EAT_THRESHOLD_GREEDY_SPAN = 35;

/** 贪吃度高于此值时，进食有概率表现为「听到倒粮声就冲过来」。 */
export const EAT_DASH_GREEDY_THRESHOLD = 0.7;
export const EAT_DASH_CHANCE = 0.4;

// ---------------------------------------------------------------------------
// 精力与作息（晨昏型节律）
// ---------------------------------------------------------------------------

/** 醒着约 16 小时耗尽精力。 */
export const ENERGY_AWAKE_TO_EMPTY_HOURS = 16;
export const ENERGY_DRAIN_PER_TICK = perTick(NEED_MAX, ENERGY_AWAKE_TO_EMPTY_HOURS);

/** 睡满约 7 小时精力回满。 */
export const ENERGY_SLEEP_TO_FULL_HOURS = 7;
export const ENERGY_RECOVER_PER_TICK = perTick(NEED_MAX, ENERGY_SLEEP_TO_FULL_HOURS);

/** 精力低于此值直接倒下睡，不看时段也不看概率。 */
export const ENERGY_EXHAUSTED = 20;
/** 精力低于此值不会自己醒 - 还没睡够。 */
export const ENERGY_CAN_WAKE = 55;

/**
 * 入睡意愿 = 节律倾向 × (基线 + 疲惫度 × 跨度)。
 *
 * **节律是主项，精力只是修正项。** 反过来（精力做主项）会让作息完全被
 * 「醒 16 小时 / 睡 7 小时」这个约 23 小时的周期支配，与 24 小时的昼夜逐日错开，
 * 分布上就看不出晨昏型了 - 这是实测走过的一条弯路。
 */
export const SLEEP_DESIRE_BASE = 0.8;
export const SLEEP_DESIRE_TIRED_SPAN = 0.6;

/**
 * 睡着时每步醒来的概率 = 上限 × (1 - 节律倾向)。
 *
 * 深夜几乎不会醒，黄昏很快就醒。不设「睡饱必醒」的硬规则：
 * 真猫在凌晨三点精力满格也照样蜷着，硬规则会让它每隔一步就起来一次。
 */
export const WAKE_CHANCE_MAX = 0.3;

/**
 * 睡眠倾向表（晨昏型节律）。
 *
 * 真实猫是 crepuscular 动物：黎明与黄昏活跃，白天大睡，深夜熟睡但偶发跑酷。
 * 这里按时段给出「这一步会去睡」的概率。
 */
export const NIGHT_END_HOUR = 6;
export const DAY_NAP_START_HOUR = 12;
export const DAY_NAP_END_HOUR = 16;
export const LATE_EVENING_START_HOUR = 22;

/** 00:00 - 06:00 深夜熟睡。 */
export const SLEEP_P_DEEP_NIGHT = 0.85;
/** 12:00 - 16:00 白天大睡的基线。 */
export const SLEEP_P_DAY_NAP_BASE = 0.4;
/** 12:00 - 16:00 由「不活跃」追加的部分：懒猫午睡更久。 */
export const SLEEP_P_DAY_NAP_LAZY_SPAN = 0.35;
/** 22:00 - 24:00 准备入夜。 */
export const SLEEP_P_LATE_EVENING = 0.5;
/** 黎明（06-12）与黄昏（16-22）的活跃时段。 */
export const SLEEP_P_CREPUSCULAR = 0.06;
/** 生病时追加的睡眠倾向（蔫、趴着不动）。 */
export const SLEEP_P_SICK_BONUS = 0.3;

// ---------------------------------------------------------------------------
// 心情
// ---------------------------------------------------------------------------

/** 心情向基线回落，不做无因的漂移。 */
export const MOOD_BASELINE = 55;
/** 亲密度对心情基线的加成上限（bond 满时 +10）。 */
export const MOOD_BOND_BONUS_AT_MAX = 10;
/** 饿到有可视表现时的心情惩罚。 */
export const MOOD_HUNGRY_PENALTY = 25;
export const MOOD_HUNGRY_THRESHOLD = 15;
export const MOOD_SICK_PENALTY = 30;
export const MOOD_WEAK_PENALTY = 10;
/** 每步向目标靠近的比例。指数趋近，不是线性。 */
export const MOOD_APPROACH_RATE = 0.12;
/** 心情高于此值算「心情好」，尾巴摆得更欢。 */
export const MOOD_HAPPY_THRESHOLD = 70;

/** 抚摸带来的即时心情增益（叠加在基线之上，逐步衰减）。 */
export const PET_GLOW_GAIN = 12;
export const GLOW_MAX = 24;
export const GLOW_DECAY_PER_TICK = 1.5;
/** 摸正在睡的猫会被甩尾巴，心情略降。 */
export const PET_ASLEEP_MOOD_PENALTY = 4;

// ---------------------------------------------------------------------------
// 亲密度
// ---------------------------------------------------------------------------

export const BOND_MAX = 100;
export const BOND_GAIN_FILL_BOWL = 1.5;
export const BOND_GAIN_PET = 0.8;
export const BOND_GAIN_MEDICATE = 2.5;

/**
 * 最后一次互动之后先给这么久的宽限，之后才开始流失。
 *
 * 有宽限期而不是无条件流失，是为了让「长期不互动才掉」成立 -
 * 无条件流失的话，正常一天来看两眼也在掉，那不叫长期。
 */
export const BOND_IDLE_GRACE_HOURS = 24;
/** 宽限期之后每步流失量（约每天 -1.92）。 */
export const BOND_DECAY_PER_TICK = 0.04;

// ---------------------------------------------------------------------------
// 活动选择：性格必须真实影响行为分布
// ---------------------------------------------------------------------------

/**
 * 醒着且健康时，这一步主要在做什么的权重。
 *
 * 权重带 ACTIVE / LAZY 跨度是 issue #6 的硬要求：性格不能只是个标签，
 * 高活跃的猫走动与扑跳明显更多，懒猫更多趴着。
 */
export const ACTIVITY_IDLE_WEIGHT = 1;
export const ACTIVITY_WALK_BASE = 0.2;
export const ACTIVITY_WALK_ACTIVE_SPAN = 1.6;
export const ACTIVITY_POUNCE_ACTIVE_SPAN = 1.4;
export const ACTIVITY_GROOM_WEIGHT = 0.7;
export const ACTIVITY_SIT_BASE = 0.6;
export const ACTIVITY_SIT_LAZY_SPAN = 0.8;
export const ACTIVITY_LIE_BASE = 0.3;
export const ACTIVITY_LIE_LAZY_SPAN = 1.5;
/** 打哈欠权重 = 跨度 × (1 - 精力/满)。困了才打。 */
export const ACTIVITY_YAWN_TIRED_SPAN = 1.2;
/** 饿了在食盆边徘徊：走与坐之间的比例，不会去做别的。 */
export const ACTIVITY_HUNGRY_WALK_CHANCE = 0.5;

/**
 * 每个动作能持续多少拍（含首尾，1 拍 = 15 秒），闭区间。
 *
 * **有这张表才不会像节拍器。** 只按固定节拍换动作的话，猫会精确地每 15 秒
 * 变一次姿势，比一动不动更假。真猫的分布是长尾的：趴下能趴好几分钟，
 * 走两步就停，打个哈欠就一下。所以每次选定动作后再随机抽一个持续时长。
 *
 * 这些区间是「读起来像不像猫」的调优旋钮，不影响任何已定档的数值。
 */
export const ACTIVITY_HOLD_BEATS: Readonly<Record<ActionKey, readonly [number, number]>> = {
  idle: [2, 6], // 30 - 90 秒
  walk: [1, 3], // 15 - 45 秒，走一小段就停
  // 打哈欠、伸懒腰、扑跳都是一次性动作（ACTIONS 里 loop: false）：只占一拍。
  // 给更多拍没有意义 - 动作三四秒就播完了，剩下的时间运动层会让猫站着。
  pounce: [1, 1],
  groom: [3, 8], // 45 秒 - 2 分钟，理毛是件耐心的事
  sit: [4, 12], // 1 - 3 分钟
  lie: [8, 24], // 2 - 6 分钟，趴着是猫最长的姿势
  yawn: [1, 1], // 一下就完
  stretch: [1, 1],
  eat: [2, 4], // 30 秒 - 1 分钟
  // 睡眠时长由模拟步的睡眠决策决定，不由这张表控制（见 advanceBeat 的持续状态分支）。
  sleep: [1, 1],
};

/** 深夜跑酷时段（22:00 - 02:00）扑跳权重的倍率。 */
export const ZOOMIES_START_HOUR = 22;
export const ZOOMIES_END_HOUR = 2;
export const ZOOMIES_POUNCE_MULTIPLIER = 2.5;
/**
 * 深夜时段里，醒着的那一步记一条跑酷的概率。
 *
 * 比日常小事的概率高得多，因为深夜醒着本身就很稀有（那几个小时它九成在睡）-
 * 用日常概率的话四十天也攒不出几条，「深夜偶发跑酷」就成了纸面设定。
 */
export const ZOOMIES_EVENT_CHANCE = 0.35;

/** 生病时动作放慢的倍率，是「蔫」的主要读数。 */
export const SICK_TIME_SCALE = 0.5;
/** 病后虚弱期动作略慢。 */
export const WEAK_TIME_SCALE = 0.8;

// ---------------------------------------------------------------------------
// 日记
// ---------------------------------------------------------------------------

/**
 * 每天最多记这么多条日常事件。重要事件既不受此限，也不消耗额度。
 *
 * 上限要留出余量，不能刚好卡在日常事件的期望条数上。
 * 额度是按时间先后消耗的，卡得太紧的后果不是「条数变少」而是
 * **一整个时段的事件永远进不了日记** - 深夜跑酷发生在一天的末尾，
 * 额度早被白天的作息条目吃光，于是它在日记里根本不存在。
 * 这条坑实测踩过。
 */
export const DIARY_MAX_PER_DAY = 10;
/** 日记保留的最大条数，超出丢最早的。存档不该无限膨胀。 */
export const DIARY_MAX_ENTRIES = 400;
/** 醒着且健康时，每步发生一件日常小事的概率。 */
export const IDLE_EVENT_CHANCE = 0.07;
/** 入睡与醒来记进日记的概率。作息转换一天有十几次，全记就刷屏了。 */
export const SLEEP_DIARY_CHANCE = 0.25;
export const WAKE_DIARY_CHANCE = 0.3;

/** 离开超过这么久，回来时头顶冒气泡提示有日记可看。 */
export const DIARY_BUBBLE_AWAY_HOURS = 2;

// ---------------------------------------------------------------------------
// 初始状态
// ---------------------------------------------------------------------------

/** 刚领养时的状态。不是满格 - 一只刚到家的猫本来就有点饿、有点累、有点戒备。 */
export const INITIAL_HUNGER = 80;
export const INITIAL_ENERGY = 70;
export const INITIAL_MOOD = 65;
export const INITIAL_BOND = 10;

/** 存档格式版本。结构变更时递增，旧存档由调用方决定是迁移还是丢弃。 */
export const WORLD_VERSION = 2;
