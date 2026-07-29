import { ACTIONS, LEAP_CROUCH_S, W } from '../render/index.js';
import type { ActionKey, WorldActionKey, Cat, MicroOpts, Pose } from '../render/index.js';
import { clamp } from '../render/rng.js';
import { GROUND_FROM_BOTTOM } from './stage.js';

/**
 * 运动层（[ADR 0007](../../docs/adr/0007-stage-window-and-motion-layer.md)）。
 *
 * 分工：**世界层决定猫想干什么，运动层负责把它送到那里。**
 * 世界层给的是 30 分钟粒度的意图（`renderIntent.action`），而「走过去」是逐帧的事 -
 * 位置、朝向、抵达判定、爪印都需要帧时钟。
 *
 * 挂件（食盆、猫窝）就是「送到那里」的字面意思：世界层说「它想去食盆」
 * （只有名字，没有坐标），应用层把名字换算成一个屏幕 x 传进 `anchorX`，
 * 这一层负责在世界层动嘴之前把猫送到那儿。**世界层对「吃不吃」的权威一点没动** -
 * 它照旧在整步上自己判定，不需要任何「猫到了吗」的回信。需要回信才能吃的话，
 * 离线补算就吃不了饭了（补算时没有屏幕，也没有帧）。
 *
 * 不变量（改代码时不要破坏）：
 * - **运动层绝不写世界层。** 这个文件里没有任何 `World` 的引用，输入只有
 *   `ActionKey`（intent 的投影）与 `Cat`（由品种+Seed 重建），编译期就断掉了
 *   回写的通路。任何从帧循环回写状态的路径都会破坏离线等价性 - 补算时没有帧，
 *   那条路径不存在，两边就会算出不同结果。
 * - **状态不进存档。** 重启后猫出现在一个合理位置即可，没人记得它昨晚站在哪。
 * - 纯函数：dt、时间戳、随机源全部注入，因此不需要 DOM 也能测（test/app/motion.test.ts）。
 *
 * **表面模型**（ticket 12 引入，见 [ADR 0012](../../docs/adr/0012-surfaces-and-perching.md)）：
 * 猫任何时刻站在某一个**表面**上。桌面的地面线是其中一个表面，前台窗口的上沿是
 * 另一个。`liftY`（离地面线多高）由所在表面推出来，**不是一个自由的 y** -
 * 这是「猫可以离开地面，但不会停在半空」这条口径在代码里的形状：
 * 被拎着与下落时没有表面，所以必然落回地面；站在窗口上时有表面，所以停得住。
 * 食盆与猫窝仍然只摆在地面线上（props/layout.ts），因此猫要吃饭或睡觉必须先跳下来。
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
 * 猫可以站上去的一条**表面**（ticket 12）。目前只有一个来源：前台窗口的可见上沿。
 *
 * 运动层刻意只收这四个数，与锚点只收一个 `anchorX` 是同一条纪律（ADR 0009）：
 * 它不需要知道那是哪个应用的窗口、窗口有多高、在哪个显示器上、DPI 是多少。
 * 那些是平台层与 app/perch.ts 的事 - 塞进来只会让这一层跟着窗口 API 一起变。
 */
export interface PerchSurface {
  /**
   * 表面来源的标识（macOS 的 windowID / Windows 的 HWND）。
   *
   * 运动层只用它判断「还是同一条表面吗」：换了一个窗口就得先下来再上去，
   * 不能让猫在两个窗口之间横向瞬移。
   */
  readonly id: number;
  /** 表面的屏幕 y。猫站上去之后脚就踩在这条线上。 */
  readonly y: number;
  /** 猫在这条表面上可站的屏幕 x 区间（锚点是精灵的横向中心）。 */
  readonly min: number;
  readonly max: number;
}

