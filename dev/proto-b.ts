/**
 * 原型 B 的人工验证页：配色 × 六场景全矩阵，同步播放。
 *
 * ?t=<秒> 冻结在该时刻（截图用）；缺省实时动画。
 */
import { makeCat } from '../src/render/index.js';
import {
  SCENE_KEYS,
  SCENE_LABELS,
  colorwayFor,
  ready,
  render,
} from '../src/render/proto-b/index.js';
import type { CatSpecB, SceneKey } from '../src/render/proto-b/index.js';

/** 行：品种（决定配色）+ 固定 seed。前三行覆盖三种花纹形态。 */
const ROWS: readonly { breed: string; seed: number }[] = [
  { breed: 'orange', seed: 11 },
  { breed: 'amshort', seed: 22 },
  { breed: 'cow', seed: 33 },
  { breed: 'black', seed: 44 },
  { breed: 'ragdoll', seed: 55 },
];

interface Cell {
  canvas: HTMLCanvasElement;
  spec: CatSpecB;
  scene: SceneKey;
}

const cells: Cell[] = [];
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

function buildGrid(): void {
  const table = $<HTMLTableElement>('grid');
  table.innerHTML = '';
  cells.length = 0;
  const scale = Number($<HTMLSelectElement>('scale').value);

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  headRow.appendChild(document.createElement('th'));
  for (const key of SCENE_KEYS) {
    const th = document.createElement('th');
    th.textContent = SCENE_LABELS[key];
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const row of ROWS) {
    const tr = document.createElement('tr');
    const cat = makeCat(row.breed, row.seed);
    const spec: CatSpecB = { breed: row.breed, seed: row.seed, cat };
    const cw = colorwayFor(row.breed, row.seed);

    const th = document.createElement('th');
    th.innerHTML = `${cw.label}<small>${row.breed} · seed ${row.seed}</small>` +
      `<small>${cw.pattern ? `花纹 ${cw.pattern.mask}` : '纯色'}</small>`;
    tr.appendChild(th);

    for (const scene of SCENE_KEYS) {
      const td = document.createElement('td');
      const canvas = document.createElement('canvas');
      canvas.style.width = `${144 * scale}px`;
      canvas.style.height = `${112 * scale}px`;
      td.appendChild(canvas);
      tr.appendChild(td);
      cells.push({ canvas, spec, scene });
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
}

const frozenT = ((): number | null => {
  const v = new URLSearchParams(location.search).get('t');
  return v === null ? null : Number(v);
})();

// ?scale= 覆盖缩放（截图放大细看接缝用）。
const scaleParam = new URLSearchParams(location.search).get('scale');

function drawAll(t: number): void {
  for (const cell of cells) render(cell.canvas, cell.spec, cell.scene, t);
}

async function main(): Promise<void> {
  if (scaleParam) {
    const sel = $<HTMLSelectElement>('scale');
    if (Array.from(sel.options).some((o) => o.value === scaleParam)) sel.value = scaleParam;
  }
  buildGrid();
  $<HTMLSelectElement>('scale').addEventListener('change', () => {
    buildGrid();
    if (frozenT !== null) drawAll(frozenT);
  });

  await ready();

  if (frozenT !== null) {
    drawAll(frozenT);
    document.title += ` · t=${frozenT}`;
    return;
  }

  let last = performance.now();
  let t = 0;
  let frames = 0;
  let fpsT = 0;
  const tick = (now: number): void => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    t += dt;
    drawAll(t);
    frames++;
    fpsT += dt;
    if (fpsT >= 1) {
      $('fps').textContent = `${frames} fps · t=${t.toFixed(1)}s`;
      frames = 0;
      fpsT = 0;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

void main();
