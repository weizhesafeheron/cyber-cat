import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const main = readFileSync(new URL('../../src/adopt/main.ts', import.meta.url), 'utf8');

describe('领养预览使用固定动作', () => {
  it('逐帧时间只持续累加，不再存在用户可拖动的动作节奏', () => {
    expect(main).toContain('animT += dt');
    expect(main).not.toContain('tuneMotionTime');
    expect(main).not.toContain('setMotionTuning');
  });
});
