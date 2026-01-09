/**
 * 物品目录（Item Catalog）
 * 数据驱动的物品类型定义，新增道具只需修改此文件
 */
import type { ItemType, Rarity } from './types.js';

export const ITEM_CATALOG: Record<string, ItemType> = {

  medkit: {
    id: 'medkit',
    category: 'consumable',
    name: '急救包',
    rarity: 'COMMON',
    value: 150,
    stackMax: 5,
    description: '基础的医疗用品，能快速处理伤口。恢复50点生命值。',
    shortName: '医疗',
    consumableProps: {
      healAmount: 50,  // 恢复50点生命值
    },
  },
  
  // COMMON items (2个)
  scrap_metal: {
    id: 'scrap_metal',
    category: 'material',
    name: '废金属',
    rarity: 'COMMON',
    value: 5,
    description: '普遍存在的废弃金属碎片，是制作和修理的基础材料。',
    stackMax: 20,
  },
  cloth: {
    id: 'cloth',
    category: 'material',
    name: '布料',
    rarity: 'COMMON',
    value: 3,
    description: '普通的布料，可用于包扎伤口或制作简单的装备。',
    stackMax: 30,
  },
  
  // RARE items (3个)
  electronics: {
    id: 'electronics',
    category: 'material',
    name: '电子零件',
    rarity: 'RARE',
    value: 25,
    description: '精密的电子元件，用于制造高科技设备和战术道具。',
    stackMax: 10,
  },
  medical_supplies: {
    id: 'medical_supplies',
    category: 'material',
    name: '医疗材料',
    rarity: 'RARE',
    value: 30,
    description: '稀有的医疗耗材，用于合成高级药品。',
    stackMax: 5,
  },
  weapon_parts: {
    id: 'weapon_parts',
    category: 'material',
    name: '武器零件',
    rarity: 'RARE',
    value: 40,
    description: '各种枪械的通用零部件，是改装和制造武器的关键。',
    stackMax: 8,
  },
  
  // EPIC items (新增材料)
  rare_metal: {
    id: 'rare_metal',
    category: 'material',
    name: '稀有金属',
    rarity: 'EPIC',
    value: 100,
    description: '极其罕见的合金金属，强度高且重量轻，用于制造顶级装备。',
    stackMax: 5,
  },
  advanced_circuit: {
    id: 'advanced_circuit',
    category: 'material',
    name: '高级电路板',
    rarity: 'EPIC',
    value: 150,
    description: '复杂的集成电路板，蕴含尖端科技，是核心设备的必需品。',
    stackMax: 3,
  },
  combat_stim: {
    id: 'combat_stim',
    category: 'consumable',
    name: '战斗兴奋剂',
    rarity: 'EPIC',
    value: 200,
    stackMax: 3,
    description: '肾上腺素混合剂，能在短时间内大幅提升移动速度。',
    shortName: '兴奋',
    consumableProps: {
      buffDurationMs: 15000,  // 15秒
      speedMultiplier: 1.4,  // +40% 速度
    },
  },
  regeneration_serum: {
    id: 'regeneration_serum',
    category: 'consumable',
    name: '再生血清',
    rarity: 'EPIC',
    value: 300,
    stackMax: 2,
    description: '包含纳米修复机器人的血清，能持续快速再生生命体征。',
    shortName: '再生',
    consumableProps: {
      buffDurationMs: 20000,  // 20秒
      hpPerSecond: 15,  // 每秒回复15点HP
    },
  },

  // LEGENDARY materials (新增极罕见材料)
  legendary_core: {
    id: 'legendary_core',
    category: 'material',
    name: '传说核心',
    rarity: 'LEGENDARY',
    value: 10000,
    description: '一个蕴含着巨大能量的神秘核心，是制造顶级传说武器的核心部件。',
    stackMax: 1,
  },
  pure_gold: {
    id: 'pure_gold',
    category: 'material',
    name: '纯金',
    rarity: 'LEGENDARY',
    value: 8888,
    description: '极其纯净的黄金，具有完美的导电性和魔法感应性，用于制造传说级防具。',
    stackMax: 5,
  },
  
  // 武器
  w_pistol: {
    id: 'w_pistol',
    category: 'weapon',
    name: '手枪',
    rarity: 'COMMON',
    value: 200,
    description: '标准制式手枪，轻便可靠，适合防身和近距离交战。',
    stackMax: 1,
  },
  w_smg: {
    id: 'w_smg',
    category: 'weapon',
    name: '冲锋枪',
    rarity: 'RARE',
    value: 600,
    description: '高射速轻型冲锋枪，近战火力压制的不二之选。',
    stackMax: 1,
  },
  w_burst: {
    id: 'w_burst',
    category: 'weapon',
    name: '三连发步枪',
    rarity: 'RARE',
    value: 800,
    description: '能够快速进行三连发射击的步枪，兼顾射速与精度。',
    stackMax: 1,
  },
  w_dmr: {
    id: 'w_dmr',
    category: 'weapon',
    name: '精确步枪',
    rarity: 'RARE',
    value: 1200,
    description: '半自动精确射手步枪，适合中远距离精准打击。',
    stackMax: 1,
  },
  w_shotgun: {
    id: 'w_shotgun',
    category: 'weapon',
    name: '霰弹枪',
    rarity: 'RARE',
    value: 900,
    description: '泵动式霰弹枪，近距离威力巨大，一击必杀。',
    stackMax: 1,
  },
  w_sniper: {
    id: 'w_sniper',
    category: 'weapon',
    name: '狙击步枪',
    rarity: 'RARE',
    value: 1800,
    description: '高倍镜狙击步枪，极高的单发伤害，适合远距离狙杀。',
    stackMax: 1,
  },
  w_grenade_launcher: {
    id: 'w_grenade_launcher',
    category: 'weapon',
    name: '榴弹炮',
    rarity: 'EPIC',
    value: 2200,
    description: '发射高爆榴弹的重型武器，能对范围内敌人造成毁灭性打击。',
    stackMax: 1,
  },
  w_minigun: {
    id: 'w_minigun',
    category: 'weapon',
    name: '加特林机枪',
    rarity: 'LEGENDARY',
    value: 5000,
    description: '多管旋转机枪，拥有恐怖的持续火力和压制力。传说级别的屠杀机器。',
    stackMax: 1,
  },
  w_anti_material: {
    id: 'w_anti_material',
    category: 'weapon',
    name: '反器材狙击枪',
    rarity: 'LEGENDARY',
    value: 6000,
    description: '大口径反器材步枪，能够穿透掩体并摧毁重型装甲。传说级别的致命远射。',
    stackMax: 1,
  },
  w_double_barrel: {
    id: 'w_double_barrel',
    category: 'weapon',
    name: '双管霰弹枪',
    rarity: 'RARE',
    value: 1500,
    description: '双管猎枪，瞬间爆发力极强，但装填较慢。',
    stackMax: 1,
  },
  w_laser_rifle: {
    id: 'w_laser_rifle',
    category: 'weapon',
    name: '激光步枪',
    rarity: 'EPIC',
    value: 2500,
    description: '发射高能激光束的未来武器，精准度极高且无后座力。',
    stackMax: 1,
  },
  w_crossbow: {
    id: 'w_crossbow',
    category: 'weapon',
    name: '弩',
    rarity: 'RARE',
    value: 1400,
    description: '无声且致命的弩箭，适合隐秘行动，发射可回收的箭矢。',
    stackMax: 1,
  },
  w_auto_shotgun: {
    id: 'w_auto_shotgun',
    category: 'weapon',
    name: '全自动霰弹枪',
    rarity: 'RARE',
    value: 1800,
    description: '全自动射击的霰弹枪，能在短时间内倾泻大量弹药。',
    stackMax: 1,
  },
  w_precision_rifle: {
    id: 'w_precision_rifle',
    category: 'weapon',
    name: '精确射手步枪',
    rarity: 'EPIC',
    value: 2000,
    description: '特制的高精度步枪，射速与伤害的完美平衡。',
    stackMax: 1,
  },
  w_micro_smg: {
    id: 'w_micro_smg',
    category: 'weapon',
    name: '微型冲锋枪',
    rarity: 'RARE',
    value: 1000,
    description: '极其紧凑的冲锋枪，射速惊人但射程较短。',
    stackMax: 1,
  },
  w_chainsaw: {
    id: 'w_chainsaw',
    category: 'weapon',
    name: '链锯',
    rarity: 'RARE',
    value: 2000,
    description: '通过高速旋转链条切割敌人的近战利器，令人闻风丧胆。',
    stackMax: 1,
  },
  w_burst_grenade_launcher: {
    id: 'w_burst_grenade_launcher',
    category: 'weapon',
    name: '连发榴弹炮',
    rarity: 'EPIC',
    value: 2800,
    description: '改进型榴弹发射器，能够快速连续发射三发榴弹，适合区域压制。',
    stackMax: 1,
  },
  w_katana: {
    id: 'w_katana',
    category: 'weapon',
    name: '武士刀',
    rarity: 'EPIC',
    value: 2200,
    description: '锋利无比的日本武士刀，一刀致命，轻盈快速。',
    stackMax: 1,
  },
  w_sledgehammer: {
    id: 'w_sledgehammer',
    category: 'weapon',
    name: '大锤',
    rarity: 'LEGENDARY',
    value: 3500,
    description: '沉重的战锤，挥舞缓慢但威力惊人，一击必杀。',
    stackMax: 1,
  },
  w_whip: {
    id: 'w_whip',
    category: 'weapon',
    name: '鞭子',
    rarity: 'LEGENDARY',
    value: 6000,
    description: '传说级的远程近战武器，超长攻击距离可以隔山打牛，让敌人防不胜防。',
    stackMax: 1,
  },
  w_bubble_gun: {
    id: 'w_bubble_gun',
    category: 'weapon',
    name: '泡泡枪',
    rarity: 'LEGENDARY',
    value: 4500,
    description: '发射特殊泡泡的传说级武器，具有极强的控制和混乱效果。',
    stackMax: 1,
  },
  
  // 投掷物消耗品
  frag_grenade: {
    id: 'frag_grenade',
    category: 'consumable',
    name: '破片手雷',
    rarity: 'RARE',
    value: 150,
    stackMax: 5, // 可以堆叠5个
    description: '投掷后爆炸，产生破片对范围内敌人造成伤害。',
    shortName: '手雷',
    consumableProps: {
      explosionRadius: 100,  // 100像素爆炸半径
      damage: 300,  // 500伤害
    },
  },
  flash_grenade: {
    id: 'flash_grenade',
    category: 'consumable',
    name: '闪光弹',
    rarity: 'RARE',
    value: 200,
    stackMax: 5,
    description: '通过强光致盲敌人，干扰其视野和听觉。',
    shortName: '闪光',
    consumableProps: {
      flashRadius: 150,  // 150像素致盲范围
      flashDurationMs: 5000,  // 5秒致盲持续时间
      explosionRadius: 150,  // 150像素爆炸半径（用于视觉效果）
    },
  },
  smoke_grenade: {
    id: 'smoke_grenade',
    category: 'consumable',
    name: '烟雾弹',
    rarity: 'RARE',
    value: 180,
    stackMax: 5,
    description: '释放浓密的烟雾，阻挡视线，用于掩护行动。',
    shortName: '烟雾',
    consumableProps: {
      smokeRadius: 200,  // 140像素烟雾半径
      smokeDurationMs: 15000,  // 15秒持续时间
    },
  },
  molotov: {
    id: 'molotov',
    category: 'consumable',
    name: '燃烧弹',
    rarity: 'RARE',
    value: 200,
    stackMax: 5,
    description: '投掷后产生持续燃烧的火焰区域，封锁路径并造成持续伤害。',
    shortName: '燃烧',
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
    name: '全息诱饵',
    rarity: 'RARE',
    value: 100,
    stackMax: 3,
    description: '部署一个全息投影产生的替身，用于迷惑敌人。',
    shortName: '诱饵',
    consumableProps: {
      // 诱饵不需要很多属性，由服务器逻辑处理生成实体
      // 借用 explosionRadius 作为"触发"标记
      explosionRadius: 1, 
    },
  },
  i_sentry_turret: {
    id: 'i_sentry_turret',
    category: 'consumable',
    name: '哨戒炮台',
    rarity: 'EPIC',
    value: 500,
    stackMax: 1,
    description: '自动追踪并攻击范围内敌人的便携式炮台。',
    shortName: '炮台',
    consumableProps: {
      // Logic handled by server
      durationMs: 30000, 
    },
  },
  i_disguise: {
    id: 'i_disguise',
    category: 'consumable',
    name: '伪装药水',
    rarity: 'RARE',
    value: 200,
    stackMax: 2,
    description: '特制的伪装剂，能让你暂时看起来像一个普通的AI。',
    shortName: '伪装',
    consumableProps: {
      disguiseDurationMs: 30000, // 30秒伪装
    },
  },
  
  // EPIC 消耗品
  advanced_medkit: {
    id: 'advanced_medkit',
    category: 'consumable',
    name: '高级急救包',
    rarity: 'EPIC',
    value: 250,
    stackMax: 3,
    description: '军用级急救包，内置高效药物，能瞬间恢复全部生命值。',
    shortName: '高级',
    consumableProps: {
      healAmount: 100,  // 恢复100点生命值（满血）
    },
  },

  
  // 背包 (5个)
  bag_sling: {
    id: 'bag_sling',
    category: 'bag',
    name: '小挎包',
    rarity: 'COMMON',
    value: 100,
    description: '简易的小挎包，提供少量额外的存储空间。',
    stackMax: 1,
  },
  bag_daypack: {
    id: 'bag_daypack',
    category: 'bag',
    name: '小背包',
    rarity: 'RARE',
    value: 300,
    description: '日常使用的小型背包，在这个末世中非常实用。',
    stackMax: 1,
  },
  bag_tactical: {
    id: 'bag_tactical',
    category: 'bag',
    name: '战术背包',
    rarity: 'RARE',
    value: 700,
    description: '专为作战设计的战术背包，拥有合理的空间布局。',
    stackMax: 1,
  },
  bag_expedition: {
    id: 'bag_expedition',
    category: 'bag',
    name: '大背包',
    rarity: 'RARE',
    value: 1200,
    description: '大容量的探险背包，能装下你搜刮到的大部分物资。',
    stackMax: 1,
  },
  bag_military: {
    id: 'bag_military',
    category: 'bag',
    name: '军用背包',
    rarity: 'LEGENDARY',
    value: 4000,
    description: '军方核心科技的高负重背包，拥有绝对领先的存储容量。',
    stackMax: 1,
  },
  
  // 防具 (5个)
  armor_light: {
    id: 'armor_light',
    category: 'armor',
    name: '轻甲',
    rarity: 'RARE',
    value: 150,
    description: '轻质的防护背心，能提供基础的身体防护。',
    stackMax: 1,
  },
  armor_kevlar: {
    id: 'armor_kevlar',
    category: 'armor',
    name: '凯夫拉甲',
    rarity: 'RARE',
    value: 400,
    description: '采用凯夫拉纤维制成，对小口径子弹有较好的防护效果。',
    stackMax: 1,
  },
  armor_plate: {
    id: 'armor_plate',
    category: 'armor',
    name: '插板甲',
    rarity: 'RARE',
    value: 900,
    description: '带有陶瓷插板的战术背心，能抵挡突击步枪的射击。',
    stackMax: 1,
  },
  armor_heavy: {
    id: 'armor_heavy',
    category: 'armor',
    name: '重甲',
    rarity: 'LEGENDARY',
    value: 5500,
    description: '传说级别的复合重型护甲，提供坚不可摧的防御，是战场上的移动堡垒。',
    stackMax: 1,
  },
  armor_exo: {
    id: 'armor_exo',
    category: 'armor',
    name: '外骨骼装甲',
    rarity: 'EPIC',
    value: 2500,
    description: '结合动力辅助的未来装甲，防御强悍且不牺牲机动性。',
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
