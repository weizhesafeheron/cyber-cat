import type { BreedKey } from './types.js';

/** 参数范围 [最小值, 最大值]，由 Seed 在其间线性采样。 */
type Range = readonly [number, number];

export interface BreedDef {
  key: BreedKey;
  label: string;
  desc: string;
  bodyRW: Range;
  bodyRH: Range;
  headR: Range;
  earH: Range;
  earW: Range;
  tailLen: Range;
  tailThick: Range;
  legLen: Range;
  fluff: number;
  eyeBig: 0 | 1;
  /** 活跃度基线。Seed 在其附近采样，因此同品种也有活跃与懒的个体。 */
  active: number;
  sitW?: number;
  earSet?: number;
  earSpread?: Range;
  earRound?: boolean;
  earDrop?: number;
  eyeLiner?: boolean;
}

/**
 * 七个品种的骨架参数。
 *
 * **品种差异必须做在结构上，不能只靠换色。**
 * 这是 prototype ① 的核心反馈，详见 docs/art-and-motion-decisions.md。
 * 修改任何品种的耳朵参数前请先读那份文档 - 德文与阿比的耳朵是它们唯一的
 * 强辨识点，收敛到同一组值会让两个品种无法分辨。
 */
export const BREEDS: Readonly<Record<BreedKey, BreedDef>> = {
  orange: {
    key: 'orange',
    label: '橘猫',
    desc: '圆 · 懒 · 尾巴粗',
    bodyRW: [12.5, 14],
    bodyRH: [8.6, 10],
    headR: [8.4, 9.2],
    earH: [4, 5],
    earW: [4, 5],
    tailLen: [11, 13],
    tailThick: [3.1, 3.8],
    legLen: [4, 5],
    fluff: 0.12,
    eyeBig: 0,
    active: 0.25,
  },
  black: {
    key: 'black',
    label: '黑猫',
    desc: '轮廓细长 · 眼睛明显',
    bodyRW: [11.5, 13],
    bodyRH: [6.6, 7.6],
    headR: [7.6, 8.3],
    earH: [5, 6.4],
    earW: [4, 4.6],
    tailLen: [13, 15],
    tailThick: [2.1, 2.6],
    legLen: [6, 7],
    fluff: 0,
    eyeBig: 1,
    active: 0.55,
    sitW: 0.6,
  },
  cow: {
    key: 'cow',
    label: '奶牛猫',
    desc: '花纹不规则 · 动作活跃',
    bodyRW: [11.5, 13.5],
    bodyRH: [7.4, 8.6],
    headR: [7.9, 8.7],
    earH: [4.4, 5.6],
    earW: [4.2, 5],
    tailLen: [11, 14],
    tailThick: [2.4, 3],
    legLen: [5, 6],
    fluff: 0,
    eyeBig: 0,
    active: 0.85,
  },
  ragdoll: {
    key: 'ragdoll',
    label: '布偶猫',
    desc: '毛领大 · 尾巴蓬松',
    bodyRW: [11.5, 14.5],
    bodyRH: [8, 9.8],
    headR: [8, 9.2],
    earH: [4, 4.8],
    earW: [4.2, 4.8],
    tailLen: [11, 14],
    tailThick: [3.2, 5],
    legLen: [4.5, 5.5],
    fluff: 0.55,
    eyeBig: 0,
    active: 0.4,
  },
  devon: {
    key: 'devon',
    label: '德文卷毛',
    desc: '耳朵巨大 · 精灵脸',
    bodyRW: [10, 11.5],
    bodyRH: [5.8, 6.8],
    headR: [7, 7.8],
    // 四个耳朵参数共同构成德文的剪影，缺一个就退化成普通猫：
    // 最宽的耳朵、最大的耳距、整体下移、圆耳尖。
    earH: [7.5, 9],
    earW: [7, 8.2],
    tailLen: [12, 14],
    tailThick: [1.8, 2.2],
    legLen: [5.5, 6.5],
    fluff: 0,
    eyeBig: 1,
    active: 0.8,
    sitW: 0.64,
    earSet: 0.8,
    earSpread: [0.8, 1.6],
    earRound: true,
    earDrop: 2,
  },
  amshort: {
    key: 'amshort',
    label: '美短',
    desc: '银虎斑 · 结实',
    bodyRW: [12.5, 14],
    bodyRH: [8, 9.2],
    headR: [8.4, 9.1],
    earH: [4, 4.8],
    earW: [4.4, 5],
    tailLen: [10, 12],
    tailThick: [2.8, 3.4],
    legLen: [4.5, 5.5],
    fluff: 0,
    eyeBig: 0,
    active: 0.5,
    sitW: 0.78,
  },
  aby: {
    key: 'aby',
    label: '阿比西尼亚',
    desc: '野性优雅 · 渐层毛色',
    bodyRW: [10.5, 12],
    bodyRH: [6.2, 7],
    headR: [7.6, 8.3],
    // 高而外张的尖耳，与德文的低位宽圆耳形成完全不同的剪影。
    earH: [7, 8.2],
    earW: [6, 7],
    tailLen: [13, 15],
    tailThick: [2, 2.5],
    legLen: [6.5, 7.5],
    fluff: 0,
    eyeBig: 1,
    active: 0.75,
    sitW: 0.6,
    earSet: 0.74,
    earSpread: [1.8, 2.8],
    earDrop: 1,
    eyeLiner: true,
  },
};

export const BREED_KEYS = Object.keys(BREEDS) as BreedKey[];
