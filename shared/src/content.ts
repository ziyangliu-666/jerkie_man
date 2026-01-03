import { z } from 'zod';

// 地图配置 schema
export const MAP_CONFIG_SCHEMA = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
  seed: z.number().int(),
});

export type MAP_CONFIG = z.infer<typeof MAP_CONFIG_SCHEMA>;

// 默认地图配置（Day1占位）
export const DEFAULT_MAP_CONFIG: MAP_CONFIG = {
  width: 2000,
  height: 2000,
  seed: 12345, // Day1固定seed，后续由server生成
};

// 物品类型配置（Day1占位）
export const ITEM_TYPE_SCHEMA = z.object({
  id: z.string(),
  name: z.string(),
  rarity: z.enum(['common', 'rare', 'epic', 'legendary']),
});

export type ITEM_TYPE = z.infer<typeof ITEM_TYPE_SCHEMA>;

// 默认物品类型（Day1占位，后续从JSON加载）
export const DEFAULT_ITEM_TYPES: ITEM_TYPE[] = [
  { id: 'medkit', name: '医疗包', rarity: 'common' },
  { id: 'ammo', name: '弹药', rarity: 'common' },
];

// 内容加载器（Day1只返回默认内容）
export function loadMapConfig(seed?: number): MAP_CONFIG {
  return {
    ...DEFAULT_MAP_CONFIG,
    seed: seed ?? DEFAULT_MAP_CONFIG.seed,
  };
}

export function loadItemTypes(): ITEM_TYPE[] {
  return DEFAULT_ITEM_TYPES;
}

