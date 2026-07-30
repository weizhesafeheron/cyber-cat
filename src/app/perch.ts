import { W } from '../render/index.js';
import type { WorldActionKey } from '../render/index.js';
import type { PropKind } from '../props/index.js';
import type { CatStatus } from '../world/index.js';
import { groundScreenY, reachableX } from './motion.js';
import type { PerchSurface, StageGeometry } from './motion.js';

/**
 * 「猫爬到前台窗口上」的判断层（ticket 12，[ADR 0012](../../docs/adr/0012-surfaces-and-perching.md)）。
 *
 * 职责边界，与挂件那条链（ADR 0009）完全对称：
 *
 * | 层 | 负责 | 不知道 |
 * |---|---|---|
 * | 平台层（platform.rs） | 前台窗口是哪个、可见矩形、所在屏的 DPI | 猫想干什么 |
 * | 这一层 | 那个矩形能不能站、这一刻要不要上去、待多久 | 怎么跳、跳多久 |
 * | 运动层（motion.ts） | 逐帧把猫送上那条表面、在上面走、跳下来 | 表面是窗口还是别的什么 |
 *
 * 全是纯函数，所以「什么样的窗口能站」「跨 DPI 时不许上去」这些判断可以直接测
 * （test/app/perch.test.ts），不需要真机 - 而真机上这些条件几乎无法逐个复现。
 *
 * 世界层在这条链里的位置：**它只提供两个投影**（`status` 与 `anchor`），
 * 连「有没有窗口」都不知道。屏幕矩形绝不能进 World，否则同一份存档在不同分辨率的
 * 机器上会演化出不同的猫，离线推演当场失效（ADR 0001 + 0009）。
 */

/**
 * 平台层读到的前台窗口，**一律逻辑像素**（CSS 像素 / 点），与舞台同一个坐标系。
 *
 * 换算在 Rust 侧做完（见 platform.rs 的 foreground_window）：
 * macOS 的 `kCGWindowBounds` 本来就是点；Windows 的 DWM 矩形是物理像素，
 * 必须按**目标窗口所在显示器**的 DPI 换算，用宠物窗口自己的 DPI 会在混合 DPI
 * 多屏上整体错位（实测同一窗口 900×650@150% → 600×433@100%，mvp-scope 3.1）。
 */
export interface ForegroundWindow {
  /** macOS 的 windowID / Windows 的 HWND。用来判断「还是同一个窗口吗」。 */
  readonly id: number;
  /** 拥有者进程。宠物自己的窗口已在 Rust 侧排除，这里留着是为了排查问题。 */
  readonly pid: number;
  /** 可见矩形（不含 Windows 的不可见拖拽边框）。 */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** 目标窗口所在显示器的缩放（macOS backingScaleFactor / Windows dpi/96）。 */
  readonly scale: number;
}

/**
 * 窗口要比猫宽才站得上去，单位是精灵像素。
 *
 * 一只猫是 72 个精灵像素宽（三倍缩放下 216 CSS 像素），比它窄的窗口上猫的两头
 * 都悬在外面，读起来是浮空而不是站着。
 */
const PERCH_MIN_WIDTH_SPRITE = W;

/**
 * 猫的锚点离窗口两端至少留这么多精灵像素。
 *
 * 锚点是精灵的横向中心，所以贴到窗口角上时半只猫在窗口外 - 悬一点点是猫感，
 * 悬半只就是掉下去了。留出这一段之后爪子始终踩在窗口里。
 */
const PERCH_EDGE_INSET_SPRITE = 6;

/**
 * 「上去之后能走一段」的最小长度，精灵像素。
 *
 * 走不了就只能站着，那不如不上去 - 特效的内容是「沿上边缘行走」，
 * 不是「在窗口上定住」。24 个精灵像素约等于走三步。
 */
const PERCH_MIN_SPAN_SPRITE = 24;

