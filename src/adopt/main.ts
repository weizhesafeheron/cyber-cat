import { BreedSprites } from '../app/breed-sprites.js';
import { CatDisplay } from '../app/display.js';
import { walkSpeedFor } from '../app/motion.js';
import {
  announceAdopted,
  cancelAdoption,
  closeAdoption,
  contentReady,
  inTauri,
} from '../app/ipc.js';
import { GROUND_FROM_BOTTOM } from '../app/stage.js';
import { mountChrome } from '../chrome/index.js';
import { BREEDS, BREED_KEYS, materializeCat } from '../render/index.js';
import type { ActionKey, BreedKey, Cat } from '../render/index.js';
import { walkFrame } from './arrival.js';
import {
  ADOPT_SCALE,
  ADOPT_W,
  ENTER_X,
  MAX_ANIM_DT,
  NAME_MAX_CHARS,
  REST_X,
  SETTLE_S,
  SKY_H,
} from './constants.js';
import { accept, beginAdoption, nameIt, resumeMeeting, selectBreed } from './flow.js';
import type { AdoptionFlow } from './flow.js';
import { handOff } from './handoff.js';
import { introOf } from './intro.js';
import { makeRain, stepRain } from './rain.js';
import type { RainBox, RainField } from './rain.js';
import { SkyCanvas } from './sky.js';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const ui = {
  night: $('night'),
  lede: $('lede'),
  breed: $('breed'),
  shape: $('shape'),
  traits: $('traits'),
  meeting: $('meeting'),
  naming: $<HTMLFormElement>('naming'),
  name: $<HTMLInputElement>('name'),
  hint: $('hint'),
  keep: $<HTMLButtonElement>('keep'),
  back: $<HTMLButtonElement>('back'),
  confirm: $<HTMLButtonElement>('confirm'),
  choose: $('choose'),
  breedGrid: $('breed-grid'),
};

const skyBox = (): RainBox => ({ w: ui.night.clientWidth || ADOPT_W / 2, h: SKY_H });
const sky = new SkyCanvas($<HTMLCanvasElement>('sky'));
const display = new CatDisplay($<HTMLCanvasElement>('cat'), ADOPT_SCALE, skyBox);
const sprites = new BreedSprites();

let flow: AdoptionFlow = beginAdoption(Math.random);
let cat: Cat = materializeCat(flow.candidate);
let stageT = 0;
let animT = 0;
let playing: ActionKey | null = null;
let rain: RainField = makeRain(skyBox(), Math.random);
let lastFrameMs = performance.now();

function applyGeometry(): void {
  document.documentElement.style.setProperty('--sky-h', `${SKY_H}px`);
  display.applyScale();
  sky.resize(skyBox(), window.devicePixelRatio || 1);
}

function groundY(): number {
  return SKY_H - GROUND_FROM_BOTTOM * display.spriteScale;
}

function refreshCat(): void {
  cat = materializeCat(flow.candidate);
}

function paintCard(canvas: HTMLCanvasElement, breed: BreedKey): void {
  const frame = sprites.frameAt(breed, 'sit', 0, 1).visual;
  const ratio = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.round(112 * ratio);
  const height = Math.round(82 * ratio);
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width, height);
  const scale = Math.min(width / frame.sw, height / frame.sh);
  const dw = Math.round(frame.sw * scale);
  const dh = Math.round(frame.sh * scale);
  const dx = Math.round((width - dw) / 2);
  const dy = Math.round((height - dh) / 2);
  ctx.drawImage(frame.source, frame.sx, frame.sy, frame.sw, frame.sh, dx, dy, dw, dh);
}

function syncBreedSelection(): void {
  ui.breedGrid.querySelectorAll<HTMLButtonElement>('.breed-card').forEach((button) => {
    button.setAttribute('aria-selected', String(button.dataset['breed'] === flow.candidate.breed));
  });
}

function showCandidate(): void {
  const intro = introOf(cat);
  ui.lede.innerHTML = '雨声里有脚步。<b>它在你面前停下，也把选择留给了你。</b>';
  ui.breed.textContent = intro.breed;
  ui.shape.textContent = intro.shape;
  ui.traits.replaceChildren(
    ...intro.traits.map((trait) => {
      const li = document.createElement('li');
      li.textContent = trait;
      return li;
    }),
  );
  syncBreedSelection();
}

