/**
 * 视觉对比页（issue #24）：现状 / 原型 A / 原型 B 三栏同步播放。
 *
 * 判决制的展示面（issue #21 resolution）：
 * - 六个必测场景按钮；同 seed 同场景同一份 Pose 喂给三栏，逐帧同步。
 * - 第二屏：6 只不同品种/seed 同屏站立，验个体辨识度。
 *
 * 栏位契约（原型 B 的接入口）：
 *   一栏 = 一个 render(canvas, spec, scene, t, pose) 函数。
 *   - canvas 的 width/height 由栏位自己设（各自的缓冲分辨率），页面只管 CSS 尺寸。
 *   - spec = { breed, seed, cat }，cat 是 makeCat(breed, seed) 的完整产物。
 *   - t 为秒，场景切换时归零。
 *   - pose 是页面统一算好的当帧姿态（含微动作），保证三栏动作逐帧一致；可忽略。
 *   原型 B 在 src/render/proto-b/index.ts 具名导出 render 即自动接入。
 */

import {
  ACTIONS,
  BREEDS,
  BREED_KEYS,
  CatRenderer,
  H,
  W,
  makeCat,
  makeMicro,
  stepMicro,
} from '../src/render/index.js';
import type {
  ActionKey,
  BreedKey,
  Cat,
  MicroOut,
  MicroState,
  Pose,
} from '../src/render/index.js';
import { H2, ProtoARenderer, W2 } from '../src/render/proto-a/index.js';

// ---------- 场景 ----------

export type SceneKey = 'stand-blink' | 'walk' | 'sleep' | 'eat' | 'held-land' | 'sit-rise';

interface SceneStep {
  action: ActionKey;
  dur: number;
}

interface SceneDef {
  key: SceneKey;
  label: string;
  /** 依次播放、整体循环的动作时间线。 */
  steps: readonly SceneStep[];
  /** 歪头只适合静态姿态。 */
  tilt?: boolean;
}

const SCENES: readonly SceneDef[] = [
  { key: 'stand-blink', label: '站立眨眼', steps: [{ action: 'idle', dur: 6 }], tilt: true },
  { key: 'walk', label: '行走', steps: [{ action: 'walk', dur: 6 }] },
  { key: 'sleep', label: '睡觉呼吸', steps: [{ action: 'sleep', dur: 8 }] },
  { key: 'eat', label: '进食', steps: [{ action: 'eat', dur: 7.2 }] },
  {
    key: 'held-land',
    label: '拎起悬空/落地',
    steps: [
      { action: 'held', dur: 2.6 },
      { action: 'land', dur: 0.6 },
      { action: 'idle', dur: 1.2 },
    ],
  },
  {
    key: 'sit-rise',
    label: '蹲坐→起身',
    steps: [
      { action: 'sit', dur: 2.5 },
      { action: 'idle', dur: 2.5 },
    ],
    tilt: true,
  },
];

function scenePose(scene: SceneDef, t: number, cat: Cat, mi: MicroOut): Pose {
  const total = scene.steps.reduce((sum, s) => sum + s.dur, 0);
  let local = t % total;
  for (const step of scene.steps) {
    if (local < step.dur) return ACTIONS[step.action].make(local, cat, mi, { tailSweep: true });
    local -= step.dur;
  }
  const last = scene.steps[scene.steps.length - 1]!;
  return ACTIONS[last.action].make(last.dur, cat, mi, { tailSweep: true });
}

// ---------- 栏位 ----------

export interface CatSpec {
  breed: BreedKey;
  seed: number;
  cat: Cat;
}

export type ColumnRender = (
  canvas: HTMLCanvasElement,
  spec: CatSpec,
  scene: SceneKey,
  t: number,
  pose: Pose,
) => void;

interface CanvasBuf {
  ctx: CanvasRenderingContext2D;
  img: ImageData;
}

