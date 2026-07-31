/**
 * 原型 A 的着色核心：固定光源、法线明暗量化、hue shift 色阶查表。
 *
 * 关键取向（调研报告第四节的五步路径）：
 * 1. 椭圆内每像素由 (u, v) 解析出球面法线，与固定光向点乘 - 绝不用
 *    「离部件中心的距离」当明暗输入，那得到的正是 pillow shading。
 * 2. 点乘结果量化到 4 阶色带。跳过量化会变成「缩小的 3D 渲染」。
 * 3. 色带用预先 hue shift 好的查表色。
 *
 * 现有 furShade 回调返回的颜色只用来回答「这个像素属于哪条 ramp」
 * （base / mark / white / muzzle），明暗由这里重新决定。
 * 这样花纹算法（个体辨识特征）原样贯穿，不改 parts.ts 一行。
 */

import { OUTLINE, tone } from '../palette.js';
import { clamp } from '../rng.js';
import type { Palette, Ramp } from '../types.js';
import { coolDarken, mixHex, warmLighten } from './color.js';

/**
 * 固定假想光源：上方、偏观察者、略偏左（像素画惯例）。
 * 猫翻转朝向时几何本身会翻，光保持屏幕空间固定，符合物理直觉。
 */
const LIGHT_RAW: readonly [number, number, number] = [-0.34, -0.62, 0.72];
const LEN = Math.hypot(LIGHT_RAW[0], LIGHT_RAW[1], LIGHT_RAW[2]);
export const LIGHT: readonly [number, number, number] = [
  LIGHT_RAW[0] / LEN,
  LIGHT_RAW[1] / LEN,
  LIGHT_RAW[2] / LEN,
];

/** 光向在屏幕平面上的投影（归一化），selout 与 rim 用它判断受光侧。 */
const L2_LEN = Math.hypot(LIGHT[0], LIGHT[1]);
export const LIGHT2D: readonly [number, number] = [LIGHT[0] / L2_LEN, LIGHT[1] / L2_LEN];

/** 色带序号：0 高光、1 亮、2 中、3 暗。 */
export type Band = 0 | 1 | 2 | 3;

/**
 * 明暗量化。输入是 wrap 光照值（0.5 + 0.5 * n·L，0..1）。
 *
 * 用 wrap（半 Lambert）而不是纯点乘：纯点乘会让每个球面部件的背光侧
 * 挂上一整圈深色带，头压在身体上时那圈暗带就是一道生硬的「雪人脖子」接缝。
 * wrap 把暗带压缩到极端边缘，部件叠放处以中间调衔接。
 *
 * 阈值让高光只占受光面顶部一小块、最暗档贴着背光轮廓，
 * 中间两档承担大面积 - 2-3 阶可见色带，符合调研的「2-3 阶足够」。
 */
export function bandOf(wrap: number): Band {
  if (wrap >= 0.88) return 0;
  if (wrap >= 0.6) return 1;
  if (wrap >= 0.34) return 2;
  return 3;
}

/** 一条 4 阶着色 ramp：新造的暖高光 + 原 ramp 的三阶。 */
export type ShadeRamp = readonly [string, string, string, string];

/**
 * 由既有 3 阶 ramp 构造 4 阶着色 ramp。
 *
 * 保留手调过的三个原色（品种辨识度依赖它们），只新增一个
 * hue shift 的暖高光。暗部的冷偏移放在 selout 与接地暗色里。
 */
export function buildShadeRamp(ramp: Ramp): ShadeRamp {
  return [warmLighten(ramp[0], 0.42), ramp[0], ramp[1], ramp[2]];
}

export interface LutEntry {
  bands: ShadeRamp;
  /** 该颜色在源 ramp 里的档位，用来还原「远侧腿压暗一档」这类语义。 */
  idx: 0 | 1 | 2;
}

export type ShadeLut = ReadonlyMap<string, LutEntry>;

const lutCache = new WeakMap<Palette, ShadeLut>();

/**
 * 调色板 -> 着色查表。
 *
 * 覆盖 base / mark / white 三条 ramp 与口鼻色；眼睛、鼻头、内耳、瞳孔、
 * 高光等特征色刻意不收录 - 它们是符号不是体积，保持原色直出。
 */
