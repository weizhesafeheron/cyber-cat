/** 渲染层的公开类型。平台无关，不依赖 DOM。 */

/** 品种是目录里的稳定 ID；新增品种不再需要修改类型联合。 */
export type BreedKey = string;

/** 花纹算法是可复用能力；品种只在目录里选择一种，不进入渲染分支。 */
export type MarkingAdapter =
  | 'tabby'
  | 'solid'
  | 'patches'
  | 'color-point'
  | 'wavy'
  | 'classic-tabby'
  | 'ticked';

/** 领养时封存的花纹选择。variant 是适配器内稳定 ID，seed 只控制模板内细节。 */
export interface MarkingChoice {
  variant: string;
  seed: number;
}

/** 花纹分层。决定某个像素取调色板的哪一条色阶。 */
export type Layer = 'base' | 'mark' | 'white';

/** 部件。花纹算法按部件分支。 */
export type Part = 'body' | 'head' | 'earL' | 'earR' | 'tail' | 'leg';

/** 体型。四种，动作库通过 pose.form 选择。 */
export type Form = 'stand' | 'sit' | 'lie' | 'curl';

/** 三条色阶：亮部、中间、暗部。tone() 按局部 v 坐标选择。 */
export type Ramp = readonly [string, string, string];

export interface Palette {
  base: Ramp;
  mark: Ramp;
  white: Ramp;
  muzzle: string;
  nose: string;
  inner: string;
  /** [虹膜亮部, 虹膜暗部] */
  eye: readonly [string, string];
}

export interface Personality {
  /** 活跃度。影响走路频率、扑跳积极性、睡眠倾向。 */
  active: number;
  /** 粘人度。影响被拖拽后是否蹭回来。 */
  clingy: number;
  /** 贪吃度。影响听到添粮后多快过来。 */
  greedy: number;
}

export interface CowPatch {
  u: number;
  v: number;
  r: number;
  /** 纵向拉伸比 */
  e: number;
  /** 该斑块的哈希种子，决定边缘抖动 */
  s: number;
}

export interface Marks {
  // 橘猫 / 美短
  stripeFreq?: number;
  stripeW?: number;
  stripePhase?: number;
  stripeStyle?: 'lines' | 'spots';
  headStripes?: boolean;
  tailRings?: boolean;
  // 德文卷毛
  speck?: number;
  waveScale?: number;
  wavePhase?: number;
  // 阿比西尼亚
  tick?: number;
  // 黑猫
  whiteToe?: boolean;
  locket?: boolean;
  // 奶牛猫
  patches?: CowPatch[];
  headPatch?: { side: number; r: number; s: number } | null;
  earL?: boolean;
  earR?: boolean;
  tailBlack?: boolean;
  // 布偶猫
  maskDepth?: number;
  mitts?: boolean;
  ruffR?: number;
}

/**
 * 一只猫的完整运行时外观与性格参数。
 * 由基础 Seed 猫叠加封存档案得到；相同档案永远得到相同的猫。
 */
