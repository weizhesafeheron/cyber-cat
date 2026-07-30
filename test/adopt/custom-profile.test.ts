import { describe, expect, it } from 'vitest';
import {
  accept,
  beginAdoption,
  nameIt,
  randomizeVisuals,
  rerollAppearance,
  selectBreed,
  setArtTuning,
  setMotionTuning,
} from '../../src/adopt/flow.js';
import { materializeCat } from '../../src/render/index.js';

describe('领养草稿把性格与可调外观分开', () => {
  const values = [0.1, 0.2, 0.31, 0.42, 0.53, 0.64, 0.75];
  const rnd = (): number => values.shift() ?? 0.88;

  it('换品种、换花纹和调参都不会重抽性格', () => {
    const first = beginAdoption(rnd);
    const personality = first.candidate.personality;
    const bodySeed = first.candidate.seed;
    const changed = setMotionTuning(
      setArtTuning(
        rerollAppearance(selectBreed(first, 'cow'), rnd),
        { roundness: 0.6, cheekWidth: 0.4 },
      ),
      'walk',
      { bodyBob: -0.8, gaitFlow: 0.7 },
    );
    expect(changed.candidate.personality).toEqual(personality);
    expect(changed.candidate.seed).toBe(bodySeed);
    expect(changed.candidate.marking.variant).not.toBe(first.candidate.marking.variant);
    expect(changed.candidate.breed).toBe('cow');
    expect(changed.candidate.art.roundness).toBe(0.6);
    expect(changed.candidate.motion.walk?.bodyBob).toBe(-0.8);
  });

  it('起名产出的身份包含完整快照，之后改草稿不会改身份', () => {
    const tuned = setArtTuning(beginAdoption(rnd), { eyeSize: 0.45 });
    const result = nameIt(accept(tuned), '团子');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.identity.personality).toEqual(tuned.candidate.personality);
    expect(result.identity.marking).toEqual(tuned.candidate.marking);
    expect(result.identity.art?.eyeSize).toBe(0.45);
    expect(materializeCat(result.identity).eyeScale).toBeGreaterThan(1);
    const later = setArtTuning(tuned, { eyeSize: -1 });
    expect(result.identity.art?.eyeSize).toBe(0.45);
    expect(later.candidate.art.eyeSize).toBe(-1);
  });

  it('完全随机只覆盖品种和外观，动作恢复默认并保留性格', () => {
    const initial = beginAdoption(() => 0.1);
    const tuned = setMotionTuning(initial, 'walk', { strideLength: 0.8 });
    let draw = 0;
    const randomized = randomizeVisuals(tuned, () => ((draw++ * 37 + 73) % 101) / 100);
    expect(randomized.candidate.personality).toEqual(initial.candidate.personality);
    expect(randomized.candidate.breed).not.toBe(initial.candidate.breed);
    expect(randomized.candidate.seed).not.toBe(initial.candidate.seed);
    expect(Object.values(randomized.candidate.art).some((value) => value !== 0)).toBe(true);
    expect(randomized.candidate.motion).toEqual({});
  });
});
