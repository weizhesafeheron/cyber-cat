/**
 * 原型 B 分层部件资产生成器。
 *
 * 产出（写入 src/render/proto-b/assets/）：
 * - 部件 PNG × N：规范 ID 调色板绘制，Mana Seed 式同布局（所有部件画在
 *   同一张 144×112 画布的原位上，运行时叠加零对位成本）。
 * - 花纹 mask PNG：与部件同布局的二值选区（虎斑/奶牛/重点色）。
 * - parts.json：部件 → 图片 / pivot / 父节点 / zIndex 的自研描述。
 * - parts-data.ts：parts.json 的 TS 镜像，运行时与测试直接 import。
 *
 * 用法：npx vite-node tools/proto-b/make-parts.ts
 * 所有绘制都是确定性的，重跑产出逐字节一致。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ID } from '../../src/render/proto-b/palette.js';
import { encodePng } from '../png.js';
import {
  PGrid,
  bellyBand,
  capsule,
  coatBand,
  ellipse,
  fillRegion,
  furTufts,
  hash2,
  maskToRGBA,
  outlinePass,
  toRGBA,
  triangle,
  union,
  type BandPicker,
  type Region,
} from './grid.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../../src/render/proto-b/assets');
const PREVIEW = process.env.PROTO_B_PREVIEW;

export const W = 144;
export const H = 112;
/** 站立时脚底所在行。 */
export const GROUND = 101;

const coatPick: BandPicker = (b) => coatBand(b);
const bellyPick: BandPicker = (b) => bellyBand(b);

/** 远侧肢体整体暗一档（纵深），仍落在同一条色带内，换色不受影响。 */
const farCoatPick: BandPicker = (b) => {
  const id = coatBand(b);
  return id > ID.C0 ? id - 1 : id;
};

// ---------------------------------------------------------------- 身体

function drawBodyStand(): PGrid {
  const g = new PGrid(W, H);
  const torso = capsule(58, 73, 16, 84, 71, 13.5);
  const chestPatch = ellipse(90, 77, 6.5, 7.5);
  fillRegion(
    g,
    torso,
    (b, x, y) => (y >= 80 || chestPatch.contains(x, y) ? bellyBand(b) : coatBand(b)),
    1,
  );
  furTufts(g, 0.3, 11);
  outlinePass(g);
  return g;
}

function drawBodySit(): PGrid {
  const g = new PGrid(W, H);
  // 远侧前腿先画，被躯干压住。
  const farLeg = union(capsule(79, 71, 3.4, 79, 95, 3.0), capsule(79.5, 97.4, 2.4, 82, 97.4, 2.3));
  fillRegion(g, farLeg, farCoatPick, 21);
  const haunch = ellipse(60, 83.5, 17.5, 17.5);
  const torsoUp = capsule(60, 84, 15.5, 82, 64, 11.5);
  const chestPatch = ellipse(87, 78, 4.5, 8);
  const body = union(haunch, torsoUp);
  fillRegion(
    g,
    body,
    (b, x, y) => (chestPatch.contains(x, y) || (y >= 92 && x > 66) ? bellyBand(b) : coatBand(b)),
    2,
  );
  // 近侧前腿（坐直）与爪。
  const nearLeg = union(
    capsule(85, 72, 3.7, 85, 97, 3.3),
    capsule(85.5, 98.6, 2.6, 88.5, 98.6, 2.5),
  );
  fillRegion(g, nearLeg, coatPick, 22);
  furTufts(g, 0.3, 12);
  outlinePass(g, { groundY: GROUND });
  return g;
}

function drawBodyCurl(breath: 0 | 1): PGrid {
  const g = new PGrid(W, H);
  const ry = breath === 0 ? 16 : 17;
  const cy = breath === 0 ? 85.5 : 85;
  const blob = ellipse(68, cy, 29, ry);
  fillRegion(g, blob, coatPick, 3);
  // 盘在身前的尾巴：同色带但压暗，读成独立体量又不用内描边。
  const tail = tubeAlong(
    [
      [42, 91],
      [50, 99],
      [68, 102],
      [90, 96],
    ],
    3.4,
    2.6,
  );
  const tailClip = clipRegion(tail, blob);
  fillRegion(g, tailClip, (b) => {
    const id = coatBand(b + 0.1);
    return id > ID.C0 ? id - 1 : id;
  }, 4);
  // 盘尾上缘一条软描边，把它从身体里剥出来。
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (tailClip.contains(x, y) && !tailClip.contains(x, y - 1) && blob.contains(x, y - 1)) {
        g.set(x, y, ID.OUT_SOFT);
      }
    }
  }
  furTufts(g, 0.26, 13);
  outlinePass(g, { groundY: GROUND });
  return g;
}