/** 猫与某条表面的关系。四个阶段各自对应一个动作。 */
export type PerchPhase =
  /** 蓄力 + 腾空上升。 */
  | 'up'
  /** 站在表面上（走边沿、或者就在上面趴着）。 */
  | 'on'
  /** 蓄力 + 自由下落。 */
  | 'down'
  /** 落地压缩。播完就把控制交还给世界层。 */
  | 'land';

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
   * 叠在动作产出的姿态之上的覆盖。落地后的甩尾巴就靠它。
   *
   * 运动层能决定「播哪个动作」，但情绪化的细节（甩尾）不值得为它单独开一个动作 -
   * 那会让「落地后蹭回来」和「落地后走开」各要一套动作。
   */
  readonly pose: Pose;
  /**
   * 猫的脚离地面线多高，CSS 像素。0 = 踩在地上。
   *
   * **这是猫唯一的纵向位置，而且它永远由「猫站在哪条表面上」推出来，不是自由变量。**
   * 三种非零的情况，都不是「猫自己飞起来了」：
   *   - 被拎着（`held`）：高度由光标决定，没有表面，所以松手必然落回 0；
   *   - 下落中：同上，正在回到某条表面；
   *   - 站在窗口上沿（`perch.phase === 'on'`）：高度 = 地面线 - 表面的 y。
   *
   * 表面之外的一切（食盆、猫窝、爪印的落线）仍然共用桌面那条地面线
   * （见 props/layout.ts），所以猫要吃饭或睡觉必须先跳下来。
   */
  readonly liftY: number;
  /** 正在被拎着。 */
  readonly held: boolean;
  /** 下落速度，CSS 像素每秒。只在 liftY > 0 且没被拎着时有意义。 */
  readonly fallV: number;
  /**
   * 落地反应：粘人的蹭回来、高冷的走开。null = 没在反应。
   *
   * `goalX` 在落地那一刻就定下来，不每帧重算：高冷的目标是「离这儿远一点」，
   * 每帧按当前位置重算的话目标会一直后退，猫永远走不到、也就永远趴不下
   * （实测走过了目标距离的 1.4 倍，反应窗口到期还在走）。
   * null 表示「跟着光标」- 粘人的猫要跟着手走，那个目标本来就该是活的。
   */
  readonly reaction: {
    readonly kind: 'cling' | 'aloof';
    readonly left: number;
    readonly goalX: number | null;
  } | null;
  /**
   * 正在播的一次性动作与它已播的秒数。null = 当前不是一次性动作。
   *
   * 世界层给一个动作分配的时长是十几秒起，而打个哈欠只要三秒、扑一下四秒 -
   * 播完之后接什么需要帧时钟，和「走完一段路就地歇一会」是同一类判断，
   * 因此归运动层（ADR 0007）。
   */
  readonly shot: { readonly action: ActionKey; readonly t: number } | null;
  /**
   * 猫与某条表面的关系（ticket 12）。null = 站在桌面的地面线上。
   *
   * 有它才谈得上「停在别的高度」：`liftY` 在 `phase === 'on'` 时由 `surface.y`
   * 每帧重新推出来，所以窗口被拖动时猫跟着走，而窗口一没了就没有表面可站 -
   * 状态机随即进入 'down'，猫跳回地面。
   */
  readonly perch: {
    readonly phase: PerchPhase;
    readonly surface: PerchSurface;
    /** 当前阶段已进行的秒数。 */
    readonly t: number;
    /** 纵向速度，CSS 像素每秒，**向上为正**。只在腾空的两个阶段有意义。 */
    readonly v: number;
  } | null;
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
  /**
   * 世界层的意图动作。**只读** - 运动层不回写世界。
   *
   * 类型是 WorldActionKey：「被拎起来」「落地」是这一层自己的决定，不该能从外面
   * 传进来（见 render/actions.ts 的 MOTION_ONLY_ACTIONS）。
   */
  readonly action: WorldActionKey | null;
  /**
   * 猫这一刻该待的屏幕 x（挂件跟前）。null = 没有空间诉求，照旧自己漫游。
   *
   * 由应用层把世界层的 `renderIntent.anchor`（只有挂件名，没有坐标）经挂件层
   * 换算而来。**运动层刻意只收一个数**：它不需要知道挂件是什么、有几个、
   * 藏起来了没有 - 那些是挂件层的事，塞进来只会让这一层跟着挂件一起变。
   */
  readonly anchorX: number | null;
  /** 这只猫。只读性格与体型。 */
  readonly cat: Cat;
  readonly geom: StageGeometry;
  /** 随机源。注入而非内置，测试才能拿到确定的行走序列。 */
  readonly rnd: () => number;
  /**
   * 正被拎着时光标的屏幕位置。null = 没在拎。
   *
   * 拎着期间**猫的位置完全由这个值决定** - 世界层的意图、锚点、走路全部让位。
   * 这不违反「运动层不回写世界」：拎起来这件事已经作为 UserAction 进过 step 了
   * （世界层在那里结算醒来与心情），这里只负责让画面跟着手走。
   */
  readonly hold?: { readonly x: number; readonly y: number } | null;
  /**
   * 最近一次知道的光标屏幕 x。null = 不知道。
   *
   * 落地反应要用：粘人的猫朝光标蹭回去，高冷的猫朝反方向走开。
   */
  readonly cursorX?: number | null;
  /**
   * 这一帧允许猫待的表面（前台窗口的上沿）。null = 没有表面可待。
   *
   * 语义刻意是**每帧续约**而不是「上去/下来」两个命令：
   * - 从 null 变成一条表面 = 邀请（猫会先走到起跳点，再跳上去）；
   * - 一直给同一条（`id` 相同）= 续约，几何可以每帧变，猫跟着窗口走；
   * - 变回 null 或换了 `id` = 撤销，猫跳下来。
   *
   * 这么定的理由是**失效方向**：任何一处出问题（轮询停了、窗口读不到、
   * 世界层说该去吃饭了、上层忘了调用），猫都会回到桌面地面线上 -
   * 那是唯一一条永远存在的表面。反过来（「上去/下来」两个命令）漏掉一次
   * 「下来」就会把猫永久留在半空。
   *
   * 要不要邀请、邀请多久由 app/perch.ts 决定（那里有性格与冷却），
   * 窗口几何与 DPI 的换算在 src-tauri/src/platform.rs。这一层只管把猫送上去。
   */
  readonly perch?: PerchSurface | null;
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
 * 松手之后的下落加速度，CSS 像素每秒平方。
 *
 * 取到「从屏幕顶端掉到地面约半秒」的量级。再慢就成了轻飘飘的羽毛，
 * 再快就看不出下落过程、等于瞬移。
 */