/** 现状栏：72×56。 */
function makeCurrentColumn(): ColumnRender {
  const renderer = new CatRenderer();
  const bufs = new WeakMap<HTMLCanvasElement, CanvasBuf>();
  return (canvas, spec, _scene, _t, pose) => {
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
      bufs.delete(canvas);
    }
    let buf = bufs.get(canvas);
    if (!buf) {
      const ctx = canvas.getContext('2d')!;
      buf = { ctx, img: ctx.createImageData(W, H) };
      bufs.set(canvas, buf);
    }
    const res = renderer.render(spec.cat, pose);
    buf.img.data.set(res.pixels);
    buf.ctx.putImageData(buf.img, 0, 0);
  };
}

/** 原型 A 栏：144×112。 */
function makeProtoAColumn(): ColumnRender {
  const renderer = new ProtoARenderer();
  const bufs = new WeakMap<HTMLCanvasElement, CanvasBuf>();
  return (canvas, spec, _scene, _t, pose) => {
    if (canvas.width !== W2 || canvas.height !== H2) {
      canvas.width = W2;
      canvas.height = H2;
      bufs.delete(canvas);
    }
    let buf = bufs.get(canvas);
    if (!buf) {
      const ctx = canvas.getContext('2d')!;
      buf = { ctx, img: ctx.createImageData(W2, H2) };
      bufs.set(canvas, buf);
    }
    const res = renderer.render(spec.cat, pose);
    buf.img.data.set(res.pixels);
    buf.ctx.putImageData(buf.img, 0, 0);
  };
}

interface ColumnDef {
  label: string;
  desc: string;
  render: ColumnRender | null;
}

const columns: ColumnDef[] = [
  { label: '现状', desc: '72×56 · 平面填色 + 均匀描边', render: makeCurrentColumn() },
  {
    label: '原型 A · 程序化着色',
    desc: '144×112 · 体积光影 / hue shift / selout / 毛簇',
    render: makeProtoAColumn(),
  },
  { label: '原型 B · 分层部件', desc: '待接入（src/render/proto-b/index.ts）', render: null },
];

// 原型 B 动态接入：模块存在即亮起，不存在保持占位。
const PROTO_B_MODULE = '/src/render/proto-b/index.ts';
void import(/* @vite-ignore */ PROTO_B_MODULE)
  .then((m: { render?: ColumnRender }) => {
    if (typeof m.render === 'function') {
      columns[2]!.render = m.render;
      columns[2]!.desc = '已接入';
      buildColumns();
    }
  })
  .catch(() => {
    /* 占位即可 */
  });

// ---------- DOM ----------

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const breedSelect = $<HTMLSelectElement>('breed');
const seedInput = $<HTMLInputElement>('seed');
const scaleSelect = $<HTMLSelectElement>('scale');

for (const key of BREED_KEYS) {
  const opt = document.createElement('option');
  opt.value = key;
  opt.textContent = BREEDS[key].label;
  breedSelect.appendChild(opt);
}

let scene: SceneDef = SCENES[0]!;
let sceneT = 0;

interface MainSlot {
  def: ColumnDef;
  canvas: HTMLCanvasElement | null;
}

let spec: CatSpec = makeSpec();
let micro: MicroState = makeMicro(spec.seed);
const mainSlots: MainSlot[] = [];

function makeSpec(): CatSpec {
  const breed = (breedSelect.value || BREED_KEYS[0]!) as BreedKey;
  const seed = Number(seedInput.value) || 0;
  return { breed, seed, cat: makeCat(breed, seed) };
}

function buildSceneButtons(): void {
  const host = $('sceneBtns');
  host.innerHTML = '';
  for (const def of SCENES) {
    const btn = document.createElement('button');
    btn.textContent = def.label;
    btn.classList.toggle('on', def.key === scene.key);
    btn.addEventListener('click', () => {
      scene = def;
      sceneT = 0;
      micro = makeMicro(spec.seed);
      buildSceneButtons();
    });
    host.appendChild(btn);
  }
}

function stageSize(): readonly [number, number] {
  const s = Number(scaleSelect.value) || 2;
  return [W2 * s, H2 * s];
}

