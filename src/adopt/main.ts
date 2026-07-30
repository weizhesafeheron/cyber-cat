import { CatDisplay } from '../app/display.js';
import { faceDir, walkSpeedFor } from '../app/motion.js';
import {
  announceAdopted,
  cancelAdoption,
  closeAdoption,
  contentReady,
  inTauri,
} from '../app/ipc.js';
import { GROUND_FROM_BOTTOM } from '../app/stage.js';
import { mountChrome } from '../chrome/index.js';
import {
  ACTIONS,
  ACTION_KEYS,
  ART_TUNING_CONTROLS,
  BREEDS,
  BREED_KEYS,
  CatRenderer,
  DEFAULT_ART_TUNING,
  DEFAULT_MOTION_TUNING,
  makeMicro,
  materializeCat,
  motionTuningControlsFor,
  motionTuningFor,
  stepMicro,
  tuneMotionPose,
  tuneMotionTime,
} from '../render/index.js';
import type {
  ActionKey,
  Cat,
  CatArtTuningKey,
  CatMotionTuningKey,
  MicroState,
} from '../render/index.js';
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
import {
  accept,
  beginAdoption,
  nameIt,
  randomizeVisuals,
  rerollAppearance,
  resumeMeeting,
  selectBreed,
  setArtTuning,
  setMotionTuning,
} from './flow.js';
import type { AdoptionFlow } from './flow.js';
import { handOff } from './handoff.js';
import { introOf } from './intro.js';
import { makeRain, stepRain } from './rain.js';
import type { RainBox, RainField } from './rain.js';
import { SkyCanvas } from './sky.js';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const night = $('night');
const ui = {
  lede: $('lede'),
  breed: $('breed'),
  shape: $('shape'),
  traits: $<HTMLUListElement>('traits'),
  breedDropdown: $('breed-dropdown'),
  breedTrigger: $<HTMLButtonElement>('breed-trigger'),
  breedMenu: $('breed-menu'),
  reroll: $<HTMLButtonElement>('reroll'),
  meeting: $('meeting'),
  naming: $<HTMLFormElement>('naming'),
  name: $<HTMLInputElement>('name'),
  hint: $('hint'),
  keep: $<HTMLButtonElement>('keep'),
  back: $<HTMLButtonElement>('back'),
  confirm: $<HTMLButtonElement>('confirm'),
  customize: $('customize'),
  fields: $<HTMLFieldSetElement>('tuning-fields'),
  controls: $('controls'),
  actionDropdown: $('action-dropdown'),
  actionTrigger: $<HTMLButtonElement>('action-trigger'),
  actionMenu: $('action-menu'),
  artTab: $<HTMLButtonElement>('art-tab'),
  motionTab: $<HTMLButtonElement>('motion-tab'),
  randomize: $<HTMLButtonElement>('randomize'),
  reset: $<HTMLButtonElement>('reset'),
};

const skyBox = (): RainBox => ({ w: night.clientWidth || ADOPT_W / 2, h: SKY_H });
const renderer = new CatRenderer();
const sky = new SkyCanvas($<HTMLCanvasElement>('sky'));
const display = new CatDisplay($<HTMLCanvasElement>('cat'), ADOPT_SCALE, skyBox);

type TuningTab = 'art' | 'motion';
let tab: TuningTab = 'art';
let previewAction: ActionKey = 'walk';
let flow: AdoptionFlow = beginAdoption(Math.random);
let cat: Cat = materializeCat(flow.candidate);
let micro: MicroState = makeMicro(flow.candidate.seed);
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

function refreshCat(resetMicro = false): void {
  cat = materializeCat(flow.candidate);
  if (resetMicro) micro = makeMicro(flow.candidate.seed);
}

function showCandidate(): void {
  const intro = introOf(cat);
  ui.lede.innerHTML = '雨声里有脚步。<b>它在你面前停下，也把选择留给了你。</b>';
  ui.breed.textContent = intro.breed;
  ui.shape.textContent = intro.shape;
  ui.breedTrigger.textContent = BREEDS[flow.candidate.breed].label;
  ui.traits.replaceChildren(
    ...intro.traits.map((trait) => {
      const li = document.createElement('li');
      li.textContent = trait;
      return li;
    }),
  );
}

