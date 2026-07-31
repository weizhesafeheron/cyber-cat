/** 程序 tween：缓动函数与拼接时间线。纯函数。 */

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

export const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;

export const easeInQuad = (u: number): number => u * u;

export const easeOutQuad = (u: number): number => u * (2 - u);

export const easeInOutQuad = (u: number): number =>
  u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;

export const easeOutCubic = (u: number): number => 1 - (1 - u) ** 3;

/** 轻微过冲的回弹，落地/起身收尾用。 */
export const easeOutBack = (u: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (u - 1) ** 3 + c1 * (u - 1) ** 2;
};

export interface PhaseState {
  /** 当前段下标。 */
  index: number;
  /** 段内进度 0..1。 */
  u: number;
  /** 段内已经历秒数。 */
  local: number;
}

/**
 * 拼接时间线：把 t 定位到一串时长段里。
 * loop = true 时对总时长取模；false 时停在最后一段末尾。
 */
export function phaseAt(t: number, durations: readonly number[], loop = true): PhaseState {
  const total = durations.reduce((s, d) => s + d, 0);
  if (total <= 0) return { index: 0, u: 0, local: 0 };
  let time = loop ? ((t % total) + total) % total : Math.min(Math.max(t, 0), total);
  for (let i = 0; i < durations.length; i++) {
    const d = durations[i]!;
    if (time < d || i === durations.length - 1) {
      const local = Math.min(time, d);
      return { index: i, u: d > 0 ? clamp01(local / d) : 1, local };
    }
    time -= d;
  }
  return { index: durations.length - 1, u: 1, local: durations[durations.length - 1]! };
}

/**
 * 确定性眨眼时间线。返回睁眼度 0..1。
 * 周期由 seed 微扰，双眨概率也由 seed 决定，同一只猫永远同一节奏。
 */
export function blinkOpenness(t: number, seed: number): number {
  const s = Math.abs(seed | 0);
  const period = 2.8 + ((s % 7) * 0.22); // 2.8s..4.1s
  const u = ((t % period) + period) % period;
  const closeDur = 0.11;
  const reopenAt = period - closeDur;
  if (u < reopenAt) return 1;
  const k = (u - reopenAt) / closeDur;
  // 快合慢开
  return k < 0.4 ? 1 - k / 0.4 : (k - 0.4) / 0.6;
}