/** 只保留与另一区域相交的部分。盘尾不能越出身体轮廓。 */
function clipRegion(inner: Region, outer: Region): Region {
  return {
    contains(x, y) {
      return inner.contains(x, y) && outer.contains(x, y);
    },
    normal(x, y) {
      return inner.normal(x, y);
    },
  };
}

// ---------------------------------------------------------------- 头与五官

function drawHead(): PGrid {
  const g = new PGrid(W, H);
  const skull = ellipse(97, 47, 19, 17);
  const cheekL = ellipse(81, 54, 5, 4.5);
  const cheekR = ellipse(113, 54, 5, 4.5);
  const muzzle = ellipse(100, 56, 7.5, 5.5);
  const face = union(skull, cheekL, cheekR);
  fillRegion(
    g,
    face,
    (b, x, y) => (muzzle.contains(x, y) ? bellyBand(b + 0.25) : coatBand(b)),
    5,
  );
  // 鼻头。
  g.set(99, 52, ID.NOSE, 0.5);
  g.set(100, 52, ID.NOSE, 0.5);
  g.set(101, 52, ID.NOSE, 0.5);
  g.set(100, 53, ID.NOSE, 0.4);
  // 胡须点（亮色小簇，读成毛流而不是逐根胡须）。
  g.set(85, 55, ID.B2, 0.5);
  g.set(84, 58, ID.B2, 0.5);
  g.set(112, 55, ID.B2, 0.5);
  g.set(113, 58, ID.B2, 0.5);
  furTufts(g, 0.3, 14);
  outlinePass(g);
  return g;
}

function drawEarBack(): PGrid {
  const g = new PGrid(W, H);
  fillRegion(g, triangle(80, 37, 92, 33, 83, 21), coatPick, 6);
  outlinePass(g);
  return g;
}

function drawEarFront(): PGrid {
  const g = new PGrid(W, H);
  const outer = triangle(101, 33, 114, 37, 110, 21);
  const inner = triangle(105, 33, 111, 35, 109, 26);
  fillRegion(g, outer, (b, x, y) => (inner.contains(x, y) ? ID.NOSE : coatBand(b)), 7);
  outlinePass(g);
  return g;
}

function drawEyes(state: 'open' | 'half' | 'closed'): PGrid {
  const g = new PGrid(W, H);
  const eye = (cx: number, cy: number): void => {
    if (state === 'open') {
      // 上睫毛
      g.set(cx, cy - 3, ID.OUT_DARK);
      g.set(cx + 1, cy - 3, ID.OUT_DARK);
      // 虹膜块 + 瞳孔 + 高光
      g.set(cx - 1, cy - 2, ID.IRIS_L);
      g.set(cx, cy - 2, ID.IRIS_L);
      g.set(cx + 1, cy - 2, ID.IRIS_L);
      g.set(cx - 2, cy - 1, ID.IRIS_L);
      g.set(cx - 1, cy - 1, ID.PUPIL);
      g.set(cx, cy - 1, ID.PUPIL);
      g.set(cx + 1, cy - 1, ID.GLINT);
      g.set(cx + 2, cy - 1, ID.IRIS_L);
      g.set(cx - 2, cy, ID.IRIS_D);
      g.set(cx - 1, cy, ID.PUPIL);
      g.set(cx, cy, ID.PUPIL);
      g.set(cx + 1, cy, ID.IRIS_D);
      g.set(cx + 2, cy, ID.IRIS_D);
      g.set(cx - 1, cy + 1, ID.IRIS_D);
      g.set(cx, cy + 1, ID.IRIS_D);
      g.set(cx + 1, cy + 1, ID.IRIS_D);
    } else if (state === 'half') {
      g.set(cx - 2, cy, ID.OUT_DARK);
      g.set(cx - 1, cy - 1, ID.OUT_DARK);
      g.set(cx, cy - 1, ID.OUT_DARK);
      g.set(cx + 1, cy - 1, ID.OUT_DARK);
      g.set(cx + 2, cy, ID.OUT_DARK);
      g.set(cx - 1, cy, ID.IRIS_D);
      g.set(cx, cy, ID.PUPIL);
      g.set(cx + 1, cy, ID.IRIS_D);
    } else {
      // 闭眼：向下的弧线，睡相要甜。
      g.set(cx - 2, cy - 1, ID.OUT_DARK);
      g.set(cx - 1, cy, ID.OUT_DARK);
      g.set(cx, cy, ID.OUT_DARK);
      g.set(cx + 1, cy, ID.OUT_DARK);
      g.set(cx + 2, cy - 1, ID.OUT_DARK);
    }
  };
  eye(88, 48);
  eye(103, 48);
  return g;
}

