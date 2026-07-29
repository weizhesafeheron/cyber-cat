import {
  HUNGRY_VISIBLE_THRESHOLD,
  MOOD_HAPPY_THRESHOLD,
  SICK_TIME_SCALE,
  WEAK_TIME_SCALE,
} from './constants.js';
import type { CatStatus, RenderIntent, World } from './types.js';

/**
 * 世界状态 → 「现在应该画什么」。
 *
 * **是纯投影，没有自己的状态。** 因此离线补算完成后拿到的 intent 与一路实时
 * 跑到同一个 world 拿到的 intent 必然相同，不需要额外的同步逻辑。
 */

/** 总体状态。托盘图标与状态气泡只看这一个值。 */
export function statusOf(world: World): CatStatus {
  if (world.dead) return 'dead';
  if (world.sick) return 'sick';
  if (world.needs.hunger <= 0) return 'starving';
  if (world.sleeping) return 'sleeping';
  if (world.needs.hunger < HUNGRY_VISIBLE_THRESHOLD) return 'hungry';
  return 'ok';
}

export function renderIntentOf(world: World): RenderIntent {
  const status = statusOf(world);

  if (status === 'dead') {
    return { action: null, status, timeScale: 1, pose: {}, micro: { blink: false, ear: false } };
  }

  if (status === 'sick') {
    // 「蔫」的读数来自三件事一起：趴着、动作放慢、眼睛半闭、尾巴不摆。
    // 少任何一件，在 72x56 这个尺度上都看不出病了。
    return {
      action: 'lie',
      status,
      timeScale: SICK_TIME_SCALE,
      pose: { eyeOpen: 0.25, tailWave: 0 },
      micro: { tilt: false },
    };
  }

  if (world.sleeping) {
    return {
      action: 'sleep',
      status,
      timeScale: 1,
      pose: {},
      micro: { blink: false, ear: false, tilt: false },
    };
  }

  const weak = world.weakHours > 0;
  const pose = world.needs.hunger < HUNGRY_VISIBLE_THRESHOLD
    ? // 饿了：头略垂，尾巴不摆 - 在食盆边徘徊的读数。
      { headDY: 1.5, tailWave: 0.2 }
    : world.needs.mood > MOOD_HAPPY_THRESHOLD
      ? { tailWave: 1.2 }
      : {};

  return {
    action: world.activity,
    status,
    timeScale: weak ? WEAK_TIME_SCALE : 1,
    pose,
    micro: { tilt: true },
  };
}
