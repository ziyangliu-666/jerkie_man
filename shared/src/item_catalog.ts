/**
 * 物品目录（Item Catalog）
 * 数据驱动的物品类型定义，新增道具只需修改此文件
 */
import type { ItemType, Rarity } from './types.js';

export const ITEM_CATALOG: Record<string, ItemType> = {
  // 消耗品
  ammo: {
    id: 'ammo',
    name: '弹药',
    rarity: 'COMMON',
    value: 50,
    stackMax: 60,
  },
  medkit: {
    id: 'medkit',
    name: '急救包',
    rarity: 'COMMON',
    value: 150,
    stackMax: 5,
  },
  
  // COMMON items (2个)
  scrap_metal: {
    id: 'scrap_metal',
    name: '废金属',
    rarity: 'COMMON',
    value: 5,
    stackMax: 20,
  },
  cloth: {
    id: 'cloth',
    name: '布料',
    rarity: 'COMMON',
    value: 3,
    stackMax: 30,
  },
  
  // RARE items (3个)
  electronics: {
    id: 'electronics',
    name: '电子零件',
    rarity: 'RARE',
    value: 25,
    stackMax: 10,
  },
  medical_supplies: {
    id: 'medical_supplies',
    name: '医疗材料',
    rarity: 'RARE',
    value: 30,
    stackMax: 5,
  },
  weapon_parts: {
    id: 'weapon_parts',
    name: '武器零件',
    rarity: 'RARE',
    value: 40,
    stackMax: 8,
  },
  
  // QUEST items (3个)
  keycard_alpha: {
    id: 'keycard_alpha',
    name: '门禁卡A',
    rarity: 'QUEST',
    value: 100,
    stackMax: 1,
  },
  keycard_beta: {
    id: 'keycard_beta',
    name: '门禁卡B',
    rarity: 'QUEST',
    value: 150,
    stackMax: 1,
  },
  intel_document: {
    id: 'intel_document',
    name: '情报文件',
    rarity: 'QUEST',
    value: 200,
    stackMax: 1,
  },
  
  // 武器 (5个)
  w_pistol: {
    id: 'w_pistol',
    name: '手枪',
    rarity: 'COMMON',
    value: 200,
    stackMax: 1,
  },
  w_smg: {
    id: 'w_smg',
    name: '冲锋枪',
    rarity: 'RARE',
    value: 600,
    stackMax: 1,
  },
  w_burst: {
    id: 'w_burst',
    name: '三连发步枪',
    rarity: 'RARE',
    value: 800,
    stackMax: 1,
  },
  w_dmr: {
    id: 'w_dmr',
    name: '精确步枪',
    rarity: 'RARE',
    value: 1200,
    stackMax: 1,
  },
  w_shotgun: {
    id: 'w_shotgun',
    name: '霰弹枪',
    rarity: 'RARE',
    value: 900,
    stackMax: 1,
  },
  
  // 背包 (4个)
  bag_sling: {
    id: 'bag_sling',
    name: '小挎包',
    rarity: 'COMMON',
    value: 100,
    stackMax: 1,
  },
  bag_daypack: {
    id: 'bag_daypack',
    name: '小背包',
    rarity: 'RARE',
    value: 300,
    stackMax: 1,
  },
  bag_tactical: {
    id: 'bag_tactical',
    name: '战术背包',
    rarity: 'RARE',
    value: 700,
    stackMax: 1,
  },
  bag_expedition: {
    id: 'bag_expedition',
    name: '大背包',
    rarity: 'RARE',
    value: 1200,
    stackMax: 1,
  },
  
  // 防具 (4个)
  armor_light: {
    id: 'armor_light',
    name: '轻甲',
    rarity: 'RARE',
    value: 150,
    stackMax: 1,
  },
  armor_kevlar: {
    id: 'armor_kevlar',
    name: '凯夫拉甲',
    rarity: 'RARE',
    value: 400,
    stackMax: 1,
  },
  armor_plate: {
    id: 'armor_plate',
    name: '插板甲',
    rarity: 'RARE',
    value: 900,
    stackMax: 1,
  },
  armor_heavy: {
    id: 'armor_heavy',
    name: '重甲',
    rarity: 'RARE',
    value: 1600,
    stackMax: 1,
  },
};

/**
 * 获取物品类型（带校验）
 * @throws 如果 typeId 不存在
 */
export function getItemType(typeId: string): ItemType {
  const itemType = ITEM_CATALOG[typeId];
  if (!itemType) {
    throw new Error(`Unknown item type: ${typeId}`);
  }
  return itemType;
}

/**
 * 获取所有物品类型列表
 */
export function getAllItemTypes(): ItemType[] {
  return Object.values(ITEM_CATALOG);
}

/**
 * 根据稀有度获取物品类型列表
 */
export function getItemTypesByRarity(rarity: Rarity): ItemType[] {
  return Object.values(ITEM_CATALOG).filter(item => item.rarity === rarity);
}