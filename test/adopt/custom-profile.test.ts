import { describe, expect, it } from 'vitest';
import { accept, beginAdoption, nameIt, selectBreed } from '../../src/adopt/flow.js';

describe('领养只选择品种', () => {
  it('切换品种不会重抽性格或个体 Seed', () => {
    const first = beginAdoption(() => 0.2);
    const changed = selectBreed(first, 'cow');
    expect(changed.candidate.breed).toBe('cow');
    expect(changed.candidate.personality).toEqual(first.candidate.personality);
    expect(changed.candidate.seed).toBe(first.candidate.seed);
  });

  it('新领养身份不再携带外观与动作调参', () => {
    const flow = accept(selectBreed(beginAdoption(() => 0.2), 'ragdoll'));
    const result = nameIt(flow, '团子');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.identity).toEqual({
      breed: 'ragdoll',
      seed: flow.candidate.seed,
      personality: flow.candidate.personality,
      name: '团子',
    });
    expect(result.identity).not.toHaveProperty('marking');
    expect(result.identity).not.toHaveProperty('art');
    expect(result.identity).not.toHaveProperty('motion');
  });
});