const FALL_ACCEL = 2600;

/** 落地反应持续多久，秒。之后交回世界层的意图。 */
const REACTION_S = 3.2;

/**
 * 跳上一条高 `lift` 的表面所需的初速度，CSS 像素每秒。
 *
 * `v0 = sqrt(2 g lift)`，也就是**刚好够到**那条边的速度，重力用的是与下落同一个
 * `FALL_ACCEL`。于是「跳得高就飞得久」是算出来的（270 像素 ≈ 0.46 秒，
 * 900 像素 ≈ 0.83 秒），不需要给跳跃动作定一个时长。
 *
 * 被否决的做法：固定 0.4 秒的腾空时间，高度用 easing 插值。那样跳一层楼与跳
 * 一个书架的速度感完全一样，而这两种高度在真实桌面上都会遇到（窗口位置任意）。
 */
function climbSpeed(lift: number): number {
  return Math.sqrt(2 * FALL_ACCEL * Math.max(0, lift));
}

/**
 * 在窗口上沿走动的速度，CSS 像素每秒。
 *
 * 与地面走路共用同一个性格倍率，只换基准 travel - 两者的**步幅因此相同**，
 * 只有频率变慢（见 render/actions.ts 里 edge 的 hz）。速度与步频必须同比例，
 * 否则是滑步，这与 walkSpeedFor 是同一条约束。
 */
function edgeSpeed(cat: Cat, geom: StageGeometry): number {
  const base = ACTIONS.edge.travel ?? 13;
  return base * geom.spriteScale * (SPEED_BASE + cat.personality.active * SPEED_ACTIVE_SPAN);
}

/** 粘人度高于此值算「粘人」：落地后蹭回光标边。低于它是高冷，走开去别处趴下。 */
const CLINGY_THRESHOLD = 0.5;

/** 粘人的猫蹭回来时，靠到离光标这么近就算到了（CSS 像素）。 */
const CLING_NEAR_PX = 24;

/**
 * 高冷的猫走开多远，精灵像素。
 *
 * 这个距离要**能在反应窗口内走完并留出趴下的时间**：走路约每秒 56 CSS 像素，
 * 45 个精灵像素 = 135 CSS 像素 ≈ 2.4 秒，反应窗口 3.2 秒，剩下的时间刚好趴下。
 * 第一版给了 90，走到一半窗口就到期了，「走开去别处趴下」只走开没趴下。
 */
const ALOOF_AWAY_SPRITE = 45;

/** 落地不满的甩尾幅度。比日常的尾巴摆动明显得多，一眼能看出情绪。 */
const UPSET_TAIL_WAVE = 2.4;

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

/**
 * 舞台原点被工作区钳住的范围。屏幕比舞台还窄时贴左。
 *
 * 纵向也要钳：猫被拎起来时舞台会往上走（见 nextStage），不钳的话舞台顶端会
 * 跑到工作区之外，那一段里的猫就被系统裁掉了。
 */
function clampStage(p: ScreenPoint, geom: StageGeometry): ScreenPoint {
  const maxX = geom.work.x + Math.max(0, geom.work.w - geom.w);
  const maxY = geom.work.y + Math.max(0, geom.work.h - geom.h);
  return { x: clamp(p.x, geom.work.x, maxX), y: clamp(p.y, geom.work.y, maxY) };
}

/**
 * 猫在桌面工作区内横向可达的屏幕 x 区间（锚点是精灵的横向中心，所以两端各留半个精灵宽）。
 *
 * 导出是给挂件层用的：食盆的落点必须落在这个区间里，否则猫走不到那儿
 * （挂件被拖到屏幕最边上时会发生）。**只算工作区，不算舞台** - 舞台会跟着猫滚动，
 * 「这一帧能走到哪」是另一回事，见 roamBounds。
 */
export function reachableX(geom: StageGeometry): { min: number; max: number } {
  const half = (W * geom.spriteScale) / 2;
  return { min: geom.work.x + half, max: geom.work.x + geom.work.w - half };
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
  const work = reachableX(geom);
  const min = Math.max(work.min, state.stage.x + half);
  const max = Math.min(work.max, state.stage.x + geom.w - half);
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
    pose: {},
    liftY: 0,
    held: false,
    fallV: 0,
    reaction: null,
    shot: null,
    perch: null,
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
  liftY = 0,
): ScreenPoint {
  // 猫离地时舞台跟着往上走。猫在窗口里的纵向位置是固定的（贴着窗口下沿），
  // 所以「让猫升高」只能靠整个窗口升高 - 窗口只有 200 像素高，靠画布内偏移
  // 顶多抬起一点点就顶到窗口边了。
  const y = stageYFor(geom) - liftY;
  const local = x - stage.x;
  const near = geom.w * SCROLL_EDGE;
  // 猫在舞台中部：横向不动。y 仍然跟着工作区走（程序坞显隐会改它）。
  const inMiddle = local >= near && local <= geom.w - near;
  // 挪的话把猫放在行进方向的后 35% 处：身后留爪印的空间，身前留下一段路。
  const behind = dir > 0 ? geom.w * SCROLL_REST : geom.w * (1 - SCROLL_REST);
  const want = clampStage({ x: inMiddle ? stage.x : x - behind, y }, geom);
  return want.x === stage.x && want.y === stage.y ? stage : want;
}

