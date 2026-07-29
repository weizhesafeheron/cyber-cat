import type { ActionKey, Cat, WorldActionKey } from '../render/index.js';
import { clamp } from '../render/rng.js';
import { companionDays, localDayIndex, localHourOfDay } from './clock.js';
import {
  ACTIVITY_GROOM_WEIGHT,
  ACTIVITY_HOLD_BEATS,
  ACTIVITY_HUNGRY_WALK_CHANCE,
  ACTIVITY_IDLE_WEIGHT,
  ACTIVITY_LIE_BASE,
  ACTIVITY_LIE_LAZY_SPAN,
  ACTIVITY_POUNCE_CHANCE_ACTIVE_SPAN,
  ACTIVITY_SIT_BASE,
  ACTIVITY_SIT_LAZY_SPAN,
  ACTIVITY_WALK_ACTIVE_SPAN,
  ACTIVITY_WALK_BASE,
  ACTIVITY_YAWN_CHANCE_TIRED_SPAN,
  BOND_DECAY_PER_TICK,
  BOND_GAIN_FILL_BOWL,
  BOND_GAIN_MEDICATE,
  BOND_GAIN_PET,
  BOND_IDLE_GRACE_HOURS,
  BOND_MAX,
  BOWL_MAX_PORTIONS,
  BOWL_PORTIONS_PER_FILL,
  DAY_NAP_END_HOUR,
  DAY_NAP_START_HOUR,
  DIARY_MAX_ENTRIES,
  DIARY_MAX_PER_DAY,
  EAT_DASH_CHANCE,
  EAT_DASH_GREEDY_THRESHOLD,
  EAT_THRESHOLD_BASE,
  EAT_THRESHOLD_GREEDY_SPAN,
  ENERGY_CAN_WAKE,
  ENERGY_DRAIN_PER_TICK,
  ENERGY_EXHAUSTED,
  ENERGY_RECOVER_PER_TICK,
  GLOW_DECAY_PER_TICK,
  GLOW_MAX,
  HUNGER_DROP_PER_TICK,
  HUNGER_SLEEP_DAMP,
  HUNGER_WAKES_THRESHOLD,
  HUNGER_WAKE_CHANCE,
  HUNGRY_VISIBLE_THRESHOLD,
  IDLE_EVENT_CHANCE,
  LATE_EVENING_START_HOUR,
  MEAL_HUNGER_GAIN,
  MOOD_APPROACH_RATE,
  MOOD_BASELINE,
  MOOD_BOND_BONUS_AT_MAX,
  MOOD_HUNGRY_PENALTY,
  MOOD_HUNGRY_THRESHOLD,
  MOOD_SICK_PENALTY,
  MOOD_WEAK_PENALTY,
  MS_PER_HOUR,
  NEED_MAX,
  NIGHT_END_HOUR,
  DROP_MOOD_PENALTY,
  PET_ASLEEP_MOOD_PENALTY,
  PICK_UP_MOOD_PENALTY,
  PET_GLOW_GAIN,
  SICK_DIARY_CHANCE,
  SICK_DIARY_INTERVAL_HOURS,
  SICK_TO_DEATH_HOURS,
  SLEEP_DESIRE_BASE,
  SLEEP_DESIRE_TIRED_SPAN,
  SLEEP_DIARY_CHANCE,
  SLEEP_P_CREPUSCULAR,
  SLEEP_P_DAY_NAP_BASE,
  SLEEP_P_DAY_NAP_LAZY_SPAN,
  SLEEP_P_DEEP_NIGHT,
  SLEEP_P_LATE_EVENING,
  SLEEP_P_SICK_BONUS,
  STARVE_NOTICE_HOURS,
  STARVE_PLEA_HOURS,
  STARVE_TO_SICK_HOURS,
  TICK_HOURS,
  WAKE_CHANCE_MAX,
  WAKE_DIARY_CHANCE,
  WEAK_AFTER_CURE_HOURS,
  WEAK_ENERGY_DRAIN_MULTIPLIER,
  ZOOMIES_END_HOUR,
  ZOOMIES_EVENT_CHANCE,
  ZOOMIES_POUNCE_MULTIPLIER,
  ZOOMIES_START_HOUR,
} from './constants.js';
import { draw } from './rng.js';
import type { UserAction, World, WorldEvent, WorldEventKind } from './types.js';

