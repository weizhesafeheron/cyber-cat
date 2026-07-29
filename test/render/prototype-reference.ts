import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 加载 prototype 阶段的渲染核心作为参照实现。
 *
 * 这份参照只为**证明端口是行为保真的**而存在，不是长期的回归基准。
 * 一旦 .lavish/cat-core.js 被删除，依赖它的 port-equivalence 测试也应一并删除 -
 * 见 docs/art-and-motion-decisions.md 关于不做像素级黄金图对比的说明。
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PROTOTYPE_PATH = resolve(HERE, '../../.lavish/cat-core.js');

export interface PrototypeCore {
  W: number;
  H: number;
  GROUND: number;
  BREED_KEYS: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  BREEDS: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  makeCat(breed: string, seed: number): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createRenderer(canvas: unknown): { draw(cat: any, pose: any): void };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  makeMicro(seed: number): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stepMicro(m: any, dt: number, opts?: any): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ACTIONS: Record<string, { make(t: number, cat: any, mi: any, opts?: any): any }>;
}

export function loadPrototype(): PrototypeCore {
  const src = readFileSync(PROTOTYPE_PATH, 'utf8');
  const factory = new Function(`${src}\nreturn CatCore;`);
  return factory() as PrototypeCore;
}

/**
 * 最小的 canvas 替身。
 *
 * 原型的 createRenderer 只用到 createImageData 与 putImageData，
 * 这里把 putImageData 的目标数组截获下来供比对。
 */
export function makeCanvasStub(): {
  canvas: unknown;
  read(): Uint8ClampedArray;
} {
  let captured: Uint8ClampedArray | null = null;
  const canvas = {
    width: 0,
    height: 0,
    getContext(): unknown {
      return {
        createImageData(w: number, h: number) {
          return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
        },
        putImageData(img: { data: Uint8ClampedArray }) {
          captured = img.data;
        },
      };
    },
  };
  return {
    canvas,
    read(): Uint8ClampedArray {
      if (!captured) throw new Error('原型渲染器还没有输出任何一帧');
      return captured;
    },
  };
}
