/**
 * 装备系统定义
 * 包含武器、背包、防具的详细属性
 */

// 武器种类（为手雷/火箭筒预留）
export type WeaponKind = 'gun' | 'throwable' | 'launcher' | 'melee';

// 武器定义
export interface WeaponDef {
  typeId: string;
  name: string;
  weaponKind?: WeaponKind; // 武器种类（默认为gun）
  magSize: number; // 弹匣容量
  reloadMs: number; // 换弹时间（毫秒）
  fireIntervalMs: number; // 开火间隔（毫秒）
  spreadDeg: number; // 散布角度（度）
  bulletSpeed: number; // 子弹速度
  damage: number; // 伤害值
  bulletLifeMs: number; // 子弹生命周期（毫秒）
  burstCount?: number; // 连发数量（例如3表示三连发，未定义或1表示单发）
  burstIntervalMs?: number; // 连发间隔（毫秒，默认等于fireIntervalMs）
  pelletCount?: number; // 弹丸数量（霰弹枪使用，例如8表示一次发射8颗子弹）
  meleeRange?: number; // 近战攻击范围（像素）
  meleeArcDeg?: number; // 近战攻击扇形角度（度）
  explosionRadius?: number; // 榴弹/炸弹爆炸半径（像素）
  explosionDamage?: number; // 爆炸伤害（高于普通伤害）
}

// 投射物定义（为手雷/火箭弹预留，当前仅作为类型定义）
export interface ProjectileDef {
  speed: number; // 飞行速度
  ttl: number; // 生命周期（毫秒）
  explosionRadius?: number; // 爆炸半径（像素）
  explosionDamage?: number; // 爆炸伤害
  fuseMs?: number; // 引信时间（手雷专用，毫秒）
}

// 背包定义
export interface BagDef {
  typeId: string;
  name: string;
  bagCap: number; // 背包容量
}

// 防具定义
export interface ArmorDef {
  typeId: string;
  name: string;
  damageReduction: number; // 伤害减免（0-1，例如 0.3 表示减少 30% 伤害）
}

