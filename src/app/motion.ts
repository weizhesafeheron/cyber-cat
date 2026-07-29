import { ACTIONS, W } from '../render/index.js';
import type { ActionKey, Cat, MicroOpts, Pose } from '../render/index.js';
import { clamp } from '../render/rng.js';
import { GROUND_FROM_BOTTOM } from './stage.js';

/**
 * 运动层（[ADR 0007](../../docs/adr/0007-stage-window-and-motion-layer.md)）。
 *
 * 分工：**世界层决定猫想干什么，运动层负责把它送到那里。**
 * 世界层给的是 30 分钟粒度的意图（`renderIntent.action`），而「走过去」是逐帧的事 -
 * 位置、朝向、抵达判定、爪印都需要帧时钟。
 *
 * 不变量（改代码时不要破坏）：
 * - **运动层绝不写世界层。** 这个文件里没有任何 `World` 的引用，输入只有
 *   `ActionKey`（intent 的投影）与 `Cat`（由品种+Seed 重建），编译期就断掉了
 *   回写的通路。任何从帧循环回写状态的路径都会破坏离线等价性 - 补算时没有帧，
 *   那条路径不存在，两边就会算出不同结果。
 * - **状态不进存档。** 重启后猫出现在一个合理位置即可，没人记得它昨晚站在哪。
 * - 纯函数：dt、时间戳、随机源全部注入，因此不需要 DOM 也能测（test/app/motion.test.ts）。
 *
 * 三个坐标系，混用是这一层最容易出的错，所以字段名都带单位含义：
 * - **屏幕逻辑坐标**（CSS 像素，桌面左上角为原点）：`MotionState.x`、`stage`、爪印。
 * - **舞台内坐标**（CSS 像素，舞台客户区左上角为原点）：只在要画东西时换算出来。
 * - **精灵像素**（72×56 缓冲）：所有美术尺度的常量都以它为单位，乘 `spriteScale` 换算。
 */

/** 屏幕逻辑坐标上的一点。 */
export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

/** 一个矩形，屏幕逻辑坐标。 */
export interface ScreenRect extends ScreenPoint {
  readonly w: number;
  readonly h: number;
}

/**
 * 舞台的当前几何。由平台层每帧提供 - 它会随 dpr、系统缩放、工作区变化，
 * 缓存下来迟早会与真实窗口不一致。
 */
export interface StageGeometry {
  /** 舞台客户区尺寸，CSS 像素。 */
  readonly w: number;
  readonly h: number;
  /** 一个精灵像素当前占多少 CSS 像素。由 display.ts 的取整规则决定，不是常量。 */
  readonly spriteScale: number;
  /** 桌面可用区（避开程序坞/任务栏），CSS 像素。猫的活动范围由它决定。 */
  readonly work: ScreenRect;
}

/**
 * 一枚爪印。**按屏幕坐标记录**，每帧换算成舞台内坐标再画。
 *
 * 记屏幕坐标是必须的：舞台滚动时爪印要留在原地。若按舞台内坐标记，
 * 窗口一挪爪印就会整体跟着飘，看起来像猫拖着一串脚印在走。
 */
export interface PawPrint {
  readonly x: number;
  /** 落下时的地面线屏幕 y。 */
  readonly y: number;
  /** 落下时刻，毫秒。 */
  readonly at: number;
  /** 近侧/远侧脚。决定纵向错开一点，形成双排足迹。 */
  readonly side: 1 | -1;
}

