/**
 * 物品目录（Item Catalog）
 * 数据驱动的物品类型定义，新增道具只需修改此文件
 */
import type { ItemType, Rarity } from './types.js';

export const ITEM_CATALOG: Record<string, ItemType> = {
  // COMMON items (2个)
  scrap_metal: {
    id: 'scrap_metal',
    name: 'Scrap Metal',
    rarity: 'COMMON',
    value: 5,
    stackMax: 20,
  },
  cloth: {
    id: 'cloth',
    name: 'Cloth',
    rarity: 'COMMON',
    value: 3,
    stackMax: 30,
  },
  
  // RARE items (3个)
  electronics: {
    id: 'electronics',
    name: 'Electronics',
    rarity: 'RARE',
    value: 25,
    stackMax: 10,
  },
  medical_supplies: {
    id: 'medical_supplies',
    name: 'Medical Supplies',
    rarity: 'RARE',
    value: 30,
    stackMax: 5,
  },
  weapon_parts: {
    id: 'weapon_parts',
    name: 'Weapon Parts',
    rarity: 'RARE',
    value: 40,
    stackMax: 8,
  },
  
  // QUEST items (3个)
  keycard_alpha: {
    id: 'keycard_alpha',
    name: 'Keycard Alpha',
    rarity: 'QUEST',
    value: 100,
    stackMax: 1,
  },
  keycard_beta: {
    id: 'keycard_beta',
    name: 'Keycard Beta',
    rarity: 'QUEST',
    value: 150,
    stackMax: 1,
  },
  intel_document: {
    id: 'intel_document',
    name: 'Intel Document',
    rarity: 'QUEST',
    value: 200,
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