function buildColumns(): void {
  const host = $('columns');
  host.innerHTML = '';
  mainSlots.length = 0;
  const [cw, ch] = stageSize();
  for (const def of columns) {
    const col = document.createElement('div');
    col.className = 'col';
    col.innerHTML = `<h3>${def.label}</h3><small>${def.desc}</small>`;
    const stage = document.createElement('div');
    stage.className = 'stage';
    stage.style.width = `${cw}px`;
    stage.style.height = `${ch}px`;
    let canvas: HTMLCanvasElement | null = null;
    if (def.render) {
      canvas = document.createElement('canvas');
      canvas.style.width = `${cw}px`;
      canvas.style.height = `${ch}px`;
      stage.appendChild(canvas);
    } else {
      stage.classList.add('placeholder');
      stage.textContent = '原型 B 待接入';
    }
    col.appendChild(stage);
    host.appendChild(col);
    mainSlots.push({ def, canvas });
  }
}

// ---------- 辨识度屏 ----------

const ID_BREEDS: readonly BreedKey[] = ['orange', 'black', 'cow', 'ragdoll', 'devon', 'aby'];

interface IdSlot {
  spec: CatSpec;
  micro: MicroState;
  t: number;
  canvases: HTMLCanvasElement[]; // [现状, 原型A]
}

const idSlots: IdSlot[] = [];

function buildIdentity(): void {
  const host = $('idrows');
  host.innerHTML = '';
  idSlots.length = 0;
  const baseSeed = Number(seedInput.value) || 0;
  const s = Number(scaleSelect.value) || 2;

  const rows: { label: string }[] = [{ label: '现状' }, { label: '原型 A' }];
  const rowEls = rows.map((r) => {
    const row = document.createElement('div');
    row.className = 'idrow';
    const span = document.createElement('span');
    span.textContent = r.label;
    row.appendChild(span);
    host.appendChild(row);
    return row;
  });

  ID_BREEDS.forEach((breed, i) => {
    const seed = baseSeed + i * 31 + 7;
    const slot: IdSlot = {
      spec: { breed, seed, cat: makeCat(breed, seed) },
      micro: makeMicro(seed),
      t: i * 0.61,
      canvases: [],
    };
    rowEls.forEach((row) => {
      const cell = document.createElement('div');
      cell.className = 'idcell';
      const stage = document.createElement('div');
      stage.className = 'stage';
      const canvas = document.createElement('canvas');
      canvas.style.width = `${W2 * s}px`;
      canvas.style.height = `${H2 * s}px`;
      stage.appendChild(canvas);
      cell.appendChild(stage);
      const label = document.createElement('small');
      label.textContent = `${BREEDS[breed].label} · ${seed}`;
      cell.appendChild(label);
      row.appendChild(cell);
      slot.canvases.push(canvas);
    });
    idSlots.push(slot);
  });
}

// ---------- 主循环 ----------

let last = performance.now();

function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  // 三栏：同一份 pose。
  sceneT += dt;
  const mi = stepMicro(micro, dt, { blink: true, ear: true, tilt: scene.tilt ?? false });
  const pose = scenePose(scene, sceneT, spec.cat, mi);
  for (const slot of mainSlots) {
    if (slot.def.render && slot.canvas) {
      slot.def.render(slot.canvas, spec, scene.key, sceneT, pose);
    }
  }

  // 辨识度屏：站立眨眼。
  const current = columns[0]!.render!;
  const protoA = columns[1]!.render!;
  for (const slot of idSlots) {
    slot.t += dt;
    const smi = stepMicro(slot.micro, dt, { blink: true, ear: true, tilt: true });
    const spose = ACTIONS.idle.make(slot.t, slot.spec.cat, smi, { tailSweep: true });
    current(slot.canvases[0]!, slot.spec, 'stand-blink', slot.t, spose);
    protoA(slot.canvases[1]!, slot.spec, 'stand-blink', slot.t, spose);
  }

  requestAnimationFrame(frame);
}

function rebuildCat(): void {
  spec = makeSpec();
  micro = makeMicro(spec.seed);
  sceneT = 0;
  buildIdentity();
}

$('reroll').addEventListener('click', () => {
  seedInput.value = String(Math.floor(Math.random() * 1e9));
  rebuildCat();
});
seedInput.addEventListener('change', rebuildCat);
breedSelect.addEventListener('change', rebuildCat);
scaleSelect.addEventListener('change', () => {
  buildColumns();
  buildIdentity();
});

buildSceneButtons();
buildColumns();
buildIdentity();
requestAnimationFrame(frame);
