import type { ActionKey } from './actions.js';
import type { Cat, Pose } from './types.js';

/** 动作的观感参数。它只改变画面，不改变世界层选动作的概率。 */
export interface CatMotionTuning {
  tempo: number;
  strideLength: number;
  footLift: number;
  bodyBob: number;
  headBob: number;
  gaitFlow: number;
  tailBalance: number;
}

export type CatMotionTuningKey = keyof CatMotionTuning;

export interface MotionTuningControl {
  key: CatMotionTuningKey;
  label: string;
  low: string;
  high: string;
}

export const MOTION_TUNING_CONTROLS = [
  { key: 'tempo', label: '动作节奏', low: '从容', high: '急促' },
  { key: 'strideLength', label: '步幅', low: '小碎步', high: '大步' },
  { key: 'footLift', label: '抬脚高度', low: '贴地', high: '高抬' },
  { key: 'bodyBob', label: '身体起伏', low: '平稳', high: '弹跳' },
  { key: 'headBob', label: '头部动作', low: '稳定', high: '点头' },
  { key: 'gaitFlow', label: '动作衔接', low: '硬朗', high: '流畅' },
  { key: 'tailBalance', label: '尾巴平衡', low: '安静', high: '灵动' },
] as const satisfies readonly MotionTuningControl[];

const CONTROL_BY_KEY = Object.fromEntries(
  MOTION_TUNING_CONTROLS.map((control) => [control.key, control]),
) as Record<CatMotionTuningKey, MotionTuningControl>;

/**
 * 每个动作只暴露确实能改变该姿态、且名称不会误导人的参数。
 *
 * 例如舔毛虽然内部有一只抬起的前爪，但“抬脚高度”描述的是步态，不能拿来控制
 * 舔毛姿势；“动作衔接”目前也只真正表达走路时的步态流畅度，所以只留给两种行走。
 */
const MOTION_TUNING_KEYS_BY_ACTION = {
  idle: ['tempo', 'bodyBob', 'tailBalance'],
  walk: ['tempo', 'strideLength', 'footLift', 'bodyBob', 'headBob', 'gaitFlow', 'tailBalance'],
  sit: ['tempo', 'bodyBob', 'tailBalance'],
  lie: ['tempo', 'bodyBob', 'tailBalance'],
  sleep: ['tempo', 'bodyBob'],
  groom: ['tempo', 'headBob', 'tailBalance'],
  eat: ['tempo', 'headBob', 'tailBalance'],
  yawn: ['tempo', 'headBob', 'tailBalance'],
  stretch: ['tempo', 'bodyBob', 'headBob', 'tailBalance'],
  pounce: ['tempo', 'bodyBob', 'headBob', 'tailBalance'],
  held: ['tempo', 'headBob', 'tailBalance'],
  land: ['tempo', 'headBob', 'tailBalance'],
  leapUp: ['tempo', 'bodyBob', 'headBob', 'tailBalance'],
  leapDown: ['tempo', 'bodyBob', 'headBob', 'tailBalance'],
  edge: ['tempo', 'strideLength', 'footLift', 'bodyBob', 'headBob', 'gaitFlow', 'tailBalance'],
} as const satisfies Record<ActionKey, readonly CatMotionTuningKey[]>;

export function motionTuningControlsFor(action: ActionKey): readonly MotionTuningControl[] {
  return MOTION_TUNING_KEYS_BY_ACTION[action].map((key) => CONTROL_BY_KEY[key]);
}

export const DEFAULT_MOTION_TUNING: Readonly<CatMotionTuning> = Object.freeze({
  tempo: 0,
  strideLength: 0,
  footLift: 0,
  bodyBob: 0,
  headBob: 0,
  gaitFlow: 0,
  tailBalance: 0,
});

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export function normalizeMotionTuning(input?: Partial<CatMotionTuning> | null): CatMotionTuning {
  const result = { ...DEFAULT_MOTION_TUNING };
  if (!input) return result;
  for (const { key } of MOTION_TUNING_CONTROLS) {
    const value = input[key];
    if (typeof value === 'number' && Number.isFinite(value)) result[key] = clamp(value, -1, 1);
  }
  return result;
}

