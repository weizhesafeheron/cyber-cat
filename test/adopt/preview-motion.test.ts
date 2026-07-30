import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const main = readFileSync(new URL('../../src/adopt/main.ts', import.meta.url), 'utf8');

describe('领养动作预览时钟', () => {
  it('拖动节奏时只缩放本帧增量，不重算累计动画时间', () => {
    expect(main).toContain('animT += tuneMotionTime(dt, tuning, action, cat)');
    expect(main).not.toMatch(/make\(tuneMotionTime\(animT,/);
  });
});
