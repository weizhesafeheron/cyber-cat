/**
 * 色带映射（换色）与花纹叠加。纯函数，输入输出都是 RGBA 像素数组。
 *
 * 规则（见 docs/research/2026-07-31-layered-parts-pipeline/report.md 第二节）：
 * - 填充带 / 腹白带整条映射：暗档 → 暗档，亮档 → 亮档，光影档位不变。
 * - 暗描边（OUT_DARK）不映射；软描边（OUT_SOFT）映射到目标配色的 outSoft。
 * - 花纹 = mask 命中 且 像素属于允许色带 → 替换为花纹色带中同亮度档位的颜色。
 *   描边、眼睛不在允许集合里，天然免疫。
 */
import { CANON, ID, type Colorway, type PatternBand } from './palette.js';

export function parseHex(hex: string): number {
  const h = hex.replace('#', '');
  return ((parseInt(h.slice(0, 2), 16) << 16) |
    (parseInt(h.slice(2, 4), 16) << 8) |
    parseInt(h.slice(4, 6), 16)) >>> 0;
}

const pack = (r: number, g: number, b: number): number => ((r << 16) | (g << 8) | b) >>> 0;

/** 规范 packed RGB → 语义 ID。运行时识别像素属于哪条色带。 */
const CANON_TO_ID: ReadonlyMap<number, number> = (() => {
  const m = new Map<number, number>();
  for (const [id, hex] of Object.entries(CANON)) m.set(parseHex(hex), Number(id));
  return m;
})();

/** coat 带的 ID 顺序，索引即亮度档位。 */
const COAT_IDS = [ID.C0, ID.C1, ID.C2, ID.C3] as const;
const BELLY_IDS = [ID.B0, ID.B1, ID.B2] as const;

/** 腹白带只有三档，花纹带四档：按相对亮度对位（0→0, 1→1, 2→3）。 */
const BELLY_TO_PATTERN_STEP = [0, 1, 3] as const;

interface RemapTable {
  /** packed 规范色 → packed 目标色。 */
  plain: ReadonlyMap<number, number>;
  /** packed 规范色 → packed 花纹色（仅允许带内的 ID 有条目）。 */
  pattern: ReadonlyMap<number, number>;
}

const tableCache = new Map<string, RemapTable>();

export function buildRemapTable(cw: Colorway): RemapTable {
  const cached = tableCache.get(cw.key);
  if (cached) return cached;

  const plain = new Map<number, number>();
  const put = (id: number, hex: string): void => {
    plain.set(parseHex(CANON[id]!), parseHex(hex));
  };
  COAT_IDS.forEach((id, i) => put(id, cw.coat[i]!));
  BELLY_IDS.forEach((id, i) => put(id, cw.belly[i]!));
  put(ID.OUT_SOFT, cw.outSoft);
  put(ID.NOSE, cw.nose);
  put(ID.IRIS_L, cw.iris[0]);
  put(ID.IRIS_D, cw.iris[1]);
  // OUT_DARK / PUPIL / GLINT / MOUTH / 道具带：不映射。

  const pattern = new Map<number, number>();
  if (cw.pattern) {
    const bands = new Set<PatternBand>(cw.pattern.bands);
    if (bands.has('coat')) {
      COAT_IDS.forEach((id, i) => {
        pattern.set(parseHex(CANON[id]!), parseHex(cw.pattern!.ramp[i]!));
      });
    }
    if (bands.has('belly')) {
      BELLY_IDS.forEach((id, i) => {
        pattern.set(
          parseHex(CANON[id]!),
          parseHex(cw.pattern!.ramp[BELLY_TO_PATTERN_STEP[i]!]!),
        );
      });
    }
  }

  const table: RemapTable = { plain, pattern };
  tableCache.set(cw.key, table);
  return table;
}

/**
 * 对一张部件位图做换色 + 花纹叠加。返回新数组，不改输入。
 *
 * @param rgba 部件像素（规范调色板绘制）
 * @param mask 与部件同尺寸的花纹 mask（alpha > 127 算命中），无花纹传 null
 */
export function remapPixels(
  rgba: Uint8ClampedArray,
  mask: Uint8ClampedArray | null,
  cw: Colorway,
): Uint8ClampedArray {
  const { plain, pattern } = buildRemapTable(cw);
  const out = new Uint8ClampedArray(rgba.length);
  const usePattern = cw.pattern != null && mask != null;
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3]!;
    if (a === 0) continue;
    const key = pack(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!);
    let target: number | undefined;
    if (usePattern && mask![i + 3]! > 127) target = pattern.get(key);
    if (target === undefined) target = plain.get(key);
    if (target === undefined) {
      // 不认识的颜色原样保留（瞳孔、高光、道具等固定色）。
      out[i] = rgba[i]!;
      out[i + 1] = rgba[i + 1]!;
      out[i + 2] = rgba[i + 2]!;
    } else {
      out[i] = (target >> 16) & 0xff;
      out[i + 1] = (target >> 8) & 0xff;
      out[i + 2] = target & 0xff;
    }
    out[i + 3] = a;
  }
  return out;
}

/** 像素是否属于可识别的规范色（构建脚本的「非法色检查」用）。 */
export function isCanonColor(r: number, g: number, b: number): boolean {
  return CANON_TO_ID.has(pack(r, g, b));
}

export function idOfPixel(r: number, g: number, b: number): number | undefined {
  return CANON_TO_ID.get(pack(r, g, b));
}