/** 运动层的全部状态。可整体拷贝，但**不要存档**。 */
export interface MotionState {
  /** 猫锚点的屏幕 x。锚点是精灵的横向中心。 */
  readonly x: number;
  /** 朝向。1 = 朝右。 */
  readonly dir: 1 | -1;
  /** 当前的移动目标，屏幕 x；null = 没有目标（原地动作，或刚抵达）。 */
  readonly targetX: number | null;
  /** 抵达后就地歇着的剩余秒数。 */
  readonly restS: number;
  /** 这一帧真正该播的动作。null = 猫已离开，什么都不画。 */
  readonly playing: ActionKey | null;
  /**
   * 正在播的一次性动作与它已播的秒数。null = 当前不是一次性动作。
   *
   * 世界层给一个动作分配的时长是十几秒起，而打个哈欠只要三秒、扑一下四秒 -
   * 播完之后接什么需要帧时钟，和「走完一段路就地歇一会」是同一类判断，
   * 因此归运动层（ADR 0007）。
   */
  readonly shot: { readonly action: ActionKey; readonly t: number } | null;
  /**
   * 舞台客户区原点。画布偏移与爪印换算都按它算。
   *
   * 决定滚动的那一帧就在这里改掉，不等窗口真的挪到位 - 猫的屏幕位置是
   * 「舞台原点 + 舞台内位置」，两项必须同时改，否则中间那段时间猫会先跳出去
   * 再跳回来。窗口没跟上的风险只有一帧，而分两步改是**必然**看到一次跳动。
   * 万一移动失败，平台层会在下一次读几何时把这里纠回来（settleStage）。
   */
  readonly stage: ScreenPoint;
  readonly paws: readonly PawPrint[];
  /** 距离下一枚爪印还剩多少 CSS 像素的路程。 */
  readonly strideLeft: number;
  readonly pawSide: 1 | -1;
}

/** 一帧的输入。 */
export interface MotionInput {
  /** 帧时长，秒。 */
  readonly dt: number;
  /** 当前时刻，毫秒。只用于爪印寿命。 */
  readonly now: number;
  /** 世界层的意图动作。**只读** - 运动层不回写世界。 */
  readonly action: ActionKey | null;
  /** 这只猫。只读性格与体型。 */
  readonly cat: Cat;
  readonly geom: StageGeometry;
  /** 随机源。注入而非内置，测试才能拿到确定的行走序列。 */
  readonly rnd: () => number;
}

/**
 * 走路速度的性格倍率，归一化到 active = 0.5。
 *
 * 与动作库里的步频（`2.2 + active * 0.8`）成正比，因此不同性格的猫**步幅相同**：
 * 只改速度不改步频（或反之）会立刻看出滑步。这两个数是那个公式除以 2.6 的结果，
 * 没有直接 import 是因为步频属于动作定义的内部细节。
 */
const SPEED_BASE = 0.85;
const SPEED_ACTIVE_SPAN = 0.31;

/** 一段路的长度，精灵像素。活跃的猫一次走得更远。 */
const LEG_MIN_SPRITE = 40;
const LEG_ACTIVE_SPAN_SPRITE = 120;

/**
 * 抵达判定的容差，CSS 像素。
 *
 * 只用来吸收浮点误差，不是「差不多就算到了」：容差给大一点看起来是省事，
 * 实际是每段路的最后会瞬移那么多像素。真正的收尾靠「最后一帧只走到目标为止」。
 */
const ARRIVE_EPS = 1e-6;

/** 抵达后的休息时长，秒。懒猫歇得久，这是性格影响行为频率的落点。 */
const REST_MIN_S = 0.7;
const REST_LAZY_SPAN_S = 4.2;

/** 每走这么多精灵像素落一枚爪印。按路程而不是按时间 - 否则走得快的猫脚印会变密。 */
const PAW_STRIDE_SPRITE = 7;

/** 爪印寿命，毫秒。「几秒淡去」的落点。 */
export const PAW_LIFE_MS = 3500;

/** 寿命的前这一段不淡，之后线性淡到透明。一上来就开始淡会显得爪印从没实过。 */
const PAW_HOLD = 0.3;

/**
 * 同时存在的爪印上限。
 *
 * 正常走路只会有十来枚（3.5 秒寿命 / 每 21 CSS 像素一枚），这个上限是兜底：
 * 帧时长异常大时一帧可能落好几枚，不设上限就会在卡顿后堆出一长串。
 */
const PAW_MAX = 64;

