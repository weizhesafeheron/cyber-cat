/**
 * 原型 A 专用颜色工具：hex <-> HSL 与 hue shift。
 *
 * 调研结论（docs/research/2026-07-31-hi-fi-pixel-cat-refs，分支
 * research/hi-fi-pixel-cat-refs）：纯明度 ramp 是「塑料/灰泥感」的教科书成因。
 * 变亮往暖色（黄）偏、变暗往冷色（蓝紫）偏，同样的颜色数观感更透气。
 *
 * 全部为纯函数，输入输出都是 `#rrggbb`，方便单测。
 */

import { clamp } from '../rng.js';

/** 亮部的目标色相（暖黄）。 */
const WARM_HUE = 48;
/** 暗部的目标色相（蓝紫）。 */
const COOL_HUE = 265;
/** 单次 shift 的最大色相偏移角度。超过就是「彩虹猫」。 */
const MAX_HUE_SHIFT = 26;

export type Rgb = readonly [number, number, number];
export type Hsl = readonly [number, number, number];

export function hexToRgb(hex: string): Rgb {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const to = (n: number): string =>
    Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** h: 0..360, s/l: 0..1 */
export function rgbToHsl(r: number, g: number, b: number): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = 60 * (((gn - bn) / d) % 6);
  else if (max === gn) h = 60 * ((bn - rn) / d + 2);
  else h = 60 * ((rn - gn) / d + 4);
  if (h < 0) h += 360;
  return [h, s, l];
}

export function hslToRgb(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let rn = 0;
  let gn = 0;
  let bn = 0;
  if (hp < 1) [rn, gn, bn] = [c, x, 0];
  else if (hp < 2) [rn, gn, bn] = [x, c, 0];
  else if (hp < 3) [rn, gn, bn] = [0, c, x];
  else if (hp < 4) [rn, gn, bn] = [0, x, c];
  else if (hp < 5) [rn, gn, bn] = [x, 0, c];
  else [rn, gn, bn] = [c, 0, x];
  const m = l - c / 2;
  return [(rn + m) * 255, (gn + m) * 255, (bn + m) * 255];
}

/** 把色相沿最短路径向 target 偏移，幅度上限 maxDeg。 */
function shiftHue(h: number, target: number, maxDeg: number): number {
  const delta = ((target - h + 540) % 360) - 180;
  const step = clamp(delta, -maxDeg, maxDeg);
  return (h + step + 360) % 360;
}

/**
 * 亮部：提亮 + 往暖色偏。amt 取 0..1。
 *
 * 低饱和（接近白/灰）时色相无意义，直接给一点暖色饱和度，
 * 白毛的高光偏暖是安全的。
 */
export function warmLighten(hex: string, amt: number): string {
  const [r, g, b] = hexToRgb(hex);
  let [h, s, l] = rgbToHsl(r, g, b);
  if (s < 0.08) {
    h = WARM_HUE;
    s = Math.min(0.2, s + 0.12 * amt);
  } else {
    h = shiftHue(h, WARM_HUE, MAX_HUE_SHIFT * amt);
  }
  l = clamp(l + 0.2 * amt, 0, 1);
  const [nr, ng, nb] = hslToRgb(h, s, l);
  return rgbToHex(nr, ng, nb);
}

/**
 * 暗部：压暗 + 往冷色（蓝紫）偏 + 饱和度略升。amt 取 0..1。
 *
 * 白毛暗部偏蓝紫是安全做法（调研 2.2 节）。
 */
export function coolDarken(hex: string, amt: number): string {
  const [r, g, b] = hexToRgb(hex);
  let [h, s, l] = rgbToHsl(r, g, b);
  if (s < 0.08) {
    h = COOL_HUE;
    s = Math.min(0.3, s + 0.16 * amt);
  } else {
    h = shiftHue(h, COOL_HUE, MAX_HUE_SHIFT * amt);
    s = clamp(s + 0.12 * amt, 0, 1);
  }
  l = clamp(l - 0.22 * amt, 0, 1);
  const [nr, ng, nb] = hslToRgb(h, s, l);
  return rgbToHex(nr, ng, nb);
}

/** 线性混合两个 hex，t = 0 取 a，t = 1 取 b。 */
export function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const k = clamp(t, 0, 1);
  return rgbToHex(ar + (br - ar) * k, ag + (bg - ag) * k, ab + (bb - ab) * k);
}

/** 相对亮度（0..255 级），用于测试断言「提亮/压暗确实生效」。 */
export function luma(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
