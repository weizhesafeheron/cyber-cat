import { HIGHLIGHT, MOUTH_DARK, OUTLINE, PUPIL, tone } from '../render/palette.js';
import type { Cat, Ramp } from '../render/index.js';

/**
 * 托盘图标：一个 18×18 的像素猫头，按整数倍放大后交给 Rust 侧的
 * `tauri::image::Image`。
 *
 * **为什么是 18。** tray-icon 0.24 在 macOS 上把任何图标缩放到 18 点高
 * （`platform_impl/macos/mod.rs` 里的 `let icon_height: f64 = 18.0`）。
 * 只有 18 的整数倍才不会被系统重采样 - 差一个像素，整张像素画就会糊成
 * 一团带灰边的东西。所以尺寸不是画好之后量出来的，是先定死再往里画。
 *
 * **为什么不复用渲染层的 `Raster`。** 那个类的 72×56 是所有品种参数的标定
 * 尺度（`docs/art-and-motion-decisions.md`），把猫头缩到 18 只能靠重采样，
 * 而重采样正是这里要躲开的东西。托盘图标是另一张画，不是同一张画的缩略图。
 *
 * **为什么不做 macOS 模板图标（纯 alpha 单色）。** 模板图标只有形状没有颜色，
 * 而这个应用的身份就是彩色像素猫，四个状态里有两个（sick 的降饱和、dead 的
 * 灰掉）本来就是靠颜色说话的。单色版本等于把五个状态压回「靠形状分」，
 * 在 18×18 上分不开。
 *
 * 纯函数：不碰 DOM、不碰 canvas、不取时间也不取随机数，
 * 同样的入参逐字节相同。因此可以在 node 里测（test/tray/icon.test.ts）。
 */

/** 托盘图标的边长，缩放前的像素。见文件头：这个数由 tray-icon 定死。 */
export const TRAY_ICON_SIZE = 18;

/**
 * 托盘图标要表达的状态。
 *
 * 比世界层的 `CatStatus` 少一档：`starving` 并到 `hungry`。
 * 「饿了」与「在挨饿」的区别是一个倒计时，18×18 上没有第二个记号的位置，
 * 硬分成两档只会让两个图标看起来一样 - 那条信息交给 tooltip 与菜单文案。
 */
export type TrayIconState = 'ok' | 'sleeping' | 'hungry' | 'sick' | 'dead';

export interface TrayIconBitmap {
  readonly w: number;
  readonly h: number;
  /** RGBA，逐行，长度 = w * h * 4。要交给 Rust 的 tauri::image::Image。 */
  readonly rgba: Uint8Array;
}

// ---------------------------------------------------------------------------
// 五个状态靠什么分开
// ---------------------------------------------------------------------------

