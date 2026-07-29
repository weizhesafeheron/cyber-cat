import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HIT_CONFIG,
  ZERO_VELOCITY,
  initialHitState,
  nearRect,
  stepHit,
} from '../../src/app/hit.js';
import type { CursorSample, HitRect, Velocity } from '../../src/app/hit.js';
import { PollingPassthrough } from '../../src/app/passthrough.js';
import type { CursorSource } from '../../src/app/passthrough.js';
import { bubbleSpriteRect, hitsRect } from '../../src/diary/index.js';
import { ACTIONS, CatRenderer, makeCat } from '../../src/render/index.js';
import { centersAtDistance, frameOf, maskCenters } from './masks.js';

/**
 * 回归气泡进命中判定（[ADR 0010](../../docs/adr/0010-return-bubble-in-stage.md)）。
 *
 * **这是「气泡点得动」的唯一自动化保障。** 穿透是整窗一刀切的（ADR 0006）：
 * 只要判定层不认识气泡，光标压上去时窗口仍然是穿透的，点击会落到下层窗口，
 * 而画面上气泡好端端地画着 - 症状是「点它没反应」，在真机之外看不出来。
 */

const renderer = new CatRenderer();
const MI = { eyeOpen: 1, earFlickL: 0, earFlickR: 0, tilt: 0 };
const CFG = DEFAULT_HIT_CONFIG;

const cat = makeCat('orange', 20260728);
const frame = frameOf(renderer.render(cat, ACTIONS.sit.make(0, cat, MI)));
const onCat = maskCenters(frame)[0]!;
const farAway = centersAtDistance(frame, CFG.baseMargin + CFG.exitExtra + 1, Infinity)[0]!;

const rect: HitRect = bubbleSpriteRect(0);
/** 气泡正中。 */
const onBubble = { x: (rect.x0 + rect.x1) / 2, y: (rect.y0 + rect.y1) / 2 };

class FakeCursor implements CursorSource {
  latest: CursorSample | null = null;
  velocity: Velocity = ZERO_VELOCITY;

  at(p: { x: number; y: number } | null, t: number): void {
    this.latest = p ? { x: p.x, y: p.y, t } : null;
  }
}

describe('矩形命中区', () => {
  it('margin 为 0 时与 hitsRect 一致，只有远侧边界那一线更宽松', () => {
    // 两份实现（判定用 nearRect、点击用 hitsRect）必须对齐，否则会出现
    // 「穿透关了但点击被当成没点中」这种最难查的状态。
    //
    // 唯一的差别在 x1 / y1 那条线上：nearRect 量的是「点到矩形的距离」，
    // 贴在远侧边界上距离是 0；hitsRect 是半开区间，那条线不算命中。
    // 这与掩膜那边的情况完全一样（nearMask 在像素右边界上也判 true），
    // 而且方向是安全的 - 穿透已经关着，只是那一线的点击会被丢掉。
    for (let y = rect.y0 - 3; y < rect.y1 + 3; y += 0.5) {
      for (let x = rect.x0 - 3; x < rect.x1 + 3; x += 0.5) {
        const near = nearRect(rect, x, y, 0);
        const hit = hitsRect(rect, x, y);
        if (hit) expect(near, `(${x},${y}) 点中了却判为远离`).toBe(true);
        if (near && !hit) expect(x === rect.x1 || y === rect.y1, `(${x},${y})`).toBe(true);
      }
    }
  });

  it('边距按点到矩形的距离算', () => {
    expect(nearRect(rect, rect.x0 - 2, onBubble.y, 3)).toBe(true);
    expect(nearRect(rect, rect.x0 - 4, onBubble.y, 3)).toBe(false);
    // 斜角方向是欧氏距离，不是切比雪夫
    expect(nearRect(rect, rect.x0 - 3, rect.y0 - 3, 3)).toBe(false);
    expect(nearRect(rect, rect.x0 - 2, rect.y0 - 2, 3)).toBe(true);
  });

  it('坐标不是有限数时判为不命中', () => {
    expect(nearRect(rect, Number.NaN, 0, 3)).toBe(false);
    expect(nearRect(rect, 0, Number.POSITIVE_INFINITY, 3)).toBe(false);
  });
});

