/**
 * 原型 B：ID 调色板与配色（colorway）目录。
 *
 * 部件 PNG 用「规范 ID 调色板」绘制：每个语义区域一条色带（ramp）。
 * 运行时把规范色整条映射成目标配色 - 暗档映射到暗档、亮档映射到亮档，
 * 光影层次原样保留。描边带单独处理：暗描边全配色通用不映射，
 * 受光侧软描边（selout）映射到目标配色的深色，保证换色不破坏描边。
 *
 * 规范色本身取橘猫的观感，因此素材文件直接打开看也是「正确」的猫。
 */

/** 语义 ID。部件位图里的每个像素属于且仅属于一个 ID。 */
export const ID = {
  NONE: 0,
  /** 背光侧描边。全配色通用，不参与映射。 */
  OUT_DARK: 1,
  /** 受光侧软描边（selout）。映射到目标配色的最深一档附近。 */
  OUT_SOFT: 2,
  /** 身体填充色带，暗 → 亮四档。 */
  C0: 3,
  C1: 4,
  C2: 5,
  C3: 6,
  /** 腹部/口鼻奶油色带，暗 → 亮三档。 */
  B0: 7,
  B1: 8,
  B2: 9,
  /** 鼻头与耳内粉色。 */
  NOSE: 10,
  IRIS_L: 11,
  IRIS_D: 12,
  /** 瞳孔。固定色。 */
  PUPIL: 13,
  /** 眼高光。固定色。 */
  GLINT: 14,
  /** 嘴线。固定色。 */
  MOUTH: 15,
  /** 食盆（道具带，固定色，不参与映射）。 */
  PROP0: 16,
  PROP1: 17,
  PROP2: 18,
  FOOD: 19,
} as const;

export type IdKey = keyof typeof ID;

/** 规范 RGB。生成器写 PNG、运行时建映射表都以它为准。 */
export const CANON: Readonly<Record<number, string>> = {
  [ID.OUT_DARK]: '#241b36',
  [ID.OUT_SOFT]: '#6e3c1c',
  [ID.C0]: '#9c5a24',
  [ID.C1]: '#c97b30',
  [ID.C2]: '#eda14b',
  [ID.C3]: '#ffc372',
  [ID.B0]: '#d9b98c',
  [ID.B1]: '#f4dcb4',
  [ID.B2]: '#fff1d6',
  [ID.NOSE]: '#e8838f',
  [ID.IRIS_L]: '#f5b83d',
  [ID.IRIS_D]: '#b67708',
  [ID.PUPIL]: '#1c1226',
  [ID.GLINT]: '#ffffff',
  [ID.MOUTH]: '#5e2b3a',
  [ID.PROP0]: '#4d8fc4',
  [ID.PROP1]: '#3a6d99',
  [ID.PROP2]: '#2c5377',
  [ID.FOOD]: '#d98a4b',
} as const;

/** 花纹 mask 的种类。mask 与部件同布局存储，运行时按配色选用。 */
export type MaskKey = 'tabby' | 'cow' | 'point';

/** 花纹映射允许落点的色带。描边/眼睛永远不在允许集合里。 */
export type PatternBand = 'coat' | 'belly';

export interface PatternSpec {
  mask: MaskKey;
  /** 花纹色带，与身体填充带同为四档，替换时保留原亮度档位。 */
  ramp: readonly [string, string, string, string];
  /** 允许被花纹覆盖的色带。奶牛斑要盖过腹白，虎斑只落在填充带。 */
  bands: readonly PatternBand[];
}

export interface Colorway {
  key: string;
  label: string;
  coat: readonly [string, string, string, string];
  belly: readonly [string, string, string];
  /** 受光侧软描边的目标色。 */
  outSoft: string;
  nose: string;
  iris: readonly [string, string];
  pattern?: PatternSpec;
}

/**
 * 配色目录。同一套部件位图服务所有配色 - 「有限个性化」的全部来源。
 * 色带都做过 hue shift：暗档偏冷、亮档偏暖，不是纯明度阶梯。
 */
export const COLORWAYS: readonly Colorway[] = [
  {
    key: 'orange-tabby',
    label: '橘虎斑',
    coat: ['#9c5a24', '#c97b30', '#eda14b', '#ffc372'],
    belly: ['#d9b98c', '#f4dcb4', '#fff1d6'],
    outSoft: '#6e3c1c',
    nose: '#e8838f',
    iris: ['#f5b83d', '#b67708'],
    pattern: {
      mask: 'tabby',
      ramp: ['#7c421c', '#9c5424', '#b8682c', '#d98338'],
      bands: ['coat'],
    },
  },
  {
    key: 'silver-tabby',
    label: '银虎斑',
    coat: ['#7e8199', '#a4a7b8', '#cfd2dd', '#eef0f5'],
    belly: ['#c8cbd8', '#e6e8f0', '#f8f9fc'],
    outSoft: '#4a4d66',
    nose: '#e08b9d',
    iris: ['#b7d94c', '#6f9422'],
    pattern: {
      mask: 'tabby',
      ramp: ['#2a2c42', '#3e405a', '#565a76', '#6b6f8c'],
      bands: ['coat'],
    },
  },
  {
    key: 'cow',
    label: '奶牛',
    coat: ['#b9b6ac', '#d8d5cb', '#f3f1ea', '#ffffff'],
    belly: ['#d8d5cb', '#f3f1ea', '#ffffff'],
    outSoft: '#8f8c82',
    nose: '#f08fa4',
    iris: ['#b7d94c', '#6f9422'],
    pattern: {
      mask: 'cow',
      ramp: ['#232033', '#312e44', '#4a4760', '#5d5a78'],
      bands: ['coat', 'belly'],
    },
  },
  {
    key: 'black',
    label: '黑猫',
    coat: ['#262336', '#3b3850', '#4f4b68', '#6b6587'],
    belly: ['#b8b3c9', '#dedbe8', '#efeef5'],
    outSoft: '#1c1830',
    nose: '#c66a80',
    iris: ['#ffd94a', '#c99a12'],
  },
  {
    key: 'cream-point',
    label: '奶油重点色',
    coat: ['#c4ae8c', '#e6d5b8', '#f8ecd7', '#fffaf0'],
    belly: ['#e0d0b2', '#f4e8d0', '#fffaf0'],
    outSoft: '#8a7458',
    nose: '#e8a0b0',
    iris: ['#7cc4ff', '#3b7fd4'],
    pattern: {
      mask: 'point',
      ramp: ['#5f4f41', '#7d6a58', '#9c8874', '#b5a390'],
      bands: ['coat', 'belly'],
    },
  },
] as const;

export function colorwayByKey(key: string): Colorway {
  const found = COLORWAYS.find((c) => c.key === key);
  if (!found) throw new Error(`未知配色: ${key}`);
  return found;
}

/** 现有品种 → 配色。原型阶段的粗映射，未覆盖的品种按 seed 兜底。 */
const BREED_TO_COLORWAY: Readonly<Record<string, string>> = {
  orange: 'orange-tabby',
  amshort: 'silver-tabby',
  cow: 'cow',
  black: 'black',
  ragdoll: 'cream-point',
  devon: 'cream-point',
  aby: 'orange-tabby',
};

export function colorwayFor(breed: string, seed: number): Colorway {
  const key = BREED_TO_COLORWAY[breed];
  if (key) return colorwayByKey(key);
  const idx = Math.abs(seed | 0) % COLORWAYS.length;
  return COLORWAYS[idx]!;
}
