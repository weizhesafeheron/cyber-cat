import {
  ACTION_KEYS,
  H,
  W,
  XIAOMI_FRAME_COUNT,
  XIAOMI_FRAME_H,
  XIAOMI_FRAME_W,
  xiaomiFrameIndex,
} from '../render/index.js';
import type { ActionKey, RenderResult } from '../render/index.js';
import type { SpritePaintFrame } from './display.js';

interface CachedFrame {
  readonly normal: RenderResult;
  readonly mirrored: RenderResult;
}

export interface XiaomiFrame {
  readonly visual: SpritePaintFrame;
  readonly hit: RenderResult;
  readonly index: number;
}

const assetUrl = (action: ActionKey): string => `/pets/xiaomi/actions/${action}.webp`;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`小米动作素材加载失败：${src}`));
    image.src = src;
  });
}

function mirrored(result: RenderResult): RenderResult {
  const pixels = new Uint8ClampedArray(result.pixels.length);
  const alphaMask = new Uint8Array(result.alphaMask.length);
  for (let y = 0; y < result.height; y++) {
    for (let x = 0; x < result.width; x++) {
      const sourceX = result.width - 1 - x;
      const from = (y * result.width + sourceX) * 4;
      const to = (y * result.width + x) * 4;
      pixels[to] = result.pixels[from]!;
      pixels[to + 1] = result.pixels[from + 1]!;
      pixels[to + 2] = result.pixels[from + 2]!;
      pixels[to + 3] = result.pixels[from + 3]!;
      alphaMask[y * result.width + x] = result.alphaMask[y * result.width + sourceX]!;
    }
  }
  return { width: result.width, height: result.height, pixels, alphaMask };
}

/**
 * 小米 A 方案运行时：预载 15 条完整帧条带，并缓存每格的 72×56 命中掩膜。
 *
 * 屏幕上画的是 288×224 高清整格；命中仍使用产品既有的 72×56 逻辑坐标，
 * 因而拖拽、点击穿透、逗猫与舞台运动都不需要改协议。
 */
export class XiaomiSprites {
  private readonly strips = new Map<ActionKey, HTMLImageElement>();
  private readonly frames = new Map<ActionKey, readonly CachedFrame[]>();
  private loaded = false;

  get ready(): boolean {
    return this.loaded;
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    const entries = await Promise.all(
      ACTION_KEYS.map(async (action) => [action, await loadImage(assetUrl(action))] as const),
    );

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d', { alpha: true, willReadFrequently: true });
    if (!ctx) throw new Error('无法创建小米命中掩膜画布');
    ctx.imageSmoothingEnabled = false;

    for (const [action, image] of entries) {
      const expectedWidth = XIAOMI_FRAME_W * XIAOMI_FRAME_COUNT;
      if (image.naturalWidth !== expectedWidth || image.naturalHeight !== XIAOMI_FRAME_H) {
        throw new Error(
          `${action} 条带尺寸错误：${image.naturalWidth}×${image.naturalHeight}，期望 ${expectedWidth}×${XIAOMI_FRAME_H}`,
        );
      }
      this.strips.set(action, image);

      const actionFrames: CachedFrame[] = [];
      for (let index = 0; index < XIAOMI_FRAME_COUNT; index++) {
        ctx.clearRect(0, 0, W, H);
        ctx.drawImage(
          image,
          index * XIAOMI_FRAME_W,
          0,
          XIAOMI_FRAME_W,
          XIAOMI_FRAME_H,
          0,
          0,
          W,
          H,
        );
        const data = ctx.getImageData(0, 0, W, H).data;
        const pixels = new Uint8ClampedArray(data);
        const alphaMask = new Uint8Array(W * H);
        for (let pixel = 0; pixel < alphaMask.length; pixel++) {
          // 去掉边缘极淡的抗锯齿像素，避免透明画面周围出现过宽的点击区。
          alphaMask[pixel] = pixels[pixel * 4 + 3]! >= 32 ? 255 : 0;
        }
        const normal: RenderResult = { width: W, height: H, pixels, alphaMask };
        actionFrames.push({ normal, mirrored: mirrored(normal) });
      }
      this.frames.set(action, actionFrames);
    }
    this.loaded = true;
  }

  frame(action: ActionKey, seconds: number, dir: 1 | -1): XiaomiFrame {
    if (!this.loaded) throw new Error('小米动作素材尚未加载');
    const index = xiaomiFrameIndex(action, seconds);
    const strip = this.strips.get(action);
    const cached = this.frames.get(action)?.[index];
    if (!strip || !cached) throw new Error(`缺少小米动作帧：${action}/${index}`);
    return {
      index,
      visual: {
        source: strip,
        sx: index * XIAOMI_FRAME_W,
        sy: 0,
        sw: XIAOMI_FRAME_W,
        sh: XIAOMI_FRAME_H,
        flipX: dir < 0,
      },
      hit: dir < 0 ? cached.mirrored : cached.normal,
    };
  }
}

