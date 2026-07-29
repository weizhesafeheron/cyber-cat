import { drawHead, drawLeg, drawTail, furShade } from './parts.js';
import { GROUND, type Raster } from './raster.js';
import type { Cat, Form, Pose } from './types.js';

/** 姿态绘制后返回的锚点，供影子与装饰定位。 */
export interface Anchors {
  /** 身体中心 x */
  bx: number;
  /** 头中心 x */
  hx: number;
  /** 头中心 y */
  hy: number;
}

const CENTER_X = 34;

/**
 * 这个姿态下头中心的横向列位，精灵像素。
 *
 * 导出是给头顶的气泡对齐用的（src/say/）：气泡的尾巴尖要指着头那一列，
 * 不然它指的是猫的后背。**必须与 drawStand 里那一行是同一个表达式** -
 * 在气泡那边照抄一份的代价是：头的列位取决于品种的体宽（德文瘦、美短最宽），
 * 拍一个固定偏移量在瘦品种上会偏三四个精灵像素，而这种偏差只有盯着看才发现。
 *
 * 只对站立类姿态成立（吃饭、走路、站立、扑跳都是 stand）。坐姿趴姿的头在别处，
 * 但那些姿态目前没有气泡。
 */
export function headColumn(cat: Cat, p: Pose, dir: 1 | -1): number {
  const rw = cat.bodyRW * (p.stretchX ?? 1);
  const bx = CENTER_X + (p.dx ?? 0);
  return bx + dir * (rw - 1) + (p.headDX ?? 0) * dir;
}

/** 四足站立。走路、伸懒腰、扑跳、吃饭都基于它。 */
function drawStand(r: Raster, cat: Cat, p: Pose): Anchors {
  const dir = p.dir ?? 1;
  const breath = 1 + (p.breath ?? 0);
  const rw = cat.bodyRW * (p.stretchX ?? 1);
  const rh = cat.bodyRH * breath * (p.squashY ?? 1);
  const bx = CENTER_X + (p.dx ?? 0);
  const legLen = cat.legLen * (p.legScale ?? 1);
  const by = GROUND - legLen - rh * 0.82 + (p.dy ?? 0);

  drawTail(r, cat, bx - dir * (rw - 1), by - 2, {
    baseAng: p.tailAng ?? 0.9,
    curl: p.tailCurl ?? 1.6,
    wave: p.tailWave,
    wavePhase: p.tailPhase,
    dirX: -dir,
  });

  // 整体腾空：四条腿一起离地。
  const air = Math.max(0, Math.round(p.airborne ?? 0));
  const legTop = by + rh * 0.5;
  const ox = (i: number): number => p.legOx?.[i] ?? 0;
  const lift = (i: number): number => (p.legLift?.[i] ?? 0) + air;

  // 远侧腿先画，被身体压住，产生纵深。
  drawLeg(r, cat, bx + dir * (rw - 5) - 1, legTop, { far: true, ox: ox(1), lift: lift(1), dir });
  drawLeg(r, cat, bx - dir * (rw - 5) - 1, legTop, { far: true, ox: ox(3), lift: lift(3), dir });

  r.blob(bx, by, rw, rh, furShade(cat, 'body'), cat.fluff, cat.seed);

  drawLeg(r, cat, bx + dir * (rw - 3) - 1, legTop, { ox: ox(0), lift: lift(0), dir });
  drawLeg(r, cat, bx - dir * (rw - 3) - 1, legTop, { ox: ox(2), lift: lift(2), dir });

  const hx = bx + dir * (rw - 1) + (p.headDX ?? 0) * dir;
  const hy = by - rh - cat.headR * 0.55 + (p.headDY ?? 0);
  drawHead(r, cat, Math.round(hx), Math.round(hy), p);
  return { bx, hx, hy };
}

/**
 * 端坐。后臀 + 胸 + 直立的前腿。
 *
 * 坐姿高度随腿长变化（rearRY），宽窄由品种的 sitW 决定 -
 * 写死高度会让腿长的黑猫和腿短的橘猫坐下来一样高，抹掉体型差异。
 */