/**
 * **判据：每个状态至少改动两处，且其中一处是整块的（徽章或全局调色）。**
 *
 * 在 18×18 上，「只改眼睛」这种改动约 12 个像素，放大两倍后仍然要凑近看；
 * 所以每一档都必须再叠一个大面积的变化。逐档如下：
 *
 * | 状态     | 大面积的那处            | 五官那处                 |
 * |----------|-------------------------|--------------------------|
 * | ok       | 无（唯一没有徽章的一档）| 睁眼，带瞳孔与高光       |
 * | sleeping | 右下角「Z」徽章         | 眼睛闭成横线 + 耳朵压平  |
 *
 * **已知的弱项（真机验收时看过并接受，2026-07-30）**：sleeping 那个 Z 在 18 像素上
 * 糊成一个带折线的小方块，深色菜单栏上尤其读不出是字母 - 真正在起作用的是闭眼与压耳。
 * 试过的改法：去掉徽章底让 Z 直接落在透明背景上（腾出两个像素给字形），
 * 以及干脆不要这个徽章。所有者选择先保持现状，因为「有没有徽章」本身已经是第一层信息，
 * 而这一档不需要盯着托盘去确认。要改的话从那两条里挑一条。
 * | hungry   | 右下角空食盆徽章        | 张嘴                     |
 * | sick     | 全身降饱和 + 橄榄色偏移 | 半闭的病眼（上眼睑压下） |
 * | dead     | 全身灰掉并压暗          | 眼睛变成两个叉           |
 *
 * 「有没有徽章」把 ok 和其余四档一刀切开，这是最先被读到的一位信息：
 * 托盘里多了个小方块 = 猫有事。剩下三个徽章靠形状与颜色分（蓝食盆 / 红十字 /
 * 深紫 Z），dead 不给徽章 - 它已经整只灰掉了，再挂个记号反而弱化「灰」这个信号。
 *
 * **被否决的画法：**
 *
 * - *把记号画在脸上*（嘴边一个碗色的点、鼻梁上一道病纹）。18×18 的脸上，
 *   口鼻区总共只有 10 个像素，任何画上去的记号都会和鼻子抢位置，读起来是
 *   「这只猫脸脏了」而不是「它饿了」。徽章挪到右下角之后，脸保持干净，
 *   记号也能画到 5×4 这么大。
 * - *只靠眼睛区分四档*（睁眼 / 闭眼 / 眯眼 / 叉眼）。眼睛一共 12 个像素，
 *   四档之间两两只差三五个像素，在菜单栏里是同一个图标。
 * - *只靠颜色区分*（饿了偏黄、生病偏绿）。品种自带七套配色，
 *   全局色偏会和品种色混在一起 - 橘猫「偏黄」看不出来。
 *   所以全局调色只用在 sick 与 dead 这两档「降」的方向上（降饱和、去色），
 *   降饱和对七个品种都成立，加色不成立。
 * - *给 sleeping 也做全局压暗*。压暗与 dead 的灰掉是同一类信号，
 *   两档会在余光里混淆；睡着改成动形状（耳朵压平 + 闭眼）+ Z 徽章。
 */

// ---------------------------------------------------------------------------
// 猫头的版式
// ---------------------------------------------------------------------------

const N = TRAY_ICON_SIZE;

/** 每一行：[y, x 起, x 止（含）]。全部关于 x = 8.5 对称，写的时候拿 x0+x1=17 校验。 */
type Span = readonly [number, number, number];

/**
 * 头骨。上宽下窄收到下巴，最宽处 14 像素（x 2..15），左右各留 1 像素给描边。
 *
 * 不用椭圆光栅化：18 像素高的椭圆逐行算出来的宽度是 2、8、12、13、14…，
 * 顶上那两行会细成一条缝。这个尺度上手写每一行反而更可控。
 */
const SKULL: readonly Span[] = [
  [4, 5, 12],
  [5, 3, 14],
  [6, 2, 15],
  [7, 2, 15],
  [8, 2, 15],
  [9, 2, 15],
  [10, 2, 15],
  [11, 3, 14],
  [12, 4, 13],
  [13, 5, 12],
  [14, 7, 10],
];

/** 竖着的耳朵。耳尖两像素宽，耳根四像素宽。 */
const EARS_UP: readonly Span[] = [
  [2, 3, 4],
  [2, 13, 14],
  [3, 2, 5],
  [3, 12, 15],
  [4, 2, 5],
  [4, 12, 15],
];

/**
 * 压平的耳朵（睡着）。少一行、耳尖往外挪一格。
 *
 * 只矮一行看起来像画错了，往外挪之后才读成「耳朵摊下去了」-
 * 猫放松时耳朵是往两侧倒的，不是缩短的。
 */
const EARS_FLAT: readonly Span[] = [
  [3, 2, 4],
  [3, 13, 15],
  [4, 2, 5],
  [4, 12, 15],
];

/** 内耳。醒着时两行、压平时只剩耳根那行。 */
const INNER_EAR_UP: readonly Span[] = [
  [3, 3, 4],
  [3, 13, 14],
  [4, 3, 4],
  [4, 13, 14],
];
const INNER_EAR_FLAT: readonly Span[] = [
  [4, 3, 4],
  [4, 13, 14],
];

