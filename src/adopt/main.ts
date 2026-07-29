/**
 * 领养窗口的入口。
 *
 * 职责边界：这个文件只做三件事 - 把纯逻辑的产出画到画布上、把点击翻译成状态迁移、
 * 把选定的猫交回宠物窗口。**判断一律不在这里**：
 * 挑猫在 flow.ts、走位在 arrival.ts、措辞在 intro.ts、名字校验在 name.ts、
 * 交接顺序在 handoff.ts，它们都有测试。
 *
 * 呈现要求（CONTEXT.md 的「领养」）：猫是**主动到来的个体**。
 * 文案里不出现「生成」「创建」「随机」「抽取」这类词 - 那会把一次相遇变成一次配置。
 */
import { CatDisplay } from '../app/display.js';
import { announceAdopted, closeAdoption, contentReady, inTauri } from '../app/ipc.js';
import { faceDir, walkSpeedFor } from '../app/motion.js';
import { GROUND_FROM_BOTTOM } from '../app/stage.js';
import { ACTIONS, CatRenderer, makeCat, makeMicro, stepMicro } from '../render/index.js';
import type { ActionKey, Cat, MicroState } from '../render/index.js';
import { walkFrame } from './arrival.js';
import {
  ADOPT_SCALE,
  ADOPT_W,
  ENTER_X,
  EXIT_X,
  MAX_ANIM_DT,
  NAME_MAX_CHARS,
  REST_X,
  SETTLE_S,
  SKY_H,
} from './constants.js';
import { accept, beginAdoption, meetNext, nameIt, resumeMeeting } from './flow.js';
import type { AdoptionFlow } from './flow.js';
import { handOff } from './handoff.js';
import { introOf } from './intro.js';
import { makeRain, stepRain } from './rain.js';
import type { RainBox, RainField } from './rain.js';
import { SkyCanvas } from './sky.js';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const night = $('night');
const panel = {
  lede: $('lede'),
  breed: $('breed'),
  shape: $('shape'),
  traits: $<HTMLUListElement>('traits'),
  meeting: $('meeting'),
  naming: $<HTMLFormElement>('naming'),
  name: $<HTMLInputElement>('name'),
  hint: $('hint'),
  next: $<HTMLButtonElement>('next'),
  keep: $<HTMLButtonElement>('keep'),
  back: $<HTMLButtonElement>('back'),
  confirm: $<HTMLButtonElement>('confirm'),
};

/** 夜幕的尺寸。窗口不可缩放，所以它只在 dpr 变化时需要重算。 */
const skyBox = (): RainBox => ({ w: night.clientWidth || ADOPT_W, h: SKY_H });

const renderer = new CatRenderer();
const sky = new SkyCanvas($<HTMLCanvasElement>('sky'));
// 画布的放大倍数按**夜幕**钳制而不是整个窗口：分数 dpr 下按整窗算会得到比夜幕
// 更高的画布，猫的头会被裁在夜幕上边。
const display = new CatDisplay($<HTMLCanvasElement>('cat'), ADOPT_SCALE, skyBox);

/** 猫走到画面外的这一段：离场结束后立刻换下一只。 */
type Stage = 'arriving' | 'leaving';

let flow: AdoptionFlow = beginAdoption(Math.random);
let cat: Cat = makeCat(flow.candidate.breed, flow.candidate.seed);
let micro: MicroState = makeMicro(flow.candidate.seed);
let stage: Stage = 'arriving';
/** 这一段（入场或离场）的局部时间，秒。 */
let stageT = 0;
/** 当前动作的局部时间。动作一换就归零，否则新动作会从中间开始播。 */
let animT = 0;
let playing: ActionKey | null = null;
let rain: RainField = makeRain(skyBox(), Math.random);
let lastFrameMs = performance.now();

function applyGeometry(): void {
  document.documentElement.style.setProperty('--sky-h', `${SKY_H}px`);
  display.applyScale();
  sky.resize(skyBox(), window.devicePixelRatio || 1);
}

/**
 * 猫脚下地面线在夜幕里的 CSS y。湿地从这里往下铺。
 *
 * 精灵贴着夜幕下沿，地面线离精灵下沿正好 GROUND_FROM_BOTTOM 个精灵像素
 * （与宠物窗口同一个换算，见 stage.ts）。按当前的 spriteScale 算而不是按
 * ADOPT_SCALE - 分数 dpr 下实际倍数会被取整改掉，否则湿地会与猫的脚错开。
 */
function groundY(): number {
  return SKY_H - GROUND_FROM_BOTTOM * display.spriteScale;
}

/** 把当前这只猫说给用户听。**每次换猫都要重写一遍**，否则卡片会停在上一只身上。 */
function showCandidate(): void {
  const intro = introOf(cat);
  panel.lede.innerHTML =
    flow.met === 1
      ? '雨声里有脚步。<b>一只猫从街那头走过来，在你面前停下了。</b>'
      : '雨里又走出一只，停下来看着你。';
  panel.breed.textContent = intro.breed;
  panel.shape.textContent = intro.shape;
  panel.traits.replaceChildren(
    ...intro.traits.map((t) => {
      const li = document.createElement('li');
      li.textContent = t;
      return li;
    }),
  );
}