function showPhase(): void {
  const naming = flow.phase === 'naming';
  ui.meeting.hidden = naming;
  ui.naming.hidden = !naming;
  ui.choose.classList.toggle('locked-mode', naming);
  ui.breedGrid.querySelectorAll<HTMLButtonElement>('.breed-card').forEach((button) => {
    button.disabled = naming;
  });
  ui.hint.classList.remove('bad');
  ui.hint.textContent = naming
    ? `给它起个名字。以后你看到的就是刚刚选中的这只猫（最多 ${NAME_MAX_CHARS} 个字）`
    : '选择一个品种，确认后再给它起名字。';
  if (naming) ui.name.focus();
}

function buildBreedCards(): void {
  ui.breedGrid.replaceChildren(
    ...BREED_KEYS.map((breed) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'breed-card';
      button.dataset['breed'] = breed;
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', String(breed === flow.candidate.breed));
      const canvas = document.createElement('canvas');
      const label = document.createElement('span');
      label.textContent = BREEDS[breed].label;
      paintCard(canvas, breed);
      button.append(canvas, label);
      button.addEventListener('click', () => {
        flow = selectBreed(flow, breed);
        refreshCat();
        animT = 0;
        playing = null;
        showCandidate();
      });
      return button;
    }),
  );
}

function render(dt: number): void {
  stageT += dt;
  rain = stepRain(rain, dt, skyBox(), Math.random);
  sky.paint(rain, groundY());
  const arrival = walkFrame(stageT, {
    from: ENTER_X,
    to: REST_X,
    speed: walkSpeedFor(cat, display.spriteScale),
    settleS: SETTLE_S,
  });
  const action = arrival.action;
  if (action !== playing) {
    playing = action;
    animT = 0;
  } else {
    animT += dt;
  }
  const dir: 1 | -1 = arrival.dir < 0 ? -1 : 1;
  const sprite = sprites.frame(flow.candidate.breed, action, animT, dir);
  display.paintSprite(sprite.visual);
  display.place(arrival.x);
}

function frame(now: number): void {
  const dt = Math.min(MAX_ANIM_DT, Math.max(0, (now - lastFrameMs) / 1000));
  lastFrameMs = now;
  render(dt);
  requestAnimationFrame(frame);
}

ui.keep.addEventListener('click', () => {
  flow = accept(flow);
  showPhase();
});
ui.back.addEventListener('click', () => {
  flow = resumeMeeting(flow);
  showPhase();
});
ui.naming.addEventListener('submit', (event) => {
  event.preventDefault();
  const result = nameIt(flow, ui.name.value);
  if (!result.ok) {
    ui.hint.classList.add('bad');
    ui.hint.textContent = result.reason;
    return;
  }
  ui.confirm.disabled = true;
  ui.hint.textContent = `${result.identity.name}，回家了。`;
  void handOff(result.identity, {
    announce: async (identity) => {
      if (!inTauri) {
        console.info('[cyber-cat] 领养完成（浏览器调试模式）：', identity);
        return;
      }
      await announceAdopted(identity);
    },
    close: closeAdoption,
  }).catch((error: unknown) => {
    ui.confirm.disabled = false;
    ui.hint.classList.add('bad');
    ui.hint.textContent = '没能把它交给桌面，再试一次';
    console.error('[cyber-cat] 交接领养结果失败：', error);
  });
});

window.addEventListener('resize', () => {
  applyGeometry();
  ui.breedGrid.querySelectorAll<HTMLCanvasElement>('canvas').forEach((canvas) => {
    const breed = canvas.parentElement?.dataset['breed'];
    if (breed) paintCard(canvas, breed);
  });
});
matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener('change', applyGeometry);
mountChrome({
  close: {
    hint: '先不养猫（会退出）',
    close: () => {
      if (!inTauri) return;
      void cancelAdoption().catch((error: unknown) => console.error('[cyber-cat] 放弃领养失败：', error));
    },
  },
});

async function boot(): Promise<void> {
  applyGeometry();
  await sprites.load();
  buildBreedCards();
  showCandidate();
  showPhase();
  render(0);
  await contentReady(true);
  lastFrameMs = performance.now();
  requestAnimationFrame(frame);
}

void boot().catch((error: unknown) => console.error('[cyber-cat] 显示领养窗口失败：', error));