/** 口鼻区。下面一行收窄，给右下角的徽章让开位置。 */
const MUZZLE: readonly Span[] = [
  [11, 6, 11],
  [12, 7, 10],
];

/** 眼睛的三列。左右各 3 像素宽，瞳孔在中列，高光在外侧上角。 */
const EYE_X0 = [4, 11] as const;
const EYE_Y = 8;
const PUPIL_X = [5, 12] as const;
const HIGHLIGHT_X = [4, 13] as const;

/** 额头虎斑的四列（中间两道 + 两侧各一道），只在 `marks.headStripes` 时画。 */
const STRIPE_X: readonly number[] = [5, 8, 9, 12];
const STRIPE_Y: readonly number[] = [5, 6];

/**
 * 取色阶用的头部中心与半高。
 *
 * 这两个数只服务 `tone()`：上亮、中、下暗。直接照搬渲染层那条规则，
 * 是为了让托盘上的猫和桌面上的猫是同一只 - 换一套明暗规则，
 * 同一个品种在两处会读成两种颜色。
 */
const HEAD_CY = 9.5;
const HEAD_RY = 5.5;

// ---------------------------------------------------------------------------
// 徽章
// ---------------------------------------------------------------------------

/**
 * 徽章占右下角 5×4，外面再套一圈描边色，总共 7×6。
 *
 * 尺寸下限是「一眼看见」定的：整张图 18×18，徽章连描边约占 12%，
 * 是余光里能分辨的最小块。再小就要靠盯着看，那这一整套就白做了。
 * 位置压在下巴右侧、故意与头有一像素重叠 - 完全离开头会读成两个东西。
 */
const BADGE_X0 = 12;
const BADGE_Y0 = 13;
const BADGE_W = 5;
const BADGE_H = 4;

/**
 * 徽章底板。一律用亮色，记号才用彩色。
 *
 * 反过来（深底板 + 亮记号）在黑猫身上会糊掉：黑猫的毛色是 `#3b3850`，
 * 深底板加深色描边贴上去就是一块看不出边界的暗斑。亮底板对七个品种都成立 -
 * 最亮的奶牛猫是纯白，靠那圈描边分开。
 */
const BADGE_PLATE = '#f4f1e6';

/** 空食盆的两档蓝，与挂件那个食盆同色（src/props/art.ts）- 换个蓝就成了另一套美术。 */
const BOWL_RIM = '#4a5ea0';
const BOWL_BODY = '#3d4f8a';
/** 药十字。整张图里唯一的红，红十字是不需要解释的记号。 */
const CROSS_RED = '#c0313f';
/** 睡着的 Z。深紫，与食盆蓝拉开色相 - 两个徽章形状不同，颜色也不能撞。 */
const ZZZ_INK = '#3a2f63';

interface Badge {
  /** BADGE_H 行 × BADGE_W 列。'.' = 底板，其余查 legend。 */
  readonly rows: readonly string[];
  readonly legend: Readonly<Record<string, string>>;
}

/**
 * 三个徽章。空盆朝上开口、十字居中、Z 带一道斜线。
 *
 * 食盆画的是**空盆**：饿了要表达的是「该添粮了」，画上粮堆等于在说碗里有东西。
 */
const BADGES: Readonly<Record<'sleeping' | 'hungry' | 'sick', Badge>> = {
  hungry: {
    rows: ['.....', 'RRRRR', '.BBB.', '..B..'],
    legend: { R: BOWL_RIM, B: BOWL_BODY },
  },
  sick: {
    rows: ['.....', '..X..', 'XXXXX', '..X..'],
    legend: { X: CROSS_RED },
  },
  sleeping: {
    rows: ['ZZZZZ', '...Z.', '.Z...', 'ZZZZZ'],
    legend: { Z: ZZZ_INK },
  },
};

