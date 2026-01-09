import { z } from 'zod';
import { ITEM_CATALOG } from './item_catalog.js';
import type { ItemType } from './types.js';

// 地图配置 schema
export const MAP_CONFIG_SCHEMA = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
  seed: z.number().int(),
  extractZone: z.object({
    x: z.number().nonnegative(),
    y: z.number().nonnegative(),
    w: z.number().positive(),
    h: z.number().positive(),
  }),
  // 新增: 地图区域（用于不同地面材质等）
  zones: z.array(z.object({
    id: z.string().min(1),
    name: z.string().optional(),
    x: z.number().nonnegative(),
    y: z.number().nonnegative(),
    w: z.number().positive(),
    h: z.number().positive(),
    type: z.string().default('generic'), // grass, wood, tile, concrete, puddle
    description: z.string().optional(),
    renderingProps: z.any().optional(), // 额外的渲染属性
  })).optional().default([]),
});

export type MAP_CONFIG = z.infer<typeof MAP_CONFIG_SCHEMA>;
export type Zone = NonNullable<MAP_CONFIG['zones']>[number];

// 新增: POI (Point of Interest) 定义
// moved here to avoid circular deps if needed, but currently keeping POI in mapTemplate is fine if MAP_CONFIG doesn't use it.
// Actually POI is also map data. Let's move it here too? No, existing code puts it in Template.
// But Zone is needed in Config because Config is what Client receives (often).
// Server sends Config to Client.
// MapTemplate is Server-side asset.


// 默认地图配置（Day1占位）
export const DEFAULT_MAP_CONFIG: MAP_CONFIG = {
  width: 2000,
  height: 2000,
  seed: 12345, // Day1固定seed，后续由server生成
  extractZone: {
    x: 1800, // Day3: 地图右下角，200x200区域
    y: 1800,
    w: 200,
    h: 200,
  },
  zones: [], // 初始化为空
};

// 物品类型配置（Day1占位，已废弃，保留用于兼容）
export const ITEM_TYPE_SCHEMA = z.object({
  id: z.string(),
  name: z.string(),
  rarity: z.enum(['common', 'rare', 'epic', 'legendary']),
});

export type ITEM_TYPE = z.infer<typeof ITEM_TYPE_SCHEMA>;

// 默认物品类型（已废弃，现在统一使用 ITEM_CATALOG）
export const DEFAULT_ITEM_TYPES: ITEM_TYPE[] = [
  { id: 'medkit', name: '医疗包', rarity: 'common' },

];

// 内容加载器（Day1只返回默认内容）
export function loadMapConfig(seed?: number): MAP_CONFIG {
  return {
    ...DEFAULT_MAP_CONFIG,
    seed: seed ?? DEFAULT_MAP_CONFIG.seed,
    // extractZone 使用默认值（已在 DEFAULT_MAP_CONFIG 中定义）
  };
}

/**
 * 加载所有物品类型（统一从 ITEM_CATALOG 读取）
 * 确保掉落系统能获取到所有物品（包括背包/护甲/武器/材料/消耗品）
 */
export function loadItemTypes(): ItemType[] {
  return Object.values(ITEM_CATALOG);
}