/**
 * 舞台滚动的触发边距，占舞台宽度的比例。
 *
 * 猫走进任意一侧这个范围内就把舞台整体挪一次。0.25 的下限来自可见性钳制：
 * 猫不能走出舞台，而半个精灵宽在 3 倍精灵宽的舞台里占 1/6，触发必须先于钳制发生。
 */
export const SCROLL_EDGE = 0.25;

/**
 * 挪完之后猫落在舞台里的位置，从**行进方向的后方**边缘算起的比例。
 *
 * 0.35 的取法：身后 0.35 × 648 ≈ 227 CSS 像素留给爪印（约 3.4 秒的路程，
 * 接近爪印寿命），身前剩下的路够走 3 到 4 秒才需要再挪一次。
 * 挪得太勤是跨进程操作的浪费，挪完位置太靠后则爪印会一落地就被裁掉。
 */
export const SCROLL_REST = 0.35;

/** 舞台下沿贴着工作区下沿；这个函数给出对应的舞台原点 y。 */
function stageYFor(geom: StageGeometry): number {
  return geom.work.y + geom.work.h - geom.h;
}

/**
 * 猫脚下地面线的屏幕 y。
 *
 * 舞台永远贴着工作区下沿、猫永远贴着舞台下沿，所以地面线只由工作区与缩放决定，
 * 与舞台此刻挪到哪里无关 - 爪印的 y 用它算才不会因为一次滚动而错位。
 */
export function groundScreenY(geom: StageGeometry): number {
  return geom.work.y + geom.work.h - GROUND_FROM_BOTTOM * geom.spriteScale;
}

/** 舞台原点被工作区钳住的范围。屏幕比舞台还窄时贴左。 */
function clampStage(p: ScreenPoint, geom: StageGeometry): ScreenPoint {
  const maxX = geom.work.x + Math.max(0, geom.work.w - geom.w);
  return { x: clamp(p.x, geom.work.x, maxX), y: p.y };
}

/**
 * 猫这一帧可以走到的屏幕 x 范围。
 *
 * 两重约束的交集：桌面工作区（不走出屏幕），以及当前的舞台（不走出画布被裁掉
 * 半只猫）。后者是失效方向的兜底 - 窗口挪不动、平台层把舞台原点纠回旧值之后，
 * 猫会在这个舞台里来回走，仍然可见、可点，而不是走出去消失。
 */
function roamBounds(state: MotionState, geom: StageGeometry): { min: number; max: number } {
  const half = (W * geom.spriteScale) / 2;
  const min = Math.max(geom.work.x + half, state.stage.x + half);
  const max = Math.min(geom.work.x + geom.work.w - half, state.stage.x + geom.w - half);
  // 交集为空只可能出现在舞台被拖到工作区之外的时候，取中点保证后续算术有定义。
  if (max < min) {
    const mid = (min + max) / 2;
    return { min: mid, max: mid };
  }
  return { min, max };
}

/** 初始状态：猫站在舞台正中，朝右，舞台就在平台层报告的位置上。 */
export function createMotion(geom: StageGeometry, stageAt: ScreenPoint): MotionState {
  return {
    x: stageAt.x + geom.w / 2,
    dir: 1,
    targetX: null,
    restS: 0,
    playing: null,
    shot: null,
    stage: stageAt,
    paws: [],
    strideLeft: PAW_STRIDE_SPRITE * geom.spriteScale,
    pawSide: 1,
  };
}

/**
 * 这只猫的走路速度，CSS 像素每秒。
 *
 * 导出是给领养窗口用的（src/adopt/arrival.ts）：那边的猫也要走进画面，
 * 而「速度与步频必须成正比」这条约束只能有一处实现 - 抄第二份的话，
 * 两个窗口里同一只猫会一个走得实、一个滑步。
 */
export function walkSpeedFor(cat: Cat, spriteScale: number): number {
  // 基准取动作库给的 travel：腿的相位是照着它调的，换成别的值就成了滑步。
  const base = ACTIONS.walk.travel ?? 22;
  return base * spriteScale * (SPEED_BASE + cat.personality.active * SPEED_ACTIVE_SPAN);
}