// ---------------------------------------------------------------------------
// 调色：sick 与 dead 的全局变换
// ---------------------------------------------------------------------------

type RGB = readonly [number, number, number];

function rgbOf(hex: string): RGB {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

const mix = (a: number, b: number, k: number): number => Math.round(a + (b - a) * k);

/** 感知亮度。降饱和沿它走，才不会把亮的毛色降成一样深的灰。 */
const luma = (c: RGB): number => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];

/**
 * 生病的偏色。降饱和之后再压一点橄榄绿。
 *
 * 只降饱和是不够的：奶牛猫与美短本来就是灰白配色，降饱和对它们几乎不改颜色，
 * 「生病」这一档在这两个品种上会消失。补一点冷绿之后，七个品种的每一个毛色像素
 * 都会变，这条才成为对所有猫都成立的信号。
 */
const SICK_TINT = rgbOf('#93a06a');
const SICK_DESAT = 0.6;
const SICK_TINT_K = 0.18;

/** 死亡：完全去色再压暗。压暗是为了和 sick 分开 - 纯去色对白猫等于什么都没做。 */
const DEAD_DIM = 0.78;

type Recolor = (c: RGB) => RGB;

function recolorFor(state: TrayIconState): Recolor | null {
  if (state === 'sick') {
    return (c) => {
      const g = luma(c);
      const d: RGB = [mix(c[0], g, SICK_DESAT), mix(c[1], g, SICK_DESAT), mix(c[2], g, SICK_DESAT)];
      return [
        mix(d[0], SICK_TINT[0], SICK_TINT_K),
        mix(d[1], SICK_TINT[1], SICK_TINT_K),
        mix(d[2], SICK_TINT[2], SICK_TINT_K),
      ];
    };
  }
  if (state === 'dead') {
    return (c) => {
      const g = Math.round(luma(c) * DEAD_DIM);
      return [g, g, g];
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// 画布
// ---------------------------------------------------------------------------

/**
 * 18×18 的逐像素画布。
 *
 * 存 RGB 三元组而不是十六进制字符串：sick 与 dead 要对整张图做一次调色，
 * 存字符串就得来回转换。挂件那边（src/props/art.ts）没有调色需求，所以存的是字符串。
 */
class IconGrid {
  private readonly buf: (RGB | undefined)[] = new Array<RGB | undefined>(N * N);

  px(x: number, y: number, hex: string | undefined): void {
    if (x < 0 || y < 0 || x >= N || y >= N || !hex) return;
    this.buf[y * N + x] = rgbOf(hex);
  }

  /** 画一行。`hex` 是回调，因为毛色按列取花纹。 */
  span([y, x0, x1]: Span, hex: (x: number, y: number) => string | undefined): void {
    for (let x = x0; x <= x1; x++) this.px(x, y, hex(x, y));
  }

  spans(rows: readonly Span[], hex: (x: number, y: number) => string | undefined): void {
    for (const row of rows) this.span(row, hex);
  }

  private at(x: number, y: number): RGB | undefined {
    if (x < 0 || y < 0 || x >= N || y >= N) return undefined;
    return this.buf[y * N + x];
  }

  /** 整张图调色。徽章与描边在这之后才画，因此不受影响。 */
  recolor(fn: Recolor): void {
    for (let i = 0; i < N * N; i++) {
      const c = this.buf[i];
      if (c) this.buf[i] = fn(c);
    }
  }

  /**
   * 描边：给所有紧贴非空像素的空像素涂上描边色。
   *
   * **必须在所有色块之后、徽章之前跑。** 之前跑会在部件之间描出内部黑线，
   * 之后跑会绕着徽章再描一圈 - 徽章自带一圈描边，两圈叠起来是 2 像素的黑框。
   * 先收集再写入，避免刚写下的描边成为下一个像素的邻居而级联扩散。
   * 这两条约束与渲染层的 `outlinePass` 完全相同，踩过的坑也相同。
   */
  outline(): void {
    const marks: number[] = [];
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        if (this.buf[y * N + x]) continue;
        if (this.at(x + 1, y) || this.at(x - 1, y) || this.at(x, y + 1) || this.at(x, y - 1)) {
          marks.push(y * N + x);
        }
      }
    }
    const ink = rgbOf(OUTLINE);
    for (const i of marks) this.buf[i] = ink;
  }

  /**
   * 输出 RGBA。整数最近邻复制放大：每个原始像素铺成 scale×scale 个完全相同的四元组。
   *
   * alpha 只会是 0 或 255。半透明边缘在浅色菜单栏上会读成灰边，
   * 而系统那一道 18 点的缩放会把灰边糊得更宽。
   */
  toRgba(scale: number): Uint8Array {
    const size = N * scale;
    const rgba = new Uint8Array(size * size * 4);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const c = this.buf[y * N + x];
        if (!c) continue;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const o = ((y * scale + sy) * size + x * scale + sx) * 4;
            rgba[o] = c[0];
            rgba[o + 1] = c[1];
            rgba[o + 2] = c[2];
            rgba[o + 3] = 255;
          }
        }
      }
    }
    return rgba;
  }
}

