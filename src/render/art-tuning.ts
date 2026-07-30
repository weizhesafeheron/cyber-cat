import type { Cat, Palette, Ramp } from './types.js';

/** 领养时可调的语义化外观参数。0 保持品种原画，取值范围均为 [-1, 1]。 */
export interface CatArtTuning {
  roundness: number;
  headSize: number;
  earSize: number;
  earShape: number;
  earSpread: number;
  legLength: number;
  eyeSize: number;
  tailVolume: number;
  fluffiness: number;
  colorEnergy: number;
  outlineStrength: number;
  shadingDepth: number;
  cheekWidth: number;
  muzzleSize: number;
  markingTemplate: number;
  jointBlend: number;
}

export type CatArtTuningKey = keyof CatArtTuning;

export interface ArtTuningControl {
  key: CatArtTuningKey;
  label: string;
  group: '轮廓' | '五官' | '质感' | '像素风格';
  low: string;
  high: string;
}

export const ART_TUNING_CONTROLS: readonly ArtTuningControl[] = [
  { key: 'roundness', label: '身体轮廓', group: '轮廓', low: '修长', high: '圆润' },
  { key: 'headSize', label: '头身比例', group: '轮廓', low: '小巧', high: '幼态' },
  { key: 'earSize', label: '耳朵大小', group: '轮廓', low: '克制', high: '夸张' },
  { key: 'earShape', label: '耳朵形状', group: '轮廓', low: '尖耳', high: '圆耳' },
  { key: 'earSpread', label: '耳朵姿态', group: '轮廓', low: '聚拢', high: '外张' },
  { key: 'legLength', label: '腿部比例', group: '轮廓', low: '短腿', high: '修长' },
  { key: 'eyeSize', label: '眼睛存在感', group: '五官', low: '含蓄', high: '明亮' },
  { key: 'cheekWidth', label: '脸颊宽度', group: '五官', low: '精瘦', high: '圆腮' },
  { key: 'muzzleSize', label: '口鼻尺寸', group: '五官', low: '精巧', high: '饱满' },
  { key: 'tailVolume', label: '尾巴体量', group: '质感', low: '轻巧', high: '蓬松' },
  { key: 'fluffiness', label: '毛发轮廓', group: '质感', low: '利落', high: '毛茸茸' },
  { key: 'colorEnergy', label: '色彩精神', group: '质感', low: '柔和', high: '鲜明' },
  { key: 'outlineStrength', label: '描边强度', group: '像素风格', low: '轻柔', high: '醒目' },
  { key: 'shadingDepth', label: '阴影层次', group: '像素风格', low: '平涂', high: '立体' },
  {
    key: 'markingTemplate',
    label: '花纹规整度',
    group: '像素风格',
    low: '自然斑驳',
    high: '经典块面',
  },
  { key: 'jointBlend', label: '关节融合', group: '像素风格', low: '清晰分件', high: '自然连贯' },
] as const;

export const DEFAULT_ART_TUNING: Readonly<CatArtTuning> = Object.freeze({
  roundness: 0,
  headSize: 0,
  earSize: 0,
  earShape: 0,
  earSpread: 0,
  legLength: 0,
  eyeSize: 0,
  tailVolume: 0,
  fluffiness: 0,
  colorEnergy: 0,
  outlineStrength: 0,
  shadingDepth: 0,
  cheekWidth: 0,
  muzzleSize: 0,
  markingTemplate: 0,
  jointBlend: 0,
});

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export function normalizeArtTuning(input?: Partial<CatArtTuning> | null): CatArtTuning {
  const result = { ...DEFAULT_ART_TUNING };
  if (!input) return result;
  for (const { key } of ART_TUNING_CONTROLS) {
    const value = input[key];
    if (typeof value === 'number' && Number.isFinite(value)) result[key] = clamp(value, -1, 1);
  }
  return result;
}