function drawSit(r: Raster, cat: Cat, p: Pose): Anchors {
  const dir = p.dir ?? 1;
  const breath = 1 + (p.breath ?? 0);
  const bx = CENTER_X + (p.dx ?? 0);
  const rearRX = cat.bodyRW * cat.sitW;
  const rearRY = (7.2 + cat.legLen * 0.72) * breath;
  const rearCX = bx - dir * 2;
  const rearCY = GROUND - rearRY + 0.5;

  if (p.tailWrap !== false) {
    drawTail(r, cat, rearCX - dir * (rearRX - 2), GROUND - 2.4, {
      baseAng: -0.12,
      curl: p.tailCurl ?? 0.5,
      wave: p.tailWave ?? 0.5,
      wavePhase: p.tailPhase,
      dirX: dir,
      floor: true,
    });
  }

  r.blob(rearCX, rearCY, rearRX, rearRY, furShade(cat, 'body'), cat.fluff, cat.seed);

  const chestCX = bx + dir * 4.5;
  const chestRY = rearRY * 0.84;
  const chestCY = GROUND - chestRY + 0.5;
  r.blob(chestCX, chestCY, 5.8, chestRY, furShade(cat, 'body'), cat.fluff, cat.seed + 3);

  // pawLift > 0 时近侧前爪抬到嘴边（舔毛用）。
  drawLeg(r, cat, Math.round(chestCX + dir * 2) - 1, Math.round(GROUND - 7), {
    dir,
    lift: p.pawLift ?? 0,
  });
  drawLeg(r, cat, Math.round(chestCX - dir * 2) - 1, Math.round(GROUND - 7), { far: true, dir });

  const hx = chestCX + dir * 1.5 + (p.headDX ?? 0) * dir;
  const hy = GROUND - chestRY * 2 - cat.headR * 0.78 + 1.5 + (p.headDY ?? 0);
  drawHead(r, cat, Math.round(hx), Math.round(hy), { ...p, scale: (p.scale ?? 1) * 1.06 });
  return { bx, hx, hy };
}

/** 趴下（面包坐）。身体压扁贴地，前爪收在身下。 */
function drawLie(r: Raster, cat: Cat, p: Pose): Anchors {
  const dir = p.dir ?? 1;
  const breath = 1 + (p.breath ?? 0) * 0.7;
  const bx = CENTER_X + (p.dx ?? 0);
  const rw = cat.bodyRW * 1.08;
  const rh = 5.6 * breath;
  const by = GROUND - rh + 0.4;

  drawTail(r, cat, bx - dir * (rw - 2), GROUND - 2.2, {
    baseAng: 0.06,
    curl: 0.25,
    wave: p.tailWave,
    wavePhase: p.tailPhase,
    dirX: -dir,
    floor: true,
  });

  r.blob(bx, by, rw, rh, furShade(cat, 'body'), cat.fluff, cat.seed);
  // 前爪
  r.blob(bx + dir * (rw - 3), GROUND - 1.4, 2.4, 1.4, furShade(cat, 'leg'), 0, 0);

  const hx = bx + dir * (rw - 2) + (p.headDX ?? 0) * dir;
  const hy = GROUND - rh * 2 - cat.headR * 0.55 + 0.5 + (p.headDY ?? 0);
  drawHead(r, cat, Math.round(hx), Math.round(hy), p);
  return { bx, hx, hy };
}

/** 蜷成一团。睡觉用，尾巴绕过身前直到鼻尖。 */
function drawCurl(r: Raster, cat: Cat, p: Pose): Anchors {
  const dir = p.dir ?? 1;
  const breath = 1 + (p.breath ?? 0) * 0.8;
  const bx = CENTER_X + (p.dx ?? 0);
  const rw = cat.bodyRW * 0.95;
  const rh = 7.6 * breath;
  const by = GROUND - rh + 0.4;

  r.blob(bx, by, rw, rh, furShade(cat, 'body'), cat.fluff, cat.seed);

  drawTail(r, cat, bx - dir * (rw - 3), GROUND - 2, {
    baseAng: -0.05,
    curl: 0.55,
    wave: 0,
    dirX: dir,
    floor: true,
  });

  const hx = bx + dir * (rw * 0.55);
  const hy = by - rh * 0.15;
  drawHead(r, cat, Math.round(hx), Math.round(hy), {
    scale: 0.92,
    ...p,
    eyeOpen: p.eyeOpen ?? 0,
  });
  return { bx, hx, hy };
}

export const FORMS: Record<Form, (r: Raster, cat: Cat, p: Pose) => Anchors> = {
  stand: drawStand,
  sit: drawSit,
  lie: drawLie,
  curl: drawCurl,
};