export interface Cat {
  breed: BreedKey;
  /** 决定花纹算法的可扩展适配器，不让渲染器按品种 ID 分支。 */
  markingAdapter: MarkingAdapter;
  /** 缺省表示旧版 Seed 花纹；新领养会封存适配器内的稳定模板 ID。 */
  markingVariant?: string;
  /** 与体型 Seed 分离，换花纹不会把已经挑好的身形一起换掉。 */
  markingSeed?: number;
  plumeTail: boolean;
  whiskerPixels: boolean;
  seed: number;
  bodyRW: number;
  bodyRH: number;
  headR: number;
  earH: number;
  earW: number;
  tailLen: number;
  tailThick: number;
  legLen: number;
  /** 绒毛量。内缘啃边 + 外缘长毛，表现蓬松品种的轮廓。 */
  fluff: number;
  /** 1 = 大眼带竖瞳 */
  eyeBig: 0 | 1;
  eyeScale?: number;
  outlineStrength?: number;
  cheekWidth?: number;
  muzzleScale?: number;
  markingTemplate?: number;
  jointBlend?: number;
  /** 坐姿宽窄系数。腿长的猫坐得更瘦。 */
  sitW: number;
  /** 耳距系数（相对头半径） */
  earSet: number;
  /** 耳尖外张像素数 */
  earSpread: number;
  /** 圆耳尖（德文） */
  earRound: boolean;
  /** 领养调参覆盖的整体圆润度。1 = 半椭圆，0 = 三角形；缺省保留品种原轮廓。 */
  earRoundness?: number;
  /** 新档案启用：耳根沿脸部椭圆落位；缺省保留旧存档的逐像素位置。 */
  attachEarsToFace?: boolean;
  /** 耳朵中轴与地面的夹角（度）。45 = 最大外张，90 = 竖直，>90 = 向内聚拢。 */
  earAngle?: number;
  /** 旋转前保持的耳朵中轴长度，避免外张被误读成单纯横向拉伸。 */
  earAxisLength?: number;
  /** 低位耳的下移像素数（德文） */
  earDrop: number;
  /** 眼周深色描线（阿比） */
  eyeLiner: boolean;
  pal: Palette;
  personality: Personality;
  marks: Marks;
}

/**
 * 一帧的姿态。动作库的 make() 产出这个，渲染层消费它。
 * 全部字段可选 - 缺省即取该体型的默认值。
 */
export interface Pose {
  form?: Form;
  /** 朝向。1 = 朝右 */
  dir?: number;
  /** 呼吸幅度，作用于身体纵向缩放 */
  breath?: number;
  dx?: number;
  dy?: number;
  stretchX?: number;
  squashY?: number;
  legScale?: number;
  /** 四条腿的横向偏移 [近前, 远前, 近后, 远后] */
  legOx?: readonly number[];
  /** 四条腿的抬起高度 */
  legLift?: readonly number[];
  /** 整体腾空高度。四条腿一起离地，跳跃类动作必须设置。 */
  airborne?: number;
  headDX?: number;
  headDY?: number;
  /** 头部缩放 */
  scale?: number;
  /** 歪头。正值向右。 */
  tilt?: number;
  eyeOpen?: number;
  eyeDY?: number;
  pupilDX?: number;
  earFlickL?: number;
  earFlickR?: number;
  /** 张嘴幅度 0..1 */
  mouth?: number;
  /** 舌头露出 */
  tongue?: boolean;
  muzzleDY?: number;
  /** 坐姿时近侧前爪抬起（舔毛用） */
  pawLift?: number;
  tailAng?: number;
  tailCurl?: number;
  tailWave?: number;
  tailPhase?: number;
  /** false = 坐姿不把尾巴绕到身前 */
  tailWrap?: boolean;
  /** 睡觉的 Zzz 气泡动画时间 */
  zzz?: number;
  /** 落地尘土 0..1 */
  dust?: number;
  // 这里曾有一个 `bowl?: number`（食盆画在猫的精灵缓冲里）。
  // 挂件改成独立窗口之后（ADR 0004、ticket 08）它已经删掉 - 食盆不再是猫的姿态，
  // 而是桌面上另一个窗口，像素画在 src/props/art.ts。
  // 不要因为「吃饭动作需要一个盆」把它加回来：那个盆的位置由用户拖动决定，
  // 猫的渲染器无从知道，也不该知道。
}

/**
 * 渲染结果。
 *
 * pixels 与 alphaMask 从同一个像素缓冲一次产出，因此同源性是结构保证，
 * 不依赖调用方的使用约定（见 ADR 0006）。
 */
export interface RenderResult {
  width: number;
  height: number;
  /** RGBA，长度 width * height * 4 */
  pixels: Uint8ClampedArray;
  /**
   * 命中掩膜，长度 width * height，每字节 255 或 0。
   * 只有猫本体（含描边）为 255；影子、Zzz 气泡、尘土、食盆一律为 0 -
   * 点影子不该算摸到猫。
   */
  alphaMask: Uint8Array;
}
