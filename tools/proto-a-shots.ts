/**
 * 原型 A 自验截图：在 node 里逐场景渲染「现状 / 原型 A」对照图，输出 PNG。
 *
 * 用法：npx vite-node tools/proto-a-shots.ts [输出目录]
 *
 * 渲染层与 DOM 无关（ADR 0002 的缝二），所以不开浏览器就能出图；
 * 这些图用于开发中自查 pillow shading / 轮廓沸腾 / 接缝走样，
 * 最终代表性截图存 docs/research/2026-07-31-prototype-a-shots/。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { ACTIONS, CatRenderer, H, W, makeCat } from '../src/render/index.js';
import type { ActionKey, BreedKey, MicroOut, Pose, RenderResult } from '../src/render/index.js';
import { H2, ProtoARenderer, W2 } from '../src/render/proto-a/index.js';

const OUT_DIR = process.argv[2] ?? 'proto-a-shots';

// ---------- 极简 PNG 编码 ----------

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf: Uint8Array): number {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (1 + width * 4) + 1);
  }
  const idat = deflateSync(raw);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

// ---------- 画布 ----------

class Sheet {
  readonly data: Uint8Array;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.data = new Uint8Array(w * h * 4);
    // 与 harness 相同气质的深色背景，含一条「地面」分界。
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        this.data[o] = 0x17;
        this.data[o + 1] = 0x1d;
        this.data[o + 2] = 0x36;
        this.data[o + 3] = 255;
      }
    }
  }

  blit(res: RenderResult, dx: number, dy: number, scale: number): void {
    for (let y = 0; y < res.height; y++) {
      for (let x = 0; x < res.width; x++) {
        const so = (y * res.width + x) * 4;
        if (res.pixels[so + 3] === 0) continue;
        for (let yy = 0; yy < scale; yy++) {
          for (let xx = 0; xx < scale; xx++) {
            const tx = dx + x * scale + xx;
            const ty = dy + y * scale + yy;
            if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) continue;
            const to = (ty * this.w + tx) * 4;
            this.data[to] = res.pixels[so]!;
            this.data[to + 1] = res.pixels[so + 1]!;
            this.data[to + 2] = res.pixels[so + 2]!;
            this.data[to + 3] = 255;
          }
        }
      }
    }
  }
}

// ---------- 场景采样 ----------

const MI: MicroOut = { eyeOpen: 1, earFlickL: 0, earFlickR: 0, tilt: 0 };
const BLINK: MicroOut = { ...MI, eyeOpen: 0.05 };

interface Sample {
  label: string;
  action: ActionKey;
  t: number;
  mi?: MicroOut;
}

const SCENES: Record<string, readonly Sample[]> = {
  'stand-blink': [
    { label: 'open', action: 'idle', t: 0.4 },
    { label: 'blink', action: 'idle', t: 0.4, mi: BLINK },
  ],
  walk: [
    { label: 'step1', action: 'walk', t: 0.12 },
    { label: 'step2', action: 'walk', t: 0.3 },
  ],
  sleep: [
    { label: 'inhale', action: 'sleep', t: 1.15 },
    { label: 'exhale', action: 'sleep', t: 3.45 },
  ],
  eat: [
    { label: 'down', action: 'eat', t: 1.5 },
    { label: 'up', action: 'eat', t: 2.9 },
  ],
  'held-land': [
    { label: 'held', action: 'held', t: 0.6 },
    { label: 'land', action: 'land', t: 0.18 },
  ],
  'sit-rise': [
    { label: 'sit', action: 'sit', t: 0.8 },
    { label: 'rise', action: 'idle', t: 0.2 },
  ],
};

// ---------- 出图 ----------

const current = new CatRenderer();
const protoA = new ProtoARenderer();

const CELL_W = W2 * 2; // 288
const CELL_H = H2 * 2; // 224
const GAP = 8;

function poseOf(sample: Sample, cat: ReturnType<typeof makeCat>): Pose {
  return ACTIONS[sample.action].make(sample.t, cat, sample.mi ?? MI, { tailSweep: true });
}

mkdirSync(OUT_DIR, { recursive: true });

const breed: BreedKey = (process.env.SHOT_BREED as BreedKey) ?? 'orange';
const seed = Number(process.env.SHOT_SEED ?? 20260731);
const cat = makeCat(breed, seed);

for (const [name, samples] of Object.entries(SCENES)) {
  const sheet = new Sheet(
    samples.length * (CELL_W + GAP) + GAP,
    2 * (CELL_H + GAP) + GAP,
  );
  samples.forEach((sample, i) => {
    const pose = poseOf(sample, cat);
    const x = GAP + i * (CELL_W + GAP);
    sheet.blit(current.render(cat, pose), x, GAP, 4);
    sheet.blit(protoA.render(cat, pose), x, GAP * 2 + CELL_H, 2);
  });
  writeFileSync(join(OUT_DIR, `${breed}-${name}.png`), encodePng(sheet.w, sheet.h, sheet.data));
}

// 辨识度：6 品种同屏 idle，上排现状、下排原型 A。
const ID_BREEDS: readonly BreedKey[] = ['orange', 'black', 'cow', 'ragdoll', 'devon', 'aby'];
const idSheet = new Sheet(ID_BREEDS.length * (CELL_W + GAP) + GAP, 2 * (CELL_H + GAP) + GAP);
ID_BREEDS.forEach((b, i) => {
  const c = makeCat(b, seed + i * 31 + 7);
  const pose = ACTIONS.idle.make(0.4 + i * 0.61, c, MI, { tailSweep: true });
  const x = GAP + i * (CELL_W + GAP);
  idSheet.blit(current.render(c, pose), x, GAP, 4);
  idSheet.blit(protoA.render(c, pose), x, GAP * 2 + CELL_H, 2);
});
writeFileSync(join(OUT_DIR, 'identity-6cats.png'), encodePng(idSheet.w, idSheet.h, idSheet.data));

console.log(`✓ 截图输出到 ${OUT_DIR}（上排现状 4x，下排原型 A 2x，同显示尺寸）`);
console.log(`  尺寸核对：现状 ${W}x${H}，原型 A ${W2}x${H2}`);
