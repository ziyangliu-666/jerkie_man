/**
 * 物品目录（Item Catalog）
 * 数据驱动的物品类型定义，新增道具只需修改此文件
 *
 * 只存机制数据。显示名/描述/快捷栏缩写全部走 i18n：
 * 物品 id 即翻译 key —— item.<id>.name / item.<id>.desc / item.<id>.short
 * 文案见 shared/src/i18n/locales/{en,zh}/items.ts
 */
import type { ItemType, Rarity } from './types.js';

export const ITEM_CATALOG: Record<string, ItemType> = {

  medkit: {
    id: 'medkit',
    category: 'consumable',
    rarity: 'COMMON',
    value: 150,
    stackMax: 5,
    consumableProps: {
      healAmount: 50,  // 恢复50点生命值
    },
  },
  
  // COMMON items (2个)
  scrap_metal: {
    id: 'scrap_metal',
    category: 'material',
    rarity: 'COMMON',
    value: 5,
    stackMax: 20,
  },
  cloth: {
    id: 'cloth',
    category: 'material',
    rarity: 'COMMON',
    value: 3,
    stackMax: 30,
  },
  
  // RARE items (3个)
  electronics: {
    id: 'electronics',
    category: 'material',
    rarity: 'RARE',
    value: 25,
    stackMax: 10,
  },
  medical_supplies: {
    id: 'medical_supplies',
    category: 'material',
    rarity: 'RARE',
    value: 30,
    stackMax: 5,
  },
  weapon_parts: {
    id: 'weapon_parts',
    category: 'material',
    rarity: 'RARE',
    value: 40,
    stackMax: 8,
  },
  
  // EPIC items (新增材料)
  rare_metal: {
    id: 'rare_metal',
    category: 'material',
    rarity: 'EPIC',
    value: 100,
    stackMax: 5,
  },
  advanced_circuit: {
    id: 'advanced_circuit',
    category: 'material',
    rarity: 'EPIC',
    value: 150,
    stackMax: 3,
  },
  combat_stim: {
    id: 'combat_stim',
    category: 'consumable',
    rarity: 'EPIC',
    value: 200,
    stackMax: 3,
    consumableProps: {
      buffDurationMs: 15000,  // 15秒
      speedMultiplier: 1.4,  // +40% 速度
    },
  },
  regeneration_serum: {
    id: 'regeneration_serum',
    category: 'consumable',
    rarity: 'EPIC',
    value: 300,
    stackMax: 2,
    consumableProps: {
      buffDurationMs: 20000,  // 20秒
      hpPerSecond: 15,  // 每秒回复15点HP
    },
  },

  // LEGENDARY materials (新增极罕见材料)
  legendary_core: {
    id: 'legendary_core',
    category: 'material',
    rarity: 'LEGENDARY',
    value: 10000,
    stackMax: 1,
  },
  pure_gold: {
    id: 'pure_gold',
    category: 'material',
    rarity: 'LEGENDARY',
    value: 8888,
    stackMax: 5,
  },
  
  // 武器
  w_pistol: {
    id: 'w_pistol',
    category: 'weapon',
    rarity: 'COMMON',
    value: 200,
    stackMax: 1,
  },
  w_smg: {
    id: 'w_smg',
    category: 'weapon',
    rarity: 'RARE',
    value: 600,
    stackMax: 1,
  },
  w_burst: {
    id: 'w_burst',
    category: 'weapon',
    rarity: 'RARE',
    value: 800,
    stackMax: 1,
  },
  w_dmr: {
    id: 'w_dmr',
    category: 'weapon',
    rarity: 'RARE',
    value: 1200,
    stackMax: 1,
  },
  w_shotgun: {
    id: 'w_shotgun',
    category: 'weapon',
    rarity: 'RARE',
    value: 900,
    stackMax: 1,
  },
  w_sniper: {
    id: 'w_sniper',
    category: 'weapon',
    rarity: 'RARE',
    value: 1800,
    stackMax: 1,
  },
  w_grenade_launcher: {
    id: 'w_grenade_launcher',
    category: 'weapon',
    rarity: 'EPIC',
    value: 2200,
    stackMax: 1,
  },
  w_minigun: {
    id: 'w_minigun',
    category: 'weapon',
    rarity: 'LEGENDARY',
    value: 5000,
    stackMax: 1,
  },
  w_anti_material: {
    id: 'w_anti_material',
    category: 'weapon',
    rarity: 'LEGENDARY',
    value: 6000,
    stackMax: 1,
  },
  w_double_barrel: {
    id: 'w_double_barrel',
    category: 'weapon',
    rarity: 'RARE',
    value: 1500,
    stackMax: 1,
  },
  w_laser_rifle: {
    id: 'w_laser_rifle',
    category: 'weapon',
    rarity: 'EPIC',
    value: 2500,
    stackMax: 1,
  },
  w_crossbow: {
    id: 'w_crossbow',
    category: 'weapon',
    rarity: 'RARE',
    value: 1400,
    stackMax: 1,
  },
  w_auto_shotgun: {
    id: 'w_auto_shotgun',
    category: 'weapon',
    rarity: 'RARE',
    value: 1800,
    stackMax: 1,
  },
  w_precision_rifle: {
    id: 'w_precision_rifle',
    category: 'weapon',
    rarity: 'EPIC',
    value: 2000,
    stackMax: 1,
  },
  w_micro_smg: {
    id: 'w_micro_smg',
    category: 'weapon',
    rarity: 'RARE',
    value: 1000,
    stackMax: 1,
  },
  w_chainsaw: {
    id: 'w_chainsaw',
    category: 'weapon',
    rarity: 'RARE',
    value: 2000,
    stackMax: 1,
  },
  w_burst_grenade_launcher: {
    id: 'w_burst_grenade_launcher',
    category: 'weapon',
    rarity: 'EPIC',
    value: 2800,
    stackMax: 1,
  },
  w_katana: {
    id: 'w_katana',
    category: 'weapon',
    rarity: 'EPIC',
    value: 2200,
    stackMax: 1,
  },
  w_sledgehammer: {
    id: 'w_sledgehammer',
    category: 'weapon',
    rarity: 'LEGENDARY',
    value: 3500,
    stackMax: 1,
  },
  w_whip: {
    id: 'w_whip',
    category: 'weapon',
    rarity: 'LEGENDARY',
    value: 4000,
    stackMax: 1,
  },
  w_bubble_gun: {
    id: 'w_bubble_gun',
    category: 'weapon',
    rarity: 'LEGENDARY',
    value: 4500,
    stackMax: 1,
  },
  
  // 投掷物消耗品
  frag_grenade: {
    id: 'frag_grenade',
    category: 'consumable',
    rarity: 'RARE',
    value: 150,
    stackMax: 5, // 可以堆叠5个
    consumableProps: {
      explosionRadius: 100,  // 100像素爆炸半径
      damage: 300,  // 500伤害
    },
  },
  flash_grenade: {
    id: 'flash_grenade',
    category: 'consumable',
    rarity: 'RARE',
    value: 200,
    stackMax: 5,
    consumableProps: {
      flashRadius: 150,  // 150像素致盲范围
      flashDurationMs: 5000,  // 5秒致盲持续时间
      explosionRadius: 150,  // 150像素爆炸半径（用于视觉效果）
    },
  },
  smoke_grenade: {
    id: 'smoke_grenade',
    category: 'consumable',
    rarity: 'RARE',
    value: 180,
    stackMax: 5,
    consumableProps: {
      smokeRadius: 200,  // 140像素烟雾半径
      smokeDurationMs: 15000,  // 15秒持续时间
    },
  },
  molotov: {
    id: 'molotov',
    category: 'consumable',
    rarity: 'RARE',
    value: 200,
    stackMax: 5,
    consumableProps: {
      fireRadius: 120,
      fireDurationMs: 8000,
      fireDamagePerSecond: 100,
      explosionRadius: 100, // 视觉上的爆炸半径
    },
  },
  
  // 战术道具
  w_decoy: {
    id: 'w_decoy',
    category: 'consumable',
    rarity: 'RARE',
    value: 100,
    stackMax: 3,
    consumableProps: {
      // 诱饵不需要很多属性，由服务器逻辑处理生成实体
      // 借用 explosionRadius 作为"触发"标记
      explosionRadius: 1, 
    },
  },
  i_sentry_turret: {
    id: 'i_sentry_turret',
    category: 'consumable',
    rarity: 'EPIC',
    value: 500,
    stackMax: 1,
    consumableProps: {
      // Logic handled by server
      durationMs: 30000, 
    },
  },
  i_disguise: {
    id: 'i_disguise',
    category: 'consumable',
    rarity: 'RARE',
    value: 200,
    stackMax: 2,
    consumableProps: {
      disguiseDurationMs: 30000, // 30秒伪装
    },
  },
  
  // EPIC 消耗品
  advanced_medkit: {
    id: 'advanced_medkit',
    category: 'consumable',
    rarity: 'EPIC',
    value: 250,
    stackMax: 3,
    consumableProps: {
      healAmount: 100,  // 恢复100点生命值（满血）
    },
  },

  
  // 背包 (5个)
  bag_sling: {
    id: 'bag_sling',
    category: 'bag',
    rarity: 'COMMON',
    value: 100,
    stackMax: 1,
  },
  bag_daypack: {
    id: 'bag_daypack',
    category: 'bag',
    rarity: 'RARE',
    value: 300,
    stackMax: 1,
  },
  bag_tactical: {
    id: 'bag_tactical',
    category: 'bag',
    rarity: 'RARE',
    value: 700,
    stackMax: 1,
  },
  bag_expedition: {
    id: 'bag_expedition',
    category: 'bag',
    rarity: 'RARE',
    value: 1200,
    stackMax: 1,
  },
  bag_military: {
    id: 'bag_military',
    category: 'bag',
    rarity: 'LEGENDARY',
    value: 4000,
    stackMax: 1,
  },
  
  // 防具 (5个)
  armor_light: {
    id: 'armor_light',
    category: 'armor',
    rarity: 'RARE',
    value: 150,
    stackMax: 1,
  },
  armor_kevlar: {
    id: 'armor_kevlar',
    category: 'armor',
    rarity: 'RARE',
    value: 400,
    stackMax: 1,
  },
  armor_plate: {
    id: 'armor_plate',
    category: 'armor',
    rarity: 'RARE',
    value: 900,
    stackMax: 1,
  },
  armor_heavy: {
    id: 'armor_heavy',
    category: 'armor',
    rarity: 'LEGENDARY',
    value: 5500,
    stackMax: 1,
  },
  armor_exo: {
    id: 'armor_exo',
    category: 'armor',
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
  return !!(props.explosionRadius || props.smokeRadius || props.flashRadius || props.fireRadius);
}