/**
 * 一个模拟步（30 分钟）的全部状态演化，以及用户动作的结算。
 *
 * **这里是唯一改变世界的地方，且只被 step 调用。**
 * 离线补算与实时运行走的是同一个函数 - 不存在「离线版模拟器」（ADR 0001）。
 *
 * 不变量（写测试时依赖它们，改代码时不要破坏）：
 * - 所有状态变化都发生在整个模拟步内，没有任何按 elapsedMs 连续插值的量。
 *   一旦有，一次 24 小时补算就不再等于 48 次 30 分钟步进。
 * - `dead = true` 只在 sick 分支里赋值，因此生病是死亡的必经前置状态。
 * - 猫死后世界不再变化。
 */

/** 取一个随机数并推进 world 的随机状态。 */
function roll(w: World): number {
  const d = draw(w.rngState);
  w.rngState = d.state;
  return d.value;
}

/**
 * 从**行为节拍那条流**取一个随机数。选动作与它的持续时长只用这个。
 *
 * 见 World.activityRngState 的注释：两条流分开，行为怎么调都不会动到
 * 已定档的死亡链与日记密度。混用会让这条保证当场失效。
 */
function rollActivity(w: World): number {
  const d = draw(w.activityRngState);
  w.activityRngState = d.state;
  return d.value;
}

interface RecordOpts {
  /** 重要事件不受每日条数上限约束。生病与死亡属于此类。 */
  important?: boolean;
  /** 记录概率。默认必然记录。 */
  chance?: number;
  data?: Readonly<Record<string, number>>;
}

/**
 * 发一条事件，但不写进日记。
 *
 * 用户自己的动作走这条路。**猫咪日记是猫的日记**（CONTEXT.md），
 * 记的是它自己做了什么；「你点了食盆」用户本来就知道，写进去只会占掉当天的
 * 额度，把猫真正做过的事挤出去。事件本身仍然要发出来 - 应用层要用它做即时反馈。
 */
function emit(
  w: World,
  events: WorldEvent[],
  kind: WorldEventKind,
  data?: Readonly<Record<string, number>>,
): void {
  events.push(data ? { kind, at: w.clock, important: false, data } : { kind, at: w.clock, important: false });
}

/**
 * 记一条猫自己的事件。同时进入本步的 events 与存档里的日记。
 *
 * 被上限挡掉的事件**根本不产生** - 不存在「发生了但没记」的日常事件，
 * 那会让 events 与日记不一致，日记就不再是事件的忠实投影。
 */
function record(
  w: World,
  events: WorldEvent[],
  kind: WorldEventKind,
  opts: RecordOpts = {},
): void {
  const important = opts.important ?? false;
  const day = localDayIndex(w.clock, w.tzOffsetMinutes);
  if (day !== w.diaryDay) {
    w.diaryDay = day;
    w.diaryCount = 0;
  }
  if (!important && w.diaryCount >= DIARY_MAX_PER_DAY) return;
  if (opts.chance != null && roll(w) >= opts.chance) return;

  const event: WorldEvent = opts.data
    ? { kind, at: w.clock, important, data: opts.data }
    : { kind, at: w.clock, important };
  events.push(event);
  // 只有日常事件消耗当天的额度。重要事件既然不受上限约束，就不该反过来把
  // 额度吃掉 - 否则「生病的那天」会顺手让当天剩下的日常记录全部消失。
  if (!important) w.diaryCount++;
  w.diary.push(event);
  if (w.diary.length > DIARY_MAX_ENTRIES) w.diary.shift();
}

