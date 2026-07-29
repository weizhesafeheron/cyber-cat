import { BREEDS } from '../render/index.js';
import type { BreedKey } from '../render/index.js';
import { SEED_SPACE } from './constants.js';
import { normalizeName } from './name.js';

/**
 * 领养窗口与宠物窗口之间的握手。
 *
 * 两个窗口是两个 webview，各自独立的 JS 世界，中间只有一条事件通道。
 * 于是这里同时是**协议定义**与**系统边界**：
 * 载荷会紧接着交给 createWorld 写进存档，一个坏掉的 Seed（NaN、小数、字符串）
 * 会变成一只无法重建的猫 - makeCat 照着 NaN 生成一团东西，下次启动读存档时
 * 又生成另一团。宁可在这里可见地失败。
 *
 * 只传「品种 + Seed + 名字」，**不传外观与性格**：那些由 makeCat 从 Seed 完整
 * 重建（ADR 0002）。传过来就有了两份真相，迟早不一致。出生时间由宠物窗口注入 -
 * 世界层不读时钟，取时钟是平台层的事。
 */

/** 领养完成事件。带上前缀避免与将来的其他事件名撞车。 */
export const ADOPTED_EVENT = 'cyber-cat://adopted';

/** 领养窗口交回来的身份三项，加上出生时间就是完整的身份四元组。 */
export interface AdoptedIdentity {
  readonly breed: BreedKey;
  readonly seed: number;
  readonly name: string;
}

export class AdoptionPayloadError extends Error {
  constructor(message: string) {
    super(`领养结果无效：${message}`);
    this.name = 'AdoptionPayloadError';
  }
}

/**
 * 解析跨窗口收到的领养结果。校验失败抛 AdoptionPayloadError。
 *
 * 逐字段重建而不是断言类型：多余字段会被丢掉（不会被顺手写进存档），
 * 缺失字段立刻炸。这与 world/save.ts 解析存档的取法是同一条理由。
 */
export function parseAdopted(raw: unknown): AdoptedIdentity {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new AdoptionPayloadError('载荷应为对象');
  }
  const p = raw as Record<string, unknown>;

  const breed = p['breed'];
  if (typeof breed !== 'string' || !(breed in BREEDS)) {
    throw new AdoptionPayloadError(`未知品种 ${JSON.stringify(breed)}`);
  }

  const seed = p['seed'];
  if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed >= SEED_SPACE) {
    throw new AdoptionPayloadError(`Seed 应为 [0, ${SEED_SPACE}) 内的整数，实际为 ${String(seed)}`);
  }

  const name = p['name'];
  if (typeof name !== 'string') throw new AdoptionPayloadError('名字应为字符串');
  // 复核而不是信任：领养窗口已经规范化过一次，但那是另一个 webview 的承诺。
  const checked = normalizeName(name);
  if (!checked.ok) throw new AdoptionPayloadError(checked.reason);

  return { breed: breed as BreedKey, seed, name: checked.name };
}
