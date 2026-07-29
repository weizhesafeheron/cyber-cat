import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PROP_GAP_PX,
  dragResult,
  groundedPropsState,
  settleDrag,
  PROP_KINDS,
  PROP_REACH_SPRITE,
  PROP_SCALE,
  PROP_SPRITE,
  anchorScreenX,
  approachX,
  clampPlacement,
  clampPropsState,
  defaultPropsState,
  groundedY,
  propCenterX,
  propCssSize,
  propDeviceScale,
  propWindowLabel,
  propWindowSize,
  samePropsState,
  withPlacement,
} from '../../src/props/index.js';
import type { PropKind, PropPlacement, PropsState, ScreenRect } from '../../src/props/index.js';
import { TARGET_SCALE } from '../../src/app/stage.js';
import { groundScreenY } from '../../src/app/motion.js';
import { GROUND, H, W } from '../../src/render/index.js';

/**
 * 挂件的摆放几何。
 *
 * 全是纯算术，所以「猫该站到食盆哪一侧、挂件踩不踩在地上」这类只能在真机上
 * 看出来的东西，在这里都能直接断言。
 */

/** 一个 1920x1080 的桌面。与 test/app/motion.test.ts 同一块假屏幕。 */
const DESKTOP: ScreenRect = { x: 0, y: 0, w: 1920, h: 1080 };
const SPRITE_SCALE = 3;
/** 猫脚下的地面线。挂件的下沿要落在这一行上。 */
const GROUND_Y = groundScreenY({
  w: 648,
  h: 200,
  spriteScale: SPRITE_SCALE,
  work: DESKTOP,
});

describe('与配置和猫的一致性', () => {
  it('挂件与猫用同一个放大倍数 - 否则两边的像素格不一样大', () => {
    expect(PROP_SCALE).toBe(TARGET_SCALE);
  });

  it('tauri.conf.json 里两个挂件窗口的标签与尺寸就是常量算出来的那些', () => {
    // JSON 配置没法 import 常量，只能反过来由测试守着。
    // 标签不一致的症状是「挂件永远不出现」且没有任何报错；
    // 尺寸不一致的症状是猫走到食盆旁边一点点的地方吃饭。
    const conf = JSON.parse(
      readFileSync(new URL('../../src-tauri/tauri.conf.json', import.meta.url), 'utf8'),
    ) as { app: { windows: { label: string; width: number; height: number }[] } };
    for (const kind of PROP_KINDS) {
      const label = propWindowLabel(kind);
      const win = conf.app.windows.find((w) => w.label === label);
      expect(win, `配置里没有 ${label} 窗口`).toBeDefined();
      const size = propWindowSize(kind);
      expect(win!.width, `${label} 宽度`).toBe(size.w);
      expect(win!.height, `${label} 高度`).toBe(size.h);
    }
  });

  it('挂件窗口的 url 带上了自己的 kind - 一个页面服务两个挂件', () => {
    const conf = JSON.parse(
      readFileSync(new URL('../../src-tauri/tauri.conf.json', import.meta.url), 'utf8'),
    ) as { app: { windows: { label: string; url: string }[] } };
    for (const kind of PROP_KINDS) {
      const win = conf.app.windows.find((w) => w.label === propWindowLabel(kind));
      expect(win!.url).toBe(`prop.html?kind=${kind}`);
    }
  });

  it('挂件窗口以隐藏启动 - 摆好位置之前不该被看见', () => {
    const conf = JSON.parse(
      readFileSync(new URL('../../src-tauri/tauri.conf.json', import.meta.url), 'utf8'),
    ) as { app: { windows: { label: string; visible: boolean; transparent: boolean }[] } };
    for (const kind of PROP_KINDS) {
      const win = conf.app.windows.find((w) => w.label === propWindowLabel(kind));
      expect(win!.visible, `${kind} 应当以隐藏启动`).toBe(false);
      expect(win!.transparent, `${kind} 必须是透明窗口`).toBe(true);
    }
  });
});