/**
 * 值得爬的最低高度，精灵像素。
 *
 * 窗口上沿离地面线太近时，猫站上去与站在桌面上看起来没区别，
 * 却要付一次起跳 + 下跳的动画。24 个精灵像素约等于猫的半个身高。
 */
const PERCH_MIN_LIFT_SPRITE = 24;

/**
 * 判定「同一个显示器缩放」的容差。
 *
 * 缩放是 1 / 1.25 / 1.5 / 2 这类离散值，差异远大于浮点误差，所以容差可以很小。
 */
const SCALE_EPS = 0.01;

/** 前台窗口要连续保持这么多秒，猫才考虑上去。 */
const PERCH_SETTLE_S = 1.2;

/**
 * 窗口站稳之后，最迟再等这么久就发出邀请。
 *
 * 性格抽签仍然保留：活跃的猫更可能提前想到要上去；但没有上限时，一只正在趴着的
 * 猫加上一段运气不好的随机流，真机上会让功能看起来像坏了。这个上限只约束等待，
 * 不绕过动作闸门与冷却。
 */
const PERCH_MAX_WAIT_AFTER_SETTLE_S = 15;

/**
 * 下来之后至少隔这么多秒才会再上去。
 *
 * 没有它猫会「跳下来 → 立刻又跳上去」，因为触发条件（有个窗口在前台）
 * 在它落地那一刻仍然成立。这与扑跳的「玩腻机制」是同一类节流。
 */
const PERCH_COOLDOWN_S = 20;

/** 一次待在上面多久，秒。抽签在起跳那一刻定死，之后不再重算。 */
const PERCH_STAY_MIN_S = 25;
const PERCH_STAY_SPAN_S = 70;

/**
 * 每分钟尝试上去的次数：懒猫 0.6 次，活跃的猫 3 次。
 *
 * 做成频率而不是「一有窗口就上去」是因为**这是个自主行为**（ADR 0004）：
 * 猫爬上窗口应该像它自己想到的，而不是像一个跟随前台窗口的 UI 控件。
 * 按 dt 折算成每帧概率，所以与帧率无关。
 */
const PERCH_TRIES_PER_MIN_BASE = 0.6;
const PERCH_TRIES_PER_MIN_SPAN = 2.4;

/**
 * 猫最多能站多高，CSS 像素。
 *
 * 上限不是猫的弹跳力，而是**舞台窗口不能升出工作区**：猫贴着舞台下沿
 * （ADR 0007），让它升高只能整块窗口上移，而舞台一升出工作区，露在外面那一段
 * 里的猫就被系统裁掉了（motion.ts 的 clampStage 因此钳住舞台的 y）。
 *
 * 现实后果必须说清：**最大化窗口的上沿爬不上去** - 那条边就在工作区顶端，
 * 猫站上去整只都在工作区之外。这是舞台几何的硬结果，不是能调的参数，
 * 取舍记在 ADR 0012。
 */
export function maxPerchLift(geom: StageGeometry): number {
  return Math.max(0, geom.work.h - geom.h);
}

/**
 * 前台窗口 → 猫能站的表面。不能站就返回 null（**失效方向是「不上去」**）。
 *
 * 五道闸门，每一道都对应一个真机上会出现的具体错误画面：
 *
 * 1. **跨 DPI 不上去。** 目标窗口在另一个缩放的显示器上时，猫的贴图缩放由舞台
 *    窗口所在屏决定（display.ts 的整数缩放规则），与目标屏不同 - 猫与窗口的比例
 *    会失配。MVP 不做多屏穿越（mvp-scope 第 10 节），所以这里直接不上去，
 *    而不是去缩放贴图。
 * 2. **太低不上去。** 见 PERCH_MIN_LIFT_SPRITE。
 * 3. **太高不上去。** 见 maxPerchLift：猫会被屏幕顶端裁掉。
 * 4. **比猫窄不上去。** 见 PERCH_MIN_WIDTH_SPRITE。
 * 5. **可走的一段太短不上去。** 与工作区求交之后才算 - 窗口有一半在屏幕外时，
 *    猫只能走剩下的那半段（舞台不能被拖出工作区）。
 */
