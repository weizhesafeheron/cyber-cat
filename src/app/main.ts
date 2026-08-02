/**
 * 宠物窗口的入口。
 *
 * 职责边界：这个文件是平台层，负责取时钟、读写存档、驱动帧循环、刷新托盘、
 * 编排命中测试与点击穿透、以及把运动层算出来的位置落到窗口和画布上。
 * **猫的状态一步都不在这里演化** - 全部经由世界层的 `step`（ADR 0001）。
 * **逐帧位置一步都不回写世界层** - 那条通路会破坏离线等价性（ADR 0007）。
 *
 * 真正的抚摸见 ticket 10。
 */
import {
  ACTIONS,
  H,
  W,
  hitTest,
  headColumn,
  materializeCat,
  makeMicro,
  motionTuningFor,
  stepMicro,
  tuneMotionPose,
  tuneMotionTime,
} from '../render/index.js';
import type {
  ActionKey,
  Cat,
  MicroState,
  RenderResult,
  WorldActionKey,
} from '../render/index.js';
import { clamp } from '../render/rng.js';
import { XiaomiSprites } from './xiaomi-sprites.js';
import { MS_PER_HOUR, renderIntentOf, step, worldNow } from '../world/index.js';
import type { CatStatus, RenderIntent, UserAction, World } from '../world/index.js';
import { ADOPT_H, ADOPT_W } from '../adopt/constants.js';
import { beginAdoption } from '../adopt/flow.js';
import type { AdoptedIdentity } from '../adopt/identity.js';
import { withChrome } from '../chrome/constants.js';
import {
  DIARY_H,
  DIARY_MIN_H,
  DIARY_MIN_W,
  DIARY_W,
  bubbleVisible,
  bubbleBob,
  bubbleSpriteRect,
  bubbleStageRect,
  hitsRect,
  shouldOfferDiary,
} from '../diary/index.js';
import type { SpriteRect } from '../diary/index.js';
import { adoptNewCat, ensureWorld, requestAdoption } from './adoption.js';
import type { AdoptionGate } from './adoption.js';
import { BubbleCanvas } from './bubble.js';
import { CursorTracker } from './cursor.js';
import { CatDisplay } from './display.js';
import { FarewellHost, tauriFarewellPorts } from './farewell.js';
import {
  contentReady,
  inputIdle,
  inTauri,
  moveStage,
  onAdoptAnother,
  openAdoption,
  openDiary,
  probeCursor,
  probePresenting,
  probeStage,
  pushQuietMenu,
  setPassThrough,
  setTrayIcon,
  waitForAdopted,
} from './ipc.js';
import { notifyIfSick, tauriNotifyPorts } from './notify.js';
import {
  ALL_MICRO_ON,
  applyMicroSwitches,
  catInStage,
  createMotion,
  faceDir,
  microOptsFor,
  pawsInStage,
  settleStage,
  stepMotion,
} from './motion.js';
import type { MicroSwitches, MotionState, ScreenRect, StageGeometry } from './motion.js';
import { PollingPassthrough } from './passthrough.js';
import { reactionDurationMs } from './reaction.js';
import { ForegroundWatcher } from './foreground.js';
import {
  footScreenY,
  initialPerchDesire,
  nextPerchDesire,
  perchAllowed,
  perchStartOk,
  perchSurfaceOf,
} from './perch.js';
import type { PerchDesire } from './perch.js';
import {
  EAT_SAY_SPRITE,
  sayBob,
  saySpriteRect,
  sayStageRect,
  sayVisible,
} from '../say/index.js';
import { HeartCanvas, burstHearts, heartsInStage, stepHearts } from './hearts.js';
import { SayCanvas } from './say.js';
import {
  INITIAL_TEASE,
  afterPounce,
  interruptTease,
  pounceLandingX,
  quotaFor,
  reactDelayMs,
  refreshTease,
  teaseVerdict,
} from '../tease/index.js';
import type { CursorPoint, TeaseState } from '../tease/index.js';
import type { TrayIconState } from '../tray/index.js';
import type { Heart } from './hearts.js';
import { PawCanvas } from './paws.js';
import {
  loadSettings,
  loadWorld,
  onTrayAction,
  pushTrayStatus,
  saveSettings,
  saveWorld,
} from './persist.js';
import { restrainedAction, restraint } from './restraint.js';
import { DEFAULT_SETTINGS, withQuiet } from './settings.js';
import type { Settings } from './settings.js';
import { PropsHost } from './props.js';
import { TARGET_SCALE } from './stage.js';
import { trayIcon } from '../tray/index.js';
import { trayIconState, trayStatus } from './status.js';

/** 单帧用于推进动画相位的最大时长。掉帧时不要让动作跳一大段。 */
const MAX_ANIM_DT = 0.05;

/**
 * 按下之后移动超过这么多屏幕像素才算拖拽，否则算抚摸。
 *
 * 与挂件用的是同一个量级但各自定义：挂件那边是 CSS 客户区像素，这里是屏幕像素。
 * 判反了的代价不对称 - 把抚摸误判成拖拽只是白拎一下猫（心情小降），
 * 把拖拽误判成抚摸会让每次拖动都先蹭一把手心，亲密度虚高。所以宁可偏向拖拽。
 */
const DRAG_THRESHOLD_PX = 5;

/** 存档与托盘的刷新节流。 */
const SAVE_INTERVAL_MS = 30_000;
const TRAY_INTERVAL_MS = 5_000;

/**
 * 「该不该让开」多久问一次，毫秒。
 *
 * 1 秒是按**恢复的延迟**定的，不是按检测成本定的：用户退出全屏之后猫最多晚一秒
 * 回来，读起来像它自己缓过神，而不是卡住。反过来进入全屏时晚一秒才藏起来是
 * 可以接受的 - 那一秒里用户正在切换，本来就在看别的东西。
 * 检测本身很便宜（见 platform::presenting），但它是跨进程调用，
 * 60 Hz 地问是纯浪费。
 */
const YIELD_INTERVAL_MS = 1_000;

/**
 * 重读舞台几何的间隔。
 *
 * 工作区会变（程序坞显隐、改分辨率、插拔显示器），缓存下来猫迟早会走到屏幕外
 * 或者踩在任务栏底下。两秒一次的开销可以忽略 - 光标探测每 16ms 就是一次同类调用。
 */
const STAGE_METRICS_INTERVAL_MS = 2_000;

/**
 * 离线补算的时间上限。
 *
 * 世界层刻意不对 elapsedMs 设上限（那属于平台层的健壮性问题），所以在这里挡。
 * 超过这个量几乎只可能是系统时钟被改过或存档来自另一台机器 -
 * 真按几十年去补算只会白转几百万步，而猫早在第四天就死了。
 */
const MAX_CATCHUP_MS = 400 * 24 * MS_PER_HOUR;

/**
 * 点猫之后的即时视觉反馈。
 *
 * 为什么应用层要单独做一次：世界层的动作选择粒度是 30 分钟，抚摸带来的心情与
 * 亲密度变化不会立刻改变它选的动作 - 只靠世界层，点了猫看不到任何反应。
 * 所以点击既作为 `UserAction` 进世界层（亲密度、日记、睡着时的拒绝都在那边算），
 * 也在这里播一次短动作给出即时反馈。
 *
 * 这是占位：ticket 10 的抚摸才是真正的反应（表情、按性格分化的回应）。
 * 选伸懒腰是因为它形变最大、肉眼一望即知，顺带能验证命中形状确实跟着当前帧的
 * 掩膜变 - 伸懒腰时猫横向拉长，可点范围也该跟着变宽。
 */
const REACTION: WorldActionKey = 'stretch';

const canvas = document.getElementById('cat') as HTMLCanvasElement;
const display = new CatDisplay(canvas, TARGET_SCALE);
const paws = new PawCanvas(document.getElementById('paws') as HTMLCanvasElement);
const heartCanvas = new HeartCanvas(document.getElementById('hearts') as HTMLCanvasElement);
const bubble = new BubbleCanvas(document.getElementById('bubble') as HTMLCanvasElement);
const say = new SayCanvas(document.getElementById('say') as HTMLCanvasElement, EAT_SAY_SPRITE);