/** 一次位移之后落下的爪印与新的步距余额。走路与走向挂件走的是同一套。 */
interface PawTrail {
  readonly paws: readonly PawPrint[];
  readonly strideLeft: number;
  readonly pawSide: 1 | -1;
}

/**
 * 走了 `moved` 个 CSS 像素之后该落下的爪印。
 *
 * 按路程而不是按时间，所以走得快的猫脚印不会变密；
 * 单帧最多落 8 枚是掉帧兜底 - dt 异常大时一帧可能跨过好几个步距。
 *
 * `atY` 是**脚下那条表面**的屏幕 y，默认桌面地面线。猫走在窗口上沿时要传那条边 -
 * 爪印记的是屏幕坐标（舞台滚动时要留在原地），落线错了就会在猫脚下方几百像素
 * 的桌面上出现一排脚印（mvp-scope 3.5 的「经过前台窗口时尤其明显」正是指这些）。
 */
function dropPaws(
  trail: PawTrail,
  x: number,
  moved: number,
  geom: StageGeometry,
  now: number,
  atY?: number,
): PawTrail {
  if (moved <= 0) return trail;
  const stride = PAW_STRIDE_SPRITE * geom.spriteScale;
  const y = atY ?? groundScreenY(geom);
  let strideLeft = trail.strideLeft - moved;
  let pawSide = trail.pawSide;
  const dropped: PawPrint[] = [];
  while (strideLeft <= 0 && dropped.length < 8) {
    strideLeft += stride;
    pawSide = pawSide === 1 ? -1 : 1;
    dropped.push({ x, y, at: now, side: pawSide });
  }
  if (dropped.length === 0) return { ...trail, strideLeft };
  return { paws: [...trail.paws, ...dropped], strideLeft, pawSide };
}

/**
 * 猫与表面的状态机（ticket 12）。走到起跳点、跳上去、在上面待着、跳下来、落地。
 *
 * 单独一个函数、并且每条路径各自 return 完整状态，是刻意的：猫在窗口上时的可站
 * 范围、播的动作、爪印落线全都不一样，与地面上的锚点/漫游分支混在一起会让那些
 * 既有分支每一处都要多问一句「现在是不是在窗口上」。
 * 代价是走向起跳点那几行与锚点分支长得像，接受它 - 那两处的抵达之后要做的事
 * 完全不同（一个开始吃饭，一个起跳）。
 *
 * `offered` 是这一帧续约的表面（见 MotionInput.perch）。它随时可能变成 null，
 * 于是每个阶段都要能优雅退场 - **失效方向一律是「回到地面」**。
 */
