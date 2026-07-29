import { layerOf } from './marks.js';
import { HIGHLIGHT, MOUTH_DARK, OUTLINE, PUPIL, TONGUE, TONGUE_LICK, tone } from './palette.js';
import { GROUND, KIND_CAT, type Raster, type Shade } from './raster.js';
import type { Cat, Part, Pose } from './types.js';

/** 部件着色器：查花纹层 → 按局部纵坐标选色阶。 */
export function furShade(
  cat: Cat,
  part: Part,
  opts: { layer?: 'base' | 'mark' | 'white'; darken?: boolean } = {},
): Shade {
  return (u, v, x, y) => {
    const layer = opts.layer ?? layerOf(cat, part, u, v, x, y);
    let t = tone(v);
    if (opts.darken) t = Math.min(2, t + 1) as 0 | 1 | 2;
    const ramp = cat.pal[layer] ?? cat.pal.base;
    return ramp[t];
  };
}

export interface TailOpts {
  baseAng: number;
  curl: number;
  wave?: number;
  wavePhase?: number;
  dirX?: number;
  /** true = 尾巴不会穿到地面以下 */
  floor?: boolean;
}

/** 尾巴：一串逐节收细的圆盘，沿角度累积前进。 */
export function drawTail(r: Raster, cat: Cat, sx: number, sy: number, o: TailOpts): void {
  const n = cat.tailLen;
  let x = sx;
    let y = sy;
  let ang = o.baseAng;
  const step = 1.35;
  for (let i = 0; i < n; i++) {
    ang += o.curl / n + (o.wave ?? 0) * Math.sin((o.wavePhase ?? 0) + i * 0.55) * 0.09;
    x += Math.cos(ang) * step * (o.dirX ?? 1);
    y -= Math.sin(ang) * step;
    if (o.floor) y = Math.min(y, GROUND - 1.6);
    // 布偶的锥度更小，显得更粗更蓬。
    const taper = cat.breed === 'ragdoll' ? 1 - 0.3 * (i / n) : 1 - 0.55 * (i / n);
    const rad = Math.max(1, cat.tailThick * 0.62 * taper + (cat.breed === 'ragdoll' ? 0.9 : 0));
    let layer: 'base' | 'mark';
    if (cat.marks.tailRings) layer = i % 5 < 2 && i > 2 ? 'mark' : 'base';
    else if (cat.breed === 'aby') layer = i > n * 0.72 ? 'mark' : 'base'; // 深色尾尖
    else layer = layerOf(cat, 'tail', 0, 0, Math.round(x), Math.round(y)) === 'mark' ? 'mark' : 'base';
    r.blob(x, y, rad, rad, furShade(cat, 'tail', { layer }), cat.fluff, cat.seed + i * 13);
  }
}

/**
 * 耳朵。支持外张（earSpread）与圆耳尖（earRound）。
 *
 * 这两个参数加上耳距（earSet）与低位偏移（earDrop）共同构成品种的耳朵剪影，
 * 是德文与阿比唯一的强辨识点，不要收敛到同一组值。
 */
export function drawEar(
  r: Raster,
  cat: Cat,
  bx: number,
  ty: number,
  side: number,
  flick: number,
  part: Part,
): void {
  const eh = Math.max(3, Math.round(cat.earH - flick * 2));
  const ew = Math.round(cat.earW);
  const shade = furShade(cat, part);
  for (let i = 0; i < eh; i++) {
    let hw = Math.round((ew / 2) * (i / (eh - 1 || 1)));
    if (cat.earRound && i === 0) hw = Math.max(1, Math.round(ew * 0.2)); // 顶行不收成尖
    hw = Math.max(0, hw);
    const cx = bx + Math.round(side * cat.earSpread * (1 - i / eh)); // 耳尖向外张
    const y = ty + i;
    for (let x = cx - hw; x <= cx + hw; x++) {
      r.px(x, y, shade((x - cx) / (hw || 1), -0.6, x, y));
    }
  }
  // 内耳。大耳朵的内耳也更大。
  const iy = ty + eh - 2;
  const icx = bx + Math.round(side * cat.earSpread * 0.3);
  r.px(icx, iy, cat.pal.inner);
  r.px(icx, iy - 1, cat.pal.inner);
  if (cat.earW >= 6) {
    r.px(icx + side, iy, cat.pal.inner);
    r.px(icx, iy - 2, cat.pal.inner);
  }
}

/**
 * 眼睛。
 *
 * side 决定像素列的起始位置，这是为了保证左右对称 -
 * 在 3 像素宽的眼睛上错一格就是明显的斜视，这是像素尺度特有的陷阱。
 */
export function drawEye(
  r: Raster,
  cat: Cat,
  ex: number,
  ey: number,
  open: number,
  pdx: number,
  side: number,
): void {
  const big = cat.eyeBig;
  const x0 = side < 0 ? ex : ex - 1;
  const w = big ? 3 : 2;
  const h = big ? 3 : 2;
  const bx0 = big ? ex - 1 : x0;

  if (open > 0.55) {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        r.px(bx0 + dx, ey + dy - 1, cat.pal.eye[dy === h - 1 ? 1 : 0]);
      }
    }
    r.px(bx0 + (w >> 1) + pdx, ey, PUPIL);
    if (big) r.px(bx0 + (w >> 1) + pdx, ey - 1, PUPIL); // 竖瞳
    r.px(bx0, ey - 1, HIGHLIGHT);
    if (cat.eyeLiner) {
      for (let dx = -1; dx <= w; dx++) r.px(bx0 + dx, ey - 2, cat.pal.mark[1]);
    }
  } else if (open > 0.15) {
    // 半闭：只剩一条虹膜
    r.px(x0, ey, cat.pal.eye[0]);
    r.px(x0 + 1, ey, cat.pal.eye[1]);
  } else {
    // 全闭：一条描边色的线
    r.px(x0 - (side < 0 ? 0 : 1), ey, OUTLINE);
    r.px(x0 + 1, ey, OUTLINE);
    r.px(x0, ey, OUTLINE);
  }
}