describe('默认摆放', () => {
  it('两个挂件的下沿都落在猫脚下的地面线上', () => {
    const s = defaultPropsState(DESKTOP, GROUND_Y, SPRITE_SCALE);
    for (const kind of PROP_KINDS) {
      const p = s[kind];
      // 贴图最后一个精灵行的顶边 = 窗口下沿 - 一行。它要与地面线重合。
      const lastRowTop = p.y + (PROP_SPRITE[kind].h - 1) * SPRITE_SCALE;
      expect(lastRowTop, `${kind} 没踩在地面线上`).toBe(Math.round(GROUND_Y));
    }
  });

  it('地面线的算法与猫一致：离工作区下沿是 H - GROUND 个精灵像素', () => {
    // 对照组：上一条依赖 GROUND_Y 本身是对的。这里独立算一遍。
    expect(GROUND_Y).toBe(DESKTOP.y + DESKTOP.h - (H - GROUND) * SPRITE_SCALE);
  });

  it('两件家具并排贴在右侧，猫窝在最外侧，间隔是定好的那一段', () => {
    // 产品要求：摆在一起、稍作间隔、贴屏幕最右侧 - 挂件是常驻的，摆中间会挡内容。
    const s = defaultPropsState(DESKTOP, GROUND_Y, SPRITE_SCALE);
    const right = (kind: PropKind): number => s[kind].x + propWindowSize(kind).w;

    expect(s.bed.x).toBeGreaterThan(s.bowl.x);
    expect(s.bed.x - right('bowl')).toBe(PROP_GAP_PX);
    for (const kind of PROP_KINDS) {
      expect(s[kind].x, `${kind} 没贴到右侧`).toBeGreaterThan(DESKTOP.x + (DESKTOP.w * 2) / 3);
    }
  });

  it('贴边贴到猫刚好还能站进去为止，不会再往外', () => {
    // 猫的锚点是精灵横向中心，精灵不能出屏，所以它能站到的最右位置离右沿有半个身子。
    // 真按留白贴死的话猫窝中心会落在那条线之外，猫会歪着躺在垫子边上（实测 30 像素）。
    const s = defaultPropsState(DESKTOP, GROUND_Y, SPRITE_SCALE);
    const catHalf = (W * SPRITE_SCALE) / 2;
    const reachMax = DESKTOP.x + DESKTOP.w - catHalf;
    const bedCenter = propCenterX('bed', s.bed);
    expect(bedCenter).toBeLessThanOrEqual(reachMax);
    // 而且是贴着这条线，不是随便留一大截
    expect(reachMax - bedCenter).toBeLessThan(SPRITE_SCALE);
  });

  it('间隔不小于猫躺在垫子上比垫子宽出的那部分 - 否则睡着的猫会压住食盆', () => {
    const catHalf = (W * SPRITE_SCALE) / 2;
    const bedHalf = propWindowSize('bed').w / 2;
    expect(PROP_GAP_PX).toBeGreaterThanOrEqual(catHalf - bedHalf);

    // 按真实摆放算一遍：猫躺在垫子中间时，它的身体左沿不该越过食盆右沿。
    const s = defaultPropsState(DESKTOP, GROUND_Y, SPRITE_SCALE);
    const catLeft = propCenterX('bed', s.bed) - catHalf;
    const bowlRight = propCenterX('bowl', s.bowl) + propWindowSize('bowl').w / 2;
    expect(catLeft).toBeGreaterThan(bowlRight);
  });

  it('默认就显示 - 首次启动看不见食盆的话，「点食盆添粮」没有入口', () => {
    const s = defaultPropsState(DESKTOP, GROUND_Y, SPRITE_SCALE);
    expect(s.bowl.visible).toBe(true);
    expect(s.bed.visible).toBe(true);
  });

  it('小屏上两个挂件仍然整个在屏幕里', () => {
    const tiny: ScreenRect = { x: 0, y: 0, w: 800, h: 600 };
    const s = defaultPropsState(tiny, tiny.y + tiny.h - 18, SPRITE_SCALE);
    for (const kind of PROP_KINDS) {
      const size = propWindowSize(kind);
      expect(s[kind].x).toBeGreaterThanOrEqual(tiny.x);
      expect(s[kind].x + size.w).toBeLessThanOrEqual(tiny.x + tiny.w);
    }
  });

  it('负坐标的屏幕（左侧外接屏）也摆得进去', () => {
    const left: ScreenRect = { x: -1920, y: -200, w: 1920, h: 1080 };
    const s = defaultPropsState(left, left.y + left.h - 18, SPRITE_SCALE);
    for (const kind of PROP_KINDS) {
      expect(s[kind].x).toBeGreaterThanOrEqual(left.x);
      expect(s[kind].x + propWindowSize(kind).w).toBeLessThanOrEqual(left.x + left.w);
    }
  });
});