// ---------------------------------------------------------------------------
// 毛色
// ---------------------------------------------------------------------------

/**
 * 这一格该取哪条色阶。
 *
 * 只认三件 `marks` 里的事：虎斑的额纹、奶牛猫的半脸斑、奶牛猫的单耳斑。
 * 挑这三件是因为它们在 18×18 上还看得出来 - 德文的卷毛纹、阿比的 ticked 斑点
 * 都是逐像素哈希出来的细密纹理，缩到这个尺度只会变成几颗噪点，
 * 读起来是「图标脏了」。那两个品种靠调色板本身区分。
 *
 * 布偶的面罩同理没有画：`maskDepth` 的取值范围很宽，浅面罩在 18×18 上
 * 只剩两三个像素，深面罩又会盖掉半张脸 - 同一个品种的图标忽轻忽重，
 * 比不画更糟。
 */
function headRamp(cat: Cat, x: number, y: number): Ramp {
  const m = cat.marks;
  if (m.headStripes && STRIPE_Y.includes(y) && STRIPE_X.includes(x)) return cat.pal.mark;
  // 奶牛猫的半脸斑。渲染层那边是两个子圆求并 + 哈希抖动，这里退化成一条竖边界：
  // 18 像素宽的脸上，不规则边缘的抖动幅度会大过斑块本身。
  if (m.headPatch && y <= 10 && m.headPatch.side * (x - 8.5) >= 2) return cat.pal.mark;
  if (y <= 4 && ((m.earL && x <= 5) || (m.earR && x >= 12))) return cat.pal.mark;
  return cat.pal.base;
}

/** 毛色：查花纹层 → 按行选色阶。与渲染层的 `furShade` 是同一条规则。 */
function fur(cat: Cat): (x: number, y: number) => string {
  return (x, y) => headRamp(cat, x, y)[tone((y - HEAD_CY) / HEAD_RY)];
}

// ---------------------------------------------------------------------------
// 五官
// ---------------------------------------------------------------------------

