import { describe, expect, it } from 'vitest';
import { CHROME_H, GRIP_H, withChrome } from '../../src/chrome/constants.js';
import { resizedTo, sameSize } from '../../src/chrome/resize.js';
import { ADOPT_H, ADOPT_W } from '../../src/adopt/constants.js';
import { DIARY_H, DIARY_MIN_H, DIARY_MIN_W, DIARY_W } from '../../src/diary/constants.js';
import { FAREWELL_H, FAREWELL_W } from '../../src/farewell/constants.js';

/**
 * 自绘标题栏（ADR 0013）。
 *
 * 这一层能测的就两件事：**窗口高度有没有把标题条算进去**，
 * 以及**拖把手时的尺寸算得对不对**。搭 DOM 与接事件那部分没有测试 -
 * 测试环境是 node（vitest.config.ts），而那部分除了调 DOM 之外不做任何判断。
 */

describe('窗口高度要把标题条算进去', () => {
  it('无边框窗口的客户区就是整扇窗，不加这一段内容会被压掉', () => {
    expect(withChrome(468)).toBe(468 + CHROME_H);
  });

  it('三扇弹出窗口给 Rust 的高度都比内容高一条标题条', () => {
    // 这条守的是「加法只做了一半」：三处调用里漏掉任何一处，
    // 那一页的最后一行会被 overflow: hidden 裁掉，而这只在真机上看得见。
    for (const [name, contentH] of [
      ['领养', ADOPT_H],
      ['日记', DIARY_H],
      ['告别', FAREWELL_H],
    ] as const) {
      expect(withChrome(contentH) - contentH, `${name}窗口`).toBe(CHROME_H);
    }
  });

  it('宽度不变 - 标题条只吃高度', () => {
    for (const w of [ADOPT_W, DIARY_W, FAREWELL_W]) {
      expect(w).toBeGreaterThan(0);
    }
    // 日记的宽度下限不能反过来比默认宽度还大
    expect(DIARY_MIN_W).toBeLessThanOrEqual(DIARY_W);
  });

  it('日记的高度下限也把标题条算进去了', () => {
    // 下限是「内容区还剩多少」的下限。没算标题条的话，拖到最小时内容区只剩 292，
    // 而抬头 + 页脚就要 90 - 日记正文会一条都看不见。
    expect(DIARY_MIN_H).toBeGreaterThan(CHROME_H);
    expect(DIARY_MIN_H).toBeLessThanOrEqual(withChrome(DIARY_H));
  });

  it('把手比一次点击的目标下限还大 - 它是唯一的缩放入口', () => {
    expect(GRIP_H).toBeGreaterThanOrEqual(12);
  });
});

const LIMITS = { minW: 360, minH: 348, maxW: 1440, maxH: 900 } as const;
const START = { w: 420, h: 588 } as const;

describe('拖右下角把手', () => {
  it('往右下拖就变大，位移直接加到起始尺寸上', () => {
    expect(resizedTo(START, 80, 40, LIMITS)).toEqual({ w: 500, h: 628 });
  });

  it('往左上拖就变小', () => {
    expect(resizedTo(START, -40, -100, LIMITS)).toEqual({ w: 380, h: 488 });
  });

  it('缩不到下限以下 - 再窄下去每行会断成两三截', () => {
    expect(resizedTo(START, -9999, -9999, LIMITS)).toEqual({ w: 360, h: 348 });
  });

  it('涨不过屏幕可用区 - 手动缩放没有系统那道拦阻', () => {
    // 系统缩放会自己停在屏幕边上，自己算的这条不会：不钳的话一路甩出去，
    // 窗口比屏幕还大，右下角连把手都摸不到了。
    expect(resizedTo(START, 9999, 9999, LIMITS)).toEqual({ w: 1440, h: 900 });
  });

  it('尺寸取整 - 半个像素会让像素风的边框变成两像素的灰边', () => {
    const got = resizedTo(START, 10.4, 10.6, LIMITS);
    expect(got).toEqual({ w: 430, h: 599 });
    expect(Number.isInteger(got.w) && Number.isInteger(got.h)).toBe(true);
  });

  it('屏幕比下限还小时仍然返回下限，不返回一个比 min 更小的尺寸', () => {
    // 病态输入：某些远程桌面的可用区会小于我们的下限。
    // 先钳上限再钳下限，顺序颠倒的话这里会返回 200×200。
    const tiny = { minW: 360, minH: 348, maxW: 200, maxH: 200 } as const;
    expect(resizedTo(START, 0, 0, tiny)).toEqual({ w: 360, h: 348 });
  });

  it('同尺寸认得出来 - 每个 pointermove 都要靠它省掉一次跨进程调用', () => {
    expect(sameSize({ w: 420, h: 588 }, { w: 420, h: 588 })).toBe(true);
    expect(sameSize({ w: 420, h: 588 }, { w: 421, h: 588 })).toBe(false);
  });
});