function showPhase(): void {
  const naming = flow.phase === 'naming';
  ui.meeting.hidden = naming;
  ui.naming.hidden = !naming;
  ui.fields.disabled = naming;
  ui.breedTrigger.disabled = naming;
  ui.reroll.disabled = naming;
  ui.randomize.disabled = naming;
  ui.reset.disabled = naming;
  ui.customize.classList.toggle('locked-mode', naming);
  ui.hint.classList.remove('bad');
  ui.hint.textContent = naming
    ? `给它起个名字。带它回家后，形象与动作会封存（最多 ${NAME_MAX_CHARS} 个字）`
    : '你可以先预览每个动作，再确认领养。';
  if (naming) ui.name.focus();
}

function valueText(value: number): string {
  if (Math.abs(value) < 0.005) return '当前';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}`;
}

function rangeControl(
  key: CatArtTuningKey | CatMotionTuningKey,
  label: string,
  low: string,
  high: string,
  value: number,
  onInput: (value: number) => void,
): HTMLElement {
  const box = document.createElement('div');
  box.className = 'control';
  const head = document.createElement('div');
  head.className = 'control-head';
  const title = document.createElement('span');
  title.textContent = label;
  const output = document.createElement('output');
  output.textContent = valueText(value);
  const range = document.createElement('div');
  range.className = 'range';
  const lowNode = document.createElement('span');
  lowNode.textContent = low;
  const highNode = document.createElement('span');
  highNode.textContent = high;
  const input = document.createElement('input');
  input.type = 'range';
  input.min = '-100';
  input.max = '100';
  input.step = '1';
  input.value = String(Math.round(value * 100));
  input.dataset['key'] = key;
  input.addEventListener('input', () => {
    const next = Number(input.value) / 100;
    output.textContent = valueText(next);
    onInput(next);
  });
  head.append(title, output);
  range.append(lowNode, input, highNode);
  box.append(head, range);
  return box;
}

function renderControls(): void {
  ui.artTab.setAttribute('aria-selected', String(tab === 'art'));
  ui.motionTab.setAttribute('aria-selected', String(tab === 'motion'));
  ui.controls.replaceChildren();

  if (tab === 'motion') {
    const group = document.createElement('section');
    group.className = 'group';
    const heading = document.createElement('h2');
    heading.textContent = `动作观感 · ${ACTIONS[previewAction].label}`;
    group.append(heading);
    const tuning = motionTuningFor({ motion: flow.candidate.motion }, previewAction);
    for (const control of motionTuningControlsFor(previewAction)) {
      group.append(
        rangeControl(control.key, control.label, control.low, control.high, tuning[control.key], (value) => {
          flow = setMotionTuning(flow, previewAction, { [control.key]: value });
        }),
      );
    }
    ui.controls.append(group);
    return;
  }

  const groups = new Map<string, HTMLElement>();
  for (const control of ART_TUNING_CONTROLS) {
    let group = groups.get(control.group);
    if (!group) {
      group = document.createElement('section');
      group.className = 'group';
      const heading = document.createElement('h2');
      heading.textContent = control.group;
      group.append(heading);
      groups.set(control.group, group);
      ui.controls.append(group);
    }
    group.append(
      rangeControl(control.key, control.label, control.low, control.high, flow.candidate.art[control.key], (value) => {
        flow = setArtTuning(flow, { [control.key]: value });
        refreshCat();
        showCandidate();
      }),
    );
  }
}

interface DropdownSpec {
  root: HTMLElement;
  trigger: HTMLButtonElement;
  menu: HTMLElement;
}

function closeDropdown(spec: DropdownSpec): void {
  spec.root.classList.remove('open');
  spec.trigger.setAttribute('aria-expanded', 'false');
  spec.menu.hidden = true;
}

function toggleDropdown(spec: DropdownSpec): void {
  const opening = spec.menu.hidden;
  closeDropdown(breedDropdown);
  closeDropdown(actionDropdown);
  if (!opening) return;
  spec.root.classList.add('open');
  spec.trigger.setAttribute('aria-expanded', 'true');
  spec.menu.hidden = false;
}

function addDropdownOption(
  spec: DropdownSpec,
  value: string,
  label: string,
  selected: () => boolean,
  choose: () => void,
): void {
  const option = document.createElement('button');
  option.type = 'button';
  option.className = 'dropdown-option';
  option.dataset['value'] = value;
  option.setAttribute('role', 'option');
  option.textContent = label;
  option.addEventListener('click', () => {
    choose();
    for (const node of Array.from(spec.menu.querySelectorAll<HTMLElement>('.dropdown-option'))) {
      node.setAttribute('aria-selected', String(node.dataset['value'] === value));
    }
    closeDropdown(spec);
  });
  option.setAttribute('aria-selected', String(selected()));
  spec.menu.append(option);
}

function syncDropdownSelection(spec: DropdownSpec, value: string): void {
  for (const node of Array.from(spec.menu.querySelectorAll<HTMLElement>('.dropdown-option'))) {
    node.setAttribute('aria-selected', String(node.dataset['value'] === value));
  }
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
  const action = arrival.action === 'sit' ? previewAction : arrival.action;
  const tuning = motionTuningFor({ motion: flow.candidate.motion }, action);
  if (action !== playing) {
    playing = action;
    animT = 0;
  } else {
    // 节奏只缩放本帧经过的时间。若用新节奏重算累计时间，拖动滑杆时会让
    // 已经播放过的整段动画反复跳相位，视觉上像高频闪动。
    animT += tuneMotionTime(dt, tuning, action, cat);
  }
  const mi = stepMicro(micro, dt, {
    blink: true,
    ear: true,
    tilt: action === 'idle' || action === 'sit',
  });
  const pose = tuneMotionPose(
    action,
    ACTIONS[action].make(animT, cat, mi),
    tuning,
    cat,
  );
  display.paint(renderer.render(cat, faceDir(pose, arrival.dir)));
  display.place(arrival.x);
}

function frame(now: number): void {
  const dt = Math.min(MAX_ANIM_DT, Math.max(0, (now - lastFrameMs) / 1000));
  lastFrameMs = now;
  render(dt);
  requestAnimationFrame(frame);
}

const breedDropdown: DropdownSpec = {
  root: ui.breedDropdown,
  trigger: ui.breedTrigger,
  menu: ui.breedMenu,
};
const actionDropdown: DropdownSpec = {
  root: ui.actionDropdown,
  trigger: ui.actionTrigger,
  menu: ui.actionMenu,
};
for (const breed of BREED_KEYS) {
  addDropdownOption(
    breedDropdown,
    breed,
    BREEDS[breed].label,
    () => breed === flow.candidate.breed,
    () => {
      flow = selectBreed(flow, breed);
      refreshCat(true);
      showCandidate();
    },
  );
}
for (const action of ACTION_KEYS) {
  addDropdownOption(
    actionDropdown,
    action,
    ACTIONS[action].label,
    () => action === previewAction,
    () => {
      previewAction = action;
      ui.actionTrigger.textContent = ACTIONS[action].label;
      animT = 0;
      playing = null;
      renderControls();
    },
  );
}
ui.actionTrigger.textContent = ACTIONS[previewAction].label;
ui.breedTrigger.addEventListener('click', () => toggleDropdown(breedDropdown));
ui.actionTrigger.addEventListener('click', () => toggleDropdown(actionDropdown));
document.addEventListener('click', (event) => {
  const target = event.target as Node;
  if (!ui.breedDropdown.contains(target)) closeDropdown(breedDropdown);
  if (!ui.actionDropdown.contains(target)) closeDropdown(actionDropdown);
});
ui.reroll.addEventListener('click', () => {
  flow = rerollAppearance(flow, Math.random);
  refreshCat();
  showCandidate();
});
ui.randomize.addEventListener('click', () => {
  flow = randomizeVisuals(flow, Math.random);
  syncDropdownSelection(breedDropdown, flow.candidate.breed);
  refreshCat(true);
  showCandidate();
  animT = 0;
  playing = null;
  renderControls();
});
ui.artTab.addEventListener('click', () => {
  tab = 'art';
  renderControls();
});
ui.motionTab.addEventListener('click', () => {
  tab = 'motion';
  renderControls();
});
ui.reset.addEventListener('click', () => {
  if (tab === 'art') {
    flow = setArtTuning(flow, DEFAULT_ART_TUNING);
    refreshCat();
    showCandidate();
  } else {
    flow = setMotionTuning(flow, previewAction, DEFAULT_MOTION_TUNING);
  }
  renderControls();
});
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

window.addEventListener('resize', applyGeometry);
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

applyGeometry();
showCandidate();
showPhase();
renderControls();
render(0);
void contentReady(true)
  .then(() => {
    lastFrameMs = performance.now();
    requestAnimationFrame(frame);
  })
  .catch((error: unknown) => console.error('[cyber-cat] 显示领养窗口失败：', error));