/**
 * 正在飘的爱心。**不进存档也不进世界层** - 与爪印同理，它是一次抚摸的即时回应，
 * 重启之后没人记得上一次摸猫冒了几颗心。
 */
let hearts: readonly Heart[] = [];
/** A 方案试运行：所有真实动作直接使用小米的高清完整帧。 */
const xiaomiSprites = new XiaomiSprites();

/**
 * 桌面可用区，屏幕逻辑坐标。
 *
 * 初值假装舞台原点就是桌面原点：直接用浏览器打开页面调试时没有 Rust 侧可问，
 * 这个假设让舞台内的一切仍然自洽（猫在页面里走，只是走不出页面）。
 * 真机上 bootStage 会用实测值覆盖它。
 */
let work: ScreenRect = { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };

/**
 * 五个微动作的总开关。
 *
 * 默认全开。逐个关掉对比是 prototype ② 验证过的做法，真机验收时用
 * `__cyberCat.micro({ tail: false })` 关掉再看 - 微动作层是「活着的感觉」
 * 的主要来源，这个对比是判断它有没有真的接上的唯一办法。
 */
let micros: MicroSwitches = ALL_MICRO_ON;

function geometry(): StageGeometry {
  return {
    w: window.innerWidth,
    h: window.innerHeight,
    spriteScale: display.spriteScale,
    work,
  };
}

/** 运动层状态。**不进存档** - 重启后猫出现在一个合理位置即可（ADR 0007）。 */
let motion: MotionState = createMotion(geometry(), { x: work.x, y: work.y });

/**
 * 桌面挂件（食盆与猫窝）。
 *
 * 它把世界层给的挂件名换算成一个屏幕 x，运动层据此把猫送过去 -
 * 「点食盆添粮、猫自己走过去吃」这条链上，这里是中间那一环（ADR 0004 + 0007）。
 * 摆放另存一份文件，不进世界存档。
 */
const props = new PropsHost(geometry());

/**
 * 猫死了之后的那一半（issue #13）：旧猫入档、弹告别页、从托盘再打开它。
 *
 * 每帧都会问它一次，但它只在「刚发现这只猫死了」时真的做事 - 判定与幂等都在
 * app/farewell.ts，那里有测试。「刚发现」而不是「刚死亡」：猫也可能死在离线期间，
 * 甚至上次运行时就死了（用户直接关掉了告别页）。
 */
const farewell = new FarewellHost(tauriFarewellPorts);

// --- 爬到前台窗口上（ticket 12，[ADR 0012](../../docs/adr/0012-surfaces-and-perching.md)）---
//
// 三层分工与挂件那条链完全对称：平台层读窗口矩形（watcher），app/perch.ts 判断
// 那条边能不能站、这一刻要不要上去，运动层负责跳上去、在上面走、跳下来。
// **世界层只出两个投影**（status 与 anchor），它连屏幕上有没有窗口都不知道 -
// 屏幕矩形一旦进 World，同一份存档在不同分辨率的机器上就会演化出不同的猫。

/** 前台窗口的轮询。每帧问一次，它自己按猫的活动状态节流（10 Hz / 2 Hz）。 */
const foreground = new ForegroundWatcher();

/** 「想不想上去、还要不要待着」。**不进存档**，与运动层同理。 */
let perchDesire: PerchDesire = initialPerchDesire();

/** dpr 或窗口尺寸变化时重算四张画布。它们的像素格必须一样大。 */
function applyGeometry(): void {
  display.applyScale();
  paws.resize(window.innerWidth, window.innerHeight, display.pixelRatio);
  heartCanvas.resize(window.innerWidth, window.innerHeight, display.pixelRatio);
  bubble.resize(window.innerWidth, window.innerHeight, display.pixelRatio);
  say.resize(window.innerWidth, window.innerHeight, display.pixelRatio);
}

applyGeometry();

/** 本地时区偏移，分钟（东八区 = 480）。JS 的 getTimezoneOffset 符号相反。 */
const tzOffsetMinutes = (): number => -new Date().getTimezoneOffset();

/**
 * 这只猫。
 *
 * **领养完成（或读到存档）之前它们并不存在** - 所以是 `!` 而不是给一只占位猫。
 * ticket 04 曾经在这里写死一只橘猫（seed 20260728），代价是启动时会有一瞬间画的
 * 是那只不属于用户的猫；ticket 07 之后没有占位猫，那一瞬间也随之消失。
 *
 * 不变量：读这三个变量的所有通路都在 `boot()` 里 install 之后才可达
 * （帧循环由 startLoop 起，而 startLoop 认 `booted`）。
 */
let world!: World;
let cat!: Cat;
let micro!: MicroState;

/** 把猫装进来。新身份使用领养封存的档案，旧身份回退到品种 + Seed。 */
function install(w: World): void {
  // 时区跟随当前机器：用户换了时区（或过了夏令时），猫的作息该跟着用户的白天走。
  world = { ...w, tzOffsetMinutes: tzOffsetMinutes() };
  cat = materializeCat(world.identity);
  micro = makeMicro(world.identity.seed);
}

/** 当前猫的抚摸图集播完一轮需要多久；桃心与动作窗口共用这个结果。 */
function petReactionDurationMs(): number {
  const tuning = motionTuningFor(
    world.identity.motion ? { motion: world.identity.motion } : undefined,
    REACTION,
  );
  const worldTimeScale = renderIntentOf(world, cat).timeScale;
  return reactionDurationMs(REACTION, tuning, cat, worldTimeScale);
}

/** 待结算的用户动作。托盘点击与鼠标点击都是异步来的，攒到下一帧一起交给 step。 */
let pending: UserAction[] = [];

function enqueue(action: UserAction): void {
  pending.push(action);
}

function drain(): UserAction[] {
  if (pending.length === 0) return [];
  const out = pending;
  pending = [];
  return out;
}

/** 当前动作的局部时间。动作一换就归零，否则新动作会从中间开始播。 */
let animT = 0;
let currentAction: ActionKey | null = null;

let lastFrameMs = performance.now();
/** 世界时间跟真实时钟走，不跟帧走 - 窗口被遮挡时 rAF 会停，帧时间会漏掉那一段。 */
let lastWallMs = Date.now();
let lastSaveMs = 0;
let lastTrayMs = 0;
let lastMetricsMs = 0;
let lastYieldMs = 0;
/**
 * 托盘图标上画的是哪一档。null = 还没画过。
 *
 * 只在这一档变化时才换图：换图标是一次 5KB 的跨进程调用，而状态摘要每 5 秒推一次，
 * 跟着它一起换等于每 5 秒白搬一张图。
 */
let trayIconShown: TrayIconState | null = null;

/**
 * 用户的开关。启动时从 settings.json 读，用户在托盘里拨一次写一次。
 *
 * **不进 World**：世界层必须可离线回放（ADR 0001），而开关不是时间的函数。
 * 后果是安静模式期间猫照样会饿会困 - 那正是票上要的「隐藏与恢复期间状态继续推演」。
 */
let settings: Settings = DEFAULT_SETTINGS;

/**
 * 此刻别人在全屏或投屏（让开规则）。
 *
 * 与安静模式不同，它**不持久化**：它描述的是这一刻的桌面，不是用户的偏好。
 * 重启之后重新探测一次就有了。
 */
let presenting = false;

/** 最近一帧里头中心的列位，精灵像素。台词气泡按它对齐尾尖。 */
let lastHeadX = 0;
/** 最近画出去的那一帧。命中测试必须用当前帧的掩膜（ADR 0006）。 */
let lastFrame: RenderResult | null = null;
/** 即时反馈的截止时刻（performance.now 时间轴）。0 = 没在反应。 */
let reactionUntilMs = 0;
/** 下一帧是否要把同名的一次性动作当作一次新的抚摸重新开始。 */
let reactionRestartPending = false;

// --- 回归气泡（ADR 0011）-------------------------------------------------
//
// 「离开超过阈值后回来，猫头顶冒一个可点的小气泡，点开才展开日记」。
// **不弹窗、不拦用户** - 它只是舞台里多出来的一小块可点区域。

