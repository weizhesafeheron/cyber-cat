import { describe, expect, it } from 'vitest';
import { deviceScaleFor } from '../../src/app/display.js';
import { STAGE_H, TARGET_SCALE } from '../../src/app/stage.js';
import {
  BUBBLE_BASE_SPRITE_Y,
  BUBBLE_BOB_PERIOD_S,
  BUBBLE_BOB_SPRITE,
  BUBBLE_HEADROOM_SPRITE,
  BUBBLE_LIFE_MS,
  BUBBLE_SPRITE,
  bubbleAlive,
  bubbleBob,
  bubbleSpriteRect,
  bubbleStageRect,
  hitsRect,
  shouldOfferDiary,
} from '../../src/diary/index.js';
import {
  ACTIONS,
  ACTION_KEYS,
  CatRenderer,
  H,
  W,
  makeCat,
  makeMicro,
  stepMicro,
} from '../../src/render/index.js';
import type { BreedKey } from '../../src/render/types.js';
import { DIARY_BUBBLE_AWAY_HOURS, MS_PER_HOUR } from '../../src/world/index.js';
import type { WorldEvent } from '../../src/world/index.js';

/**
 * 回归气泡。
 *
 * 三件只能靠测试守住的事（这三件在真机上都只会表现为「气泡有点不对」，
 * 很难从现象反推）：
 * - **阈值判定不读时钟。** 离开多久由补算给出，所以能直接喂数进去测。
 * - **气泡不压到猫。** 用真实渲染结果逐帧对照，而不是目测。
 * - **舞台放得下气泡。** 各档真实 dpr 都要成立，否则气泡会被窗口上边缘裁掉。
 */

const SINCE = Date.UTC(2026, 6, 29, 0, 0, 0);
const AWAY = DIARY_BUBBLE_AWAY_HOURS * MS_PER_HOUR;

function diaryAt(offsets: readonly number[]): WorldEvent[] {
  return offsets.map((ms) => ({ kind: 'napped', at: SINCE + ms, important: false }));
}

describe('该不该冒气泡', () => {
  it('离开超过阈值、期间有日记、猫还在：冒', () => {
    expect(
      shouldOfferDiary({
        awayMs: AWAY,
        since: SINCE,
        diary: diaryAt([MS_PER_HOUR]),
        dead: false,
      }),
    ).toBe(true);
  });

  it('刚好差一毫秒不到阈值：不冒', () => {
    expect(
      shouldOfferDiary({
        awayMs: AWAY - 1,
        since: SINCE,
        diary: diaryAt([MS_PER_HOUR]),
        dead: false,
      }),
    ).toBe(false);
  });

  it('随手关掉再打开（几分钟）不冒气泡', () => {
    expect(
      shouldOfferDiary({
        awayMs: 5 * 60_000,
        since: SINCE,
        diary: diaryAt([60_000]),
        dead: false,
      }),
    ).toBe(false);
  });

  it('离开够久但期间一条日记都没有：不冒', () => {
    // 补算了六小时却什么都没记（猫整夜在睡且抽签没中）。这时点开只会看到旧内容，
    // 比不提示更糟。
    expect(
      shouldOfferDiary({
        awayMs: 6 * MS_PER_HOUR,
        since: SINCE,
        // 全是离开之前的旧条目
        diary: diaryAt([-MS_PER_HOUR, -2 * MS_PER_HOUR]),
        dead: false,
      }),
    ).toBe(false);
  });

  it('猫已经离开：不冒，交给告别页', () => {
    expect(
      shouldOfferDiary({
        awayMs: 48 * MS_PER_HOUR,
        since: SINCE,
        diary: diaryAt([MS_PER_HOUR]),
        dead: true,
      }),
    ).toBe(false);
  });

  it('判定完全由入参决定，不读时钟', () => {
    // 同一份输入连续问两次必须给同一个答案。这条看着废话，但它守的是
    // 「不要在这一层调 Date.now()」这个约定 - 一旦有人加进去，这里就会开始飘。
    const input = {
      awayMs: AWAY,
      since: SINCE,
      diary: diaryAt([MS_PER_HOUR]),
      dead: false,
    };
    expect(shouldOfferDiary(input)).toBe(shouldOfferDiary(input));
  });
});

describe('气泡不理它就自己收掉', () => {
  it('冒出来之后一段时间内一直在，超过寿命就没了', () => {
    expect(bubbleAlive(1000, 1000)).toBe(true);
    expect(bubbleAlive(1000, 1000 + BUBBLE_LIFE_MS - 1)).toBe(true);
    expect(bubbleAlive(1000, 1000 + BUBBLE_LIFE_MS)).toBe(false);
  });

  it('没冒过（或已经点掉）就一直是没有', () => {
    expect(bubbleAlive(null, 0)).toBe(false);
    expect(bubbleAlive(null, 1e9)).toBe(false);
  });

  it('寿命是分钟量级，不是秒也不是永远', () => {
    // 太短来不及注意到，永远不消失则等于在猫头顶留一块永久偷点击的区域。
    expect(BUBBLE_LIFE_MS).toBeGreaterThan(30_000);
    expect(BUBBLE_LIFE_MS).toBeLessThan(15 * 60_000);
  });
});