export function tuneMotionTime(
  seconds: number,
  raw?: Partial<CatMotionTuning> | null,
  action?: ActionKey,
  cat?: Cat,
): number {
  const tuning = normalizeMotionTuning(raw);
  let minScale = 0.55;
  let maxScale = 1.45;
  if ((action === 'walk' || action === 'edge') && cat) {
    // 一个步态周期走过的地面距离不能接近整段身长，否则读成跨步/滑步；
    // 短腿也不能沿用长腿猫的最高步频，否则四肢会像活塞。
    const baseHz = 2.2 + cat.personality.active * 0.8;
    const travel = action === 'edge' ? 13 : 22 * (0.85 + cat.personality.active * 0.31);
    const bodyLength = Math.max(12, cat.bodyRW * 2);
    minScale = clamp(travel / (baseHz * bodyLength * 0.72), 0.62, 0.9);
    maxScale = clamp(0.9 + cat.legLen * 0.07, 1.08, 1.45);
  }
  return seconds * clamp(1 + tuning.tempo * 0.45, minScale, maxScale);
}

function scaledStride(
  values: readonly number[] | undefined,
  factor: number,
  cat?: Cat,
): readonly number[] | undefined {
  if (!values || !cat) return values?.map((value) => value * factor);
  const originalMax = Math.max(...values.map((value) => Math.abs(value)));
  // 默认动作逐值不变，只限制调参额外增加的步幅。上限同时受身长与腿长约束。
  const anatomyMax = Math.max(originalMax, Math.min(cat.bodyRW * 0.24, cat.legLen * 0.62));
  return values.map((value) => clamp(value * factor, -anatomyMax, anatomyMax));
}

const scaled = (values: readonly number[] | undefined, factor: number) =>
  values?.map((value) => value * factor);

export function tuneMotionPose(
  action: ActionKey,
  pose: Pose,
  raw?: Partial<CatMotionTuning> | null,
  cat?: Cat,
): Pose {
  const t = normalizeMotionTuning(raw);
  const flow = Math.max(0, t.gaitFlow);
  const rigid = Math.max(0, -t.gaitFlow);
  const bodyFactor = clamp(1 + t.bodyBob * 0.9, 0.05, 1.9) * (1 - flow * 0.38 + rigid * 0.25);
  const headFactor = clamp(1 + t.headBob * 0.85, 0.1, 1.85) * (1 - flow * 0.2 + rigid * 0.15);
  const strideFactor =
    action === 'walk' || action === 'edge' ? clamp(1 + t.strideLength * 0.48, 0.45, 1.6) : 1;
  const liftFactor = clamp(1 + t.footLift * 0.55, 0.35, 1.7) * (1 - flow * 0.15 + rigid * 0.18);
  const tailFactor = clamp(1 + t.tailBalance * 0.65, 0.25, 1.8);
  return {
    ...pose,
    breath: pose.breath === undefined ? undefined : pose.breath * bodyFactor,
    dy: pose.dy === undefined ? undefined : pose.dy * bodyFactor,
    headDX: pose.headDX === undefined ? undefined : pose.headDX * headFactor,
    headDY: pose.headDY === undefined ? undefined : pose.headDY * headFactor,
    legOx: scaledStride(pose.legOx, strideFactor, cat),
    legLift: scaled(pose.legLift, liftFactor),
    pawLift: pose.pawLift === undefined ? undefined : pose.pawLift * liftFactor,
    tailWave: pose.tailWave === undefined ? undefined : pose.tailWave * tailFactor,
    tailPhase:
      pose.tailPhase === undefined
        ? undefined
        : pose.tailPhase * clamp(1 + t.tailBalance * 0.2, 0.65, 1.35),
    tailAng:
      pose.tailAng === undefined
        ? undefined
        : pose.tailAng + t.tailBalance * (action === 'walk' || action === 'edge' ? 0.32 : 0.16),
    tailCurl: pose.tailCurl === undefined ? undefined : pose.tailCurl - t.tailBalance * 0.12,
  };
}
