/**
 * 部件位图加载与换色缓存。
 *
 * PNG 解码交给浏览器（Image + 离屏 canvas），换色是 CPU 逐像素查表，
 * 每个「图片 × 配色」只算一次，结果缓存成离屏 canvas 供 drawImage 直接用。
 */
import { PARTS_DOC } from './parts-data.js';
import { remapPixels } from './ramp.js';
import type { Colorway } from './palette.js';

interface RawImage {
  data: Uint8ClampedArray;
  w: number;
  h: number;
}

const raw = new Map<string, RawImage>();
const recolored = new Map<string, HTMLCanvasElement>();

let loadPromise: Promise<void> | null = null;
let loaded = false;

function assetUrl(file: string): string {
  return new URL(`./assets/${file}`, import.meta.url).href;
}

async function loadOne(file: string): Promise<void> {
  const img = new Image();
  img.src = assetUrl(file);
  await img.decode();
  const cv = document.createElement('canvas');
  cv.width = img.naturalWidth;
  cv.height = img.naturalHeight;
  const ctx = cv.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, cv.width, cv.height);
  raw.set(file, { data: data.data, w: cv.width, h: cv.height });
}

/** 启动全部部件与 mask 的加载。幂等。 */
export function ensureLoading(): Promise<void> {
  if (loadPromise) return loadPromise;
  const files = new Set<string>();
  for (const part of PARTS_DOC.parts) {
    for (const file of Object.values(part.images)) files.add(file);
  }
  for (const byKey of Object.values(PARTS_DOC.masks)) {
    for (const file of Object.values(byKey)) files.add(file);
  }
  loadPromise = Promise.all([...files].map(loadOne)).then(() => {
    loaded = true;
  });
  return loadPromise;
}

export function assetsReady(): boolean {
  return loaded;
}

/** 取某图片在某配色下的位图（含花纹叠加）。未加载完返回 null。 */
export function partBitmap(file: string, cw: Colorway): HTMLCanvasElement | null {
  if (!loaded) return null;
  const key = `${file}|${cw.key}`;
  const hit = recolored.get(key);
  if (hit) return hit;

  const src = raw.get(file);
  if (!src) return null;
  let mask: Uint8ClampedArray | null = null;
  if (cw.pattern) {
    const maskFile = PARTS_DOC.masks[file]?.[cw.pattern.mask];
    if (maskFile) mask = raw.get(maskFile)?.data ?? null;
  }
  const out = remapPixels(src.data, mask, cw);
  const cv = document.createElement('canvas');
  cv.width = src.w;
  cv.height = src.h;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(src.w, src.h);
  img.data.set(out);
  ctx.putImageData(img, 0, 0);
  recolored.set(key, cv);
  return cv;
}