function tuneHex(hex: string, energy: number): string {
  const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));
  const mean = (channels[0]! + channels[1]! + channels[2]!) / 3;
  const saturation = 1 + energy * 0.42;
  const light = energy * 13;
  return `#${channels
    .map((channel) => Math.round(clamp(mean + (channel - mean) * saturation + light, 0, 255)))
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`;
}

function tuneRamp(ramp: Ramp, energy: number): Ramp {
  return ramp.map((color) => tuneHex(color, energy)) as unknown as Ramp;
}

function tuneDepth(ramp: Ramp, depth: number): Ramp {
  if (Math.abs(depth) < 0.001) return ramp;
  const middle = [1, 3, 5].map((start) => Number.parseInt(ramp[1].slice(start, start + 2), 16));
  const factor = clamp(1 + depth * 0.58, 0.3, 1.58);
  return ramp.map((color, index) => {
    if (index === 1) return color;
    const channels = [1, 3, 5].map((start) => Number.parseInt(color.slice(start, start + 2), 16));
    return `#${channels
      .map((channel, i) => Math.round(clamp(middle[i]! + (channel - middle[i]!) * factor, 0, 255)))
      .map((channel) => channel.toString(16).padStart(2, '0'))
      .join('')}`;
  }) as unknown as Ramp;
}

function tunePalette(palette: Palette, energy: number, depth: number): Palette {
  if (Math.abs(energy) < 0.001 && Math.abs(depth) < 0.001) return palette;
  return {
    base: tuneDepth(tuneRamp(palette.base, energy), depth),
    mark: tuneDepth(tuneRamp(palette.mark, energy), depth),
    white: tuneDepth(tuneRamp(palette.white, energy * 0.45), depth * 0.72),
    muzzle: tuneHex(palette.muzzle, energy * 0.55),
    nose: tuneHex(palette.nose, energy),
    inner: tuneHex(palette.inner, energy * 0.8),
    eye: [tuneHex(palette.eye[0], energy), tuneHex(palette.eye[1], energy)],
  };
}

/** 不修改原猫，也不消耗随机数；所以调参不会改动 Seed 的稳定性。 */
export function tuneCatArt(cat: Cat, raw?: Partial<CatArtTuning> | null): Cat {
  const t = normalizeArtTuning(raw);
  return {
    ...cat,
    bodyRW: clamp(cat.bodyRW * (1 + t.roundness * 0.13), 8, 17),
    bodyRH: clamp(cat.bodyRH * (1 + t.roundness * 0.07), 5, 12),
    headR: clamp(cat.headR * (1 + t.headSize * 0.14), 6, 10.5),
    earH: clamp(cat.earH * (1 + t.earSize * 0.18), 3, 10),
    earW: clamp(cat.earW * (1 + t.earSize * 0.16), 3, 9),
    earRound: t.earShape < -0.15 ? false : cat.earRound,
    earRoundness: t.earShape > 0.15 ? t.earShape : t.earShape < -0.15 ? 0 : undefined,
    earSet: clamp(cat.earSet + t.earSpread * 0.12, 0.42, 0.92),
    earSpread: clamp(cat.earSpread + t.earSpread * 1.1, -0.5, 4),
    legLen: clamp(cat.legLen * (1 + t.legLength * 0.16), 3.2, 8.5),
    tailLen: Math.round(clamp(cat.tailLen * (1 + t.tailVolume * 0.08), 8, 17)),
    tailThick: clamp(cat.tailThick * (1 + t.tailVolume * 0.25), 1.5, 6),
    fluff: clamp(cat.fluff + t.fluffiness * 0.34, 0, 1.15),
    eyeScale: clamp(1 + t.eyeSize * 0.45, 0.55, 1.45),
    outlineStrength: t.outlineStrength,
    cheekWidth: t.cheekWidth,
    muzzleScale: clamp(1 + t.muzzleSize * 0.34, 0.64, 1.36),
    markingTemplate: t.markingTemplate,
    jointBlend: t.jointBlend,
    pal: tunePalette(cat.pal, t.colorEnergy, t.shadingDepth),
  };
}