// 武器配置
export const WEAPONS: Record<string, WeaponDef> = {
  w_fists: {
    typeId: 'w_fists',
    name: '拳头',
    weaponKind: 'melee',
    magSize: 0, // 拳头没有弹药
    reloadMs: 0, // 不需要换弹
    fireIntervalMs: 500, // 近战攻击间隔
    spreadDeg: 0, // 无散布
    bulletSpeed: 0, // 不使用子弹
    damage: 15, // 近战伤害
    bulletLifeMs: 0, // 不使用子弹
    meleeRange: 50,
    meleeArcDeg: 140,
  },
  w_pistol: {
    typeId: 'w_pistol',
    name: '手枪',
    magSize: 6,
    reloadMs: 1500,
    fireIntervalMs: 300,
    spreadDeg: 3,
    bulletSpeed: 800,
    damage: 25,
    bulletLifeMs: 1200, // 1.2秒
  },
  w_smg: {
    typeId: 'w_smg',
    name: '冲锋枪',
    magSize: 30,
    reloadMs: 2000,
    fireIntervalMs: 100,
    spreadDeg: 5,
    bulletSpeed: 900,
    damage: 20,
    bulletLifeMs: 900, // 0.9秒
  },
  w_burst: {
    typeId: 'w_burst',
    name: '三连发步枪',
    magSize: 20,
    reloadMs: 2500,
    fireIntervalMs: 300,
    spreadDeg: 2,
    bulletSpeed: 1000,
    damage: 30,
    bulletLifeMs: 1000, // 1秒
    burstCount: 3, // 三连发
    burstIntervalMs: 100,
  },
  w_dmr: {
    typeId: 'w_dmr',
    name: '精确步枪',
    magSize: 10,
    reloadMs: 3000,
    fireIntervalMs: 500,
    spreadDeg: 1,
    bulletSpeed: 1200,
    damage: 50,
    bulletLifeMs: 1600, // 1.6秒
  },
  w_shotgun: {
    typeId: 'w_shotgun',
    name: '霰弹枪',
    magSize: 8,
    reloadMs: 3500,
    fireIntervalMs: 800,
    spreadDeg: 12, // 霰弹枪总散布角度（度）
    bulletSpeed: 600,
    damage: 20, // 单颗弹丸伤害（降低，因为一次发射多颗）
    bulletLifeMs: 500, // 0.5秒（短射程）
    pelletCount: 8, // 一次发射8颗弹丸
  },
  w_sniper: {
    typeId: 'w_sniper',
    name: '狙击步枪',
    magSize: 5,
    reloadMs: 3800,
    fireIntervalMs: 900,
    spreadDeg: 0.6,
    bulletSpeed: 1600,
    damage: 90,
    bulletLifeMs: 2200,
  },
  w_grenade_launcher: {
    typeId: 'w_grenade_launcher',
    name: '榴弹炮',
    weaponKind: 'launcher',
    magSize: 1,
    reloadMs: 3000,
    fireIntervalMs: 1100,
    spreadDeg: 2,
    bulletSpeed: 520,
    damage: 12,
    bulletLifeMs: 3000, // 3秒后爆炸
    explosionRadius: 120,
    explosionDamage: 70,
  },
  w_minigun: {
    typeId: 'w_minigun',
    name: '加特林机枪',
    magSize: 200,        // 超大弹匣
    reloadMs: 6000,      // 换弹极慢（6秒）
    fireIntervalMs: 50,  // 极快射速（20发/秒）
    spreadDeg: 8,        // 较大散布
    bulletSpeed: 1000,
    damage: 18,          // 单发伤害较低，但射速快
    bulletLifeMs: 1200,
  },
  w_anti_material: {
    typeId: 'w_anti_material',
    name: '反器材狙击枪',
    magSize: 3,          // 极小弹匣
    reloadMs: 5000,      // 换弹极慢（5秒）
    fireIntervalMs: 1500, // 极慢射速
    spreadDeg: 0.3,      // 极高精度
    bulletSpeed: 2000,   // 极快弹速
    damage: 150,         // 超高伤害（一枪秒杀无甲）
    bulletLifeMs: 3000,  // 超远射程
  },
  w_double_barrel: {
    typeId: 'w_double_barrel',
    name: '双管霰弹枪',
    magSize: 2,          // 只有2发
    reloadMs: 4000,      // 换弹慢
    fireIntervalMs: 200, // 可以快速连射2发
    spreadDeg: 15,       // 极大散布
    bulletSpeed: 500,    // 慢弹速
    damage: 25,          // 单弹丸伤害
    bulletLifeMs: 300,   // 极短射程（0.3秒）
    pelletCount: 12,     // 12颗弹丸（总伤害300）
  },
  w_laser_rifle: {
    typeId: 'w_laser_rifle',
    name: '激光步枪',
    magSize: 30,
    reloadMs: 2500,
    fireIntervalMs: 150,
    spreadDeg: 0,        // 零散布（激光）
    bulletSpeed: 3000,   // 光速（几乎瞬间命中）
    damage: 35,
    bulletLifeMs: 500,   // 短射程（激光衰减）
  },
  w_crossbow: {
    typeId: 'w_crossbow',
    name: '弩',
    magSize: 1,          // 单发装填
    reloadMs: 3000,      // 装填慢
    fireIntervalMs: 100, // 装填后可以快速射击
    spreadDeg: 0.5,      // 高精度
    bulletSpeed: 800,    // 中等速度
    damage: 80,          // 高伤害
    bulletLifeMs: 2000,  // 中等射程
  },
  w_auto_shotgun: {
    typeId: 'w_auto_shotgun',
    name: '全自动霰弹枪',
    magSize: 12,
    reloadMs: 4000,
    fireIntervalMs: 150, // 全自动快速射击
    spreadDeg: 10,
    bulletSpeed: 550,
    damage: 18,
    bulletLifeMs: 400,
    pelletCount: 6,      // 每次6颗弹丸
  },
  w_precision_rifle: {
    typeId: 'w_precision_rifle',
    name: '精确射手步枪',
    magSize: 15,
    reloadMs: 2800,
    fireIntervalMs: 400,
    spreadDeg: 0.4,      // 极高精度
    bulletSpeed: 1400,
    damage: 65,          // 高伤害
    bulletLifeMs: 1800,
    burstCount: 2,       // 二连发
    burstIntervalMs: 80,
  },
  w_micro_smg: {
    typeId: 'w_micro_smg',
    name: '微型冲锋枪',
    magSize: 50,         // 超大弹匣
    reloadMs: 1800,      // 快速换弹
    fireIntervalMs: 60,  // 极快射速
    spreadDeg: 12,       // 极大散布
    bulletSpeed: 850,
    damage: 12,          // 低伤害
    bulletLifeMs: 700,
  },
  w_chainsaw: {
    typeId: 'w_chainsaw',
    name: '链锯',
    weaponKind: 'melee',
    magSize: 0,
    reloadMs: 0,
    fireIntervalMs: 200, // 快速连续攻击
    spreadDeg: 0,
    bulletSpeed: 0,
    damage: 30,          // 高近战伤害
    bulletLifeMs: 0,
    meleeRange: 60,      // 稍长近战范围
    meleeArcDeg: 180,    // 180度扇形
  },
};