function drawMouth(state: 'idle' | 'open'): PGrid {
  const g = new PGrid(W, H);
  if (state === 'idle') {
    g.set(100, 54, ID.MOUTH);
    g.set(98, 55, ID.MOUTH);
    g.set(99, 56, ID.MOUTH);
    g.set(101, 56, ID.MOUTH);
    g.set(102, 55, ID.MOUTH);
  } else {
    g.set(100, 54, ID.MOUTH);
    g.set(99, 55, ID.MOUTH);
    g.set(100, 55, ID.MOUTH);
    g.set(101, 55, ID.MOUTH);
    g.set(99, 56, ID.MOUTH);
    g.set(100, 56, ID.MOUTH);
    g.set(101, 56, ID.MOUTH);
    g.set(100, 57, ID.NOSE);
  }
  return g;
}

// ---------------------------------------------------------------- 尾巴

/** 三次贝塞尔采样成圆片管，返回网格与每像素的曲线参数（花纹环用）。 */
function tubeAlong(
  pts: readonly (readonly [number, number])[],
  r0: number,
  r1: number,
): Region & { paramAt(x: number, y: number): number } {
  const [p0, p1, p2, p3] = pts as readonly [
    readonly [number, number],
    readonly [number, number],
    readonly [number, number],
    readonly [number, number],
  ];
  const at = (t: number): readonly [number, number] => {
    const u = 1 - t;
    return [
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ];
  };
  const N = 96;
  const centers: (readonly [number, number, number, number])[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const [x, y] = at(t);
    centers.push([x, y, r0 + (r1 - r0) * t, t]);
  }
  const nearest = (x: number, y: number): { d2: number; r: number; t: number; cx: number; cy: number } => {
    let best = { d2: Infinity, r: 0, t: 0, cx: 0, cy: 0 };
    for (const [cx, cy, r, t] of centers) {
      const d2 = (x - cx) ** 2 + (y - cy) ** 2;
      if (d2 - r * r < best.d2 - best.r * best.r) best = { d2, r, t, cx, cy };
    }
    return best;
  };
  return {
    contains(x, y) {
      const n = nearest(x, y);
      return n.d2 <= n.r * n.r;
    },
    normal(x, y) {
      const n = nearest(x, y);
      return [(x - n.cx) / (n.r || 1), (y - n.cy) / (n.r || 1)];
    },
    paramAt(x, y) {
      return nearest(x, y).t;
    },
  };
}

const TAIL_STAND = tubeAlong(
  [
    [46, 71],
    [22, 64],
    [14, 38],
    [28, 25],
  ],
  3.6,
  2.8,
);

const TAIL_SIT = tubeAlong(
  [
    [47, 87],
    [50, 100],
    [66, 103],
    [80, 98],
  ],
  3.4,
  2.5,
);

function drawTail(which: 'stand' | 'sit'): PGrid {
  const g = new PGrid(W, H);
  const tube = which === 'stand' ? TAIL_STAND : TAIL_SIT;
  fillRegion(g, tube, coatPick, 8);
  furTufts(g, 0.24, 15);
  outlinePass(g, which === 'sit' ? { groundY: GROUND } : {});
  return g;
}

// ---------------------------------------------------------------- 腿

export type LegVariant = 'stand' | 'fwd' | 'back' | 'dangle';

interface LegSpec {
  hipX: number;
  hipY: number;
  far: boolean;
}