function walkSpeed(cat: Cat, geom: StageGeometry): number {
  return walkSpeedFor(cat, geom.spriteScale);
}

function restAfterLeg(active: number, rnd: () => number): number {
  return (REST_MIN_S + (1 - active) * REST_LAZY_SPAN_S) * (0.6 + rnd() * 0.8);
}

/** 挑下一段路的终点。撞墙就反向 - 直接钳到墙上会让猫贴着屏幕边缘蹭。 */
function pickTarget(
  x: number,
  active: number,
  bounds: { min: number; max: number },
  geom: StageGeometry,
  rnd: () => number,
): number {
  const reach =
    (LEG_MIN_SPRITE + active * LEG_ACTIVE_SPAN_SPRITE) * geom.spriteScale * (0.4 + rnd() * 0.6);
  const pick = rnd() < 0.5 ? -1 : 1;
  const ahead = x + pick * reach;
  const t = ahead < bounds.min || ahead > bounds.max ? x - pick * reach : ahead;
  return clamp(t, bounds.min, bounds.max);
}

/** 淘汰过期爪印。没有变化时返回原数组，避免每帧产生新引用。 */
function prune(paws: readonly PawPrint[], now: number): readonly PawPrint[] {
  const alive = paws.filter((p) => now - p.at < PAW_LIFE_MS);
  if (alive.length === paws.length) return paws;
  return alive.length > PAW_MAX ? alive.slice(alive.length - PAW_MAX) : alive;
}

/**
 * 这一帧舞台该在哪。位置没变时**返回原来那个对象**，调用方靠引用相等判断要不要
 * 下发窗口移动 - 每帧下发一次跨进程的窗口移动正是 ADR 0007 里带滞后要避免的。
 *
 * 滞后来自触发线与落点的距离：猫走进两侧各 25% 的边缘区才挪，挪完落在
 * 行进方向后方 35% 处。落点离两条触发线都还有一段路，所以不会连续触发。
 */
function nextStage(
  stage: ScreenPoint,
  geom: StageGeometry,
  x: number,
  dir: 1 | -1,
): ScreenPoint {
  const y = stageYFor(geom);
  const local = x - stage.x;
  const near = geom.w * SCROLL_EDGE;
  // 猫在舞台中部：横向不动。y 仍然跟着工作区走（程序坞显隐会改它）。
  const inMiddle = local >= near && local <= geom.w - near;
  // 挪的话把猫放在行进方向的后 35% 处：身后留爪印的空间，身前留下一段路。
  const behind = dir > 0 ? geom.w * SCROLL_REST : geom.w * (1 - SCROLL_REST);
  const want = clampStage({ x: inMiddle ? stage.x : x - behind, y }, geom);
  return want.x === stage.x && want.y === stage.y ? stage : want;
}

/**
 * 推进一帧。纯函数，返回新状态，不改动入参。
 *
 * 世界层说「走路」时，这里负责挑目标、逐帧推进、抵达后**交还控制**
 * （不再推位置，改播站立呼吸并歇一会，等世界层下一个整步改主意）。
 * 其余动作原样放行 - 它们的位移都在动作自己的 pose 里。
 */