export function perchSurfaceOf(
  win: ForegroundWindow | null,
  geom: StageGeometry,
  stageScale: number,
): PerchSurface | null {
  if (win === null) return null;
  if (Math.abs(win.scale - stageScale) > SCALE_EPS) return null;

  const s = geom.spriteScale;
  const lift = groundScreenY(geom) - win.y;
  if (lift < PERCH_MIN_LIFT_SPRITE * s) return null;
  if (lift > maxPerchLift(geom)) return null;
  if (win.w < PERCH_MIN_WIDTH_SPRITE * s) return null;

  const inset = PERCH_EDGE_INSET_SPRITE * s;
  const reach = reachableX(geom);
  const min = Math.max(win.x + inset, reach.min);
  const max = Math.min(win.x + win.w - inset, reach.max);
  if (max - min < PERCH_MIN_SPAN_SPRITE * s) return null;

  return { id: win.id, y: win.y, min, max };
}

/**
 * 世界层允许猫待在高处吗。**只读两个投影**，不读 World 本身。
 *
 * - 有挂件诉求（要吃饭、要睡觉）→ 不允许。食盆与猫窝都摆在桌面那条地面线上
 *   （props/layout.ts），所以「上去了就得先下来才能吃饭」是这一条推出来的，
 *   不是运动层里另写的规则。
 * - 只有状态是 `ok` 才允许：生病要蔫着趴在原地（那是病的读数，爬窗户会把它抹掉），
 *   饿了要在食盆边徘徊（哪怕食盆被藏起来因而没有锚点），睡着了在窝里，
 *   死了就不在了。
 *
 * 待接：**安静模式**（mvp-scope 第 6 节「不爬前台窗口」）。它还没实现，
 * 实现之后在调用处与这个函数求与即可 - 别把开关塞进世界状态。
 */
export function perchAllowed(status: CatStatus, anchor: PropKind | null): boolean {
  if (anchor !== null) return false;
  return status === 'ok';
}

/**
 * 这一刻可以起跳吗。
 *
 * 走动、站着、坐下与趴下都可以自然转去爬窗口：后两者是没有明确收尾帧的循环
 * 姿势，若一定等世界层改主意，单次会挡住 25–100 秒，功能就像失灵。运动层收到
 * 邀请后会先改播走路、走到起跳点，不会从趴姿直接弹起来。
 *
 * 有明确内容的动作仍不打断：打哈欠、伸懒腰、舔毛、吃饭、睡觉与扑跳都要播完。
 * **这只是起跳闸门，不是留在上面的条件** - 上去之后世界层想趴就趴，
 * 那正是「趴在标题栏上」。
 */
export function perchStartOk(action: WorldActionKey | null): boolean {
  return action === 'walk' || action === 'idle' || action === 'sit' || action === 'lie';
}

/**
 * 「要不要上去、还要不要待着」的全部状态。**不进存档**，与运动层同理。
 */
export interface PerchDesire {
  /** 这一帧交给运动层的表面。null = 不邀请 / 该下来了。 */
  readonly offer: PerchSurface | null;
  /** `readyS` / `onS` 说的是哪条表面。换了窗口就要从头计时。 */
  readonly id: number | null;
  /** 同一条表面连续可用了多久，秒。 */
  readonly readyS: number;
  /** 这一次邀请已经持续多久，秒（含走过去与起跳的时间）。 */
  readonly onS: number;
  /** 这一次打算待多久，秒。起跳那一刻抽定。 */
  readonly stayS: number;
  /** 上一次收回邀请之后过了多久，秒。冷却用。 */
  readonly restS: number;
}

export function initialPerchDesire(): PerchDesire {
  // 冷却只约束「刚从窗口下来又马上上去」。应用刚启动还没有上一次，直接视为已冷却。
  return {
    offer: null,
    id: null,
    readyS: 0,
    onS: 0,
    stayS: 0,
    restS: PERCH_COOLDOWN_S,
  };
}