function drawLeg(spec: LegSpec, variant: LegVariant): PGrid {
  const g = new PGrid(W, H);
  const { hipX, hipY, far } = spec;
  const ground = far ? GROUND - 1 : GROUND;
  const rTop = far ? 3.9 : 4.3;
  const rBot = far ? 3.2 : 3.6;
  const rPaw = far ? 2.7 : 3.0;
  const pawY = ground - rPaw + 0.5;
  let leg: Region;
  if (variant === 'stand') {
    leg = union(
      capsule(hipX, hipY, rTop, hipX, ground - 4, rBot),
      capsule(hipX + 0.5, pawY, rPaw, hipX + 3.6, pawY, rPaw - 0.1),
    );
  } else if (variant === 'fwd') {
    leg = union(
      capsule(hipX, hipY, rTop, hipX + 5, ground - 4, rBot),
      capsule(hipX + 5.5, pawY, rPaw, hipX + 8.6, pawY, rPaw - 0.1),
    );
  } else if (variant === 'back') {
    leg = union(
      capsule(hipX, hipY, rTop, hipX - 5, ground - 4, rBot),
      capsule(hipX - 4.5, pawY, rPaw, hipX - 1.4, pawY, rPaw - 0.1),
    );
  } else {
    // dangle：悬空下垂，爪子放松微收。
    leg = union(
      capsule(hipX, hipY, rTop, hipX - 1, ground - 2, rBot - 0.2),
      capsule(hipX - 1, ground - 1.6, rPaw - 0.2, hipX + 0.8, ground - 1.6, rPaw - 0.3),
    );
  }
  const brightPick: BandPicker = (b) => coatBand(b + 0.3);
  const brightFarPick: BandPicker = (b) => {
    const id = coatBand(b + 0.3);
    return id > ID.C0 ? id - 1 : id;
  };
  fillRegion(g, leg, far ? brightFarPick : brightPick, spec.hipX * 3 + (far ? 1 : 0));
  outlinePass(g, variant === 'dangle' ? {} : { groundY: ground });
  // 脚趾分离线：爪底前端一个暗色缺口。
  if (variant !== 'dangle') {
    const toeX = variant === 'fwd' ? hipX + 6 : variant === 'back' ? hipX - 3 : hipX + 1;
    g.set(toeX, ground, ID.OUT_DARK);
  }
  return g;
}

// ---------------------------------------------------------------- 道具

function drawBowl(): PGrid {
  const g = new PGrid(W, H);
  const body = ellipse(124, 97, 10, 4.5);
  fillRegion(g, body, (b) => (b > 0.2 ? ID.PROP0 : b > -0.45 ? ID.PROP1 : ID.PROP2), 9);
  const food = ellipse(124, 92.5, 6, 2.2);
  fillRegion(g, food, () => ID.FOOD, 10);
  outlinePass(g, { groundY: GROUND });
  return g;
}

// ---------------------------------------------------------------- 花纹 mask

type MaskFn = (x: number, y: number, g: PGrid) => boolean;

function buildMask(g: PGrid, fn: MaskFn): Uint8Array {
  const m = new Uint8Array(g.w * g.h);
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      if (g.get(x, y) !== 0 && fn(x, y, g)) m[y * g.w + x] = 1;
    }
  }
  return m;
}

/** 虎斑：沿背线的斜条纹，边缘用哈希咬一口，不要机械直线。 */
const tabbyStripes = (x: number, y: number): boolean => {
  const k = (x * 0.62 + (y - 36) * 1.0 + hash2(x, y, 31) * 1.6) % 9;
  return (k + 9) % 9 < 3;
};