describe('钳进工作区', () => {
  const outside: PropPlacement = { x: 5000, y: 5000, visible: true };

  it('屏幕外的摆放被拉回屏幕内 - 否则用户既看不见也拖不回来', () => {
    const p = clampPlacement('bowl', outside, DESKTOP);
    const size = propWindowSize('bowl');
    expect(p.x + size.w).toBe(DESKTOP.w);
    expect(p.y + size.h).toBe(DESKTOP.h);
  });

  it('屏幕内的摆放一动不动 - 用户摆在哪儿是他的决定', () => {
    const inside: PropPlacement = { x: 300, y: 400, visible: false };
    expect(clampPlacement('bed', inside, DESKTOP)).toEqual(inside);
    const state = { bowl: inside, bed: inside };
    expect(samePropsState(clampPropsState(state, DESKTOP), state)).toBe(true);
  });

  it('钳制不改变显示状态', () => {
    expect(clampPlacement('bowl', { ...outside, visible: false }, DESKTOP).visible).toBe(false);
  });

  it('屏幕比挂件还窄时贴左，不产生负的可用宽度', () => {
    const sliver: ScreenRect = { x: 100, y: 0, w: 20, h: 20 };
    expect(clampPlacement('bed', { x: 0, y: 0, visible: true }, sliver).x).toBe(100);
  });
});

describe('猫的落点', () => {
  const limits = { min: 108, max: 1812 };
  const at = (x: number): PropPlacement => ({ x, y: 900, visible: true });

  it('食盆：猫停在自己那一侧，离盆心 PROP_REACH_SPRITE 个精灵像素', () => {
    const bowl = at(900);
    const center = propCenterX('bowl', bowl);
    const reach = PROP_REACH_SPRITE.bowl * SPRITE_SCALE;
    // 猫在右边 → 停在盆的右侧
    expect(approachX('bowl', bowl, center + 400, limits, SPRITE_SCALE)).toBe(center + reach);
    // 猫在左边 → 停在盆的左侧
    expect(approachX('bowl', bowl, center - 400, limits, SPRITE_SCALE)).toBe(center - reach);
  });

  it('落点是稳定的：站定之后再算一次不会跳到另一侧', () => {
    const bowl = at(900);
    const center = propCenterX('bowl', bowl);
    const first = approachX('bowl', bowl, center + 400, limits, SPRITE_SCALE);
    expect(approachX('bowl', bowl, first, limits, SPRITE_SCALE)).toBe(first);
    const other = approachX('bowl', bowl, center - 400, limits, SPRITE_SCALE);
    expect(approachX('bowl', bowl, other, limits, SPRITE_SCALE)).toBe(other);
  });

  it('猫窝：reach 为 0，猫站在垫子正中间（睡在窝里，不是窝旁边）', () => {
    const bed = at(600);
    expect(approachX('bed', bed, 100, limits, SPRITE_SCALE)).toBe(propCenterX('bed', bed));
    expect(approachX('bed', bed, 1800, limits, SPRITE_SCALE)).toBe(propCenterX('bed', bed));
  });

  it('食盆贴着屏幕右边缘时改从左侧靠近', () => {
    const bowl = at(limits.max);
    const center = propCenterX('bowl', bowl);
    const reach = PROP_REACH_SPRITE.bowl * SPRITE_SCALE;
    // 猫从右边过来，但右侧落点已经出了可达范围。
    const x = approachX('bowl', bowl, center + 10, limits, SPRITE_SCALE);
    expect(x).toBe(center - reach);
    expect(x).toBeLessThanOrEqual(limits.max);
  });

  it('两侧都不可达时钳住，仍然落在可达范围内', () => {
    // 极窄的可达范围：两侧落点都出界。
    const narrow = { min: 500, max: 502 };
    const bowl = at(400);
    const x = approachX('bowl', bowl, 501, narrow, SPRITE_SCALE);
    expect(x).toBeGreaterThanOrEqual(narrow.min);
    expect(x).toBeLessThanOrEqual(narrow.max);
  });

  it('隐藏的挂件没有锚点 - 猫照旧自己漫游，不会走去一个空位置', () => {
    const state = { bowl: { x: 900, y: 900, visible: false }, bed: at(300) };
    expect(anchorScreenX('bowl', state, 500, limits, SPRITE_SCALE)).toBeNull();
    expect(anchorScreenX('bed', state, 500, limits, SPRITE_SCALE)).not.toBeNull();
  });
});

