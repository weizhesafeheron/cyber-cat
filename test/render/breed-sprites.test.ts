import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ACTION_KEYS, BREEDS, BREED_KEYS } from '../../src/render/index.js';

describe('品种完整帧目录', () => {
  it('每个品种都指向自己的资源目录，而不是小米换色', () => {
    const assets = BREED_KEYS.map((breed) => BREEDS[breed].sprite.asset);
    expect(new Set(assets).size).toBe(BREED_KEYS.length);
    expect(BREEDS.cow.sprite.asset).toBe('xiaomi');
  });

  it('每个品种都提供完整 15 条动作资源', () => {
    for (const breed of BREED_KEYS) {
      const asset = BREEDS[breed].sprite.asset;
      for (const action of ACTION_KEYS) {
        expect(
          existsSync(new URL(`../../public/pets/${asset}/actions/${action}.webp`, import.meta.url)),
          `${breed} 缺少 ${asset}/${action}`,
        ).toBe(true);
      }
    }
  });
});