export function stepMotion(state: MotionState, input: MotionInput): MotionState {
  const { dt, now, cat, geom, rnd } = input;

  if (input.action === null) {
    // 猫已离开。位置不再推进，爪印自然淡完（告别页是 ticket 12 的事）。
    return {
      ...state,
      playing: null,
      targetX: null,
      restS: 0,
      shot: null,
      paws: prune(state.paws, now),
    };
  }

  const active = cat.personality.active;
  const bounds = roamBounds(state, geom);
  let x = clamp(state.x, bounds.min, bounds.max);
  let dir = state.dir;
  let targetX = state.targetX;
  let restS = state.restS;
  let strideLeft = state.strideLeft;
  let pawSide = state.pawSide;
  let paws = state.paws;
  let playing: ActionKey = input.action;
  let shot = state.shot;

  // 一次性动作：播一遍就完，之后站着等世界层改主意。
  const def = ACTIONS[input.action];
  if (!def.loop) {
    const wasT = shot?.action === input.action ? shot.t : null;
    const t = wasT === null ? 0 : wasT + Math.max(0, dt);
    shot = { action: input.action, t };
    const done = t >= (def.period ?? 0);
    playing = done ? 'idle' : input.action;

    // 跳跃的位移记在真实位置上，不在姿态的 dx 里 - 见 ACTIONS 的 leap 注释。
    // 只推进落在腾空窗口内的那部分 dt，所以帧率高低不影响跳的距离。
    if (def.leap !== undefined && wasT !== null) {
      const { startS, endS, px } = def.leap;
      const from = Math.max(wasT, startS);
      const to = Math.min(t, endS);
      if (to > from && endS > startS) {
        const advance = dir * px * ((to - from) / (endS - startS)) * geom.spriteScale;
        x = clamp(x + advance, bounds.min, bounds.max);
      }
    }
  } else {
    shot = null;
  }

  if (input.action !== 'walk') {
    targetX = null;
    restS = 0;
  } else if (restS > 0) {
    // 一段路走完就地歇一会。半小时里一直走或一直站着都读起来像循环播放。
    restS = Math.max(0, restS - dt);
    playing = 'idle';
  } else {
    if (targetX == null) targetX = pickTarget(x, active, bounds, geom, rnd);
    const delta = targetX - x;
    if (delta !== 0) dir = delta > 0 ? 1 : -1;
    playing = 'walk';

    // dt = 0 时什么都不判定。启动路径上会用 dt = 0 推一帧来把 playing 算出来，
    // 那一帧不该顺手把「已经到了」这个结论也做掉。
    const stepLen = walkSpeed(cat, geom) * Math.max(0, dt);
    if (stepLen > 0) {
      // 最后一帧只走到目标为止，不冲过去再拉回来 - 那会是一次肉眼可见的抽动。
      const next = clamp(x + dir * Math.min(stepLen, Math.abs(delta)), bounds.min, bounds.max);
      const moved = Math.abs(next - x);
      x = next;

      if (moved > 0) {
        strideLeft -= moved;
        const y = groundScreenY(geom);
        const stride = PAW_STRIDE_SPRITE * geom.spriteScale;
        const dropped: PawPrint[] = [];
        // 上限保护：dt 异常大时一帧可能跨过好几个步距。
        while (strideLeft <= 0 && dropped.length < 8) {
          strideLeft += stride;
          pawSide = pawSide === 1 ? -1 : 1;
          dropped.push({ x, y, at: now, side: pawSide });
        }
        if (dropped.length > 0) paws = [...paws, ...dropped];
      }

      // 到了、或者走不动了（被工作区/舞台钳住）都把控制交还回去：
      // 位置不再推进，改播站立呼吸并歇一会，等世界层下一个整步改主意。
      if (moved <= 0 || Math.abs(targetX - x) <= ARRIVE_EPS) {
        targetX = null;
        restS = restAfterLeg(active, rnd);
        playing = 'idle';
      }
    }
  }

  paws = prune(paws, now);
  const stage = nextStage(state.stage, geom, x, dir);

  return { ...state, x, dir, targetX, restS, playing, shot, stage, paws, strideLeft, pawSide };
}

/**
 * 平台层校正：舞台窗口实际在这里。
 *
 * 用来兜住「下发了移动但没生效」的情况 - 那时运动层以为舞台在新位置，
 * 画布偏移会整体偏掉。平台层定期读真实窗口位置，用这个函数把它纠回来。
 * 猫的屏幕位置不变，改的只是它落在舞台里的哪个位置。
 */
export function settleStage(state: MotionState, at: ScreenPoint): MotionState {
  if (at.x === state.stage.x && at.y === state.stage.y) return state;
  return { ...state, stage: at };
}

