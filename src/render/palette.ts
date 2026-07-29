import type { BreedKey, Palette, Ramp } from './types.js';

/** 描边色。由 outline pass 统一涂在猫的外轮廓上。 */
export const OUTLINE = '#241b36';

/** 地面投影色。不属于猫本体，不进命中掩膜。 */
export const SHADOW = '#151126';

export const PUPIL = '#1c1226';
export const HIGHLIGHT = '#ffffff';
export const MOUTH_DARK = '#5e2b3a';
export const TONGUE = '#e8838f';
export const TONGUE_LICK = '#f08fa4';

export const PALETTES: Readonly<Record<BreedKey, Palette>> = {
  orange: {
    base: ['#ffcf86', '#f5a94e', '#d17c2e'],
    mark: ['#e2914a', '#cd7526', '#a75a1d'],
    white: ['#fff3d9', '#ffedc9', '#e0c795'],
    muzzle: '#ffedc9',
    nose: '#e8838f',
    inner: '#e89aa8',
    eye: ['#f5b83d', '#b67708'],
  },
  black: {
    // 底色不能更深了：更暗会让细长轮廓与眼睛这两个辨识点一起糊掉。
    // 见 docs/art-and-motion-decisions.md。
    base: ['#6b6587', '#3b3850', '#262336'],
    mark: ['#6b6587', '#3b3850', '#262336'],
    white: ['#efeef5', '#dedbe8', '#b8b3c9'],
    muzzle: '#4a465e',
    nose: '#c66a80',
    inner: '#8d6478',
    eye: ['#ffd94a', '#c99a12'],
  },
  cow: {
    base: ['#ffffff', '#f3f1ea', '#cfccc2'],
    mark: ['#4a4760', '#312e44', '#232033'],
    white: ['#ffffff', '#f3f1ea', '#cfccc2'],
    muzzle: '#fbf8f0',
    nose: '#f08fa4',
    inner: '#f0a8b8',
    eye: ['#b7d94c', '#6f9422'],
  },
  ragdoll: {
    base: ['#fff6e8', '#f2e5cf', '#d3bfa0'],
    mark: ['#9c8874', '#7d6a58', '#5f4f41'],
    white: ['#fffdf7', '#faf3e6', '#dcd0ba'],
    muzzle: '#fffdf7',
    nose: '#e8a0b0',
    inner: '#eeb0be',
    eye: ['#7cc4ff', '#3b7fd4'],
  },
  devon: {
    base: ['#e3d2c0', '#c4ad94', '#9c8268'],
    mark: ['#b39c83', '#94806a', '#6f5d4c'],
    white: ['#f5ebdd', '#e8dbc8', '#c6b49c'],
    muzzle: '#f5ebdd',
    nose: '#d78b98',
    inner: '#e2a5b1',
    eye: ['#e5c95c', '#a8862a'],
  },
  amshort: {
    base: ['#eef0f5', '#cfd2dd', '#a4a7b8'],
    mark: ['#565a76', '#3e405a', '#2a2c42'],
    white: ['#f8f9fc', '#e6e8f0', '#bfc2d2'],
    muzzle: '#f8f9fc',
    nose: '#e08b9d',
    inner: '#e9a8b6',
    eye: ['#b7d94c', '#6f9422'],
  },
  aby: {
    base: ['#e09a55', '#bd7436', '#8a4e22'],
    mark: ['#7c451c', '#5e3314', '#42230d'],
    white: ['#ffe9cd', '#f4d9b4', '#d3b287'],
    muzzle: '#ffe9cd',
    nose: '#c96a70',
    inner: '#e2989f',
    eye: ['#cdd44e', '#7c8f1e'],
  },
};

/**
 * 布偶重点色的三个色系：海豹棕、蓝灰、巧克力。
 *
 * 由 Seed 抽取。这是拉开布偶个体差异最有效的一招 - 连续参数的微调在
 * 像素尺度下几乎看不出来，换色系一眼就能分辨。
 */
export const RAGDOLL_POINTS: readonly Ramp[] = [
  ['#9c8874', '#7d6a58', '#5f4f41'],
  ['#a3a4bd', '#83849e', '#63647c'],
  ['#b59a7d', '#96795c', '#755c44'],
];

/** 按局部纵坐标选色阶：上方亮、中间、下方暗。 */
export const tone = (v: number): 0 | 1 | 2 => (v < -0.42 ? 0 : v > 0.5 ? 2 : 1);