/**
 * 气泡冒出来的时刻（帧时钟）。null = 这次启动不冒，或者已经收掉了。
 *
 * 要不要冒由 catchUp 里的补算结果决定（shouldOfferDiary）。
 * **不在这里读墙上时钟算「离开了多久」。** 那个数只有补算知道，而且读时钟的版本
 * 没法测（见 diary/bubble.ts 的注释）。
 */
let bubbleArmedAt: number | null = null;
/**
 * 气泡这一帧占的矩形，精灵像素。null = 此刻没有气泡。
 *
 * 由 draw() 每帧算出来，点击判定与穿透判定都读它 - **画的和判的必须是同一个矩形**，
 * 分成两份迟早差一像素，症状是「看起来点在气泡上但没反应」。
 */
let bubbleRect: SpriteRect | null = null;

/**
 * 打开日记。托盘菜单与气泡共用。
 *
 * 顺手把气泡收掉：点开了就算读过了。留着它不消失的话，用户会以为没点中而再点一次。
 */
function showDiary(): void {
  bubbleArmedAt = null;
  void openDiary(DIARY_W, withChrome(DIARY_H), DIARY_MIN_W, DIARY_MIN_H);
}

/**
 * 客户区 CSS 坐标 → 精灵像素坐标。
 *
 * 舞台化之后光标位置与猫的位置**不再等同**（ADR 0007）：猫只占舞台的三分之一，
 * 在里面来回走。这里之所以不用改，是因为它量的是 canvas 自己的布局矩形 -
 * `display.place()` 写的 transform 会体现在这个矩形上，横向偏移自动被吸收。
 *
 * 反过来说：**猫在舞台内的位置只能有一个来源。** 在这里按运动层的 x 重算一遍
 * 等于把定位规则抄第二份，两份一旦不同步（比如 place 里的整像素对齐）命中区就会
 * 整体偏移，而且只在真机上看得出来。
 *
 * 每次采样都读一次矩形是有意的 - 换来跨屏拖动、系统缩放变化后自动正确。
 */
function toSprite(clientX: number, clientY: number): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  return { x: ((clientX - r.left) / r.width) * W, y: ((clientY - r.top) / r.height) * H };
}

const tracker = new CursorTracker(probeCursor, toSprite);
const passthrough = new PollingPassthrough(tracker, setPassThrough);

/**
 * 画一帧，返回画出去的那一帧供命中测试用。
 *
 * **播哪个动作由运动层决定，不是直接用 intent.action。** 世界层说的是「这半小时
 * 想走路」，走到了之后该站着歇一会 - 那个判断需要帧时钟，属于运动层（ADR 0007）。
 *
 * 猫已离开时返回 null 并清空画布 - 不能留着上一帧，那会变成一只不动的僵尸猫。
 * 那之后桌面上什么都没有，该看的东西在告别页窗口里（app/farewell.ts）。
 */
/**
 * 把桌面上属于猫的一切擦掉。
 *
 * 两条路都会走到这里：猫离开了（永久），以及让开规则生效（临时）。
 * 抽成一个函数是因为**漏掉任何一块画布都会留下一块残影**，而那两条路都不该留下
 * 任何痕迹 - 死掉的猫头顶飘着一个气泡，或者全屏演示时屏幕角上留着几个爪印。
 */
function blank(): void {
  display.clear();
  paws.clear();
  heartCanvas.clear();
  bubbleRect = null;
  bubble.clear();
  say.clear();
  lastFrame = null;
}

function draw(intent: RenderIntent, animDt: number, nowMs: number): RenderResult | null {
  if (motion.playing === null) {
    // 猫不在了，头顶也就没有气泡可冒。死掉的猫的日记由告别页承接（ticket 13）。
    blank();
    return null;
  }
  // 播什么动作只看 motion.playing - 即时反馈已经在 frame() 里作为动作喂给
  // 运动层了，这里不再覆盖。两个来源会让画面与位移脱节（见 frame() 的注释）。
  const mi = stepMicro(micro, animDt, microOptsFor(micros, intent.micro));
  const motionTuning = motionTuningFor(
    world.identity.motion ? { motion: world.identity.motion } : undefined,
    motion.playing,
  );
  const tunedT = tuneMotionTime(animT, motionTuning, motion.playing, cat);
  const base = tuneMotionPose(
    motion.playing,
    ACTIONS[motion.playing].make(
      tunedT,
      cat,
      mi,
    ),
    motionTuning,
    cat,
  );
  // 叠加顺序是有讲究的：
  //   intent.pose 在动作之上 - 生病、睡着这类状态覆盖不该被动作或即时反馈吃掉；
  //   faceDir 在合并之后 - 它要翻转的 dx / legOx 可能来自任何一层；
  //   微动作开关最后 - 关掉尾巴就是最终结果里尾巴不摆，不管谁设过它。
  const posed = applyMicroSwitches(faceDir({ ...base, ...intent.pose }, motion.dir), micros);
  // 头在哪一列。台词气泡的尾巴尖按它对齐 - 由渲染层算，不在气泡那边拍一个偏移量
  // （头的列位取决于品种的体宽，拍死会在瘦品种上偏三四个精灵像素）。
  lastHeadX = headColumn(cat, posed, motion.dir);
  const sprite = xiaomiSprites.frame(motion.playing, tunedT, motion.dir);
  const res = sprite.hit;
  lastFrame = res;
  display.paintSprite(sprite.visual);
  // 猫在舞台内的位置与爪印每帧都要跟着走，否则猫会站在原地「走路」。
  display.place(catInStage(motion));
  paws.paint(pawsInStage(motion, nowMs), display.scale, display.pixelRatio);
  hearts = stepHearts(hearts, nowMs);
  heartCanvas.paint(
    // 爱心按**猫这一刻的脚底线**定位，不是桌面那条地面线：猫站在窗口上时舞台整块
    // 升高了（ticket 12 的表面模型），拿地面线算出来的爱心会从猫脚下几百像素的
    // 桌面上冒出来。摸窗口上的猫是完全正常的操作，所以这不是边角情况。
    heartsInStage(
      hearts,
      nowMs,
      motion.stage,
      footScreenY(geometry(), motion.liftY),
      display.spriteScale,
    ),
    display.spriteScale,
  );
  // 两种气泡都排在 display.place 之后：横向位置取自 display.originCss，
  // 而那个值是 place() 写的（已对齐到整数物理像素）。顺序颠倒会让气泡慢猫一帧。
  paintBubble(nowMs);
  paintSay(nowMs);
  return res;
}

/**
 * 画这一帧的回归气泡，并记下它的矩形。
 *
 * 气泡的位置用**精灵坐标**表达（相对精灵左上角），所以「跟着猫头顶走」是结构保证的：
 * 猫的画布靠 transform 在舞台里移动，气泡按同一个 originCss 换算，两者不可能脱节。
 * 没有任何逐帧跟随的代码。
 */
function paintBubble(nowMs: number): void {
  // 拎着或正在下落时不画：被拎起来的姿态会伸进气泡占的那几行，而且那时用户的手
  // 正在猫身上，气泡的点击区会跟拖拽抢同一片像素（见 diary/bubble.ts）。
  // 猫站在窗口上时（liftY > 0）同样不画 - 那个气泡是「我回来了」的招呼，
  // 该在桌面上等着被点，而不是跟着猫飘到别人的标题栏上。它不会因此丢掉：
  // bubbleArmedAt 还在，猫下来之后照样冒。
  if (!bubbleVisible(bubbleArmedAt, nowMs, motion.held || motion.liftY > 0)) {
    bubbleRect = null;
    bubble.clear();
    return;
  }
  const rect = bubbleSpriteRect(bubbleBob(nowMs / 1000));
  bubbleRect = rect;
  bubble.paint(
    bubbleStageRect(rect, display.originCss, display.spriteScale, window.innerHeight),
    display.pixelRatio,
  );
}

/**
 * 画这一帧的台词气泡（吃饭时的「yummy...」）。
 *
 * 时机跟着**吃饭动作的时相**走，用的是渲染动作的那同一个 animT - 传别的值会让气泡
 * 与低头错开（见 say/bubble.ts）。回归气泡在的时候让位：两者位置重合，
 * 而那个是可点的入口。
 */
