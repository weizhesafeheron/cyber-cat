import {
  ACTION_KEYS,
  BREED_KEYS,
  H,
  W,
  XIAOMI_FRAME_COUNT,
  XIAOMI_FRAME_H,
  XIAOMI_FRAME_W,
  getBreed,
  xiaomiFrameIndex,
} from '../render/index.js';
import type { ActionKey, BreedKey, RenderResult } from '../render/index.js';
import type { SpritePaintFrame } from './display.js';

interface CachedFrame {
  readonly normal: RenderResult;
  readonly mirrored: RenderResult;
}

export interface BreedSpriteFrame {
  readonly visual: SpritePaintFrame;
  readonly hit: RenderResult;
  readonly index: number;
}

const sourceUrl = (asset: string, action: ActionKey): string =>
  `/pets/${asset}/actions/${action}.webp`;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`猫咪动作素材加载失败：${src}`));
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
 * 按品种加载独立的高清完整帧资源。每个品种目录都必须提供完整 15 条动作，
 * 运行时只逐格裁切和镜像，不再做换色、局部拼接或形变。
 */
export class BreedSprites {
  private readonly strips = new Map<string, Map<ActionKey, HTMLImageElement>>();
  private readonly frames = new Map<string, readonly CachedFrame[]>();

  async load(breeds: readonly BreedKey[] = BREED_KEYS): Promise<void> {
    const assets = [...new Set(breeds.map((breed) => getBreed(breed).sprite.asset))];
    await Promise.all(assets.map((asset) => this.loadAsset(asset)));
  }

  private async loadAsset(asset: string): Promise<void> {
    if (this.strips.has(asset)) return;
    const entries = await Promise.all(
      ACTION_KEYS.map(async (action) => [action, await loadImage(sourceUrl(asset, action))] as const),
    );
    const strips = new Map<ActionKey, HTMLImageElement>();
    this.strips.set(asset, strips);

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d', { alpha: true, willReadFrequently: true });
    if (!ctx) throw new Error('无法创建猫咪命中掩膜画布');
    ctx.imageSmoothingEnabled = false;

    for (const [action, image] of entries) {
      const expectedWidth = XIAOMI_FRAME_W * XIAOMI_FRAME_COUNT;
      if (image.naturalWidth !== expectedWidth || image.naturalHeight !== XIAOMI_FRAME_H) {
        throw new Error(
          `${asset}/${action} 条带尺寸错误：${image.naturalWidth}×${image.naturalHeight}，` +
            `期望 ${expectedWidth}×${XIAOMI_FRAME_H}`,
        );
      }
      strips.set(action, image);
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
          alphaMask[pixel] = pixels[pixel * 4 + 3]! >= 32 ? 255 : 0;
        }
        const normal: RenderResult = { width: W, height: H, pixels, alphaMask };
        actionFrames.push({ normal, mirrored: mirrored(normal) });
      }
      this.frames.set(`${asset}/${action}`, actionFrames);
    }
  }

  frameAt(breed: BreedKey, action: ActionKey, index: number, dir: 1 | -1): BreedSpriteFrame {
    const asset = getBreed(breed).sprite.asset;
    const strip = this.strips.get(asset)?.get(action);
    const frameIndex = Math.min(XIAOMI_FRAME_COUNT - 1, Math.max(0, Math.floor(index)));
    const cached = this.frames.get(`${asset}/${action}`)?.[frameIndex];
    if (!strip || !cached) throw new Error(`缺少猫咪动作帧：${breed}/${action}/${frameIndex}`);
    return {
      index: frameIndex,
      visual: {
        source: strip,
        sx: frameIndex * XIAOMI_FRAME_W,
        sy: 0,
        sw: XIAOMI_FRAME_W,
        sh: XIAOMI_FRAME_H,
        flipX: dir < 0,
      },
      hit: dir < 0 ? cached.mirrored : cached.normal,
    };
  }

  frame(breed: BreedKey, action: ActionKey, seconds: number, dir: 1 | -1): BreedSpriteFrame {
    return this.frameAt(breed, action, xiaomiFrameIndex(action, seconds), dir);
  }
}