export function shadeLutFor(pal: Palette): ShadeLut {
  const hit = lutCache.get(pal);
  if (hit) return hit;
  const map = new Map<string, LutEntry>();
  const addRamp = (ramp: Ramp): void => {
    const bands = buildShadeRamp(ramp);
    ramp.forEach((color, i) => {
      if (!map.has(color)) map.set(color, { bands, idx: i as 0 | 1 | 2 });
    });
  };
  addRamp(pal.base);
  addRamp(pal.mark);
  addRamp(pal.white);
  if (!map.has(pal.muzzle)) {
    map.set(pal.muzzle, {
      bands: [
        warmLighten(pal.muzzle, 0.22),
        pal.muzzle,
        coolDarken(pal.muzzle, 0.14),
        coolDarken(pal.muzzle, 0.3),
      ],
      idx: 1,
    });
  }
  lutCache.set(pal, map);
  return map;
}

/**
 * 重新着色一个来自旧 shade 回调的像素。
 *
 * @param c 旧回调给出的颜色（决定 ramp 归属）
 * @param u,v 部件局部坐标，[-1,1]
 * @param d u*u + v*v
 * @param small 小圆盘（尾巴链节、耳尖帽）压缩到中间两档 -
 *   逐盘全幅量化会让尾巴读成一节节的「棱纹管」。
 * @returns 按解析法线与固定光向选出的色带颜色；不认识的颜色原样返回
 */
export function reshadeSphere(
  lut: ShadeLut,
  c: string,
  u: number,
  v: number,
  d: number,
  small = false,
): string {
  const e = lut.get(c);
  if (!e) return c;
  const nz = Math.sqrt(Math.max(0, 1 - Math.min(1, d)));
  const wrap = 0.5 + 0.5 * (u * LIGHT[0] + v * LIGHT[1] + nz * LIGHT[2]);
  let band: number = bandOf(wrap);
  // 受光侧轮廓内 1px 的 rim：贴边、面向光、且不是已经最亮时提一档。
  // 严格限制在最外一圈（d > 0.88），超过 1px 或绕一整圈就是反向 pillow shading。
  if (d > 0.88 && u * LIGHT2D[0] + v * LIGHT2D[1] > 0.55 && band > 0) band -= 1;
  if (small) band = clamp(band, 1, 2);
  // 「压暗一档」语义（远侧腿产生纵深）原样保留。
  const darkenOffset = clamp(e.idx - tone(v), 0, 1);
  return e.bands[clamp(band + darkenOffset, 0, 3) as Band];
}

/**
 * 柱面重着色（腿这类窄矩形部件）：法线只由横向 u 决定。
 * v > 0.62 的接地段压暗一档，保住「贴桌面处有深色」的落地感。
 */
export function reshadeCylinder(lut: ShadeLut, c: string, u: number, v: number): string {
  const e = lut.get(c);
  if (!e) return c;
  const nz = Math.sqrt(Math.max(0, 1 - Math.min(1, u * u)));
  const wrap = 0.5 + 0.5 * (u * LIGHT[0] + nz * LIGHT[2]);
  // 腿不给高光档：4 像素宽的柱面上出现纯高光边会读成「金属管」。
  let band: number = Math.max(1, bandOf(wrap));
  if (v > 0.62) band += 1;
  const darkenOffset = clamp(e.idx - tone(v), 0, 1);
  return e.bands[clamp(band + darkenOffset, 0, 3) as Band];
}

/**
 * selout：按受光侧程度为描边像素选色。
 *
 * dot 是描边像素外向法线（2D）与光向投影的点乘。
 * 受光侧只「提亮到本体暗色再压向描边色」，不完全去掉描边 -
 * 桌面壁纸不可控，浅色壁纸上全 selout 会让受光侧轮廓消失。
 */
export function seloutColor(lut: ShadeLut, neighbor: string, dot: number): string {
  if (dot <= -0.15) return OUTLINE;
  const e = lut.get(neighbor);
  const dark = e ? e.bands[3] : mixHex(neighbor, OUTLINE, 0.5);
  if (dot >= 0.4) return mixHex(dark, OUTLINE, 0.38);
  // 过渡带：介于本体暗色与描边色之间，避免受光/背光两段描边出现生硬接缝。
  return mixHex(dark, OUTLINE, 0.72);
}