function paintSay(nowMs: number): void {
  if (!sayVisible(motion.playing, animT, bubbleRect !== null)) {
    say.clear();
    return;
  }
  const rect = saySpriteRect(EAT_SAY_SPRITE, lastHeadX, motion.dir, sayBob(nowMs / 1000));
  say.paint(
    sayStageRect(rect, display.originCss, display.spriteScale, window.innerHeight),
    display.pixelRatio,
  );
}

/**
 * 与画面无关的周期性事务：存档、托盘、几何校正。
 *
 * 抽出来是因为**让开期间这些照样要做**（票上的「隐藏与恢复期间猫的状态继续正常推演，
 * 不丢失」）。让开那条路会提前返回、不画任何东西，如果这三件事留在 frame() 尾巴上，
 * 一场两小时的全屏演示期间猫的状态一次都不会落盘 - 中途关机就全丢了。
 */
function housekeeping(wall: number, hadEvents: boolean, status: CatStatus): void {
  // 有事发生就立刻存一次，其余时候按节流存 - 生病、死亡这类事件不能因为
  // 恰好在两次定时保存之间关机而丢掉。
  if (hadEvents || wall - lastSaveMs > SAVE_INTERVAL_MS) {
    lastSaveMs = wall;
    void saveWorld(world);
  }
  if (wall - lastTrayMs > TRAY_INTERVAL_MS) {
    lastTrayMs = wall;
    void pushTrayStatus(trayStatus(world, status));
  }
  // 图标本身反映状态（issue #15 第一条）：不打开任何界面就知道猫怎么样了。
  // **画的是这只猫自己的配色**，所以要把 cat 传进去（src/tray/icon.ts）。
  const wanted = trayIconState(status);
  if (wanted !== trayIconShown) {
    trayIconShown = wanted;
    // 2 倍：tray-icon 在 macOS 上把图标缩放到 18 点高，2 倍正好是 Retina 上的
    // 一比一（见 src/tray/icon.ts 文件头）。
    const icon = trayIcon(cat, wanted, 2);
    void setTrayIcon(icon.rgba, icon.w, icon.h);
  }
  if (wall - lastMetricsMs > STAGE_METRICS_INTERVAL_MS) {
    lastMetricsMs = wall;
    void refreshStage();
  }
}

/**
 * 该不该让开。每 YIELD_INTERVAL_MS 问一次 Rust。
 *
 * **探测失败一律当成「不该让开」**：失效方向必须是猫照常出现 -
 * 一只永远不出现的猫会被当成程序坏了，而一只在全屏视频上多待了一秒的猫只是有点烦。
 */
function pollYield(now: number): void {
  if (now - lastYieldMs < YIELD_INTERVAL_MS) return;
  lastYieldMs = now;
  void probePresenting().then((on) => {
    presenting = on;
  });
}

/** 让开状态的上一帧值。只在切换的那一帧动画布与挂件，不必每帧擦一次。 */
let yielded = false;

function frame(now: number): void {
  const animDt = Math.min(MAX_ANIM_DT, (now - lastFrameMs) / 1000);
  lastFrameMs = now;

  const wall = Date.now();
  const elapsed = Math.max(0, wall - lastWallMs);
  lastWallMs = wall;

  const r = step(world, elapsed, { actions: drain() });
  world = r.world;
  const intent = r.renderIntent;
  // 刚吃饱犯困那条闸门要知道上次进食是什么时候。用帧时钟而不是世界时钟：
  // 它和爪印寿命、点猫的即时反馈同一族，都是 UI 时间。
  if (r.events.some((e) => e.kind === 'ate' || e.kind === 'ateGreedy')) lastMealAtMs = now;

  // 运动层读 intent，**不写回去**。世界是状态的唯一权威（ADR 0007）。
  //
  // 即时反馈要作为动作**喂给运动层**，不能只在渲染时覆盖：
  // 运动层只在动作是 walk 时推进位置，把反馈喂进来它自然就停住了。
  // 曾经在 draw() 里覆盖播放的动作而没告诉运动层，结果点走路中的猫会
  // 「一边伸懒腰一边横向漂移」 - 因为世界层还在说走路，位置照推。
  // 这么改之后「当前播什么动作」只有 motion.playing 一个来源。
  const reacting = now < reactionUntilMs;
  if (!reacting) reactionRestartPending = false;

  // 即时反馈期间不给锚点：用户刚点了猫，猫在原地回应他，不该扭头就往食盆走。
  // 与上面「反馈要作为动作喂给运动层」是同一条理由 - 位移的开关只有一处。
  const g = geometry();
  const anchorX = reacting ? null : props.anchorX(intent.anchor, motion.x, g);

  // 两个全局兜底合成这一刻的许可（src/app/restraint.ts 的真值表）。
  // **它在所有主动行为之前算一次**，而不是在每处各写一个 if - 那样漏掉一处
  // 就会出现「安静模式下猫仍然会扑光标」，而且没有一处测试碰得到。
  const allow = restraint(settings.quiet, presenting, intent.anchor !== null);
  const effective = restrainedAction(reacting ? REACTION : intent.action, allow.roam);
  const restartReaction = reacting && reactionRestartPending && effective === REACTION;

  pollYield(now);

  // 让开规则：猫整只消失。
  //
  // **做法是「窗口留着但什么都不画」，不是隐藏窗口。** rAF 对隐藏窗口不触发，
  // 真把宠物窗口 hide 掉的话帧循环就停了，也就再也没人来问「全屏退出了吗」-
  // 猫会一直不回来（这个坑在启动流程上踩过两次，见 lib.rs 的 content_ready）。
  // 挂件是独立窗口、不驱动任何循环，所以它们是真的隐藏。
  if (allow.hidden) {
    if (!yielded) {
      yielded = true;
      blank();
      // 一块什么都没画的透明窗口绝不能截获点击 - 用户正在全屏演示，
      // 看不见的死区正是这条规则要防的事情本身。
      passthrough.yieldTo(true);
      void props.suppress(true);
    }
    // 世界照常推演（上面那次 step 已经做完了），存档与托盘照常刷新。
    housekeeping(wall, r.events.length > 0, intent.status);
    // 生病的系统通知照发：系统自己会在全屏时压住通知，那是用户在系统设置里的选择，
    // 不该由我们代劳。**但告别页不弹** - 那是一扇会抢焦点的窗口，
    // 盖在别人的演示上是这条规则最不能接受的失败。farewell.observe 是幂等的，
    // 跳过这一帧只是把它推迟到猫回来那一帧，不会漏掉。
    void notifyIfSick(r.events, world, tauriNotifyPorts);
    requestAnimationFrame(frame);
    return;
  }
  if (yielded) {
    yielded = false;
    passthrough.yieldTo(false);
    void props.suppress(false);
  }

  // 前台窗口：每帧问一次轮询器（它自己节流），把读到的矩形翻成一条可站的表面，
  // 再交给判断层决定这一刻要不要邀请猫上去。
  //
  // **轮询在这里而不是用 setInterval**，是为了让「睡眠与锁屏时停止」成为结构保证：
  // rAF 对隐藏/被遮挡的窗口不触发，帧循环停了轮询自然也停。
  foreground.poll(now, {
    // 猫在动或者已经在窗口上时用高频：前者随时可能起跳，后者要跟着窗口走。
    active: motion.perch !== null || motion.playing === 'walk',
    // 让开期间也当成隐藏：那时猫不会上任何窗口，问了也没人用这个矩形。
    hidden: document.hidden || !allow.perch,
  });
  perchDesire = nextPerchDesire(perchDesire, {
    dt: animDt,
    // 即时反馈期间也不上去：与「不给锚点」同一条理由 - 用户刚点了猫。
    allowed: !reacting && allow.perch && perchAllowed(intent.status, intent.anchor),
    startOk: perchStartOk(effective),
    surface: perchSurfaceOf(foreground.window, g, display.pixelRatio),
    active: cat.personality.active,
    rnd: Math.random,
  });

  // dt 乘上 timeScale：病后虚弱时动作会放慢，地面速度必须跟着放慢，
  // 否则腿的相位与实际位移脱节，走起来是滑步。
  motion = stepMotion(motion, {
    dt: animDt * intent.timeScale,
    now,
    action: effective,
    restartAction: restartReaction,
    pounceTimeScale: tuneMotionTime(
      1,
      motionTuningFor(
        world.identity.motion ? { motion: world.identity.motion } : undefined,
        'pounce',
      ),
      'pounce',
      cat,
    ),
    hold: holdAt,
    cursorX: cursorScreenX,
    // 安静模式与让开是逗猫棒的**第七道闸门**：不满足就连轨迹判定都不做
    // （tease/gates.ts 那六道说的是「这只猫此刻想不想玩」，这一条说的是
    // 「现在允不允许玩」，两件事不该混在同一个函数里）。
    teaseLandingX: allow.tease ? teaseThisFrame(intent, now, g) : null,
    anchorX,
    perch: perchDesire.offer,
    cat,
    geom: g,
    rnd: Math.random,
  });
  reactionRestartPending = false;
  requestStageMove();
  probeKeyboardIdle(now);
  // 从**轮询**那条路也喂光标轨迹：穿透开着时 webview 收不到 pointermove，
  // 而那正是逗猫开始的时刻 - 猫在远处，穿透是开着的。
  // 客户区坐标加舞台原点就是屏幕坐标（两者都是逻辑像素，同一个坐标系）。
  const rawCursor = tracker.latestClient;
  if (rawCursor !== null) {
    observeTrail(motion.stage.x + rawCursor.x, motion.stage.y + rawCursor.y, now);
  }
  // 一次逗猫扑跳刚刚走完：记账。玩腻与全局节流都靠这一笔。
  if (teasing && motion.tease === null) {
    tease = afterPounce(tease, now);
  }
  teasing = motion.tease !== null;
  // 被拎起来、睡着、生病都算「被别的事打断」，连续计数归零 -
  // 睡一觉起来又扑三次是两串，不是六次。
  if (motion.held || intent.status !== 'ok') tease = interruptTease(tease);
  // 碗里的份数变了就推给食盆窗口。「视觉上能看到碗里有粮」就是这个数的投影。
  props.onBowlPortions(world.bowl);

  if (motion.playing !== currentAction || restartReaction) {
    currentAction = motion.playing;
    animT = 0;
  } else {
    animT += animDt * intent.timeScale;
  }

  const res = draw(intent, animDt, now);
  // 判定与渲染同一帧：掩膜是刚产出的那一份，不是上一帧的。
  // 气泡的矩形一起传进去 - 不传的话光标压到气泡上时窗口仍然是穿透的，气泡点不动
  // （穿透是整窗一刀切的，ADR 0006）。它由上面这次 draw 刚算出来，是同一帧的值。
  if (res) passthrough.update(res, now, bubbleRect ? [bubbleRect] : []);

  // 生病发系统通知（只有这一级发，饿了不发），猫死了则入档并弹告别页。
  // 两件都不等返回：帧循环不能等一次跨进程调用（与 setPassThrough 同一条理由）。
  // 判定与幂等分别在 app/notify.ts 与 app/farewell.ts，这里只负责每帧问一声。
  void notifyIfSick(r.events, world, tauriNotifyPorts);
  void farewell.observe(world);

  housekeeping(wall, r.events.length > 0, intent.status);

  requestAnimationFrame(frame);
}