const MASKS: Record<string, Partial<Record<'tabby' | 'cow' | 'point', MaskFn>>> = {
  'body-stand': {
    tabby: (x, y) => y < 79 && tabbyStripes(x, y),
    cow: (x, y) =>
      ellipse(60, 64, 11, 8.5).contains(x, y) || ellipse(88, 80, 6.5, 5.5).contains(x, y),
  },
  'body-sit': {
    tabby: (x, y) => y < 84 && x < 80 && tabbyStripes(x, y),
    cow: (x, y) =>
      ellipse(56, 74, 11, 9).contains(x, y) || ellipse(72, 92, 6, 5).contains(x, y),
  },
  'body-curl0': {
    tabby: (x, y) => y < 92 && tabbyStripes(x, y),
    cow: (x, y) =>
      ellipse(58, 80, 11, 7).contains(x, y) || ellipse(86, 92, 6, 5).contains(x, y),
  },
  'body-curl1': {
    tabby: (x, y) => y < 92 && tabbyStripes(x, y),
    cow: (x, y) =>
      ellipse(58, 79, 11, 7).contains(x, y) || ellipse(86, 92, 6, 5).contains(x, y),
  },
  head: {
    // 额头三道短纹（经典 M），不越过眼线。
    tabby: (x, y) =>
      y >= 31 && y <= 41 && ((x >= 91 && x <= 93) || (x >= 96 && x <= 98) || (x >= 101 && x <= 103)),
    cow: (x, y) => ellipse(109, 39, 9.5, 12).contains(x, y),
    point: (x, y) => ellipse(100, 55, 9, 7).contains(x, y),
  },
  'ear-back': { point: () => true },
  'ear-front': { cow: () => true, point: () => true },
  'tail-stand': {
    tabby: (x, y) => {
      const t = TAIL_STAND.paramAt(x, y);
      return (t > 0.3 && t < 0.42) || (t > 0.55 && t < 0.66) || (t > 0.78 && t < 0.87) || t > 0.95;
    },
    cow: (x, y) => TAIL_STAND.paramAt(x, y) > 0.72,
    point: () => true,
  },
  'tail-sit': {
    tabby: (x, y) => {
      const t = TAIL_SIT.paramAt(x, y);
      return (t > 0.3 && t < 0.42) || (t > 0.55 && t < 0.66) || (t > 0.78 && t < 0.87) || t > 0.95;
    },
    cow: (x, y) => TAIL_SIT.paramAt(x, y) > 0.72,
    point: () => true,
  },
};

/** 腿的重点色袜子：靠近地面的部分。 */
const sockMask: MaskFn = (_x, y) => y >= 93;

// ---------------------------------------------------------------- 装配与输出

interface PartOut {
  id: string;
  parent: string | null;
  pivot: readonly [number, number];
  z: number;
  images: Record<string, string>;
}

