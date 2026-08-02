import type { ActionKey } from '../render/index.js';
import { materializeCat } from '../render/index.js';
import { BEATS_PER_TICK, BEAT_MS } from './constants.js';
import { draftOf } from './create.js';
import { renderIntentOf } from './intent.js';
import { advanceBeat, advanceMeal, advanceTick, applyAction } from './tick.js';
import type { StepResult, World, WorldEvent, WorldInputs } from './types.js';

/**
 * 世界层唯一的对外入口。
 *
 * ```
 * step(world, elapsedMs, inputs) -> { world, events, renderIntent }
 * ```
 *
 * **纯函数。** 不做 I/O、不调平台 API、不用 Date.now()、不用 Math.random()。
 * 时钟以 elapsedMs 的形式注入，随机源摊在 world.rngState 里（world/rng.ts）。
 * 传进来的 world 不会被修改。
 *
 * **离线推演与实时运行是同一条代码路径。** 应用常驻时每帧传十几毫秒，
 * 关机重启时一次性传几小时；两者的差别只是内部循环转几圈。
 * 不存在「离线版模拟器」（ADR 0001）。
 *
 * 时间的处理是等价性的关键：只有攒满一个行为节拍（15 秒）才推进一拍，
 * 不满一拍的余额留在 world.carryMs 里。因此
 * `step(w, 24h)` 与连续 48 次 `step(w, 30min)` 产出完全相同的 world 与事件序列，
 * 任意不规则的切分也一样。这条由 test/world/offline-equivalence.test.ts 守着。
 *
 * 时间有两种粒度，而只有一个累加器：节拍（15 秒）驱动「猫在做什么」，
 * 每数够 BEATS_PER_TICK 拍才推进一个模拟步（30 分钟）来演化需求。
 * **模拟步不是独立计时的**，它是节拍的计数结果 - 两个各自累加的余额早晚会
 * 相互漂移，而漂移一旦发生，定档过的「最后一次喂食 → 死亡 88 小时」就不再准。
 *
 * elapsedMs 由调用方保证合理。世界层不对它设上限 - 系统时钟异常跳变属于平台层
 * 的问题，在这里悄悄截断只会把一个可见的故障变成一个查不出来的状态错乱。
 */
export function step(world: World, elapsedMs: number, inputs: WorldInputs = {}): StepResult {
  const cat = materializeCat(world.identity);
  const draft = draftOf(world);
  const events: WorldEvent[] = [];

  // 用户动作发生在「现在」，所以先于时间推进结算。
  for (const action of inputs.actions ?? []) applyAction(draft, action, events);

  draft.carryMs += Math.max(0, elapsedMs);
  while (draft.carryMs >= BEAT_MS) {
    draft.carryMs -= BEAT_MS;
    draft.clock += BEAT_MS;
    // 死后世界不再演化，但时钟继续走 - 告别页要知道现在几点。
    if (draft.dead) continue;

    draft.beatsInTick += 1;
    let urge: ActionKey | null = null;
    if (draft.beatsInTick >= BEATS_PER_TICK) {
      draft.beatsInTick = 0;
      urge = advanceTick(draft, cat, events).urge;
    }
    // 模拟步之后先判断进食、再走节拍：长期需求仍按半小时变化，但看到粮后是否开吃
    // 按 5 秒行为节拍响应。刚吃完优先于刚醒来的伸懒腰，与原有顺序一致。
    if (advanceMeal(draft, cat, events)) urge = 'eat';
    advanceBeat(draft, cat, urge);
  }

  return { world: draft, events, renderIntent: renderIntentOf(draft, cat) };
}