/** 上一次已经真正落到窗口上的舞台位置。 */
let placed: { x: number; y: number } | null = null;
/** 正在等待 IPC 返回的位置。同一时刻最多只能有一个。 */
let movingTo: { x: number; y: number } | null = null;
/** 等待下发的最新位置；新帧直接覆盖旧帧，不让过时坐标在 IPC 队列里排队。 */
let pendingMove: { x: number; y: number } | null = null;
/** 上一次下发的时刻（Date.now），用来避免与几何校正打架。 */
let placedAtMs = 0;
let moveFailures = 0;

function samePoint(
  a: { readonly x: number; readonly y: number } | null,
  b: { readonly x: number; readonly y: number },
): boolean {
  return a !== null && a.x === b.x && a.y === b.y;
}

/** 串行落位，只保留等待期间收到的最后一个坐标。 */
async function drainStageMoves(): Promise<void> {
  if (movingTo !== null) return;
  while (pendingMove !== null) {
    const target = pendingMove;
    pendingMove = null;
    movingTo = target;
    try {
      await moveStage(target.x, target.y);
      placed = target;
    } catch (err) {
      // 挪不动的后果由下一次 refreshStage 兜住：它会把运动层的舞台原点纠回真实值，
      // 猫于是被 roamBounds 限制在当前窗口内活动 - 仍然可见、可点。
      moveFailures++;
      if (moveFailures <= 3) {
        console.error(
          '[cyber-cat] 移动舞台窗口失败，猫的活动范围将被限制在当前窗口内：',
          err,
        );
      }
    } finally {
      movingTo = null;
    }
  }
}

/**
 * 把运动层算出的舞台位置落到窗口上。
 *
 * 运动层在决定滚动的那一帧就把 `stage` 改掉了 - 猫的屏幕位置是「舞台原点 +
 * 舞台内位置」，两项必须同时改。所以这里是「跟上」而不是「批准」：
 * 分两步改（先挪窗口、生效后再改画布偏移）看起来更稳，实际是**必然**会看到
 * 一次跳动，因为窗口挪好之后画布还停在旧偏移上，至少差一帧。
 */
function requestStageMove(): void {
  const at = { x: motion.stage.x, y: motion.stage.y };
  if (samePoint(pendingMove, at)) return;
  if (samePoint(movingTo, at)) {
    // 移动途中曾排了别的位置，但最新一帧又回到了正在前往的位置。
    pendingMove = null;
    return;
  }
  if (movingTo === null && samePoint(placed, at)) {
    pendingMove = null;
    return;
  }
  pendingMove = at;
  placedAtMs = Date.now();
  void drainStageMoves();
}

/**
 * 重读舞台几何。
 *
 * 工作区随时会变（程序坞显隐、改分辨率），所以不能只在启动时读一次。
 * 顺便校正舞台原点：移动窗口万一失败，运动层会一直以为舞台在新位置。
 * 刚下发过的那一小段时间不校正 - 那时读到的可能还是旧位置。
 */
async function refreshStage(): Promise<void> {
  const m = await probeStage().catch(() => null);
  if (!m) return;
  work = { x: m.work_x, y: m.work_y, w: m.work_w, h: m.work_h };
  if (Date.now() - placedAtMs > 500) {
    motion = settleStage(motion, { x: m.x, y: m.y });
    placed = { x: m.x, y: m.y };
  }
  // 屏幕变小了（改分辨率、拔掉外接屏）时把挂件拉回屏幕内，否则用户既看不见
  // 也拖不回来。没越界时这是空操作，不会覆盖用户自己摆的位置。
  props.reclamp(geometry());
}

/**
 * 启动时把舞台摆到桌面下沿。
 *
 * 放在窗口显示**之前**：窗口以 visible: false 启动，此时挪它没人看得见；
 * 显示之后再挪，用户会看到猫从屏幕中间跳到底下。
 * 这一步失败不能阻塞窗口显示 - 猫留在默认位置也比不出现好，所以自己吞掉错误。
 */
async function bootStage(): Promise<void> {
  try {
    const m = await probeStage();
    if (!m) return; // 浏览器里调试：舞台就是页面本身
    work = { x: m.work_x, y: m.work_y, w: m.work_w, h: m.work_h };
    const g = geometry();
    const x = clamp(m.x, work.x, work.x + Math.max(0, work.w - g.w));
    const y = work.y + work.h - g.h;
    await moveStage(x, y);
    motion = createMotion(g, { x, y });
    placed = { x, y };
    placedAtMs = Date.now();
  } catch (err) {
    console.error('[cyber-cat] 初始化舞台位置失败，猫会留在窗口默认位置：', err);
  }
}

let looping = false;
/** 猫是否已经就位（读到存档或领养完成）。领养期间帧循环绝不能起来。 */
let booted = false;

/**
 * 启动动画循环。
 *
 * **必须在窗口真正显示之后调用。**
 * requestAnimationFrame 对隐藏窗口不触发，在窗口还是 visible: false 时启动
 * 循环，回调会一直排队不执行；即使之后窗口显示了，画布上也只有一帧在隐藏期间
 * 画的内容，看起来就是「窗口在屏但完全透明」。
 */
