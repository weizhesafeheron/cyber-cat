import type { PropKind } from '../props/types.js';
import type { Cat } from '../render/index.js';
import {
  HUNGRY_VISIBLE_THRESHOLD,
  MOOD_HAPPY_THRESHOLD,
  SICK_TIME_SCALE,
  WEAK_TIME_SCALE,
} from './constants.js';
import { eatThreshold } from './tick.js';
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

/**
 * 猫此刻想待在哪个挂件跟前。
 *
 * 这是「喂食与睡觉是空间行为」的世界层一侧：**只给名字，不给坐标。**
 *
 * 四条，按优先级：
 *
 * 1. **生病与死亡没有诉求。** 生病的表现就是「蔫、趴着不动」（CONTEXT.md），
 *    让它爬起来走回窝去躺会把这个读数抹掉。
 * 2. **睡着 → 猫窝。** 猫窝存在的全部理由就是「困了会走回猫窝睡，而不是随地趴下」。
 *    睡一觉是几小时的事，走过去那十几秒完全放得进去。
 * 3. **正在吃 → 食盆。** 世界层在整步上判定「吃了」，运动层要保证那一刻猫在盆前。
 * 4. **碗里有粮且已经够饿 → 食盆。** 这一条是给运动层的**提前量**，也是三种性格
 *    分化在画面上的落点：
 *    - 贪吃的猫阈值高（最高 80），刚倒下粮它就已经「够饿」，于是立刻起身冲过来；
 *    - 不贪吃的猫阈值低（最低 45），粮在盆里放着但它压根不动，等真饿了才去；
 *    - 睡着的猫走不到第 4 条（第 2 条先命中），可能睡完这觉再说。
 *
 *    没有这一条也能跑，但猫会在世界层宣布「吃了」的那一刻才起步 - 从桌面另一头
 *    走过来要几十秒，而一段进食只有二三十秒，多半走到一半就该干别的了。
 *    有了它，猫在世界层动嘴之前就已经站在盆前。
 *
 * 5. **饿到有可视表现 → 食盆。** 「饿了在食盆边徘徊」（chooseActivity 里的分支）
 *    从此是字面意思：徘徊的地点就是食盆旁边。此时碗里通常是空的，
 *    所以第 4 条不成立，需要单独一条。
 */
function anchorOf(world: World, cat: Cat): PropKind | null {
  if (world.dead || world.sick) return null;
  if (world.sleeping) return 'bed';
  if (world.activity === 'eat') return 'bowl';
  if (world.bowl > 0 && world.needs.hunger < eatThreshold(cat)) return 'bowl';
  if (world.needs.hunger < HUNGRY_VISIBLE_THRESHOLD) return 'bowl';
  return null;
}

/**
 * `cat` 是必填的：开吃阈值按贪吃度算，而性格由「品种 + Seed」重建，
 * 不存在世界状态里（见 CatIdentity 的注释）。调用方本来就要有这只猫。
 */
export function renderIntentOf(world: World, cat: Cat): RenderIntent {
  const status = statusOf(world);

  if (status === 'dead') {
    return {
      action: null,
      status,
      timeScale: 1,
      pose: {},
      micro: { blink: false, ear: false },
      anchor: null,
    };
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
      anchor: null,
    };
  }

  if (world.sleeping) {
    return {
      action: 'sleep',
      status,
      timeScale: 1,
      pose: {},
      micro: { blink: false, ear: false, tilt: false },
      anchor: anchorOf(world, cat),
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
    anchor: anchorOf(world, cat),
  };
}