/** 猫锚点在舞台内的 x（CSS 像素）。画布就按它定位。 */
export function catInStage(state: MotionState): number {
  return state.x - state.stage.x;
}

/** 爪印当前的不透明度。 */
export function pawAlpha(paw: PawPrint, now: number): number {
  const k = (now - paw.at) / PAW_LIFE_MS;
  if (k <= PAW_HOLD) return 1;
  return clamp(1 - (k - PAW_HOLD) / (1 - PAW_HOLD), 0, 1);
}

/** 换算到舞台内坐标、带当前不透明度的爪印。 */
export interface StagePaw {
  /** 舞台内 CSS 坐标。 */
  readonly x: number;
  readonly y: number;
  readonly alpha: number;
  readonly side: 1 | -1;
}

/**
 * 把爪印换算成舞台内坐标。
 *
 * 落在舞台外的会被画布裁掉，这是 ADR 0007 接受的代价 - 它们在猫身后、
 * 只活几秒，而舞台有三个精灵宽。
 */
export function pawsInStage(state: MotionState, now: number): readonly StagePaw[] {
  return state.paws.map((p) => ({
    x: p.x - state.stage.x,
    y: p.y - state.stage.y,
    alpha: pawAlpha(p, now),
    side: p.side,
  }));
}

/**
 * 五个微动作的总开关。
 *
 * prototype ② 里可以逐个关掉对比，微动作层是「活着的感觉」的主要来源。
 * 开关放在这里而不是烧进动作定义 - 后者会让每个动作都要自己判断一遍，
 * 加第六个微动作就得改十处。
 */
export interface MicroSwitches {
  readonly blink: boolean;
  readonly ear: boolean;
  readonly tilt: boolean;
  readonly tail: boolean;
  readonly breath: boolean;
}

export const ALL_MICRO_ON: MicroSwitches = {
  blink: true,
  ear: true,
  tilt: true,
  tail: true,
  breath: true,
};

/**
 * 眨眼 / 耳抖 / 歪头三个微动作有自己的时序状态，交给渲染层的微动作层执行。
 *
 * 与世界层的意图**求交**：意图关掉的（睡着的猫不歪头、生病的猫不歪头）
 * 不该被总开关重新打开 - 那是状态表达，不是微动作偏好。
 */
export function microOptsFor(sw: MicroSwitches, intent: MicroOpts): MicroOpts {
  return {
    blink: sw.blink && intent.blink !== false,
    ear: sw.ear && intent.ear !== false,
    tilt: sw.tilt && intent.tilt === true,
  };
}

/**
 * 尾巴摆动与呼吸起伏这两个微动作是**姿态量**：呼吸周期与尾巴幅度因动作而异
 * （睡觉 4.6 秒、趴下 3.8 秒），所以它们写在各自的动作定义里是对的。
 * 这里在动作产出之后统一压掉，于是五个微动作都能独立开关，
 * 而动作定义里不需要出现任何开关判断。
 */
export function applyMicroSwitches(pose: Pose, sw: MicroSwitches): Pose {
  if (sw.tail && sw.breath) return pose;
  const out: Pose = { ...pose };
  if (!sw.tail) {
    out.tailWave = 0;
    out.tailPhase = 0;
  }
  if (!sw.breath) out.breath = 0;
  return out;
}

/**
 * 让姿态朝向 dir。
 *
 * 渲染层只替 `headDX` 乘了 dir，`dx` / `legOx` / `pupilDX` 是「朝前」的量但不会
 * 被自动翻转 - 不处理的话扑跳朝左时会变成「面朝左、身体往右扑」。
 */
export function faceDir(pose: Pose, dir: 1 | -1): Pose {
  const out: Pose = { ...pose, dir };
  if (dir === -1) {
    if (pose.dx != null) out.dx = -pose.dx;
    if (pose.pupilDX != null) out.pupilDX = -pose.pupilDX;
    if (pose.legOx != null) out.legOx = pose.legOx.map((v) => -v);
  }
  return out;
}