function stepPerch(
  state: MotionState,
  input: MotionInput,
  action: WorldActionKey,
  offered: PerchSurface | null,
): MotionState {
  const { now, cat, geom } = input;
  const dt = Math.max(0, input.dt);
  const bounds = roamBounds(state, geom);
  const groundY = groundScreenY(geom);

  let x = clamp(state.x, bounds.min, bounds.max);
  let dir = state.dir;
  let targetX = state.targetX;
  let restS = state.restS;
  let trail: PawTrail = { paws: state.paws, strideLeft: state.strideLeft, pawSide: state.pawSide };

  /** 收尾：把这一帧的结果拼成完整状态。舞台跟着 liftY 一起升降。 */
  const out = (
    playing: ActionKey,
    liftY: number,
    perch: MotionState['perch'],
    shot: MotionState['shot'] = null,
  ): MotionState => ({
    ...state,
    x,
    dir,
    targetX,
    restS,
    playing,
    pose: {},
    liftY,
    held: false,
    fallV: 0,
    reaction: null,
    shot,
    perch,
    stage: nextStage(state.stage, geom, x, dir, liftY),
    paws: prune(trail.paws, now),
    strideLeft: trail.strideLeft,
    pawSide: trail.pawSide,
  });

  /** 朝 goal 走一步，返回这一帧走了多远。 */
  const walkToward = (goal: number, speed: number, atY: number): number => {
    dir = goal > x ? 1 : -1;
    const step = speed * dt;
    if (step <= 0) return 0;
    const next = clamp(x + dir * Math.min(step, Math.abs(goal - x)), bounds.min, bounds.max);
    const moved = Math.abs(next - x);
    x = next;
    trail = dropPaws(trail, x, moved, geom, now, atY);
    return moved;
  };

  const p = state.perch;

  // --- 还在地上：先走到起跳点，站定了才起跳 ---
  //
  // 起跳点取「猫当前位置钳进表面的横向范围」：窗口就在头顶时它原地起跳，
  // 窗口在旁边时它先走到最近的那一端。走过去的路上世界层要什么动作都先放一放，
  // 与锚点分支同一条理由（原地播吃饭 / 原地起跳都是假的）。
  if (p === null) {
    // 按调用条件走不到这儿（没有表面关系又没有邀请就不会进这个函数）。
    // 留着是因为放宽那个条件的人不一定会读到这里：兜底是「什么都不做」，
    // 代价是这一帧猫站着不动，而不是位置或高度出错。
    if (offered === null) return out(action, 0, null);
    const spot = clamp(clamp(x, offered.min, offered.max), bounds.min, bounds.max);
    const begin = { phase: 'up' as PerchPhase, surface: offered, t: 0, v: 0 };
    // 起跳点必须真的落在表面上。**够不到就先别跳**：舞台被工作区钳在别处时
    // `spot` 会被 bounds 拉出表面范围，在那儿起跳会在落顶的同一帧被判「站不住」
    // 而弹回来 - 屏幕上是猫原地跳了一下。舞台会跟着猫滚动，够得到的那一帧再跳。
    const onSurface = spot >= offered.min - ARRIVE_EPS && spot <= offered.max + ARRIVE_EPS;
    if (onSurface && Math.abs(spot - x) <= ARRIVE_EPS) return out('leapUp', 0, begin);
    targetX = spot;
    restS = 0;
    if (dt > 0 && walkToward(spot, walkSpeed(cat, geom), groundY) <= 0) {
      // 一步也走不动（撞上工作区或舞台的钳制）：够得着就地起跳，
      // 够不着就当没这回事、照常听世界层的 - 别在墙边一直播走路。
      return onSurface ? out('leapUp', 0, begin) : out(action, 0, null);
    }
    return out('walk', 0, null);
  }

  /** 从表面上跳下来：先蓄力（t 从 0 起），再自由落体。 */
  const hopOff = (): MotionState =>
    out('leapDown', state.liftY, { phase: 'down', surface: p.surface, t: 0, v: 0 });

  // --- 上升：蓄力 → 腾空 ---
  if (p.phase === 'up') {
    // 表面被撤了、或者前台换成了另一个窗口：中途放弃，落回地面。
    // 不追新窗口是有意的 - 半空中改道等于横向瞬移。
    //
    // 已经离地的话**跳过下落前的蓄力**（t 直接给到蓄力结束），并接着当前速度落 -
    // 不这么做的话猫会在半空中先僵住 0.22 秒再开始掉。
    if (offered === null || offered.id !== p.surface.id) {
      if (state.liftY <= 0) return hopOff();
      return out('leapDown', state.liftY, {
        phase: 'down',
        surface: p.surface,
        t: LEAP_CROUCH_S,
        v: Math.min(0, p.v),
      });
    }
    const lift = Math.max(0, groundY - offered.y);
    const t = p.t + dt;
    if (t < LEAP_CROUCH_S) {
      return out('leapUp', 0, { phase: 'up', surface: offered, t, v: 0 });
    }
    // 初速度只在离地那一帧算一次。每帧重算的话窗口一动速度就跟着跳，
    // 猫会在半空中忽快忽慢。
    const v0 = p.v > 0 ? p.v : climbSpeed(lift);
    const next = state.liftY + v0 * dt;
    const v = v0 - FALL_ACCEL * dt;
    if (next >= lift) {
      // 到了。直接钉在表面上，不留浮点残差 - 差半个像素会让脚看起来陷进那条边。
      targetX = null;
      restS = 0;
      return out('edge', lift, { phase: 'on', surface: offered, t: 0, v: 0 });
    }
    // 上升到顶还没够着（窗口在腾空期间又往上跑了）：认输往下落。
    if (v <= 0) return out('leapDown', next, { phase: 'down', surface: offered, t: LEAP_CROUCH_S, v });
    return out('leapUp', next, { phase: 'up', surface: offered, t, v });
  }

  // --- 站在表面上 ---
  if (p.phase === 'on') {
    if (offered === null || offered.id !== p.surface.id) return hopOff();
    // 猫站得住的范围 = 表面 ∩ 这一帧能走到的范围（舞台不能被拖出工作区）。
    const min = Math.max(bounds.min, offered.min);
    const max = Math.min(bounds.max, offered.max);
    // 窗口缩到猫站不住了（被拖走、变窄）：跳下来。
    if (max < min) return hopOff();

    // **liftY 每帧由表面重新推出来**，所以窗口被拖动时猫跟着它上下走。
    const lift = Math.max(0, groundY - offered.y);
    x = clamp(x, min, max);

    // 世界层要走路 → 换成边缘步态；其余动作原样播 - 「趴在标题栏上」就是这一条。
    if (action !== 'walk') {
      targetX = null;
      restS = 0;
      const def = ACTIONS[action];
      if (def.loop) return out(action, lift, { ...p, surface: offered, t: 0 });
      // 一次性动作（打哈欠、伸懒腰）在窗台上照样只播一遍，播完站着。
      // **不推进 leap 的位移**：扑跳那 16 个精灵像素会把猫顶到边缘钳制上，
      // 读起来是「扑了但没动」；窄边上本来也不该扑。
      const wasT = state.shot?.action === action ? state.shot.t : null;
      const t = wasT === null ? 0 : wasT + dt;
      const done = t >= (def.period ?? 0);
      return out(done ? 'idle' : action, lift, { ...p, surface: offered, t: 0 }, {
        action,
        t,
      });
    }

    // 边缘行走：与地面漫游同一套「走一段、歇一会」，只是范围窄、步子慢。
    if (restS > 0) {
      restS = Math.max(0, restS - dt);
      targetX = null;
      return out('idle', lift, { ...p, surface: offered, t: 0 });
    }
    let goal = targetX;
    if (goal == null || goal < min || goal > max) {
      goal = pickTarget(x, cat.personality.active, { min, max }, geom, input.rnd);
    }
    targetX = goal;
    if (Math.abs(goal - x) <= ARRIVE_EPS) {
      targetX = null;
      restS = restAfterLeg(cat.personality.active, input.rnd);
      return out('idle', lift, { ...p, surface: offered, t: 0 });
    }
    if (dt > 0 && walkToward(goal, edgeSpeed(cat, geom), offered.y) <= 0) {
      // 走不动了：交还控制，歇一会再挑目标。
      targetX = null;
      restS = restAfterLeg(cat.personality.active, input.rnd);
      return out('idle', lift, { ...p, surface: offered, t: 0 });
    }
    return out('edge', lift, { ...p, surface: offered, t: 0 });
  }

  // --- 跳下来：蓄力 → 自由落体 ---
  if (p.phase === 'down') {
    const t = p.t + dt;
    if (t < LEAP_CROUCH_S) return out('leapDown', state.liftY, { ...p, t });
    // 竖直落下，不带横向位移：猫落在它跳下来的那一点。
    // 带一点前扑会更好看，但那要保证落点仍在工作区内，留给手感调优。
    const v = p.v - FALL_ACCEL * dt;
    const next = state.liftY + v * dt;
    if (next <= 0) {
      targetX = null;
      restS = 0;
      return out('land', 0, { phase: 'land', surface: p.surface, t: 0, v: 0 });
    }
    return out('leapDown', next, { ...p, t, v });
  }

  // --- 落地压缩。播完把控制交还给世界层 ---
  const t = p.t + dt;
  if (t < (ACTIONS.land.period ?? 0)) return out('land', 0, { ...p, t });
  return out('idle', 0, null);
}