/**
 * 晨昏型睡眠倾向。返回这一步会去睡的概率。
 *
 * 黎明（06-12）与黄昏（16-22）活跃，白天（12-16）大睡，深夜（00-06）熟睡。
 * 懒猫的午睡更长 - 这是活跃度对作息的影响，不只是对动作的影响。
 */
export function sleepPressure(hour: number, active: number): number {
  if (hour < NIGHT_END_HOUR) return SLEEP_P_DEEP_NIGHT;
  if (hour >= DAY_NAP_START_HOUR && hour < DAY_NAP_END_HOUR) {
    return SLEEP_P_DAY_NAP_BASE + (1 - active) * SLEEP_P_DAY_NAP_LAZY_SPAN;
  }
  if (hour >= LATE_EVENING_START_HOUR) return SLEEP_P_LATE_EVENING;
  return SLEEP_P_CREPUSCULAR;
}

/**
 * 开吃的饱食度阈值。
 *
 * 贪吃的猫在还不太饿时就凑过去，不贪吃的猫要等真饿了才动 -
 * 这是「添粮后不必然立即进食」在数值上的落点。
 */
export function eatThreshold(cat: Cat): number {
  return EAT_THRESHOLD_BASE + cat.personality.greedy * EAT_THRESHOLD_GREEDY_SPAN;
}

function isZoomiesHour(hour: number): boolean {
  return hour >= ZOOMIES_START_HOUR || hour < ZOOMIES_END_HOUR;
}

/** 落在 [x, x + 一步) 里，用于「刚好跨过某个小时数」的判定。 */
function justCrossed(hours: number, threshold: number): boolean {
  return hours >= threshold && hours < threshold + TICK_HOURS;
}

interface Weighted {
  key: WorldActionKey;
  weight: number;
}

function pickWeighted(items: readonly Weighted[], r: number): WorldActionKey {
  let total = 0;
  for (const it of items) total += it.weight;
  if (total <= 0) return items[0]!.key;
  let acc = r * total;
  for (const it of items) {
    acc -= it.weight;
    if (acc < 0) return it.key;
  }
  return items[items.length - 1]!.key;
}

/**
 * 结算一个用户动作。
 *
 * 全部是邀请：只改环境（食盆）或发出信号（抚摸），**绝不直接改饱食度**。
 * 直接改就退回成命令式了 - 猫会变成一个即时响应的按钮。
 */
export function applyAction(
  w: World,
  action: UserAction,
  events: WorldEvent[],
): void {
  // 死亡不可逆：任何输入都不再改变世界。
  if (w.dead) return;

  switch (action.type) {
    case 'fillBowl': {
      w.bowl = Math.min(BOWL_MAX_PORTIONS, w.bowl + BOWL_PORTIONS_PER_FILL);
      w.bond = Math.min(BOND_MAX, w.bond + BOND_GAIN_FILL_BOWL);
      w.stats.feedCount++;
      w.lastInteractionAt = w.clock;
      emit(w, events, 'fedByOwner');
      return;
    }
    case 'pet': {
      w.lastInteractionAt = w.clock;
      if (w.sleeping) {
        // 摸正在睡的猫会被甩尾巴。它有自己的边界。
        w.needs.mood = Math.max(0, w.needs.mood - PET_ASLEEP_MOOD_PENALTY);
        emit(w, events, 'petRefused');
        return;
      }
      w.playGlow = Math.min(GLOW_MAX, w.playGlow + PET_GLOW_GAIN);
      w.bond = Math.min(BOND_MAX, w.bond + BOND_GAIN_PET);
      w.stats.petCount++;
      emit(w, events, 'petted');
      return;
    }
    case 'pickUp': {
      w.lastInteractionAt = w.clock;
      // 被拎起来必然醒。这是唯一一条**不经概率**的醒来路径 - 作息决定的醒来在
      // decideSleep 里按节律抽签，而被端离地面不是概率问题。
      w.sleeping = false;
      w.needs.mood = Math.max(0, w.needs.mood - PICK_UP_MOOD_PENALTY);
      emit(w, events, 'pickedUp');
      return;
    }
    case 'drop': {
      w.lastInteractionAt = w.clock;
      w.needs.mood = Math.max(0, w.needs.mood - DROP_MOOD_PENALTY);
      // 落地之后蹭回来还是走开，是逐帧的事，归运动层（它按 clingy 分化）。
      // 世界层只发这一声，不记录「反应是哪种」- 记了就等于把帧层的决定搬进存档。
      emit(w, events, 'dropped');
      return;
    }
    case 'medicate': {
      // 喂药入口只在生病时出现，因此没病时是无操作而非「预防性用药」。
      if (!w.sick) return;
      w.sick = false;
      w.sickHours = 0;
      w.starveHours = 0;
      w.weakHours = WEAK_AFTER_CURE_HOURS;
      w.bond = Math.min(BOND_MAX, w.bond + BOND_GAIN_MEDICATE);
      w.lastInteractionAt = w.clock;
      emit(w, events, 'medicated');
      // 「病好了」是猫身上发生的事，进日记；「你喂了药」是用户的动作，不进。
      record(w, events, 'cured', { important: true });
      return;
    }
  }
}