describe('不可变更新', () => {
  it('withPlacement 返回新对象，不改原状态', () => {
    const state = defaultPropsState(DESKTOP, GROUND_Y, SPRITE_SCALE);
    const before = JSON.stringify(state);
    const next = withPlacement(state, 'bowl', { visible: false });
    expect(JSON.stringify(state)).toBe(before);
    expect(next.bowl.visible).toBe(false);
    // 没碰的那个挂件保持原样
    expect(next.bed).toEqual(state.bed);
    // 只改 visible 不该动坐标
    expect(next.bowl.x).toBe(state.bowl.x);
  });

  it('samePropsState 认得出「一模一样」与「差一点」', () => {
    const a = defaultPropsState(DESKTOP, GROUND_Y, SPRITE_SCALE);
    expect(samePropsState(a, { ...a })).toBe(true);
    expect(samePropsState(a, withPlacement(a, 'bed', { x: a.bed.x + 1 }))).toBe(false);
    expect(samePropsState(a, withPlacement(a, 'bed', { visible: !a.bed.visible }))).toBe(false);
  });
});

describe('像素缩放', () => {
  /** 真机上会遇到的 dpr 档位。与 test/app/display.test.ts 同一组。 */
  const REAL_DPRS = [1, 1.25, 1.5, 2, 2.5, 3] as const;

  it('任何 dpr 下缩放都是整数，且画布放得进窗口', () => {
    for (const kind of PROP_KINDS) {
      const sprite = PROP_SPRITE[kind];
      const box = propWindowSize(kind);
      for (const dpr of REAL_DPRS) {
        const scale = propDeviceScale(sprite, PROP_SCALE, dpr, box);
        expect(Number.isInteger(scale), `${kind} dpr=${dpr}`).toBe(true);
        expect(scale).toBeGreaterThanOrEqual(1);
        const css = propCssSize(sprite, scale, dpr);
        expect(css.w, `${kind} dpr=${dpr} 画布宽 ${css.w} 超出窗口 ${box.w}`).toBeLessThanOrEqual(
          box.w,
        );
        expect(css.h, `${kind} dpr=${dpr} 画布高 ${css.h} 超出窗口 ${box.h}`).toBeLessThanOrEqual(
          box.h,
        );
      }
    }
  });

  it('每个源像素占整数个物理像素 - 像素风不破功的那条约束', () => {
    for (const kind of PROP_KINDS) {
      for (const dpr of REAL_DPRS) {
        const scale = propDeviceScale(PROP_SPRITE[kind], PROP_SCALE, dpr, propWindowSize(kind));
        // 画布的后备缓冲是 sprite * scale 个物理像素，CSS 宽是它除以 dpr，
        // 于是一个源像素占 scale 个物理像素 - 整数，与 dpr 是不是分数无关。
        expect(Number.isInteger(scale)).toBe(true);
      }
    }
  });

  it('窗口给得再小也不会算出 0 倍（那会画出一张空图）', () => {
    const kind: PropKind = 'bed';
    expect(propDeviceScale(PROP_SPRITE[kind], PROP_SCALE, 1, { w: 1, h: 1 })).toBe(1);
  });
});

