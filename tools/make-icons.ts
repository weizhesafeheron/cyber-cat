import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACTIONS, CatRenderer, makeCat } from '../src/render/index.js';
import type { RenderResult } from '../src/render/index.js';
import { encodePng } from './png.js';

/**
 * 生成应用图标与托盘图标。
 *
 * 图标用渲染器画的真猫，而不是外部素材 - 这样图标永远和产品里的猫是同一套
 * 参数与调色板，改了渲染核心重跑一次即可同步。
 *
 * 用法：npx vite-node tools/make-icons.ts
 * 之后再跑 npx tauri icon src-tauri/app-icon.png 生成各平台所需的尺寸。
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../src-tauri');

/** 图标里用哪只猫。橘猫最有辨识度，坐姿最紧凑。 */
const ICON_BREED = 'orange' as const;
const ICON_SEED = 20260728;

const renderer = new CatRenderer();
const cat = makeCat(ICON_BREED, ICON_SEED);
const MI = { eyeOpen: 1, earFlickL: 0, earFlickR: 0, tilt: 0 };
// t 取一个呼吸周期中段、眼睛完全睁开的时刻
const full = renderer.render(cat, ACTIONS.sit.make(0.8, cat, MI));

/** 裁到掩膜的包围盒并居中放进正方形画布，避免图标四周留大片空白。 */
function cropToSquare(res: RenderResult, pad: number): {
  pixels: Uint8ClampedArray;
  size: number;
} {
  let x0 = res.width;
  let y0 = res.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < res.height; y++) {
    for (let x = 0; x < res.width; x++) {
      if (res.pixels[(y * res.width + x) * 4 + 3] !== 255) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const size = Math.max(w, h) + pad * 2;
  const out = new Uint8ClampedArray(size * size * 4);
  const ox = ((size - w) / 2) | 0;
  const oy = ((size - h) / 2) | 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = ((y + y0) * res.width + (x + x0)) * 4;
      const di = ((y + oy) * size + (x + ox)) * 4;
      out[di] = res.pixels[si]!;
      out[di + 1] = res.pixels[si + 1]!;
      out[di + 2] = res.pixels[si + 2]!;
      out[di + 3] = res.pixels[si + 3]!;
    }
  }
  return { pixels: out, size };
}

mkdirSync(OUT, { recursive: true });

// 应用图标：源图放大到 1024，供 tauri icon 派生各平台尺寸
const app = cropToSquare(full, 3);
const appScale = Math.floor(1024 / app.size);
writeFileSync(resolve(OUT, 'app-icon.png'), encodePng(app.pixels, app.size, app.size, appScale));
console.log(`app-icon.png  源 ${app.size}x${app.size} → ${app.size * appScale}px（整数 ${appScale}× 放大）`);

// 托盘图标：macOS 菜单栏按 22pt 显示，出 2x 的 44px
const tray = cropToSquare(full, 1);
const trayScale = Math.max(1, Math.floor(44 / tray.size));
writeFileSync(
  resolve(OUT, 'icons/tray.png'),
  encodePng(tray.pixels, tray.size, tray.size, trayScale),
);
console.log(`icons/tray.png 源 ${tray.size}x${tray.size} → ${tray.size * trayScale}px`);
