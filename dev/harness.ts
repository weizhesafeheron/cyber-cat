/**
 * 渲染核心的人工验证页。
 *
 * 逐像素等价性由 test/render/port-equivalence.test.ts 自动保证；
 * 这一页看的是「像不像猫」这类只能人眼判断的部分，以及掩膜的可视化确认。
 *
 * 这是开发工具，不是产品入口。
 */
import {
  ACTIONS,
  ACTION_KEYS,
  BREEDS,
  BREED_KEYS,
  CatRenderer,
  H,
  W,
  makeCat,
  makeMicro,
  stepMicro,
} from '../src/render/index.js';
import type { ActionKey, BreedKey, Cat, MicroState, Pose } from '../src/render/index.js';

interface Slot {
  breed: BreedKey;
  action: ActionKey;
  cat: Cat;
  micro: MicroState;
  ctx: CanvasRenderingContext2D;
  img: ImageData;
  t: number;
}

const renderer = new CatRenderer();
const slots: Slot[] = [];

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const seedInput = $<HTMLInputElement>('seed');
const scaleSelect = $<HTMLSelectElement>('scale');
const maskView = $<HTMLInputElement>('maskView');
const fpsLabel = $('fps');
const toggles = {
  breath: $<HTMLInputElement>('m-breath'),
  blink: $<HTMLInputElement>('m-blink'),
  ear: $<HTMLInputElement>('m-ear'),
  tilt: $<HTMLInputElement>('m-tilt'),
  tail: $<HTMLInputElement>('m-tail'),
};

function buildGrid(): void {
  const table = $<HTMLTableElement>('grid');
  table.innerHTML = '';
  slots.length = 0;

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  headRow.appendChild(document.createElement('th'));
  for (const key of ACTION_KEYS) {
    const th = document.createElement('th');
    th.textContent = ACTIONS[key].label;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  const baseSeed = Number(seedInput.value) || 0;

  BREED_KEYS.forEach((breed, bi) => {
    const tr = document.createElement('tr');
    const seed = baseSeed + bi * 17;
    const cat = makeCat(breed, seed);

    const th = document.createElement('th');
    const p = cat.personality;
    th.innerHTML =
      `${BREEDS[breed].label}<small>seed ${seed}</small>` +
      `<small>活跃 ${(p.active * 100) | 0}% 粘人 ${(p.clingy * 100) | 0}%</small>`;
    tr.appendChild(th);

    for (const action of ACTION_KEYS) {
      const td = document.createElement('td');
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      td.appendChild(canvas);
      tr.appendChild(td);

      const ctx = canvas.getContext('2d')!;
      slots.push({
        breed,
        action,
        cat,
        micro: makeMicro(seed),
        ctx,
        img: ctx.createImageData(W, H),
        // 每个格子的起始时间错开，避免整页动作同步得像阅兵
        t: (slots.length % 7) * 0.43,
      });
    }
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  applyScale();
}

function applyScale(): void {
  const s = Number(scaleSelect.value);
  for (const slot of slots) {
    slot.ctx.canvas.style.width = `${W * s}px`;
    slot.ctx.canvas.style.height = `${H * s}px`;
  }
}

/** 关掉某些微动作时，把已经写进 pose 的对应字段抹平。 */
function applyToggles(pose: Pose): void {
  if (!toggles.breath.checked) pose.breath = 0;
  if (!toggles.tail.checked) pose.tailWave = 0;
  if (!toggles.blink.checked && pose.eyeOpen != null && pose.eyeOpen > 0 && pose.eyeOpen < 1) {
    pose.eyeOpen = 1;
  }
}

let last = performance.now();
let frames = 0;
let fpsClock = performance.now();

function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const showMask = maskView.checked;
  document.body.classList.toggle('maskmode', showMask);

  for (const slot of slots) {
    slot.t += dt;
    const mi = stepMicro(slot.micro, dt, {
      blink: toggles.blink.checked,
      ear: toggles.ear.checked,
      // 只有静态姿态适合歪头
      tilt: toggles.tilt.checked && (slot.action === 'idle' || slot.action === 'sit'),
    });
    const pose = ACTIONS[slot.action].make(slot.t, slot.cat, mi, { tailSweep: true });
    applyToggles(pose);

    const res = renderer.render(slot.cat, pose);
    const data = slot.img.data;
    if (showMask) {
      // 掩膜视图：白色 = 点得到猫。影子与装饰应当是黑的。
      for (let i = 0; i < W * H; i++) {
        const o = i * 4;
        const on = res.alphaMask[i] === 255;
        data[o] = on ? 255 : 0;
        data[o + 1] = on ? 255 : 0;
        data[o + 2] = on ? 255 : 0;
        data[o + 3] = res.pixels[o + 3] === 255 ? 255 : 40;
      }
    } else {
      data.set(res.pixels);
    }
    slot.ctx.putImageData(slot.img, 0, 0);
  }

  frames++;
  if (now - fpsClock > 1000) {
    fpsLabel.textContent = `${Math.round((frames * 1000) / (now - fpsClock))} fps · ${slots.length} 格`;
    frames = 0;
    fpsClock = now;
  }
  requestAnimationFrame(frame);
}

$('reroll').addEventListener('click', () => {
  seedInput.value = String(Math.floor(Math.random() * 1e9));
  buildGrid();
});
seedInput.addEventListener('change', buildGrid);
scaleSelect.addEventListener('change', applyScale);

buildGrid();
requestAnimationFrame(frame);