function startLoop(): void {
  if (looping || !booted) return;
  looping = true;
  lastFrameMs = performance.now();
  lastWallMs = Date.now();
  // 浏览器里单独调试时没有光标探测命令，靠 pointermove 供样即可；
  // 真跑起轮询只会每 16ms 拿到一个 null 把 DOM 采样冲掉。
  if (inTauri) tracker.start();
  requestAnimationFrame(frame);
}

/**
 * 用当前意图把运动状态推一帧（dt = 0）。
 *
 * 启动路径上的两次首帧重画需要它：`playing` 是运动层算出来的，
 * 不先推一帧就还是 null，draw 会以为猫已离开而清空画布。
 */
function primeMotion(action: WorldActionKey | null): void {
  // 首帧不给锚点：这一帧只为算出 playing，给了锚点会让首帧直接播走路，
  // 而窗口刚显示、猫还没站定，第一眼看到的就是一只在走的猫。
  motion = stepMotion(motion, {
    dt: 0,
    now: performance.now(),
    action,
    anchorX: null,
    cat,
    geom: geometry(),
    rnd: Math.random,
  });
}

/**
 * 补算离线时段。
 *
 * 补算与常驻运行调的是同一个 `step`，只是 elapsedMs 大得多 -
 * 不存在「离线版模拟器」（ADR 0001）。
 */
async function catchUp(): Promise<void> {
  const leftAt = worldNow(world);
  const away = Math.min(MAX_CATCHUP_MS, Math.max(0, Date.now() - leftAt));
  const r = step(world, away, {});
  world = r.world;
  lastWallMs = Date.now();
  lastSaveMs = lastWallMs;
  lastTrayMs = lastWallMs;

  // 「离开了多久」只有这里知道，所以气泡的判定也只能在这里做一次
  // （ADR 0011）。渲染层不读墙上时钟 - 读了的话这条判定就没法测了。
  const offer = shouldOfferDiary({
    awayMs: away,
    since: leftAt,
    diary: world.diary,
    dead: world.dead,
  });
  bubbleArmedAt = offer ? performance.now() : null;

  if (away > 0) {
    console.info(
      `[cyber-cat] 补算了 ${(away / MS_PER_HOUR).toFixed(1)} 小时的离线时段，产出 ${r.events.length} 条事件` +
        (offer ? '，头顶冒了一个日记气泡' : ''),
    );
  }
  await saveWorld(world);
  await pushTrayStatus(trayStatus(world, r.renderIntent.status));
  // 补算之后世界可能已经换了姿态，先把首帧重画一次再启动循环。
  primeMotion(r.renderIntent.action);
  currentAction = motion.playing;
  animT = 0;
  draw(r.renderIntent, 0, performance.now());
}

/**
 * 点猫。
 *
 * 用 lastFrame 的掩膜做精确判定：光标可能落在猫周围的外扩边距里 - 那个边距
 * 存在的目的是提前关闭穿透（ADR 0006），不代表点到了猫。
 * 落在边距里的点击只能被丢掉：穿透是整窗一刀切的，此刻已经关着，没有办法把
 * 这一次点击转交给下层窗口。这也是边距必须尽量窄的原因。
 *
 * 不在这里切换穿透状态 - macOS 上赋值有传播延迟，到 pointerdown 才切已经太晚。
 */
/**
 * 按下、拖动、松手三件事共用一次按下。
 *
 * 判定顺序是「先当成可能的拖拽，松手时才知道到底是点还是拖」：
 * 反过来（按下就算抚摸）会让每一次拖拽都先摸一把猫，亲密度白涨。
 */
let pressAt: { x: number; y: number } | null = null;
/** 正在拖猫。null = 没在拖。值是光标的屏幕位置，每帧喂给运动层。 */
let holdAt: { x: number; y: number } | null = null;
/** 当前由猫画布捕获的指针。截图工具等系统覆盖层可能在按住期间夺走它。 */
let dragPointerId: number | null = null;
/** 最近一次知道的光标屏幕 x。落地反应要用它决定蹭回来还是走开。 */
let cursorScreenX: number | null = null;

/**
 * 清掉一次尚未正常结束的按下。
 *
 * 系统截图、锁屏和应用切换都可能让 WebView 收不到原来的 pointerup；只依赖
 * pointercancel 也不够，因为系统覆盖层不保证把取消事件转发给 WebView。无论从
 * blur、lostpointercapture 还是下一次无按键的 pointermove 进来，都走这里收尾，
 * 保证穿透强制状态与世界层的「被拎着」一起复位。
 */
function cancelPointerInteraction(): void {
  const wasHolding = holdAt !== null;
  pressAt = null;
  holdAt = null;

  const pointerId = dragPointerId;
  dragPointerId = null;
  if (pointerId !== null && canvas.hasPointerCapture(pointerId)) {
    canvas.releasePointerCapture(pointerId);
  }

  if (!wasHolding) return;
  passthrough.hold(false);
  enqueue({ type: 'drop' });
}

// --- 逗猫棒（issue #11）-----------------------------------------------------
//
// 六道闸门的判定全在 src/tease/gates.ts（纯函数、有测试）。这里只做三件事：
// 攒一段光标轨迹、把快照喂给闸门、把「扑到这个 x」交给运动层。
//
// **状态不进存档也不进 World**：它们由帧级事件驱动（扑了几次、上次是什么时候），
// 而世界层不能被帧级数据驱动（ADR 0001、0007）。重启后玩腻与每小时上限从头算，
// 这是可接受的 - 那两条防的是连续骚扰，重启本身就打断了连续性。
let tease: TeaseState = INITIAL_TEASE;
/** 最近一段光标轨迹（屏幕坐标）。运动特征闸门要看它。 */
let cursorTrail: CursorPoint[] = [];
/** 距用户上次按键多少秒。**探测失败时留 0**，也就是当成「正在打字」。 */
let keyboardIdleS = 0;
let lastIdleProbeMs = 0;
/** 闸门放行的时刻。到了性格决定的反应延迟才真的起跳。 */
let noticedAt: number | null = null;
/** 这次运行里最近一次进食的时刻（帧时钟）。刚吃饱犯困那条闸门要用。 */
let lastMealAtMs: number | null = null;
/** 上一帧运动层是否正在扑。用来在扑完那一帧记一笔账。 */
let teasing = false;

/** 光标轨迹最多留这么多点。420ms 的窗口按 16ms 采样最多 27 个，留 40 有余量。 */
const TRAIL_MAX = 40;

/** 键盘活跃探测的间隔，毫秒。它是一次 IPC，不值得每帧问。 */
const IDLE_PROBE_MS = 400;

/**
 * 记一个光标采样点，屏幕坐标。
 *
 * 两条路都会喂到这里：穿透关着时是 webview 的 pointermove，穿透开着时是 Rust 侧
 * 的轮询（那段时间 webview 收不到任何鼠标事件）。**运动特征闸门必须两条都要** -
 * 只用 pointermove 的话，猫在远处（穿透开着）时永远采不到样，而那正是逗猫开始的时候。
 */
function observeTrail(x: number, y: number, t: number): void {
  const last = cursorTrail[cursorTrail.length - 1];
  // 同一个位置重复采样对方向判定是噪声，丢掉。
  if (last !== undefined && last.x === x && last.y === y) return;
  cursorTrail.push({ x, y, t });
  if (cursorTrail.length > TRAIL_MAX) cursorTrail = cursorTrail.slice(-TRAIL_MAX);
}

/**
 * 探一次键盘活跃度。
 *
 * **探不出来就当成「用户正在打字」**（保持 keyboardIdleS = 0）：宁可让猫安静，
 * 也不要在用户打字时扑光标。这与 Rust 侧那条注释是同一个约定。
 */
function probeKeyboardIdle(now: number): void {
  if (now - lastIdleProbeMs < IDLE_PROBE_MS) return;
  lastIdleProbeMs = now;
  void inputIdle()
    .then((secs) => {
      keyboardIdleS = secs ?? 0;
    })
    .catch(() => {
      keyboardIdleS = 0;
    });
}

/**
 * 这一帧要不要开始一次逗猫扑跳，落点在哪。
 *
 * 六道闸门的判定在 src/tease/gates.ts。这里只负责组装快照，以及在闸门放行之后
 * **再等一个性格决定的反应延迟** - 零延迟的追逐读起来是程序在响应事件，
 * 不是一只猫动了心（见 tease/pounce.ts 的 reactDelayMs）。
 *
 * 返回 null 表示这一帧不下命令。运动层只在**开始**那一帧接命令，之后自己走完。
 */
