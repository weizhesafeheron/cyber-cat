import { H, W } from '../render/index.js';
import { TARGET_SCALE } from '../app/stage.js';

/**
 * 领养流程的可调数值。
 *
 * 全部集中在这里，因为领养是**一次性流程**：真机上想再看一遍就得删存档重启。
 * 数字散在四个文件里的话，每调一次节奏都要翻一遍，谁都不会去调。
 *
 * 术语按 CONTEXT.md：这一步叫**领养** - 猫从赛博城市的雨夜里走来并停下，
 * 用户接纳并为它命名。不是「生成」也不是「创建角色」，界面文案里不出现这类词。
 */

/**
 * 猫在领养窗口里的放大倍数。
 *
 * 与桌面上一致（stage.ts 的 TARGET_SCALE）：领养时看到的大小就是它以后站在
 * 桌面上的大小，否则用户会觉得「领回来的猫缩水了」。
 */
export const ADOPT_SCALE = TARGET_SCALE;

/**
 * Seed 的取值空间。
 *
 * mulberry32 吃的是 32 位无符号整数，而 makeCat 会先算 `seed * 7919 + ...`。
 * 取 2^31 是为了让那个乘法留在 IEEE754 能精确表示的整数范围内 -
 * 超出之后不同的 Seed 会算出同一个内部状态，个体差异凭空消失一部分。
 */
export const SEED_SPACE = 2 ** 31;

/**
 * 名字长度上限，按**码点**计。
 *
 * 12 够写「小橘」也够写一句短昵称，而托盘菜单与日记里塞得进去。
 * 按码点而不是 UTF-16 长度算：'🐱'.length 是 2，按长度判会让 emoji 名字凭空少一半额度。
 */
export const NAME_MAX_CHARS = 12;

/** 性格三分档的分界。低于 LOW 是一档，高于 HIGH 是一档，中间一档。 */
export const TRAIT_LOW = 1 / 3;
export const TRAIT_HIGH = 2 / 3;

/**
 * 领养窗口的客户区尺寸，CSS 逻辑像素（= Tauri 的 LogicalSize，= CSS 像素）。
 *
 * **小尺寸居中、用完即关**（mvp-scope 第 7 节）：它不是主界面，只是一次相遇。
 *
 * 宽度按「猫要有走进来的余地」定：精灵 3 倍宽是 216，给到 464 之后猫可以从画面外
 * 走进正中，走完身后还剩一个身位的雨幕。
 *
 * 高度按最高的那一步定。实测（headless Chrome，PingFang SC）：打量这一步排下来
 * 393，起名那一步输入框独占一行、443。这里给到 468。
 * **那 25 像素余量不是随手加的**：页面 overflow 是 hidden，而 Windows 上用的是
 * Microsoft YaHei，行高与 PingFang 并不相同 - 卡着 443 排在 macOS 上正好，
 * 到 Windows 上就可能把最后一行提示裁掉，而这是个本地看不见的问题。
 */
export const ADOPT_W = 920;
export const ADOPT_H = 720;
/** 左侧雨夜预览区的设计宽度。入场动画按这里裁切，不按整个双栏窗口。 */
export const ADOPT_PREVIEW_W = 478;

/** 雨夜画面的高度，CSS 逻辑像素。猫贴在它的下沿。 */
export const SKY_H = H * ADOPT_SCALE + 22;

/** 精灵宽的一半，CSS 逻辑像素。猫的锚点是精灵横向中心，进出场都按它算。 */
export const HALF_SPRITE = (W * ADOPT_SCALE) / 2;

/**
 * 猫停下的位置：画面正中偏左一点。
 *
 * 偏左是有意的：正中会与下方的文字块中轴重合，看起来像一张对齐好的说明图；
 * 偏开之后画面右侧留出的雨幕成了「它刚从那边走来」的方向暗示。
 */
export const REST_X = 230;

/** 入场起点与离场终点：都在画面外一个身位，看不到猫凭空出现或消失。 */
export const ENTER_X = ADOPT_PREVIEW_W + HALF_SPRITE;
export const EXIT_X = -HALF_SPRITE;

/**
 * 走到位之后站着看你多久才坐下，秒。
 *
 * 一停下就坐会像个开关；站着喘两口再坐下才读得出「它在打量你」。
 */
export const SETTLE_S = 1.6;

/** 单帧推进动画相位的上限，秒。与宠物窗口一致，掉帧时不要让动作跳一大段。 */
export const MAX_ANIM_DT = 0.05;

/**
 * 雨。
 *
 * 赛博朋克氛围在 ADR 0004 之后不再由背景画面承担，但**领养的雨夜是文案与呈现的
 * 一部分**（mvp-scope 第 1 与第 7 节明确保留）。所以这里只做「雨 + 夜色 + 远处霓虹的
 * 光晕」，不重建被废弃的「赛博公寓一角」场景 - 没有家具，没有房间，只有雨。
 */
export const RAIN_DROPS = 90;
/** 雨滴下落速度范围，CSS 像素每秒。 */
export const RAIN_SPEED = [260, 620] as const;
/** 雨丝长度范围，CSS 像素。 */
export const RAIN_LEN = [8, 26] as const;
/** 横向风偏：雨斜着下，纯竖直的雨看起来像静止的栅格。 */
export const RAIN_WIND = -0.28;
/** 雨滴不透明度范围。远处的雨淡、近处的雨亮，一起构成纵深。 */
export const RAIN_ALPHA = [0.14, 0.5] as const;