describe('挂件的高度', () => {
  it('两个挂件都很矮 - 与猫的窗口谁盖谁是平台行为，重叠区必须小', () => {
    // 蜷睡的猫大约 26 个精灵行高（H - 30）。挂件高过它的一半就会在
    // 「挂件盖住猫」那种叠放下把猫挡掉大半。
    for (const kind of PROP_KINDS) {
      expect(PROP_SPRITE[kind].h, `${kind} 太高了`).toBeLessThan(13);
    }
  });

  it('groundedY 对同一个地面线给出的下沿位置只与贴图高度有关', () => {
    const a = groundedY('bowl', GROUND_Y, SPRITE_SCALE);
    const b = groundedY('bed', GROUND_Y, SPRITE_SCALE);
    expect(a - b).toBe((PROP_SPRITE.bed.h - PROP_SPRITE.bowl.h) * SPRITE_SCALE);
  });
});

describe('拖动：跟手，越过中心交换，松手补间隔', () => {
  const at = (bowlX: number, bedX: number): PropsState => ({
    bowl: { x: bowlX, y: 900, visible: true },
    bed: { x: bedX, y: 900, visible: true },
  });
  const wOf = (k: PropKind): number => propWindowSize(k).w;
  const centerOf = (k: PropKind, st: PropsState): number => st[k].x + wOf(k) / 2;
  const gapBetween = (st: PropsState): number => {
    const [l, r] = st.bowl.x < st.bed.x ? (['bowl', 'bed'] as const) : (['bed', 'bowl'] as const);
    return st[r].x - (st[l].x + wOf(l));
  };

  it('纵向一步都不动 - 挂件是放在地上的东西', () => {
    const s = at(400, 800);
    const next = dragResult('bowl', 600, s, DESKTOP);
    expect(next.bowl.y).toBe(s.bowl.y);
    expect(next.bed.y).toBe(s.bed.y);
  });

  it('横向严格跟手 - 死区就是「卡顿」的来源', () => {
    // 前一版在这里按间隔挡住，挂件停住而光标还在走，一百多像素不跟手，
    // 走到尽头再突然交换。现在每一个位置都照给。
    for (const want of [420, 600, 700, 740, 760]) {
      const next = dragResult('bowl', want, at(400, 800), DESKTOP);
      expect(next.bowl.x, `想去 ${want} 却停在 ${next.bowl.x}`).toBe(want);
    }
  });

  it('拖动过程中允许重合 - 不跟手才是错的', () => {
    // 想去的位置压在猫窝上（但中心还没越过），就该压上去。
    const s = at(400, 800);
    const want = 800 + wOf('bed') / 2 - wOf('bowl') / 2 - 4; // 中心差 4 像素没到
    const next = dragResult('bowl', want, s, DESKTOP);
    expect(next.bowl.x).toBe(Math.round(want));
    expect(gapBetween(next)).toBeLessThan(0); // 真的重合了
    expect(next.bed.x).toBe(s.bed.x); // 还没交换
  });

  it('中心交错的那一刻交换，此时两者正好各重叠一半左右', () => {
    const s = at(400, 800);
    const bedCenter = centerOf('bed', s);
    // 让食盆中心刚好越过猫窝中心
    const want = bedCenter - wOf('bowl') / 2 + 1;
    const next = dragResult('bowl', want, s, DESKTOP);
    expect(centerOf('bowl', next)).toBeGreaterThan(centerOf('bed', next));
    // 交换之后立刻是分开的，间隔就是定好的那一段
    expect(gapBetween(next)).toBe(PROP_GAP_PX);
  });

  it('交换之后继续同向拖，不会再来回换', () => {
    let cur = at(400, 800);
    const bedCenter = centerOf('bed', cur);
    cur = dragResult('bowl', bedCenter - wOf('bowl') / 2 + 1, cur, DESKTOP);
    const bedAfter = cur.bed.x;
    for (let want = cur.bowl.x; want < cur.bowl.x + 200; want += 13) {
      cur = dragResult('bowl', want, cur, DESKTOP);
    }
    expect(cur.bed.x).toBe(bedAfter);
    expect(centerOf('bowl', cur)).toBeGreaterThan(centerOf('bed', cur));
  });

  it('反向也能换回来（交换不是单程票）', () => {
    let s = at(400, 800);
    s = dragResult('bowl', centerOf('bed', s) - wOf('bowl') / 2 + 1, s, DESKTOP);
    expect(centerOf('bowl', s)).toBeGreaterThan(centerOf('bed', s));
    s = dragResult('bowl', centerOf('bed', s) - wOf('bowl') / 2 - 1, s, DESKTOP);
    expect(centerOf('bowl', s)).toBeLessThan(centerOf('bed', s));
  });

  it('拖不出工作区 - 出去了用户就再也拖不回来', () => {
    expect(dragResult('bowl', -9999, at(400, 1200), DESKTOP).bowl.x).toBe(DESKTOP.x);
    const far = dragResult('bowl', 99999, at(400, 1200), DESKTOP);
    expect(far.bowl.x + wOf('bowl')).toBe(DESKTOP.x + DESKTOP.w);
  });

  it('藏起来的挂件不参与交换 - 看不见的东西突然跳一下更莫名', () => {
    const s: PropsState = {
      bowl: { x: 400, y: 900, visible: true },
      bed: { x: 800, y: 900, visible: false },
    };
    const next = dragResult('bowl', 1500, s, DESKTOP);
    expect(next.bowl.x).toBe(1500);
    expect(next.bed.x).toBe(s.bed.x);
  });

  it('松手之后一定不重合，且推向更近的那一侧', () => {
    // 压在猫窝左半边就松手 → 往左让开
    const overlapLeft = dragResult('bowl', 760, at(400, 800), DESKTOP);
    expect(gapBetween(overlapLeft)).toBeLessThan(PROP_GAP_PX);
    const settledLeft = settleDrag('bowl', overlapLeft, DESKTOP);
    expect(gapBetween(settledLeft)).toBe(PROP_GAP_PX);
    expect(settledLeft.bowl.x).toBeLessThan(settledLeft.bed.x);
  });

  it('松手时本来就不重合的话，一动都不动', () => {
    const s = at(400, 800);
    expect(settleDrag('bowl', s, DESKTOP)).toBe(s);
  });

  it('屏幕窄到放不下两件时，宁可挨着也不推出屏幕外', () => {
    const tiny: ScreenRect = { x: 0, y: 0, w: 150, h: 600 };
    const s: PropsState = {
      bowl: { x: 10, y: 500, visible: true },
      bed: { x: 14, y: 500, visible: true },
    };
    const settled = settleDrag('bowl', s, tiny);
    expect(settled.bowl.x).toBeGreaterThanOrEqual(tiny.x);
    expect(settled.bowl.x + wOf('bowl')).toBeLessThanOrEqual(tiny.x + tiny.w);
  });
});

describe('纵向永远由地面线决定', () => {
  it('存档里带着任意的 y 也会被拉回地面线', () => {
    const floating: PropsState = {
      bowl: { x: 300, y: 100, visible: true },
      bed: { x: 700, y: 4000, visible: true },
    };
    const fixed = groundedPropsState(floating, GROUND_Y, SPRITE_SCALE);
    for (const kind of PROP_KINDS) {
      const lastRowTop = fixed[kind].y + (PROP_SPRITE[kind].h - 1) * SPRITE_SCALE;
      expect(lastRowTop, `${kind} 没踩在地面线上`).toBe(Math.round(GROUND_Y));
      // x 与可见性不动
      expect(fixed[kind].x).toBe(floating[kind].x);
      expect(fixed[kind].visible).toBe(floating[kind].visible);
    }
  });

  it('两件挂件拉回之后底边在同一条线上', () => {
    const fixed = groundedPropsState(
      { bowl: { x: 0, y: 1, visible: true }, bed: { x: 400, y: 2, visible: true } },
      GROUND_Y,
      SPRITE_SCALE,
    );
    const bottom = (k: PropKind): number => fixed[k].y + propWindowSize(k).h;
    expect(bottom('bowl')).toBe(bottom('bed'));
  });
});