function drawEyes(g: IconGrid, cat: Cat, state: TrayIconState): void {
  for (let side = 0; side < 2; side++) {
    const x0 = EYE_X0[side]!;
    if (state === 'sleeping') {
      // 闭眼：一条描边色的横线，与渲染层全闭时的画法一致。
      for (let dx = 0; dx < 3; dx++) g.px(x0 + dx, EYE_Y + 1, OUTLINE);
      continue;
    }
    if (state === 'dead') {
      // 叉眼。三行高，占到眼睛下面那行毛色 - 两像素的叉认不出来。
      g.px(x0, EYE_Y, OUTLINE);
      g.px(x0 + 2, EYE_Y, OUTLINE);
      g.px(x0 + 1, EYE_Y + 1, OUTLINE);
      g.px(x0, EYE_Y + 2, OUTLINE);
      g.px(x0 + 2, EYE_Y + 2, OUTLINE);
      continue;
    }
    if (state === 'sick') {
      // 半闭：上眼睑压成一条线，下面只剩一道暗虹膜。没有瞳孔也没有高光 -
      // 「眼睛没有神」是这一档要传达的东西，高光会把它救回来。
      for (let dx = 0; dx < 3; dx++) {
        g.px(x0 + dx, EYE_Y, OUTLINE);
        g.px(x0 + dx, EYE_Y + 1, cat.pal.eye[1]);
      }
      continue;
    }
    for (let dx = 0; dx < 3; dx++) {
      g.px(x0 + dx, EYE_Y, cat.pal.eye[0]);
      g.px(x0 + dx, EYE_Y + 1, cat.pal.eye[1]);
    }
    g.px(PUPIL_X[side]!, EYE_Y, PUPIL);
    g.px(PUPIL_X[side]!, EYE_Y + 1, PUPIL);
    g.px(HIGHLIGHT_X[side]!, EYE_Y, HIGHLIGHT);
  }
}

function drawHead(g: IconGrid, cat: Cat, state: TrayIconState): void {
  const asleep = state === 'sleeping';
  const shade = fur(cat);
  g.spans(asleep ? EARS_FLAT : EARS_UP, shade);
  g.spans(SKULL, shade);
  g.spans(asleep ? INNER_EAR_FLAT : INNER_EAR_UP, () => cat.pal.inner);
  g.spans(MUZZLE, () => cat.pal.muzzle);
  for (let x = 8; x <= 9; x++) {
    g.px(x, 11, cat.pal.nose);
    g.px(x, 12, MOUTH_DARK);
    // 饿了张嘴。徽章已经说清是哪种「有事」，张嘴是让脸上也有一处对得上 -
    // 只有徽章变的话，图标看起来像是猫没事、旁边多了个贴纸。
    if (state === 'hungry') g.px(x, 13, MOUTH_DARK);
  }
  drawEyes(g, cat, state);
}

function drawBadge(g: IconGrid, badge: Badge): void {
  for (let y = BADGE_Y0 - 1; y <= BADGE_Y0 + BADGE_H; y++) {
    for (let x = BADGE_X0 - 1; x <= BADGE_X0 + BADGE_W; x++) g.px(x, y, OUTLINE);
  }
  for (let dy = 0; dy < BADGE_H; dy++) {
    const row = badge.rows[dy]!;
    for (let dx = 0; dx < BADGE_W; dx++) {
      g.px(BADGE_X0 + dx, BADGE_Y0 + dy, badge.legend[row[dx]!] ?? BADGE_PLATE);
    }
  }
}

// ---------------------------------------------------------------------------

/**
 * 画一张托盘图标。
 *
 * `scale` 必须是 ≥ 1 的整数：非整数放大只能靠插值，而插值会毁掉像素画。
 * 这里直接抛而不是向下取整 - 悄悄取整会让调用方拿到一张尺寸对不上的图，
 * 而那种错要到真机的菜单栏上才看得出来。
 */
export function trayIcon(cat: Cat, state: TrayIconState, scale: number): TrayIconBitmap {
  if (!Number.isInteger(scale) || scale < 1) {
    throw new RangeError(`托盘图标的放大倍数必须是 ≥1 的整数，收到 ${scale}`);
  }

  const g = new IconGrid();
  drawHead(g, cat, state);

  const recolor = recolorFor(state);
  if (recolor) g.recolor(recolor);

  g.outline();

  const badge = state === 'ok' || state === 'dead' ? null : BADGES[state];
  if (badge) drawBadge(g, badge);

  const size = N * scale;
  return { w: size, h: size, rgba: g.toRgba(scale) };
}