/** 睡眠决策。返回这一步是否刚醒来（决定要不要伸懒腰）。 */
function decideSleep(w: World, cat: Cat, hour: number): { justWoke: boolean } {
  const pressure = clamp(
    sleepPressure(hour, cat.personality.active) + (w.sick ? SLEEP_P_SICK_BONUS : 0),
    0,
    1,
  );

  // 饿到一定程度，饿压过节律：睡不安稳，睡着了也会被饿醒。
  // 见 HUNGER_WAKES_THRESHOLD 的注释 - 少了这条，饿着的猫会睡满整夜、
  // 碗里的粮一口不动，一路饿到生病。
  const starving = w.needs.hunger < HUNGER_WAKES_THRESHOLD;

  if (!w.sleeping) {
    // 累垮了就地睡，不看时段也不看概率。**饿也拦不住这条** -
    // 饿与累同时到极限时，猫是会倒下的。
    if (w.needs.energy < ENERGY_EXHAUSTED) {
      w.sleeping = true;
      return { justWoke: false };
    }
    const tired = 1 - w.needs.energy / NEED_MAX;
    let desire = pressure * (SLEEP_DESIRE_BASE + tired * SLEEP_DESIRE_TIRED_SPAN);
    if (starving) desire *= HUNGER_SLEEP_DAMP;
    if (roll(w) < desire) w.sleeping = true;
    return { justWoke: false };
  }

  // 饿醒。不看时段 - 深夜的节律拦不住饿。
  // 但要求精力高于累垮线，否则会在「饿醒 → 累倒 → 又被饿醒」之间来回抖。
  if (starving && w.needs.energy > ENERGY_EXHAUSTED && roll(w) < HUNGER_WAKE_CHANCE) {
    w.sleeping = false;
    return { justWoke: true };
  }

  // 没睡够不会自己醒；睡够了也要看时段 - 深夜的节律会把它按住继续睡。
  if (w.needs.energy > ENERGY_CAN_WAKE && roll(w) < WAKE_CHANCE_MAX * (1 - pressure)) {
    w.sleeping = false;
    return { justWoke: true };
  }
  return { justWoke: false };
}

/** advanceTick 交给行为节拍去落地的「这一刻该做什么」。没有则为 null。 */
export interface TickUrge {
  urge: WorldActionKey | null;
}

/**
 * 推进一个模拟步。
 *
 * 调用方负责把 w.clock 推到这一步的**结束时刻**再调它 - 事件的时间戳取 w.clock。
 *
 * 返回值里的 urge 要原样传给同一拍的 advanceBeat，见那里的注释。
 */