// 背包配置
export const BAGS: Record<string, BagDef> = {
  bag_sling: {
    typeId: 'bag_sling',
    name: '小挎包',
    bagCap: 8,
  },
  bag_daypack: {
    typeId: 'bag_daypack',
    name: '小背包',
    bagCap: 12,
  },
  bag_tactical: {
    typeId: 'bag_tactical',
    name: '战术背包',
    bagCap: 16,
  },
  bag_expedition: {
    typeId: 'bag_expedition',
    name: '大背包',
    bagCap: 20,
  },
  bag_military: {
    typeId: 'bag_military',
    name: '军用背包',
    bagCap: 24, // 超大容量
  },
};

// 防具配置
export const ARMORS: Record<string, ArmorDef> = {
  armor_light: {
    typeId: 'armor_light',
    name: '轻甲',
    damageReduction: 0.1, // 减少 10% 伤害
  },
  armor_kevlar: {
    typeId: 'armor_kevlar',
    name: '凯夫拉甲',
    damageReduction: 0.25, // 减少 25% 伤害
  },
  armor_plate: {
    typeId: 'armor_plate',
    name: '插板甲',
    damageReduction: 0.4, // 减少 40% 伤害
  },
  armor_heavy: {
    typeId: 'armor_heavy',
    name: '重甲',
    damageReduction: 0.5, // 减少 50% 伤害
  },
  armor_exo: {
    typeId: 'armor_exo',
    name: '外骨骼装甲',
    damageReduction: 0.65, // 减少 65% 伤害（最强护甲）
  },
};

/**
 * 获取武器定义
 * @throws 如果 typeId 不存在
 */
export function getWeaponDef(typeId: string): WeaponDef {
  const weapon = WEAPONS[typeId];
  if (!weapon) {
    throw new Error(`Unknown weapon type: ${typeId}`);
  }
  return weapon;
}

/**
 * 获取背包定义
 * @throws 如果 typeId 不存在
 */
export function getBagDef(typeId: string): BagDef {
  const bag = BAGS[typeId];
  if (!bag) {
    throw new Error(`Unknown bag type: ${typeId}`);
  }
  return bag;
}

/**
 * 获取防具定义
 * @throws 如果 typeId 不存在
 */
export function getArmorDef(typeId: string): ArmorDef {
  const armor = ARMORS[typeId];
  if (!armor) {
    throw new Error(`Unknown armor type: ${typeId}`);
  }
  return armor;
}

/**
 * 应用武器散布
 * @param aimRad 瞄准角度（弧度）
 * @param spreadDeg 散布角度（度）
 * @param rng 随机数生成器函数（返回 0-1 之间的数）
 * @returns 实际发射角度（弧度）
 */
export function applySpread(aimRad: number, spreadDeg: number, rng: () => number): number {
  // 将散布角度转换为弧度
  const spreadRad = (spreadDeg * Math.PI) / 180;
  
  // 使用均匀分布生成随机偏移（-spread/2 到 +spread/2）
  const offset = (rng() - 0.5) * spreadRad;
  
  return aimRad + offset;
}

