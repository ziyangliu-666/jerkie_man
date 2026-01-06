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
    shortName: '医疗',
    consumableProps: {
      healAmount: 50,  // 恢复50点生命值
    },
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
  
  // EPIC items (新增材料)
  rare_metal: {
    id: 'rare_metal',
    name: '稀有金属',
    rarity: 'EPIC',
    value: 100,
    stackMax: 5,
  },
  advanced_circuit: {
    id: 'advanced_circuit',
    name: '高级电路板',
    rarity: 'EPIC',
    value: 150,
    stackMax: 3,
  },
  combat_stim: {
    id: 'combat_stim',
    name: '战斗兴奋剂',
    rarity: 'EPIC',
    value: 200,
    stackMax: 3,
    shortName: '兴奋',
    consumableProps: {
      buffDurationMs: 15000,  // 15秒
      speedMultiplier: 2.0,  // +100% 速度
    },
  },
  regeneration_serum: {
    id: 'regeneration_serum',
    name: '再生血清',
    rarity: 'EPIC',
    value: 250,
    stackMax: 2,
    shortName: '再生',
    consumableProps: {
      buffDurationMs: 20000,  // 20秒
      hpPerSecond: 5,  // 每秒回复5点HP
    },
  },
  
  // 武器
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
  w_sniper: {
    id: 'w_sniper',
    name: '狙击步枪',
    rarity: 'RARE',
    value: 1800,
    stackMax: 1,
  },
  w_grenade_launcher: {
    id: 'w_grenade_launcher',
    name: '榴弹炮',
    rarity: 'EPIC',
    value: 2200,
    stackMax: 1,
  },
  w_minigun: {
    id: 'w_minigun',
    name: '加特林机枪',
    rarity: 'EPIC',
    value: 3000,
    stackMax: 1,
  },
  w_anti_material: {
    id: 'w_anti_material',
    name: '反器材狙击枪',
    rarity: 'EPIC',
    value: 3500,
    stackMax: 1,
  },
  w_double_barrel: {
    id: 'w_double_barrel',
    name: '双管霰弹枪',
    rarity: 'RARE',
    value: 1500,
    stackMax: 1,
  },
  w_laser_rifle: {
    id: 'w_laser_rifle',
    name: '激光步枪',
    rarity: 'EPIC',
    value: 2500,
    stackMax: 1,
  },
  w_crossbow: {
    id: 'w_crossbow',
    name: '弩',
    rarity: 'RARE',
    value: 1400,
    stackMax: 1,
  },
  w_auto_shotgun: {
    id: 'w_auto_shotgun',
    name: '全自动霰弹枪',
    rarity: 'RARE',
    value: 1800,
    stackMax: 1,
  },
  w_precision_rifle: {
    id: 'w_precision_rifle',
    name: '精确射手步枪',
    rarity: 'EPIC',
    value: 2000,
    stackMax: 1,
  },
  w_micro_smg: {
    id: 'w_micro_smg',
    name: '微型冲锋枪',
    rarity: 'RARE',
    value: 1000,
    stackMax: 1,
  },
  w_chainsaw: {
    id: 'w_chainsaw',
    name: '链锯',
    rarity: 'RARE',
    value: 1200,
    stackMax: 1,
  },
  
  // 投掷物消耗品
  frag_grenade: {
    id: 'frag_grenade',
    name: '破片手雷',
    rarity: 'COMMON',
    value: 150,
    stackMax: 5, // 可以堆叠5个
    shortName: '手雷',
    consumableProps: {
      explosionRadius: 100,  // 100像素爆炸半径
      damage: 300,  // 500伤害
    },
  },
  flash_grenade: {
    id: 'flash_grenade',
    name: '闪光弹',
    rarity: 'RARE',
    value: 200,
    stackMax: 3,
    shortName: '闪光',
    consumableProps: {
      flashRadius: 150,  // 150像素致盲范围
      flashDurationMs: 3000,  // 3秒致盲持续时间
      explosionRadius: 150,  // 150像素爆炸半径（用于视觉效果）
    },
  },
  smoke_grenade: {
    id: 'smoke_grenade',
    name: '烟雾弹',
    rarity: 'RARE',
    value: 180,
    stackMax: 3,
    shortName: '烟雾',
    consumableProps: {
      smokeRadius: 200,  // 140像素烟雾半径
      smokeDurationMs: 15000,  // 15秒持续时间
    },
  },
  
  // EPIC 消耗品
  advanced_medkit: {
    id: 'advanced_medkit',
    name: '高级急救包',
    rarity: 'EPIC',
    value: 250,
    stackMax: 3,
    shortName: '高级',
    consumableProps: {
      healAmount: 100,  // 恢复100点生命值（满血）
    },
  },
  armor_plate_item: {
    id: 'armor_plate_item',
    name: '防弹插板',
    rarity: 'EPIC',
    value: 800,
    stackMax: 2,
  },
  
  // 背包 (5个)
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
  bag_military: {
    id: 'bag_military',
    name: '军用背包',
    rarity: 'EPIC',
    value: 2000,
    stackMax: 1,
  },
  
  // 防具 (5个)
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
    rarity: 'EPIC',
    value: 3000,
    stackMax: 1,
  },
  armor_exo: {
    id: 'armor_exo',
    name: '外骨骼装甲',
    rarity: 'EPIC',
    value: 2500,
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

/**
 * 获取所有可使用的物品类型ID列表（有 consumableProps 的物品）
 */
export function getUsableItemTypeIds(): string[] {
  return Object.values(ITEM_CATALOG)
    .filter(item => item.consumableProps !== undefined)
    .map(item => item.id);
}

/**
 * 检查物品类型是否可使用
 */
export function isUsableItem(typeId: string): boolean {
  const itemType = ITEM_CATALOG[typeId];
  return itemType?.consumableProps !== undefined;
}

/**
 * 检查物品类型是否是手雷（可投掷）
 */
export function isThrowableItem(typeId: string): boolean {
  const itemType = ITEM_CATALOG[typeId];
  if (!itemType?.consumableProps) return false;
  const props = itemType.consumableProps;
  return !!(props.explosionRadius || props.smokeRadius || props.flashRadius);
}