export function advanceTick(w: World, cat: Cat, events: WorldEvent[]): TickUrge {
  const hour = localHourOfDay(w.clock, w.tzOffsetMinutes);
  const wasSleeping = w.sleeping;
  const wasWeak = w.weakHours > 0;

  const { justWoke } = decideSleep(w, cat, hour);
  if (!wasSleeping && w.sleeping) {
    const atNight = hour >= LATE_EVENING_START_HOUR || hour < NIGHT_END_HOUR;
    record(w, events, atNight ? 'sleptAtNight' : 'napped', { chance: SLEEP_DIARY_CHANCE });
  } else if (justWoke) {
    record(w, events, 'woke', { chance: WAKE_DIARY_CHANCE });
  }

  // --- 需求演化 ---
  if (w.sleeping) {
    w.needs.energy = Math.min(NEED_MAX, w.needs.energy + ENERGY_RECOVER_PER_TICK);
  } else {
    const drain = ENERGY_DRAIN_PER_TICK * (wasWeak ? WEAK_ENERGY_DRAIN_MULTIPLIER : 1);
    w.needs.energy = Math.max(0, w.needs.energy - drain);
  }
  const hungerBefore = w.needs.hunger;
  w.needs.hunger = Math.max(0, w.needs.hunger - HUNGER_DROP_PER_TICK);

  // --- 进食：碗里有粮 + 醒着 + 够饿 ---
  let ateThisTick = false;
  if (!w.sleeping && w.bowl > 0 && w.needs.hunger < eatThreshold(cat)) {
    w.bowl--;
    w.needs.hunger = Math.min(NEED_MAX, w.needs.hunger + MEAL_HUNGER_GAIN);
    w.starveHours = 0;
    ateThisTick = true;
    const dashed =
      cat.personality.greedy > EAT_DASH_GREEDY_THRESHOLD && roll(w) < EAT_DASH_CHANCE;
    record(w, events, dashed ? 'ateGreedy' : 'ate');
  }

  // --- 心情：向基线趋近，不做无因漂移 ---
  const target =
    MOOD_BASELINE +
    (w.bond / BOND_MAX) * MOOD_BOND_BONUS_AT_MAX -
    (w.needs.hunger < MOOD_HUNGRY_THRESHOLD ? MOOD_HUNGRY_PENALTY : 0) -
    (w.sick ? MOOD_SICK_PENALTY : 0) -
    (wasWeak ? MOOD_WEAK_PENALTY : 0) +
    w.playGlow;
  w.needs.mood = clamp(w.needs.mood + (target - w.needs.mood) * MOOD_APPROACH_RATE, 0, NEED_MAX);
  w.playGlow = Math.max(0, w.playGlow - GLOW_DECAY_PER_TICK);

  // --- 亲密度：宽限期之后才流失 ---
  const idleHours = (w.clock - w.lastInteractionAt) / MS_PER_HOUR;
  if (idleHours > BOND_IDLE_GRACE_HOURS) {
    w.bond = Math.max(0, w.bond - BOND_DECAY_PER_TICK);
  }

  // --- 挨饿 → 生病 → 死亡 ---
  let justFellSick = false;
  if (w.needs.hunger <= 0) {
    // 归零的那一步只是「开始挨饿」，本身不计入挨饿时长。
    // 计进去的话链上每个接点都会提前半小时，「最后一次喂食 → 死亡」
    // 就从定档的 88 小时缩成 87 小时。
    if (hungerBefore > 0) w.starveHours = 0;
    else w.starveHours += TICK_HOURS;

    if (justCrossed(w.starveHours, STARVE_NOTICE_HOURS)) {
      record(w, events, 'hungry', { important: true });
    }
    if (justCrossed(w.starveHours, STARVE_PLEA_HOURS)) {
      record(w, events, 'starving', { important: true });
    }
    if (!w.sick && w.starveHours >= STARVE_TO_SICK_HOURS) {
      w.sick = true;
      w.sickHours = 0;
      w.weakHours = 0;
      justFellSick = true;
      record(w, events, 'fellSick', { important: true });
    }
  } else if (!w.sick) {
    w.starveHours = 0;
  }

  if (w.sick) {
    // 同上：进入生病的那一步不计入病程。
    if (!justFellSick) w.sickHours += TICK_HOURS;
    if (w.sickHours > 0 && w.sickHours % SICK_DIARY_INTERVAL_HOURS < TICK_HOURS) {
      record(w, events, 'sickLingers', { chance: SICK_DIARY_CHANCE });
    }
    // **死亡只在这里发生。** 因此不存在跳过生病直接死亡的路径 -
    // 这条不变量由 test/world/death-chain.test.ts 用穷举输入序列守着。
    if (w.sickHours >= SICK_TO_DEATH_HOURS) {
      w.dead = true;
      w.diedAt = w.clock;
      w.sleeping = false;
      w.activity = 'lie';
      w.activityBeatsLeft = 0;
      record(w, events, 'died', {
        important: true,
        data: { days: companionDays(w, w.clock) },
      });
      return { urge: null };
    }
  }

  // --- 病后虚弱倒计时 ---
  if (w.weakHours > 0) {
    w.weakHours = Math.max(0, w.weakHours - TICK_HOURS);
    if (w.weakHours === 0) record(w, events, 'recoveredFromWeakness');
  }

  // --- 日常小事 ---
  if (!w.sleeping && !w.sick) {
    if (isZoomiesHour(hour)) {
      // 深夜醒着的猫基本没在干别的。
      if (roll(w) < ZOOMIES_EVENT_CHANCE) record(w, events, 'zoomies');
    } else if (roll(w) < IDLE_EVENT_CHANCE) {
      const pool: WorldEventKind[] = ['gazedOutWindow', 'groomed', 'scratched'];
      record(w, events, pool[Math.floor(roll(w) * pool.length)]!);
    }
  }

  // 刚吃完、刚醒来这两件事发生在「这一刻」，不进节拍的权重抽签 -
  // 醒来先伸个懒腰是真猫的固定动作，不该交给概率。
  // 但也不在这里直接改 activity：那样这一拍的持续时长会被 advanceBeat 当场
  // 减掉一拍，持续时长只有一拍的动作（打哈欠）根本来不及显示。
  // 交给 advanceBeat 落地，「持续 N 拍」在任何入口下都是同一个意思。
  if (ateThisTick) return { urge: 'eat' };
  if (justWoke) return { urge: 'stretch' };
  return { urge: null };
}

