import { BREEDS } from '../render/index.js';
import type { Cat } from '../render/index.js';
import { TRAIT_HIGH, TRAIT_LOW } from './constants.js';

/**
 * 把一只猫说给用户听。
 *
 * 验收项要求「展示品种、外观与性格标签，用户能据此判断是否留下」。外观自己就在
 * 画面上，所以这里只负责**品种**与**性格**的措辞。
 *
 * 三档而不是百分比：「活跃度 68%」是参数面板的语言，用户判断「要不要留下它」
 * 靠的是「一刻不停」这样的印象。数值留给托盘里的状态详情。
 *
 * 纯函数、无 DOM，因此「同品种不同 Seed 的性格明显不同」可以直接断言
 * （见 test/adopt/individuality.test.ts）。
 */

export interface CatIntro {
  /** 品种名，如「布偶猫」。 */
  readonly breed: string;
  /** 品种的骨架特征，如「毛领大 · 尾巴蓬松」。 */
  readonly shape: string;
  /** 三个性格标签：活跃度、粘人度、贪吃度各一个。 */
  readonly traits: readonly [string, string, string];
}

/**
 * 三档措辞。
 *
 * 每一组都从「几乎没有」说到「很强烈」，中间那档故意写得像一句评价而不是
 * 「中等」 - 用户看到「中等」会去找滑块，看到「不紧不慢」会去看猫。
 */
const ACTIVE = ['懒得动弹', '不紧不慢', '一刻不停'] as const;
const CLINGY = ['独来独往', '偶尔来蹭', '离不开人'] as const;
const GREEDY = ['吃得挑剔', '有饭就吃', '闻见就冲'] as const;

function band(v: number, words: readonly [string, string, string]): string {
  if (v < TRAIT_LOW) return words[0];
  if (v < TRAIT_HIGH) return words[1];
  return words[2];
}

export function introOf(cat: Cat): CatIntro {
  const def = BREEDS[cat.breed];
  const p = cat.personality;
  return {
    breed: def.label,
    shape: def.desc,
    traits: [band(p.active, ACTIVE), band(p.clingy, CLINGY), band(p.greedy, GREEDY)],
  };
}
