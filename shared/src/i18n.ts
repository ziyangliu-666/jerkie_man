/**
 * 国际化支持（目前仅中文）
 * 负责将内部枚举值转换为显示文字
 */
import type { Rarity } from './types.js';

export const RARITY_ZH: Record<Rarity, string> = {
  COMMON: '普通',
  RARE: '稀有',
  QUEST: '任务',
};

/**
 * 将稀有度枚举转换为中文显示文字
 * @param r 稀有度枚举值
 * @returns 中文显示文字
 */
export function rarityToZh(r: Rarity): string {
  return RARITY_ZH[r] ?? String(r);
}