function teaseThisFrame(intent: RenderIntent, now: number, g: StageGeometry): number | null {
  tease = refreshTease(tease, now);
  // 已经在扑了、或者正被拎着：不下新命令。
  if (motion.tease !== null || holdAt !== null) {
    noticedAt = null;
    return null;
  }

  const verdict = teaseVerdict({
    status: intent.status,
    mood: world.needs.mood,
    hunger: world.needs.hunger,
    lastMealAt: lastMealAtMs,
    keyboardIdleS,
    catX: motion.x,
    // 距离闸门从**猫这一刻的脚下**算，不是桌面那条地面线：猫站在窗口上时
    // 两者差几百像素，用地面线算的话光标明明就在它旁边却判成「太远」。
    catY: footScreenY(g, motion.liftY),
    trail: cursorTrail,
    pouncesInARow: tease.pouncesInARow,
    boredUntil: tease.boredUntil,
    lastPounceAt: tease.lastPounceAt,
    recentChases: tease.recentChases,
    quotaPerHour: quotaFor(cat.personality.active),
    now,
  });

  if (!verdict.ok) {
    // 闸门一关就把「注意到」清掉：用户中途停手了，猫不该在几百毫秒后突然扑出去。
    noticedAt = null;
    return null;
  }
  if (noticedAt === null) {
    noticedAt = now;
    return null;
  }
  if (now - noticedAt < reactDelayMs(cat.personality.active)) return null;

  noticedAt = null;
  const last = cursorTrail[cursorTrail.length - 1];
  if (last === undefined) return null;
  // 落点在光标旁边，不在光标上 - 不压住用户要点的东西。
  return pounceLandingX(last.x, motion.x);
}

window.addEventListener('pointerdown', (e) => {
  if (!e.isPrimary || e.button !== 0) return;
  // 上一次按下若被系统覆盖层截断，下一次真实按下就是最后一道自愈机会。
  if (pressAt !== null || holdAt !== null || dragPointerId !== null) {
    cancelPointerInteraction();
  }
  const p = toSprite(e.clientX, e.clientY);
  // 气泡先判。它在猫头顶、与猫的掩膜不重叠（diary/constants.ts 的
  // BUBBLE_BASE_SPRITE_Y 就是照这个量出来的），所以先后其实不冲突 -
  // 写清顺序是为了日后再加覆盖层时不产生歧义。
  if (bubbleRect && hitsRect(bubbleRect, p.x, p.y)) {
    showDiary();
    return;
  }
  if (!lastFrame) return;
  if (!hitTest(lastFrame, p.x, p.y)) return;
  // 指针捕获让正常拖动即使暂时滑出窗口也能继续；系统截图若夺走捕获，
  // lostpointercapture 会走下面的统一取消路径。
  dragPointerId = e.pointerId;
  canvas.setPointerCapture(e.pointerId);
  pressAt = { x: e.screenX, y: e.screenY };
});

window.addEventListener('pointermove', (e) => {
  // 穿透关闭时 webview 能收到 pointermove，这是比轮询更精确、且免费的采样源。
  // 穿透开启时收不到任何鼠标事件，那段时间只有 Rust 侧的轮询有数据。
  tracker.observe(e.clientX, e.clientY);
  cursorScreenX = e.screenX;
  observeTrail(e.screenX, e.screenY, performance.now());

  if (pressAt === null || dragPointerId !== e.pointerId) return;
  // 截图覆盖层可能吞掉 pointerup，恢复后浏览器只给一次 buttons=0 的移动。
  // 这时不能继续让猫黏着光标，应该把丢失的松手补回来。
  if ((e.buttons & 1) === 0) {
    cancelPointerInteraction();
    return;
  }
  if (holdAt === null) {
    if (Math.hypot(e.screenX - pressAt.x, e.screenY - pressAt.y) < DRAG_THRESHOLD_PX) return;
    // 越过阈值：这一次按下是拖拽。**拎起来要作为 UserAction 进世界层** -
    // 醒来与心情在那边结算（world/tick.ts 的 pickUp），这里只管画面跟手。
    enqueue({ type: 'pickUp' });
    // 拖拽期间强制关掉穿透，否则窗口追不上光标时判定会把穿透打开，拖拽当场断掉。
    passthrough.hold(true);
  }
  holdAt = { x: e.screenX, y: e.screenY };
});

window.addEventListener('pointerup', (e) => {
  if (dragPointerId !== e.pointerId) return;
  const start = pressAt;
  const wasHolding = holdAt !== null;
  pressAt = null;
  holdAt = null;
  dragPointerId = null;
  if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  cursorScreenX = e.screenX;
  if (wasHolding) {
    passthrough.hold(false);
    // 落地反应（蹭回来 / 走开 / 甩尾巴）由运动层按性格执行，世界层只结算心情。
    enqueue({ type: 'drop' });
    return;
  }
  if (start === null) return;
  // 没越过阈值：这是一次抚摸。两件事都要做，理由见 REACTION 的注释。
  enqueue({ type: 'pet' });
  const now = performance.now();
  const durationMs = petReactionDurationMs();
  reactionUntilMs = now + durationMs;
  reactionRestartPending = true;
  hearts = [...hearts, ...burstHearts(now, motion.x, durationMs)];
});

window.addEventListener('pointercancel', (e) => {
  if (dragPointerId === e.pointerId) cancelPointerInteraction();
});

canvas.addEventListener('lostpointercapture', (e) => {
  if (dragPointerId === e.pointerId) cancelPointerInteraction();
});

// Windows 截图、macOS 截图/切换 Space、锁屏都会先让 WebView 失去活动状态。
// 即使平台没有补发 pointercancel，也不能让猫永久停在 held。
window.addEventListener('blur', cancelPointerInteraction);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) cancelPointerInteraction();
});

// 跨屏拖动或系统缩放变化时重算设备缩放，保持像素锐利
window.addEventListener('resize', () => applyGeometry());
matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener('change', () =>
  applyGeometry(),
);

/**
 * 真机验收用的调试钩子。
 *
 * 微动作层的贡献只能靠「关掉再看」判断（prototype ② 的做法），而这五个开关
 * 没有界面入口 - 有界面入口反而是产品噪音。挂在这里让验收时能在 devtools 里
 * `__cyberCat.micro({ tail: false })`。
 */
(window as unknown as { __cyberCat: unknown }).__cyberCat = {
  micro: (patch: Partial<MicroSwitches>): MicroSwitches => {
    micros = { ...micros, ...patch };
    return micros;
  },
  motion: (): MotionState => motion,
  /**
   * 爬窗口这条链上的三段读数（ticket 12）。真机验收基本靠它。
   *
   * 「猫为什么不爬这个窗口」有六七种原因（太高、太低、太窄、跨 DPI、世界层不允许、
   * 还在冷却、还没抽中），肉眼一个也看不出来。这个钩子把三段都摊开：
   * 平台层读到什么（window）、判断层认为能不能站（surface）、这一刻要不要上去（desire）。
   */
  perch: (): unknown => ({
    window: foreground.window,
    surface: perchSurfaceOf(foreground.window, geometry(), display.pixelRatio),
    desire: perchDesire,
    liftY: motion.liftY,
    phase: motion.perch?.phase ?? null,
  }),
};

void onTrayAction((id) => {
  if (id === 'feed') enqueue({ type: 'fillBowl' });
  else if (id === 'medicate') enqueue({ type: 'medicate' });
  // 告别页是个能关掉的窗口，而它同时是「领养新猫」的唯一入口 -
  // 没有这一项，关掉之后用户就困在一个空桌面上了。
  else if (id === 'memorial') {
    void farewell.reopen().catch((err: unknown) => {
      console.error('[cyber-cat] 打开告别页失败：', err);
    });
  }
  // 日记的常驻入口。气泡只在离开够久之后出现一次，托盘里这条永远在
  // （CONTEXT.md 的托盘菜单）。
  else if (id === 'diary') showDiary();
  // 托盘里的两个挂件开关。挂件可隐藏，但要能再打开，所以是勾选项而不是「隐藏」。
  else if (id === 'prop-bowl') void props.toggle('bowl');
  else if (id === 'prop-bed') void props.toggle('bed');
  // 安静模式。**它不是一次 UserAction** - 世界层不认识这个开关（塞进去会毁掉
  // 离线推演的等价性，见 app/restraint.ts）。所以这里只改应用层的状态、写盘、
  // 再把勾选状态推回托盘。
  else if (id === 'quiet') void toggleQuiet();
});