/** 头。含毛领、耳朵、口鼻、嘴、眼睛、腮毛。 */
export function drawHead(r: Raster, cat: Cat, hx: number, hy: number, o: Pose): void {
  const rad = cat.headR * (o.scale ?? 1);
  const tiltPx = Math.round((o.tilt ?? 0) * 2.5);

  // 布偶毛领。画在头之前，垫在下面。
  if (cat.breed === 'ragdoll') {
    r.blob(
      hx,
      hy + rad * 0.45,
      rad + cat.marks.ruffR!,
      rad * 0.78,
      (_u, v) => {
        if (v < -0.2) return null;
        return cat.pal.white[tone(v) === 2 ? 2 : v > 0.4 ? 1 : 0];
      },
      0.8,
      cat.seed + 99,
    );
  }

  // 耳朵在头顶之上。earSet 控制耳距，earDrop 控制低位耳。
  const earTop = hy - rad - cat.earH + 2 + cat.earDrop;
  drawEar(
    r,
    cat,
    Math.round(hx - rad * cat.earSet) + tiltPx,
    Math.round(earTop + (o.earFlickL ? 1 : 0)),
    -1,
    o.earFlickL ?? 0,
    'earL',
  );
  drawEar(
    r,
    cat,
    Math.round(hx + rad * cat.earSet) + tiltPx,
    Math.round(earTop + (o.earFlickR ? 1 : 0)),
    1,
    o.earFlickR ?? 0,
    'earR',
  );

  r.blob(hx, hy, rad * 1.06, rad, furShade(cat, 'head'), cat.fluff * 0.7, cat.seed + 5);

  // 口鼻区
  const muzY = hy + rad * 0.42 + (o.muzzleDY ?? 0);
  r.blob(hx + tiltPx * 0.4, muzY, 3.2, 2.1, () => cat.pal.muzzle, 0, 0);
  r.px(hx + tiltPx * 0.4, muzY - 1, cat.pal.nose);

  // 嘴
  const mo = o.mouth ?? 0;
  if (mo > 0.05) {
    const mh = Math.max(1, Math.round(mo * 3.2));
    r.blob(hx + tiltPx * 0.4, muzY + 1 + mh * 0.4, 1.6, mh * 0.7 + 0.4, () => MOUTH_DARK, 0, 0);
    if (mo > 0.6) r.px(hx + tiltPx * 0.4, muzY + 1 + mh, TONGUE);
  }
  if (o.tongue) r.px(hx + tiltPx * 0.4, muzY + 2, TONGUE_LICK);

  // 眼睛
  const open = o.eyeOpen ?? 1;
  const ey = Math.round(hy - rad * 0.08 + (o.eyeDY ?? 0));
  const off = Math.round(rad * 0.42);
  const pdx = Math.round(o.pupilDX ?? 0);
  const tiltL = (o.tilt ?? 0) > 0.3 ? 1 : 0;
  const tiltR = (o.tilt ?? 0) < -0.3 ? 1 : 0;
  drawEye(r, cat, hx - off + tiltPx, ey + tiltL, open, pdx, -1);
  drawEye(r, cat, hx + off + tiltPx, ey + tiltR, open, pdx, 1);

  // 腮毛。黑猫脸细长，加了反而显脏。
  if (cat.breed !== 'black') {
    r.px(hx - rad - 1, hy + 1, cat.pal[layerOf(cat, 'head', -1, 0.1, hx - rad - 1, hy + 1)][1]);
    r.px(hx + rad + 1, hy + 1, cat.pal[layerOf(cat, 'head', 1, 0.1, hx + rad + 1, hy + 1)][1]);
  }
}

export interface LegOpts {
  /** 远侧腿。整体压暗一档以产生纵深。 */
  far?: boolean;
  ox?: number;
  /** 抬起高度。腾空动作靠它把腿带离地面。 */
  lift?: number;
  dir?: number;
}

/**
 * 腿。
 *
 * **腿的默认行为是找地面** - 从 topY 一直画到 GROUND。
 * 任何让身体离开地面的动作都必须通过 lift 把腿一起抬起，否则腿会被拉长贴地，
 * 看起来像身体在原地伸缩。这是姿态系统的结构性陷阱。
 */
export function drawLeg(r: Raster, cat: Cat, x: number, topY: number, o: LegOpts = {}): void {
  const bottom = GROUND - 1 - (o.lift ?? 0);
  const shade = furShade(cat, 'leg', { darken: o.far });
  const h = Math.max(2, bottom - topY + 1);
  r.rect(x + (o.ox ?? 0), topY, 2, h, shade, KIND_CAT);
  // 爪
  const pawShade: Shade = (u, _v, xx, yy) => cat.pal[layerOf(cat, 'leg', u, 0.9, xx, yy)][o.far ? 2 : 1];
  r.rect(x + (o.ox ?? 0) - ((o.dir ?? 0) > 0 ? 0 : 1), bottom, 3, 1, pawShade, KIND_CAT);
}