/**
 * 推进一个行为节拍（15 秒）：该换动作了就换，没到期就把持续时长减一。
 *
 * **和 advanceTick 分开是这一层存在的全部理由。** 需求半小时才有变化，
 * 姿势十几秒就该变；合在一起的话猫会一动不动地趴满 30 分钟（见 BEAT_MS 注释）。
 *
 * 这里只读世界状态、只写 activity 与它的持续计数，不碰任何需求量 -
 * 所以节拍的频率与持续时长区间都可以随便调，离线推演的等价性不受影响。
 *
 * `urge` 是同一拍里刚发生的事要求的动作（刚吃完、刚醒来），优先于抽签，
 * 但仍然让位于生病与睡眠这两个持续状态。
 */
export function advanceBeat(w: World, cat: Cat, urge: WorldActionKey | null = null): void {
  // 生病与睡眠是持续状态，压过一切正在进行的动作。
  // 持续计数清零，是为了让状态一结束（醒过来、病好了）下一拍立刻重选 -
  // 不清的话猫会醒着却继续播睡觉的姿势。
  const state: ActionKey | null = w.sick ? 'lie' : w.sleeping ? 'sleep' : null;
  if (state !== null) {
    w.activity = state;
    w.activityBeatsLeft = 0;
    return;
  }

  if (urge !== null) {
    setActivity(w, urge);
    return;
  }

  if (w.activityBeatsLeft > 0) {
    w.activityBeatsLeft -= 1;
    return;
  }

  const hour = localHourOfDay(w.clock, w.tzOffsetMinutes);
  setActivity(w, chooseActivity(w, cat, hour));
}

