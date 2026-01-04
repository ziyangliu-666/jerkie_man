/**
 * Profile工具函数 - 单一数据源（Single Source of Truth）
 *
 * 所有profile相关的查询和验证逻辑统一在此处实现
 * Client和Server必须使用这些函数，不得自己实现查找逻辑
 */

import type { PlayerProfile, ItemInstance, PlayerEquipment } from './types.js';
import { getWeaponDef, getBagDef, getArmorDef, type WeaponDef } from './equipment.js';
import { DEFAULT_BAG_CAP } from './constants.js';

/**
 * 在profile中查找物品（单一数据源）
 * @param profile 玩家档案
 * @param iid 物品实例ID
 * @returns 物品所在容器和物品实例，找不到返回null
 */
export function findItemByIid(
  profile: PlayerProfile,
  iid: string
): { container: 'stash' | 'prep'; item: ItemInstance } | null {
  // 先在stash中查找
  const stashItem = profile.stash.find(item => item.iid === iid);
  if (stashItem) {
    return { container: 'stash', item: stashItem };
  }

  // 再在prep中查找
  const prepItem = profile.prep.find(item => item.iid === iid);
  if (prepItem) {
    return { container: 'prep', item: prepItem };
  }

  return null;
}

/**
 * 获取装备的武器定义（单一数据源）
 * @param profile 玩家档案
 * @returns 武器定义，未装备或找不到返回null
 */
export function getEquippedWeaponDef(profile: PlayerProfile): WeaponDef | null {
  if (!profile.equipment.weaponIid) {
    return null;
  }

  const found = findItemByIid(profile, profile.equipment.weaponIid);
  if (!found) {
    return null; // 装备的iid找不到（数据异常）
  }

  try {
    return getWeaponDef(found.item.typeId);
  } catch {
    return null; // typeId无效
  }
}

/**
 * 获取装备的背包容量（单一数据源）
 * @param profile 玩家档案
 * @returns 背包容量，未装备或找不到返回默认值
 */
export function getEquippedBagCap(profile: PlayerProfile): number {
  if (!profile.equipment.bagIid) {
    return DEFAULT_BAG_CAP;
  }

  const found = findItemByIid(profile, profile.equipment.bagIid);
  if (!found) {
    return DEFAULT_BAG_CAP; // 装备的iid找不到（数据异常）
  }

  try {
    const bagDef = getBagDef(found.item.typeId);
    return bagDef.bagCap;
  } catch {
    return DEFAULT_BAG_CAP; // typeId无效
  }
}

/**
 * 获取装备的护甲减伤（单一数据源）
 * @param profile 玩家档案
 * @returns 减伤值（0-1），未装备或找不到返回0
 */
export function getEquippedArmorReduction(profile: PlayerProfile): number {
  if (!profile.equipment.armorIid) {
    return 0;
  }

  const found = findItemByIid(profile, profile.equipment.armorIid);
  if (!found) {
    return 0; // 装备的iid找不到（数据异常）
  }

  try {
    const armorDef = getArmorDef(found.item.typeId);
    return armorDef.damageReduction;
  } catch {
    return 0; // typeId无效
  }
}

/**
 * 检查物品是否已装备
 * @param equipment 装备槽
 * @param iid 物品实例ID
 * @returns 是否已装备
 */
export function isItemEquipped(equipment: PlayerEquipment, iid: string): boolean {
  return (
    equipment.weaponIid === iid ||
    equipment.bagIid === iid ||
    equipment.armorIid === iid
  );
}

/**
 * 验证profile的不变量（invariants）
 * @param profile 玩家档案
 * @returns 错误列表，如果为空则表示所有不变量都满足
 */
export function validateInvariants(profile: PlayerProfile): string[] {
  const errors: string[] = [];

  // 不变量1：equipment.weaponIid如果存在，必须能在stash或prep中找到
  if (profile.equipment.weaponIid) {
    const found = findItemByIid(profile, profile.equipment.weaponIid);
    if (!found) {
      errors.push(
        `equipment.weaponIid="${profile.equipment.weaponIid}" 指向不存在的物品`
      );
    }
  }

  // 不变量2：equipment.bagIid如果存在，必须能在stash或prep中找到
  if (profile.equipment.bagIid) {
    const found = findItemByIid(profile, profile.equipment.bagIid);
    if (!found) {
      errors.push(
        `equipment.bagIid="${profile.equipment.bagIid}" 指向不存在的物品`
      );
    }
  }

  // 不变量3：equipment.armorIid如果存在，必须能在stash或prep中找到
  if (profile.equipment.armorIid) {
    const found = findItemByIid(profile, profile.equipment.armorIid);
    if (!found) {
      errors.push(
        `equipment.armorIid="${profile.equipment.armorIid}" 指向不存在的物品`
      );
    }
  }

  // 不变量4：bagCap应该等于当前装备的背包容量（如果profile.bagCap字段存在）
  const actualBagCap = getEquippedBagCap(profile);
  if (profile.bagCap !== undefined && profile.bagCap !== actualBagCap) {
    errors.push(
      `bagCap=${profile.bagCap} 与实际装备容量 ${actualBagCap} 不一致`
    );
  }

  // 不变量5：prep物品数量不能超过背包容量
  if (profile.prep.length > actualBagCap) {
    errors.push(
      `prep 物品数量 ${profile.prep.length} 超过容量 ${actualBagCap}`
    );
  }

  return errors;
}

/**
 * 获取物品显示名称（为国际化预留）
 * @param typeId 物品类型ID
 * @param lang 语言（默认英文）
 * @returns 显示名称
 */
export function getItemDisplayName(typeId: string, lang: 'en' | 'zh' = 'en'): string {
  // 优先从装备定义中查找
  try {
    const weaponDef = getWeaponDef(typeId);
    return weaponDef.name; // 当前已经是中文
  } catch {
    // 不是武器
  }

  try {
    const bagDef = getBagDef(typeId);
    return bagDef.name;
  } catch {
    // 不是背包
  }

  try {
    const armorDef = getArmorDef(typeId);
    return armorDef.name;
  } catch {
    // 不是护甲
  }

  // 未来：从ITEM_CATALOG查找
  // const itemType = getItemType(typeId);
  // if (lang === 'zh') {
  //   return ITEM_NAME_ZH[typeId] ?? itemType.name;
  // }
  // return itemType.name;

  return typeId; // 兜底：返回typeId本身
}