describe('气泡那块地方本来不属于猫', () => {
  it('气泡的位置在猫的掩膜之外 - 所以它只能靠矩形变成可点', () => {
    // 这条同时守着「气泡不压到猫」：如果哪天气泡挪到猫身上，这里会先炸。
    const state = stepHit(initialHitState(), frame, {
      cursor: onBubble,
      velocity: ZERO_VELOCITY,
      now: 0,
    });
    expect(state.passThrough).toBe(true);
  });
});

describe('气泡在时，光标压上去要关掉穿透', () => {
  it('传了气泡矩形就关穿透', () => {
    const state = stepHit(initialHitState(), frame, {
      cursor: onBubble,
      velocity: ZERO_VELOCITY,
      now: 0,
      rects: [rect],
    });
    expect(state.passThrough).toBe(false);
  });

  it('猫身上照旧关穿透，多一块矩形不影响原有判定', () => {
    for (const rects of [[], [rect]]) {
      const state = stepHit(initialHitState(), frame, {
        cursor: onCat,
        velocity: ZERO_VELOCITY,
        now: 0,
        rects,
      });
      expect(state.passThrough).toBe(false);
    }
  });

  it('离猫和气泡都远的地方仍然穿透', () => {
    const state = stepHit(initialHitState(), frame, {
      cursor: farAway,
      velocity: ZERO_VELOCITY,
      now: 0,
      rects: [rect],
    });
    expect(state.passThrough).toBe(true);
  });
});

describe('气泡收掉之后那块地方要还给桌面', () => {
  it('矩形不再传进来时，同一个位置回到穿透', () => {
    const cursor = new FakeCursor();
    const applied: boolean[] = [];
    const ctl = new PollingPassthrough(cursor, (on) => applied.push(on));

    // 气泡在：压上去关穿透
    cursor.at(onBubble, 0);
    ctl.update(frame, 0, [rect]);
    expect(ctl.passThrough).toBe(false);
    expect(applied).toEqual([false]);

    // 点开日记之后气泡消失，光标没动。等过退出延迟就该还给桌面 -
    // 留着一块看不见的命中区会在猫头顶偷走用户的点击。
    for (let now = 16; now <= 16 + CFG.leaveDelayMs; now += 16) {
      cursor.at(onBubble, now);
      ctl.update(frame, now, []);
    }
    expect(ctl.passThrough).toBe(true);
    expect(applied).toEqual([false, true]);
  });

  it('不传第三个参数时行为与从前完全一致', () => {
    // 挂件窗口（prop-main.ts）就是这么调的，不该因为多了个参数而改行为。
    const cursor = new FakeCursor();
    const ctl = new PollingPassthrough(cursor, () => undefined);
    cursor.at(onBubble, 0);
    ctl.update(frame, 0);
    expect(ctl.passThrough).toBe(true);
    cursor.at(onCat, 16);
    ctl.update(frame, 16);
    expect(ctl.passThrough).toBe(false);
  });
});

describe('光标高速掠过时的提前量对气泡同样有效', () => {
  it('沿运动方向前探能提前命中气泡', () => {
    // ADR 0006 要求提前于光标抵达切换。气泡是个小目标，没有提前量的话
    // macOS 上那 5ms 的传播延迟足够让第一次点击落空。
    // 从上方往下扑过来。不用从下方靠近 - 那条路要先穿过猫，判定早就关了穿透，
    // 测不到气泡自己的提前量。
    const above = { x: onBubble.x, y: rect.y0 - 20 };
    const downward: Velocity = { vx: 0, vy: 600, speed: 600 };
    const still = stepHit(initialHitState(), frame, {
      cursor: above,
      velocity: ZERO_VELOCITY,
      now: 0,
      rects: [rect],
    });
    const moving = stepHit(initialHitState(), frame, {
      cursor: above,
      velocity: downward,
      now: 0,
      rects: [rect],
    });
    // 静止时这个位置离气泡还远（且不在猫身上），动起来就提前关了穿透。
    expect(still.passThrough).toBe(true);
    expect(moving.passThrough).toBe(false);
  });
});
