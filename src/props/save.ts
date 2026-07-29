import { PROPS_SAVE_VERSION } from './constants.js';
import { PROP_KINDS } from './types.js';
import type { PropKind, PropPlacement, PropsState } from './types.js';

/**
 * 挂件摆放的序列化与解析。
 *
 * **为什么单独一份存档，不塞进 world.json。** 摆放是屏幕坐标，而世界层必须平台
 * 无关、可回放（ADR 0001）- 把屏幕坐标塞进 World 就等于让同一份存档在不同分辨率
 * 的机器上演化出不同的猫。另一头也说得通：挂件摆放是**用户桌面的布置**，
 * 换一只猫也不该重新摆一遍家具，它的生命周期比 World 长。
 *
 * 与 world/save.ts 同一条纪律：解析是系统边界，必须逐字段验证。宁可可见地失败、
 * 退回默认摆放，也不要带着一个 NaN 坐标去调窗口移动 - 那会让挂件消失在某个
 * 算不出来的位置上，用户既看不见也拖不回来。
 */

export class PropsSaveError extends Error {
  constructor(message: string) {
    super(`挂件摆放存档无效：${message}`);
    this.name = 'PropsSaveError';
  }
}

export function serializeProps(state: PropsState): string {
  return JSON.stringify({
    version: PROPS_SAVE_VERSION,
    bowl: state.bowl,
    bed: state.bed,
  });
}

function num(source: Record<string, unknown>, key: string, where: string): number {
  const v = source[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new PropsSaveError(`${where}.${key} 应为有限数值，实际为 ${JSON.stringify(v)}`);
  }
  return v;
}

function placement(raw: unknown, kind: PropKind): PropPlacement {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new PropsSaveError(`${kind} 应为对象`);
  }
  const p = raw as Record<string, unknown>;
  const visible = p['visible'];
  if (typeof visible !== 'boolean') {
    throw new PropsSaveError(`${kind}.visible 应为布尔值，实际为 ${JSON.stringify(visible)}`);
  }
  // 逐字段重建：多余字段被丢掉，缺失字段当场炸。
  return { x: num(p, 'x', kind), y: num(p, 'y', kind), visible };
}

/**
 * 解析摆放存档。校验失败抛 PropsSaveError，由调用方决定退回默认摆放。
 *
 * 版本不一致直接拒绝，不做迁移：挂件摆放丢了的代价只是「家具回到默认位置」，
 * 为它写迁移代码不值得，而一份迁移错的坐标比重摆一次难查得多。
 */
export function parseProps(text: string): PropsState {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new PropsSaveError(`不是合法 JSON（${String(err)}）`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new PropsSaveError('顶层应为对象');
  }
  const w = raw as Record<string, unknown>;
  const version = num(w, 'version', '顶层');
  if (version !== PROPS_SAVE_VERSION) {
    throw new PropsSaveError(`版本 ${version} 与当前 ${PROPS_SAVE_VERSION} 不一致`);
  }
  const out: Record<string, PropPlacement> = {};
  for (const kind of PROP_KINDS) out[kind] = placement(w[kind], kind);
  return out as PropsState;
}