describe('浮动', () => {
  it('偏移只取整数，像素不会被重采样', () => {
    for (let t = 0; t < 10; t += 0.037) {
      const bob = bubbleBob(t);
      expect(Number.isInteger(bob)).toBe(true);
      expect(bob).toBeGreaterThanOrEqual(0);
      expect(bob).toBeLessThanOrEqual(BUBBLE_BOB_SPRITE);
    }
  });

  it('一个周期里两个位置各占一半', () => {
    expect(bubbleBob(0)).toBe(0);
    expect(bubbleBob(BUBBLE_BOB_PERIOD_S * 0.75)).toBe(BUBBLE_BOB_SPRITE);
    expect(bubbleBob(BUBBLE_BOB_PERIOD_S)).toBe(0);
  });

  it('时间不是有限数时不抖，也不产生 NaN 矩形', () => {
    expect(bubbleBob(Number.NaN)).toBe(0);
    const r = bubbleSpriteRect(bubbleBob(Number.POSITIVE_INFINITY));
    for (const v of [r.x0, r.y0, r.x1, r.y1]) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('气泡在猫头顶，且不压到猫', () => {
  it('矩形整体落在精灵缓冲之上，横向居中', () => {
    const r = bubbleSpriteRect(0);
    expect(r.y1).toBeLessThanOrEqual(BUBBLE_BASE_SPRITE_Y);
    expect(r.y0).toBeLessThan(0); // 伸到缓冲之上
    // 横向居中：两侧留白相等（允许 1 像素的取整差）
    expect(Math.abs(r.x0 - (W - r.x1))).toBeLessThanOrEqual(1);
  });

  it('任何品种、任何动作、任何一帧，猫本体都不会伸进气泡的行里', () => {
    // 这是 BUBBLE_BASE_SPRITE_Y = 5 的依据。目测「气泡在头顶上方」在趴睡与扑跳
    // 之间差了十几行，只有把全部姿态跑一遍才知道最靠上的那一帧在哪。
    const renderer = new CatRenderer();
    const breeds: BreedKey[] = ['orange', 'black', 'cow', 'ragdoll', 'devon', 'amshort', 'aby'];
    const bottom = bubbleSpriteRect(0).y1; // 气泡最低的那一行（不含）
    let topmost = H;
    for (const breed of breeds) {
      for (const seed of [1, 7, 42, 1234, 20260728]) {
        const cat = makeCat(breed, seed);
        const micro = makeMicro(seed);
        for (const key of ACTION_KEYS) {
          const def = ACTIONS[key];
          const period = def.period ?? 2;
          for (let i = 0; i < 16; i++) {
            const mi = stepMicro(micro, 0.05, { blink: true, ear: true, tilt: true });
            const res = renderer.render(cat, def.make((period * i) / 16, cat, mi));
            for (let y = 0; y < topmost; y++) {
              for (let x = 0; x < W; x++) {
                if (res.pixels[(y * W + x) * 4 + 3] !== 0) {
                  topmost = y;
                  break;
                }
              }
            }
          }
        }
      }
    }
    // 猫最靠上的像素必须在气泡下沿之下（或同行之下），中间还留了空隙。
    expect(topmost).toBeGreaterThanOrEqual(bottom);
  });

  it('命中矩形的边界是半开区间，不会与相邻像素重叠', () => {
    const r = bubbleSpriteRect(0);
    expect(hitsRect(r, r.x0, r.y0)).toBe(true);
    expect(hitsRect(r, r.x1 - 0.001, r.y1 - 0.001)).toBe(true);
    expect(hitsRect(r, r.x0 - 0.001, r.y0)).toBe(false);
    expect(hitsRect(r, r.x1, r.y0)).toBe(false);
    expect(hitsRect(r, r.x0, r.y1)).toBe(false);
    // 猫身上（缓冲中部）一定不算点到气泡
    expect(hitsRect(r, W / 2, H / 2)).toBe(false);
  });
});

describe('气泡跟着猫走', () => {
  const SCALE = 3;

  it('猫在舞台里挪动时，气泡的舞台坐标跟着挪同样的距离', () => {
    const rect = bubbleSpriteRect(0);
    const a = bubbleStageRect(rect, 100, SCALE, STAGE_H);
    const b = bubbleStageRect(rect, 260, SCALE, STAGE_H);
    expect(b.x - a.x).toBe(160);
    expect(b.y).toBe(a.y);
    expect(b.w).toBe(a.w);
    expect(b.h).toBe(a.h);
  });

  it('气泡在猫的画布之上，不与猫的画布重叠', () => {
    const rect = bubbleSpriteRect(0);
    const box = bubbleStageRect(rect, 0, SCALE, STAGE_H);
    // 猫的画布上沿在舞台里的位置
    const catTop = STAGE_H - H * SCALE;
    expect(box.y + box.h).toBeLessThanOrEqual(catTop + BUBBLE_BASE_SPRITE_Y * SCALE);
    expect(box.y).toBeLessThan(catTop);
  });

  it('浮动只改纵向，不改横向与尺寸', () => {
    const down = bubbleStageRect(bubbleSpriteRect(0), 50, SCALE, STAGE_H);
    const up = bubbleStageRect(bubbleSpriteRect(BUBBLE_BOB_SPRITE), 50, SCALE, STAGE_H);
    expect(up.x).toBe(down.x);
    expect(up.w).toBe(down.w);
    expect(up.h).toBe(down.h);
    expect(up.y).toBeLessThan(down.y);
  });
});

describe('舞台放得下气泡', () => {
  /** 真实世界里会遇到的 devicePixelRatio，与 test/app/display.test.ts 同一组。 */
  const REAL_DPRS = [1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;

  it('各档真实 dpr 下，气泡都完整落在舞台里', () => {
    for (const dpr of REAL_DPRS) {
      const scale = deviceScaleFor(TARGET_SCALE, dpr, { w: 9999, h: STAGE_H });
      const spriteScale = scale / dpr;
      const box = bubbleStageRect(bubbleSpriteRect(BUBBLE_BOB_SPRITE), 0, spriteScale, STAGE_H);
      expect(box.y, `dpr=${dpr} 气泡上沿越出舞台 ${box.y}`).toBeGreaterThanOrEqual(0);
    }
  });

  it('净空常量与舞台高度的关系写死在这里，改了会被发现', () => {
    // BUBBLE_HEADROOM_SPRITE 是「气泡在精灵缓冲之上伸出多少行」。
    // 舞台高度必须容得下「猫的画布 + 这段净空」，取最坏的那档缩放算。
    const worst = Math.max(
      ...REAL_DPRS.map((dpr) => deviceScaleFor(TARGET_SCALE, dpr, { w: 9999, h: STAGE_H }) / dpr),
    );
    expect(STAGE_H).toBeGreaterThanOrEqual((H + BUBBLE_HEADROOM_SPRITE) * worst);
  });
});

describe('气泡贴图', () => {
  it('尺寸与命中矩形一致 - 画的和判的是同一块地方', () => {
    const r = bubbleSpriteRect(0);
    expect(BUBBLE_SPRITE.width).toBe(r.x1 - r.x0);
    expect(BUBBLE_SPRITE.height).toBe(r.y1 - r.y0);
  });

  it('有描边、有内壁、有三个亮点，且四角是透明的', () => {
    const { width, height, pixels } = BUBBLE_SPRITE;
    const alphaAt = (x: number, y: number): number => pixels[(y * width + x) * 4 + 3]!;
    // 圆角：左上角那一格必须是空的
    expect(alphaAt(0, 0)).toBe(0);
    expect(alphaAt(width - 1, 0)).toBe(0);
    // 中间是实的
    expect(alphaAt(width >> 1, 6)).toBe(255);
    // 三个亮点用的是同一个颜色，数一下有多少个这种像素：3 个 3×3 = 27
    const dot = [
      pixels[(7 * width + 5) * 4]!,
      pixels[(7 * width + 5) * 4 + 1]!,
      pixels[(7 * width + 5) * 4 + 2]!,
    ];
    let count = 0;
    for (let i = 0; i < width * height; i++) {
      if (
        pixels[i * 4] === dot[0] &&
        pixels[i * 4 + 1] === dot[1] &&
        pixels[i * 4 + 2] === dot[2] &&
        pixels[i * 4 + 3] === 255
      ) {
        count++;
      }
    }
    expect(count).toBe(27);
  });

  it('尾巴从下沿伸出并收成一个尖，指着猫的头顶', () => {
    const { width, height, pixels } = BUBBLE_SPRITE;
    const rowWidth = (y: number): number => {
      let n = 0;
      for (let x = 0; x < width; x++) if (pixels[(y * width + x) * 4 + 3] !== 0) n++;
      return n;
    };
    // 最后一行只有一个像素，倒数第三行比它宽
    expect(rowWidth(height - 1)).toBe(1);
    expect(rowWidth(height - 3)).toBeGreaterThan(rowWidth(height - 1));
  });
});
