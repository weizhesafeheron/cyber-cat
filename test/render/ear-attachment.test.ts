import { describe, expect, it } from 'vitest';
import {
  BREED_KEYS,
  DEFAULT_ART_TUNING,
  earAttachment,
  materializeCat,
} from '../../src/render/index.js';
import { drawEar } from '../../src/render/parts.js';
import { H, Raster, W } from '../../src/render/raster.js';

const POSE = { eyeOpen: 1, earFlickL: 0, earFlickR: 0, tilt: 0 };

describe('耳根沿着脸部轮廓连接', () => {
  it('小头大耳在最靠拢与最外张时，耳根都不会浮在脸部边界上方', () => {
    for (const breed of BREED_KEYS) {
      for (const spread of [-1, 1]) {
        const cat = materializeCat({
          breed,
          seed: 20260730,
          art: {
            ...DEFAULT_ART_TUNING,
            headSize: -1,
            earSize: 1,
            earSpread: spread,
          },
        });
        for (const side of [-1, 1] as const) {
          const attachment = earAttachment(cat, 36, 30, side, POSE);
          expect(
            attachment.rootY,
            `${breed} / spread ${spread} / side ${side}: root=${attachment.rootY}, face=${attachment.faceY}`,
          ).toBeGreaterThanOrEqual(Math.ceil(attachment.faceY) + 1);
        }
      }
    }
  });

  it('耳朵随外扩真正旋转，最外档与地面保持 45 度下限', () => {
    for (const breed of BREED_KEYS) {
      const angles = [0, 0.5, 1].map(
        (earSpread) =>
          materializeCat({
            breed,
            seed: 20260730,
            art: { ...DEFAULT_ART_TUNING, earSpread },
          }).earAngle!,
      );
      expect(angles[1], breed).toBeLessThan(angles[0]);
      expect(angles[2], breed).toBeLessThan(angles[1]);
      expect(angles[2], breed).toBeCloseTo(45, 6);
      expect(Math.min(...angles), breed).toBeGreaterThanOrEqual(45);
    }
  });

  it('圆耳在最大外扩时仍有圆弧帽，不退化成尖角', () => {
    const cat = materializeCat({
      breed: 'orange',
      seed: 20260730,
      art: { ...DEFAULT_ART_TUNING, earShape: 1, earSpread: 1, earSize: 1 },
    });
    const raster = new Raster();
    raster.clear();
    drawEar(raster, cat, 30, 20, 1, 0, 'earR', 42);
    raster.outlinePass();
    const mask = raster.toResult().alphaMask;
    let topY = H;
    for (let y = 0; y < H && topY === H; y++) {
      for (let x = 0; x < W; x++) {
        if (mask[y * W + x] === 255) {
          topY = y;
          break;
        }
      }
    }
    let capPixels = 0;
    for (let x = 0; x < W; x++) if (mask[topY * W + x] === 255) capPixels++;
    expect(capPixels).toBeGreaterThanOrEqual(3);
  });
});