export interface PerchDesireInput {
  /** 帧时长，秒。 */
  readonly dt: number;
  /** 世界层允许待在高处吗（perchAllowed）。 */
  readonly allowed: boolean;
  /** 这一刻允许起跳吗（perchStartOk）。留在上面不看它。 */
  readonly startOk: boolean;
  /** 平台层这一刻给出的可站表面（perchSurfaceOf）。 */
  readonly surface: PerchSurface | null;
  /** 活跃度，决定爬窗口的频率。 */
  readonly active: number;
  /** 随机源。注入才能测出确定的序列。 */
  readonly rnd: () => number;
}

/**
 * 推进一帧「想不想上去」。纯函数。
 *
 * 输出只有一个用处：喂给 `MotionInput.perch`。因此这里从不发「下来」的命令 -
 * **撤销邀请就是下来**（见 motion.ts 里 perch 那个字段的注释）。这么定的好处是
 * 任何一处漏掉调用都只会让猫回到地面，而不会把它永久留在半空。
 */
export function nextPerchDesire(prev: PerchDesire, i: PerchDesireInput): PerchDesire {
  const dt = Math.max(0, i.dt);
  const idle: PerchDesire = {
    offer: null,
    id: null,
    readyS: 0,
    onS: 0,
    stayS: 0,
    restS: prev.restS + dt,
  };

  // 世界层不允许了（生病、该去吃饭），或者根本没有可站的表面：撤销。
  if (!i.allowed || i.surface === null) return idle;

  const same = prev.id === i.surface.id;

  // 已经邀请中（猫在上去、在上面、或正走向起跳点）：续约到待够为止。
  // 待够了就撤销，运动层看到 null 会让它跳下来。
  if (prev.offer !== null && same) {
    const onS = prev.onS + dt;
    if (onS >= prev.stayS) return idle;
    // 几何每帧都用最新的：窗口被拖动时猫要跟着它走。
    return { ...prev, offer: i.surface, onS };
  }

  // 还没上去。三道闸门：窗口站稳了、冷却过了、这一刻能起跳。
  const readyS = same ? prev.readyS + dt : dt;
  const waiting: PerchDesire = {
    offer: null,
    id: i.surface.id,
    readyS,
    onS: 0,
    stayS: 0,
    restS: prev.restS + dt,
  };
  if (!i.startOk) return waiting;
  if (readyS < PERCH_SETTLE_S) return waiting;
  if (waiting.restS < PERCH_COOLDOWN_S) return waiting;

  // 抽签。频率按活跃度，折算成这一帧的概率；若一直没抽中，到上限就直接邀请。
  // 这样性格决定「会不会更早想到」，但不会让用户为一次可见反馈等上几分钟。
  const waitedOut =
    readyS >= PERCH_SETTLE_S + PERCH_MAX_WAIT_AFTER_SETTLE_S;
  const perMin = PERCH_TRIES_PER_MIN_BASE + i.active * PERCH_TRIES_PER_MIN_SPAN;
  if (!waitedOut && i.rnd() >= (perMin / 60) * dt) return waiting;

  return {
    offer: i.surface,
    id: i.surface.id,
    readyS,
    onS: 0,
    stayS: PERCH_STAY_MIN_S + i.rnd() * PERCH_STAY_SPAN_S,
    restS: 0,
  };
}

/**
 * 猫这一刻的脚底线在哪条屏幕 y 上。
 *
 * 有了表面模型，「猫的脚在地面线上」不再永远成立，而舞台里的覆盖层（飘起来的爱心）
 * 是按脚底线定位的。抄一份「地面线 - liftY」到每个覆盖层里迟早会漏掉一个，
 * 症状是猫在窗口上被摸时爱心从桌面那条线上冒出来。
 */
export function footScreenY(geom: StageGeometry, liftY: number): number {
  return groundScreenY(geom) - Math.max(0, liftY);
}