/**
 * 推进一帧。纯函数，返回新状态，不改动入参。
 *
 * 三种情况，优先级从高到低：
 *
 * 1. **有锚点且还没走到**（`anchorX`）：不管世界层要什么动作，先播走路把猫送过去。
 *    这是「猫走到食盆前才吃」的落点 - 世界层保留「吃不吃」的权威，
 *    运动层保证它动嘴的那一刻人在盆前（ADR 0004 + 0007）。
 * 2. **有锚点且已经到了**：原样播世界层要的动作，位置钉住。世界层说走路时改播
 *    站立呼吸 - 猫已经在它该在的地方，原地踏步是最假的画面。
 * 3. **没有锚点**：照旧自己漫游。世界层说走路就挑目标、逐帧推进、抵达后交还控制
 *    （改播站立呼吸并歇一会，等世界层下一个整步改主意）；其余动作原样放行，
 *    它们的位移都在动作自己的 pose 里。
 */
export function stepMotion(state: MotionState, input: MotionInput): MotionState {
  const { dt, now, cat, geom, rnd } = input;

  if (input.action === null) {
    // 猫已离开。位置不再推进，爪印自然淡完；桌面上从此空着，
    // 该看的东西在告别页窗口里（app/farewell.ts）。
    // 拎着的状态也要一起清：猫不在了，手里那只更不该还悬在半空。
    return {
      ...state,
      playing: null,
      pose: {},
      targetX: null,
      restS: 0,
      shot: null,
      liftY: 0,
      held: false,
      fallV: 0,
      reaction: null,
      // 表面也一起清：没有猫了，也就没有谁站在窗口上。
      perch: null,
      paws: prune(state.paws, now),
    };
  }

  const active = cat.personality.active;
  const bounds = roamBounds(state, geom);
  let x = clamp(state.x, bounds.min, bounds.max);
  let dir = state.dir;
  let targetX = state.targetX;
  let restS = state.restS;
  let trail: PawTrail = { paws: state.paws, strideLeft: state.strideLeft, pawSide: state.pawSide };
  let playing: ActionKey = input.action;
  let shot = state.shot;
  let liftY = state.liftY;
  let fallV = state.fallV;
  let reaction = state.reaction;
  let pose: Pose = {};

  const groundY = groundScreenY(geom);
  const reach = reachableX(geom);

  // --- 被拎着：位置完全跟手，世界层的一切让位 ---
  //
  // 这不违反「运动层不回写世界」：拎起来已经作为一次 UserAction 进过 step 了
  // （世界层在那里结算醒来与心情），这里只负责让画面跟着手走。
  if (input.hold) {
    const hx = clamp(input.hold.x, reach.min, reach.max);
    // 脚不能被拎到工作区上沿之外 - 再往上整只猫就出屏了。
    const hy = clamp(groundY - input.hold.y, 0, groundY - geom.work.y);
    return {
      ...state,
      x: hx,
      liftY: hy,
      held: true,
      fallV: 0,
      playing: 'held',
      pose: {},
      // 拎起来就打断一切在进行的事：走到哪儿、歇多久、一次性动作、上一次的落地反应。
      targetX: null,
      restS: 0,
      shot: null,
      reaction: null,
      // 也包括「站在窗口上」：被拎起来之后猫就不在那条表面上了，
      // 松手会让它落回地面（下面那段自由落体），不是弹回窗台。
      perch: null,
      stage: nextStage(state.stage, geom, hx, state.dir, hy),
      paws: prune(state.paws, now),
    };
  }

  // --- 爬到前台窗口上（ticket 12）------------------------------------------
  //
  // 整段状态机在 stepPerch 里，条件写在这儿是为了让分支的先后一目了然：
  // 它必须排在**被拎着之后**（手里的猫不站在任何表面上）、**自由落体之前**
  // （站在窗口上时 liftY > 0，会被下面那段误判成「正在往下掉」）。
  //
  // `liftY <= 0` 那一半就是这个意思：刚松手、还在空中的猫不接受新邀请，
  // 让它先落地。少了这个条件，从手里松开的猫会在半空中改播走路走向起跳点。
  // 同理让位给落地反应（issue #10 的蹭回来/走开）：那三秒是用户刚放下手的回应，
  // 被一次爬窗口打断的话性格就白分化了。反过来，已经在窗口上的猫不可能有反应在跑
  // （拎起来会清掉 perch，落地反应只在从手里落地时产生）。
  if (
    state.perch !== null ||
    (input.perch != null && liftY <= 0 && state.reaction === null)
  ) {
    return stepPerch(state, input, input.action, input.perch ?? null);
  }

  // --- 松手之后自由下落。落地那一刻挑好反应 ---
  if (liftY > 0) {
    fallV += FALL_ACCEL * Math.max(0, dt);
    liftY -= fallV * Math.max(0, dt);
    if (liftY > 0) {
      return {
        ...state,
        x,
        liftY,
        held: false,
        fallV,
        playing: 'held',
        pose: {},
        targetX: null,
        restS: 0,
        shot: null,
        reaction: null,
        stage: nextStage(state.stage, geom, x, dir, liftY),
        paws: prune(state.paws, now),
      };
    }
    // 落地：先播压缩，再按性格决定蹭回来还是走开。
    liftY = 0;
    fallV = 0;
    shot = { action: 'land', t: 0 };
    const clingy = cat.personality.clingy > CLINGY_THRESHOLD;
    const cursorAt = input.cursorX ?? null;
    const away = ALOOF_AWAY_SPRITE * geom.spriteScale;
    reaction = {
      kind: clingy ? 'cling' : 'aloof',
      left: REACTION_S,
      // 粘人的跟着光标（活目标）；高冷的现在就把「走到哪」定死。
      goalX: clingy
        ? null
        : cursorAt === null
          ? x + (dir > 0 ? -away : away)
          : cursorAt > x
            ? x - away
            : x + away,
    };
    targetX = null;
    restS = 0;
  }

  // --- 落地反应：这几秒里由它接管走向，世界层的意图先放一放 ---
  //
  // 反应本身是「性格可以被摸到」的落点（issue #10）：粘人的蹭回光标边，
  // 高冷的走开去别处。**甩尾巴是共通的**，所以放在覆盖姿态里而不是分给两个动作。
  //
  // 为什么归运动层：走到哪儿、走多久都需要帧时钟，与「走完一段路歇一会」同类
  // （ADR 0007）。世界层那边已经结算完落地的心情，它不需要知道猫往哪边走。
  if (reaction !== null) {
    reaction = { ...reaction, left: reaction.left - Math.max(0, dt) };
    if (reaction.left <= 0) {
      reaction = null;
    } else {
      pose = { tailWave: UPSET_TAIL_WAVE, tailPhase: now / 260 };
      const landing = shot !== null && shot.action === 'land' ? shot : null;
      if (landing !== null) {
        // 压缩那 0.45 秒里不走动 - 刚落地就迈步会读成滑步。
        const t = landing.t + Math.max(0, dt);
        const done = t >= (ACTIONS.land.period ?? 0);
        shot = done ? null : { action: 'land', t };
        return {
          ...state,
          x,
          dir,
          playing: done ? 'idle' : 'land',
          pose,
          liftY: 0,
          held: false,
          fallV: 0,
          reaction,
          targetX: null,
          restS: 0,
          shot,
          stage: nextStage(state.stage, geom, x, dir),
          paws: prune(state.paws, now),
        };
      }

      // 压缩播完了：往目标走。粘人跟着光标，高冷走向落地时定好的那个点。
      const want = reaction.goalX ?? input.cursorX ?? x;
      const goalX = clamp(want, bounds.min, bounds.max);
      const near = reaction.kind === 'cling' ? CLING_NEAR_PX : ARRIVE_EPS;
      const stepLenR = walkSpeed(cat, geom) * Math.max(0, dt);
      let playingR: ActionKey = 'walk';
      if (Math.abs(goalX - x) <= near) {
        // 到了。粘人的猫站在光标边等着，高冷的猫趴下 - 那是「走开去别处趴下」的下半句。
        playingR = reaction.kind === 'cling' ? 'idle' : 'lie';
      } else {
        dir = goalX > x ? 1 : -1;
        if (stepLenR > 0) {
          const next = clamp(x + dir * Math.min(stepLenR, Math.abs(goalX - x)), bounds.min, bounds.max);
          const moved = Math.abs(next - x);
          x = next;
          trail = dropPaws(trail, x, moved, geom, now);
          if (moved <= 0) playingR = reaction.kind === 'cling' ? 'idle' : 'lie';
        }
      }
      return {
        ...state,
        x,
        dir,
        playing: playingR,
        pose,
        liftY: 0,
        held: false,
        fallV: 0,
        reaction,
        targetX: null,
        restS: 0,
        shot: null,
        stage: nextStage(state.stage, geom, x, dir),
        paws: prune(trail.paws, now),
        strideLeft: trail.strideLeft,
        pawSide: trail.pawSide,
      };
    }
  }

  /**
   * 锚点先钳进可达范围再判定。
   *
   * 钳完之后「走不到」这种情况就不存在了：舞台会跟着猫滚动，而舞台被工作区钳住，
   * 所以工作区内的任何 x 都走得到。少了这一步就得额外记一个「在这儿卡住了」的
   * 状态，否则挂件被拖到屏幕外时猫会永远播走路。
   */
  const goal = input.anchorX === null ? null : clamp(input.anchorX, bounds.min, bounds.max);
  const approaching = goal !== null && Math.abs(x - goal) > ARRIVE_EPS;

  const def = ACTIONS[input.action];
  if (approaching) {
    // 路上不推进一次性动作的时间线，到了才从头播。
    // 不清掉的话，从桌面另一头走过来的十几秒会把三秒的动作在半路上播完，
    // 猫抵达时那个动作已经「播过了」，等于白走一趟。
    shot = null;
  } else if (!def.loop) {
    // 一次性动作：播一遍就完，之后站着等世界层改主意。
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

  const stepLen = walkSpeed(cat, geom) * Math.max(0, dt);

  if (approaching) {
    // --- 一、走向挂件 ---
    playing = 'walk';
    targetX = goal;
    restS = 0;
    dir = goal! > x ? 1 : -1;
    // dt = 0 时不推进（启动路径会用 dt = 0 推一帧只为算出 playing）。
    if (stepLen > 0) {
      // 最后一帧只走到锚点为止，不冲过去再拉回来。
      const next = clamp(x + dir * Math.min(stepLen, Math.abs(goal! - x)), bounds.min, bounds.max);
      const moved = Math.abs(next - x);
      x = next;
      trail = dropPaws(trail, x, moved, geom, now);
    }
  } else if (goal !== null) {
    // --- 二、已经在挂件跟前 ---
    targetX = null;
    restS = 0;
    // 世界层说走路，但猫已经在它想在的地方：站着。原地踏步是最假的画面。
    // （在食盆边小幅踱步会更像猫，但那要求「吃的时候一定在盆前」这条硬约束
    //  改成带半径的判定，留给手感调优，当前先保证约束。）
    if (input.action === 'walk') playing = 'idle';
  } else if (input.action !== 'walk') {
    // --- 三、自由漫游：原地动作 ---
    targetX = null;
    restS = 0;
  } else if (restS > 0) {
    // 一段路走完就地歇一会。半小时里一直走或一直站着都读起来像循环播放。
    restS = Math.max(0, restS - dt);
    playing = 'idle';
  } else {
    // --- 三、自由漫游：走一段路 ---
    if (targetX == null) targetX = pickTarget(x, active, bounds, geom, rnd);
    const delta = targetX - x;
    if (delta !== 0) dir = delta > 0 ? 1 : -1;
    playing = 'walk';

    if (stepLen > 0) {
      const next = clamp(x + dir * Math.min(stepLen, Math.abs(delta)), bounds.min, bounds.max);
      const moved = Math.abs(next - x);
      x = next;
      trail = dropPaws(trail, x, moved, geom, now);

      // 到了、或者走不动了（被工作区/舞台钳住）都把控制交还回去：
      // 位置不再推进，改播站立呼吸并歇一会，等世界层下一个整步改主意。
      if (moved <= 0 || Math.abs(targetX - x) <= ARRIVE_EPS) {
        targetX = null;
        restS = restAfterLeg(active, rnd);
        playing = 'idle';
      }
    }
  }

  const paws = prune(trail.paws, now);
  const stage = nextStage(state.stage, geom, x, dir);

  return {
    ...state,
    x,
    dir,
    targetX,
    restS,
    playing,
    pose,
    liftY,
    held: false,
    fallV,
    reaction,
    shot,
    stage,
    paws,
    strideLeft: trail.strideLeft,
    pawSide: trail.pawSide,
  };
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