/**
 * 拨动安静模式。
 *
 * 三件事的顺序：先改内存（下一帧立刻生效），再推托盘（用户要马上看到勾上了），
 * 最后写盘。写盘失败只记录 - 开关本帧已经生效了，代价只是下次启动回到旧值，
 * 而为此把已经生效的状态回滚会让用户看到勾选自己跳回去。
 */
async function toggleQuiet(): Promise<void> {
  settings = withQuiet(settings, !settings.quiet);
  await pushQuietMenu(settings.quiet);
  await saveSettings(settings).catch((err: unknown) => {
    console.error('[cyber-cat] 保存安静模式失败，下次启动会回到旧值：', err);
  });
}

// 点食盆与点托盘的「喂食」是同一件事：都只是往碗里添粮这个**邀请**，
// 吃不吃仍然由猫决定（world/tick.ts 的进食分支）。
props.listen(() => enqueue({ type: 'fillBowl' }));

/**
 * 谁来养这只猫。
 *
 * 浏览器里直接打开 index.html 调试时没有第二个窗口可开，随手挑一只猫顶上 -
 * 这条路只为调渲染与运动层，跟真机的领养流程无关，所以大声说出来。
 */
const gate: AdoptionGate = {
  loadWorld,
  adopt: async (): Promise<AdoptedIdentity> => {
    if (!inTauri) {
      const { candidate } = beginAdoption(Math.random);
      console.info('[cyber-cat] 浏览器调试模式：随手挑了一只猫，真机上这里是领养窗口', candidate);
      return { ...candidate, name: '调试猫' };
    }
    return requestAdoption({
      waitForAdopted,
      // 放弃领养要不要退出应用，取决于此刻有没有别的路可走，而 `booted` 正好是
      // 「猫已经就位过」：首次启动时还是 false（没有猫，退出），
      // 告别页之后再领养时是 true（托盘里还能再打开告别页，不该退出）。
      openAdoption: () => openAdoption(ADOPT_W, withChrome(ADOPT_H), !booted),
    });
  },
  saveWorld,
  now: Date.now,
  tzOffsetMinutes,
};

/** 领养流程正在进行。用户可能连点两次「再养一只」，或者托盘与告别页各点一次。 */
let adopting = false;

/**
 * 告别之后再养一只（issue #13 的「可无惩罚地领养新猫」）。
 *
 * 走 adoptNewCat 而不是 ensureWorld：那个函数「有存档就接着养」，
 * 而此刻存档里躺着的正是刚死掉的那只猫，读回来等于什么都没发生。
 *
 * 旧猫留下的运行期状态必须一起清掉。它们都**不在存档里**（运动层、待结算动作、
 * 即时反馈的截止时刻），所以换猫时没有任何机制会自动重置 - 不清的话新猫会顶着
 * 上一只的动作出场，甚至立刻结算掉一个用户当时对旧猫做的动作。
 */
async function adoptAnother(): Promise<void> {
  if (adopting) {
    // 领养已经在进行中。把窗口重新开出来（open_adoption 是幂等的，已经开着就聚焦）-
    // 用户可能把领养窗口关掉了，然后从托盘再打开告别页又点了一次。
    //
    // **但不再挂第二条等待。** `waitForAdopted` 是一条 once 监听，关掉窗口不会让它
    // 落地，它仍然活着等着同一个事件；再挂一条的话两条会在同一个事件上一起落地，
    // 结果是连着领养两只猫，第二只当场把第一只覆盖掉。
    // 反过来说，正因为原来那条等待还活着，重新开出来的窗口选完猫照样能走通。
    await openAdoption(ADOPT_W, withChrome(ADOPT_H), false).catch((err: unknown) => {
      console.error('[cyber-cat] 重新打开领养窗口失败：', err);
    });
    return;
  }
  adopting = true;
  try {
    install(await adoptNewCat(gate));
    // 让下一次死亡重新走一遍入档与告别页。
    farewell.reset();
    pending = [];
    reactionUntilMs = 0;
    reactionRestartPending = false;
    animT = 0;
    lastWallMs = Date.now();

    const intent = renderIntentOf(world, cat);
    primeMotion(intent.action);
    currentAction = motion.playing;
    draw(intent, 0, performance.now());
    await pushTrayStatus(trayStatus(world, intent.status));
  } catch (err) {
    // 领养失败**不兜底**给一只猫（与 ensureWorld 同一条理由）：
    // 那会让用户拿到一只不是他选的猫。旧猫的告别页仍能从托盘再打开，还有路可走。
    console.error('[cyber-cat] 领养新猫失败：', err);
  } finally {
    adopting = false;
  }
}

void onAdoptAnother(() => void adoptAnother());

/**
 * 启动顺序：确定是哪只猫 → 画出第一帧 → 摆好舞台位置 → 通知 Rust 显示窗口
 *          → 补算离线时段 → 启动动画循环。
 *
 * **确定是哪只猫必须排在最前面。** 首次启动时这一步会停在领养窗口上等用户挑完，
 * 期间宠物窗口还是 `visible: false`（tauri.conf.json），所以「领养完成前不显示猫」
 * 是结构上的保证，不需要谁记得别画。
 * 代价是有存档时启动多等一次读文件 - 曾经为了省掉这次等待把读存档挪到显示窗口
 * 之后，代价是首帧画的是占位猫；现在没有占位猫可画了，这笔交易反过来了。
 *
 * **首帧、显示窗口与启动循环这三步的先后不能变。** 窗口以 visible: false 启动，而
 * requestAnimationFrame 对隐藏窗口不触发。这个约束踩过两次坑：
 *   1. 把「通知显示」放进 rAF 回调 → 死锁，窗口永远不出现（应用与托盘都正常）。
 *   2. 在窗口显示前就启动循环 → 窗口出现了但完全透明，因为画布上只有一帧
 *      在隐藏期间画的内容，循环的回调一直排队没执行。
 *
 * 摆舞台插在显示之前：窗口还看不见时挪它是免费的，显示之后再挪用户会看到猫从
 * 屏幕中间跳到底下。它是一次纯内存的 IPC（不读文件），推迟量可以忽略，
 * 而且失败会被自己吞掉，不会连带挡住窗口显示。
 *
 * 挂件的摆放排在补算之后、起循环之前：它也要读文件，而且**必须在猫开始漫游之前
 * 摆好** - 否则头几秒猫会按默认位置去找食盆，然后食盆突然挪到别处。
 */
async function boot(): Promise<void> {
  // 动作条带与存档读取可以并行。首帧之前必须全部解码完成，否则透明窗口会先出现。
  const spritesReady = xiaomiSprites.load();
  // 开关要在第一帧之前读到：安静模式下猫应该一开始就趴着，
  // 而不是先站起来走两步再想起来现在该安静。
  settings = await loadSettings();
  void pushQuietMenu(settings.quiet);

  install(await ensureWorld(gate));
  await spritesReady;

  const intent = renderIntentOf(world, cat);
  primeMotion(intent.action);
  currentAction = motion.playing;
  draw(intent, 0, performance.now());

  await bootStage();
  await contentReady();
  await catchUp();
  await props.boot(geometry());
  booted = true;
  startLoop();
}

void boot().catch((err) => {
  // 领养失败也走这里：窗口留在隐藏状态，托盘还在，用户可以退出重来。
  // 不兜底给一只猫 - 那会让用户拿到一只不是他选的猫，而且再也回不到领养流程。
  console.error('[cyber-cat] 启动失败：', err);
});

// 兜底：窗口从隐藏变为可见时确保循环在跑（例如被系统遮挡后恢复）。
// startLoop 自带幂等保护 - 不要直接 requestAnimationFrame，那会多起一条帧链。
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) startLoop();
});