/** 起名与打量两个阶段的界面切换。 */
function showPhase(): void {
  const naming = flow.phase === 'naming';
  panel.meeting.hidden = naming;
  panel.naming.hidden = !naming;
  panel.hint.classList.remove('bad');
  panel.hint.textContent = naming
    ? `给它起个名字，它就是你的猫了（最多 ${NAME_MAX_CHARS} 个字）`
    : '';
  if (naming) panel.name.focus();
}

/** 离场期间不能再点 - 连点两次「再等等」会让两只猫同时在走。 */
function setBusy(busy: boolean): void {
  panel.next.disabled = busy;
  panel.keep.disabled = busy;
}

function walkIn(): void {
  stage = 'arriving';
  stageT = 0;
  animT = 0;
  playing = null;
  setBusy(false);
  showCandidate();
  showPhase();
}

/** 画一帧。dt 为 0 时是「就照现在的样子画一张」，启动时的首帧用它。 */
function render(dt: number): void {
  stageT += dt;
  rain = stepRain(rain, dt, skyBox(), Math.random);
  sky.paint(rain, groundY());

  const leaving = stage === 'leaving';
  const f = walkFrame(stageT, {
    from: leaving ? REST_X : ENTER_X,
    to: leaving ? EXIT_X : REST_X,
    speed: walkSpeedFor(cat, display.spriteScale),
    // 离场不给 settle：走出画面之后不该在幕后坐下，下一只马上就来了
    settleS: leaving ? undefined : SETTLE_S,
  });

  // 上一只走出画面了，换下一只走进来。这一帧就画新猫的第一步。
  if (leaving && f.done) {
    flow = meetNext(flow, Math.random);
    cat = makeCat(flow.candidate.breed, flow.candidate.seed);
    micro = makeMicro(flow.candidate.seed);
    walkIn();
    render(0);
    return;
  }

  if (f.action !== playing) {
    playing = f.action;
    animT = 0;
  } else {
    animT += dt;
  }

  // 歪头只在站着或坐着时才合适，走路时头要跟着身体
  const mi = stepMicro(micro, dt, { blink: true, ear: true, tilt: f.action !== 'walk' });
  const pose = faceDir(ACTIONS[f.action].make(animT, cat, mi), f.dir);
  display.paint(renderer.render(cat, pose));
  display.place(f.x);
}

function frame(now: number): void {
  const dt = Math.min(MAX_ANIM_DT, Math.max(0, (now - lastFrameMs) / 1000));
  lastFrameMs = now;
  render(dt);
  requestAnimationFrame(frame);
}

/** 再等等：这一只走进雨里，下一只走出来。 */
panel.next.addEventListener('click', () => {
  if (stage === 'leaving') return;
  stage = 'leaving';
  stageT = 0;
  setBusy(true);
  panel.lede.textContent = '它转身走回雨里了。';
});

panel.keep.addEventListener('click', () => {
  flow = accept(flow);
  showPhase();
});

panel.back.addEventListener('click', () => {
  flow = resumeMeeting(flow);
  showPhase();
  showCandidate();
});

panel.naming.addEventListener('submit', (e) => {
  e.preventDefault();
  const result = nameIt(flow, panel.name.value);
  if (!result.ok) {
    panel.hint.classList.add('bad');
    panel.hint.textContent = result.reason;
    return;
  }
  panel.confirm.disabled = true;
  panel.hint.classList.remove('bad');
  panel.hint.textContent = `${result.identity.name}，回家了。`;
  void handOff(result.identity, {
    announce: async (identity) => {
      if (!inTauri) {
        // 直接用浏览器打开 /adopt.html 调试时没有宠物窗口可交接
        console.info('[cyber-cat] 领养完成（浏览器调试模式，不交接）：', identity);
        return;
      }
      await announceAdopted(identity);
    },
    close: closeAdoption,
  }).catch((err: unknown) => {
    // 交接失败时窗口还在，用户可以再点一次 - 见 handoff.ts 的失效方向
    panel.confirm.disabled = false;
    panel.hint.classList.add('bad');
    panel.hint.textContent = '没能把它交给桌面，再试一次';
    console.error('[cyber-cat] 交接领养结果失败：', err);
  });
});

// 跨屏拖动或系统缩放变化时重算，保持像素锐利
window.addEventListener('resize', () => applyGeometry());
matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener('change', () =>
  applyGeometry(),
);

/**
 * 启动顺序与宠物窗口同构：**同步画完第一帧 → 通知显示 → 起帧循环。**
 *
 * 领养窗口也是 visible: false 建出来的（adopt.rs），而 requestAnimationFrame
 * 对隐藏窗口不触发 - 把首帧放进 rAF 会死锁在「窗口永远不显示」上。
 * 这个坑宠物窗口踩过两次，见 lib.rs 的 content_ready。
 */
applyGeometry();
walkIn();
render(0);
void contentReady()
  .then(() => {
    lastFrameMs = performance.now();
    requestAnimationFrame(frame);
  })
  .catch((err: unknown) => {
    console.error('[cyber-cat] 显示领养窗口失败：', err);
  });
