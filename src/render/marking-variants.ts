import { getBreed } from './breeds.js';
import type { BreedKey, MarkingAdapter, MarkingChoice } from './types.js';

export interface MarkingVariantDef {
  /** 进入存档的稳定 ID；发布后不可改名。 */
  key: string;
  label: string;
}

/**
 * 花纹模板属于适配器，不属于某个写死的品种。新增复用品种会自动得到同一套模板；
 * 真正新增一种花纹语言时，才需要在这里注册新的适配器模板。
 */
export const MARKING_VARIANTS: Readonly<Record<MarkingAdapter, readonly MarkingVariantDef[]>> = {
  tabby: [
    { key: 'mackerel', label: '细虎斑' },
    { key: 'bold', label: '宽虎斑' },
    { key: 'spotted', label: '点状斑' },
  ],
  solid: [
    { key: 'solid', label: '纯色' },
    { key: 'socks', label: '白袜' },
    { key: 'tuxedo', label: '燕尾服' },
  ],
  patches: [
    { key: 'saddle', label: '背鞍斑' },
    { key: 'mask', label: '面罩斑' },
    { key: 'harlequin', label: '大块斑' },
  ],
  'color-point': [
    { key: 'seal', label: '海豹重点色' },
    { key: 'blue', label: '蓝灰重点色' },
    { key: 'chocolate', label: '巧克力重点色' },
  ],
  wavy: [
    { key: 'fine', label: '细卷纹' },
    { key: 'ripple', label: '波浪纹' },
    { key: 'marble', label: '大理石纹' },
  ],
  'classic-tabby': [
    { key: 'bullseye', label: '回旋斑' },
    { key: 'mackerel', label: '鱼骨斑' },
    { key: 'spotted', label: '点状斑' },
  ],
  ticked: [
    { key: 'agouti', label: '细密渐层' },
    { key: 'backline', label: '深色背线' },
    { key: 'speckled', label: '斑点渐层' },
  ],
};

export function markingVariantsFor(breed: BreedKey): readonly MarkingVariantDef[] {
  return MARKING_VARIANTS[getBreed(breed).markingAdapter];
}

export function hasMarkingVariant(breed: BreedKey, variant: string): boolean {
  return markingVariantsFor(breed).some((entry) => entry.key === variant);
}

/** 用 seed 稳定选择模板；调用方负责 seed 的合法范围。 */
export function markingChoiceFor(breed: BreedKey, seed: number): MarkingChoice {
  const variants = markingVariantsFor(breed);
  return { variant: variants[Math.abs(seed) % variants.length]!.key, seed };
}