function main(): void {
  mkdirSync(OUT, { recursive: true });

  const grids = new Map<string, PGrid>();
  const put = (name: string, g: PGrid): void => {
    grids.set(name, g);
  };

  put('body-stand', drawBodyStand());
  put('body-sit', drawBodySit());
  put('body-curl0', drawBodyCurl(0));
  put('body-curl1', drawBodyCurl(1));
  put('head', drawHead());
  put('ear-back', drawEarBack());
  put('ear-front', drawEarFront());
  put('eyes-open', drawEyes('open'));
  put('eyes-half', drawEyes('half'));
  put('eyes-closed', drawEyes('closed'));
  put('mouth-idle', drawMouth('idle'));
  put('mouth-open', drawMouth('open'));
  put('tail-stand', drawTail('stand'));
  put('tail-sit', drawTail('sit'));
  put('bowl', drawBowl());

  const legSpecs: Record<string, LegSpec> = {
    'leg-near-front': { hipX: 82, hipY: 79, far: false },
    'leg-near-back': { hipX: 60, hipY: 79, far: false },
    'leg-far-front': { hipX: 77, hipY: 78, far: true },
    'leg-far-back': { hipX: 55, hipY: 78, far: true },
  };
  const legVariants: LegVariant[] = ['stand', 'fwd', 'back', 'dangle'];
  for (const [slot, spec] of Object.entries(legSpecs)) {
    for (const v of legVariants) {
      put(`${slot}-${v}`, drawLeg(spec, v));
    }
  }

  // 部件树（父先于子）。z 只控制绘制次序，与层级无关。
  const parts: PartOut[] = [
    {
      id: 'body',
      parent: null,
      pivot: [70, 80],
      z: 2,
      images: {
        stand: 'body-stand.png',
        sit: 'body-sit.png',
        curl0: 'body-curl0.png',
        curl1: 'body-curl1.png',
      },
    },
    { id: 'tail', parent: 'body', pivot: [46, 71], z: 0, images: { stand: 'tail-stand.png', sit: 'tail-sit.png' } },
    { id: 'head', parent: 'body', pivot: [92, 60], z: 4, images: { base: 'head.png' } },
    { id: 'ear-back', parent: 'head', pivot: [86, 34], z: 5, images: { base: 'ear-back.png' } },
    { id: 'ear-front', parent: 'head', pivot: [107, 34], z: 5, images: { base: 'ear-front.png' } },
    {
      id: 'eyes',
      parent: 'head',
      pivot: [95, 48],
      z: 6,
      images: { open: 'eyes-open.png', half: 'eyes-half.png', closed: 'eyes-closed.png' },
    },
    { id: 'mouth', parent: 'head', pivot: [100, 55], z: 6, images: { idle: 'mouth-idle.png', open: 'mouth-open.png' } },
    { id: 'bowl', parent: null, pivot: [124, 98], z: 8, images: { base: 'bowl.png' } },
  ];
  const legZ: Record<string, number> = {
    'leg-near-front': 3,
    'leg-near-back': 3,
    'leg-far-front': 1,
    'leg-far-back': 1,
  };
  for (const [slot, spec] of Object.entries(legSpecs)) {
    parts.push({
      id: slot,
      parent: null,
      pivot: [spec.hipX, spec.hipY],
      z: legZ[slot]!,
      images: Object.fromEntries(legVariants.map((v) => [v, `${slot}-${v}.png`])),
    });
  }

  // 写部件 PNG。
  for (const [name, g] of grids) {
    writeFileSync(resolve(OUT, `${name}.png`), encodePng(toRGBA(g), W, H));
  }

  // 写 mask PNG。
  const maskIndex: Record<string, Record<string, string>> = {};
  const addMask = (image: string, key: string, fn: MaskFn): void => {
    const g = grids.get(image);
    if (!g) throw new Error(`mask 指向不存在的部件图: ${image}`);
    const file = `${image}.mask-${key}.png`;
    writeFileSync(resolve(OUT, file), encodePng(maskToRGBA(buildMask(g, fn), W, H), W, H));
    (maskIndex[`${image}.png`] ??= {})[key] = file;
  };
  for (const [image, byKey] of Object.entries(MASKS)) {
    for (const [key, fn] of Object.entries(byKey)) {
      if (fn) addMask(image, key, fn);
    }
  }
  for (const slot of Object.keys(legSpecs)) {
    for (const v of legVariants) {
      addMask(`${slot}-${v}`, 'point', sockMask);
    }
  }

  const doc = {
    canvas: { w: W, h: H, ground: GROUND },
    parts,
    masks: maskIndex,
  };
  writeFileSync(resolve(OUT, 'parts.json'), `${JSON.stringify(doc, null, 2)}\n`);
  writeFileSync(
    resolve(OUT, '../parts-data.ts'),
    '/** 由 tools/proto-b/make-parts.ts 生成，勿手改。规范来源是同目录 assets/parts.json。 */\n' +
      'import type { PartsDoc } from \'./types.js\';\n\n' +
      `export const PARTS_DOC: PartsDoc = ${JSON.stringify(doc, null, 2)} as const;\n`,
  );

  console.log(`已生成 ${grids.size} 张部件图 + ${Object.values(maskIndex).reduce((n, m) => n + Object.keys(m).length, 0)} 张 mask → ${OUT}`);

  if (PREVIEW) writePreview(grids, PREVIEW);
}

/** 拼一张装配预览（规范配色，站/坐/卧三姿态），供生成端快速目检。 */
function writePreview(grids: Map<string, PGrid>, outFile: string): void {
  const poses: Record<string, string[]> = {
    stand: [
      'tail-stand',
      'leg-far-front-stand',
      'leg-far-back-stand',
      'body-stand',
      'leg-near-front-stand',
      'leg-near-back-stand',
      'head',
      'ear-back',
      'ear-front',
      'eyes-open',
      'mouth-idle',
    ],
    sit: ['tail-sit', 'body-sit', 'head', 'ear-back', 'ear-front', 'eyes-open', 'mouth-idle'],
    curl: ['body-curl0', 'head', 'ear-back', 'ear-front', 'eyes-closed'],
  };
  const cols = Object.keys(poses).length;
  const sheet = new Uint8ClampedArray(W * cols * H * 4);
  let col = 0;
  for (const layers of Object.values(poses)) {
    for (const name of layers) {
      const g = grids.get(name);
      if (!g) throw new Error(`预览缺部件: ${name}`);
      const rgba = toRGBA(g);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const si = (y * W + x) * 4;
          if (rgba[si + 3] === 0) continue;
          const di = (y * W * cols + col * W + x) * 4;
          sheet[di] = rgba[si]!;
          sheet[di + 1] = rgba[si + 1]!;
          sheet[di + 2] = rgba[si + 2]!;
          sheet[di + 3] = 255;
        }
      }
    }
    col++;
  }
  writeFileSync(outFile, encodePng(sheet, W * cols, H, 3));
  console.log(`预览已写入 ${outFile}`);
}

main();