/**
 * 把姿势的「时间占比」换算成「这一次抽签的权重」。
 *
 * **只用于姿势，不用于一次性动作。** 一次性动作的权重本来就是发生概率，
 * 它们的时长由动作自己决定，除以时长没有意义 - 而且它们的时长只有一拍，
 * 除下来会变成权重最大的一项（实测半小时扑跳 41 次）。
 *
 * **常量表里的权重是时间占比，不是抽签概率。** 定档时每个模拟步只做一个动作，
 * 每个动作占的时长相同，两者恰好等价；加了持续时长之后就不等价了 -
 * 抽签决定的是「下一段做什么」，而趴下一段是 8 到 24 拍，走路一段只有 1 到 3 拍。
 * 直接拿时间占比去抽签，趴着的时长会被放大八倍。
 *
 * 这不是推理出来的，是真机上看出来的：改成节拍之后猫几乎只在站和趴之间切换，
 * 实测 120 拍里只有 4 拍在走路。除以平均持续时长之后时间占比才回到定档的样子。
 */
function perSegment(action: WorldActionKey, timeShare: number): number {
  const [min, max] = ACTIVITY_HOLD_BEATS[action];
  return (timeShare * 2) / (min + max);
}

/** 换动作，并按 ACTIVITY_HOLD_BEATS 抽一个持续时长。 */
function setActivity(w: World, action: WorldActionKey): void {
  const [min, max] = ACTIVITY_HOLD_BEATS[action];
  const beats = min + Math.floor(rollActivity(w) * (max - min + 1));
  w.activity = action;
  // 减一：本拍就算第一拍，所以剩余拍数比总时长少一。
  w.activityBeatsLeft = beats - 1;
}

/**
 * 猫此刻主要在做什么。renderIntent 的动作就是它。
 *
 * 性格在这里必须真实起作用（issue #6）：活跃度高的猫走动与扑跳明显更多，
 * 懒猫更多趴着。深夜给扑跳额外加权，这就是「深夜偶发跑酷」。
 */
function chooseActivity(w: World, cat: Cat, hour: number): WorldActionKey {
  // 饿了在食盆边徘徊：只在走与坐之间选，不会去跑酷。
  if (w.needs.hunger < HUNGRY_VISIBLE_THRESHOLD) {
    return rollActivity(w) < ACTIVITY_HUNGRY_WALK_CHANCE ? 'walk' : 'sit';
  }

  const active = cat.personality.active;
  const lazy = 1 - active;
  const tired = 1 - w.needs.energy / NEED_MAX;
  const pounce =
    active *
    ACTIVITY_POUNCE_CHANCE_ACTIVE_SPAN *
    (isZoomiesHour(hour) ? ZOOMIES_POUNCE_MULTIPLIER : 1);

  // 姿势过 perSegment（常量给的是时间占比），一次性动作不过（常量就是发生概率）。
  return pickWeighted(
    [
      { key: 'idle', weight: perSegment('idle', ACTIVITY_IDLE_WEIGHT) },
      {
        key: 'walk',
        weight: perSegment('walk', ACTIVITY_WALK_BASE + active * ACTIVITY_WALK_ACTIVE_SPAN),
      },
      { key: 'pounce', weight: pounce },
      { key: 'groom', weight: perSegment('groom', ACTIVITY_GROOM_WEIGHT) },
      {
        key: 'sit',
        weight: perSegment('sit', ACTIVITY_SIT_BASE + lazy * ACTIVITY_SIT_LAZY_SPAN),
      },
      {
        key: 'lie',
        weight: perSegment('lie', ACTIVITY_LIE_BASE + lazy * ACTIVITY_LIE_LAZY_SPAN),
      },
      { key: 'yawn', weight: tired * ACTIVITY_YAWN_CHANCE_TIRED_SPAN },
    ],
    rollActivity(w),
  );
}
