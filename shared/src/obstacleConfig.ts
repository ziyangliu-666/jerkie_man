import { OBSTACLE_TYPE, type ObstacleType } from './protocol.js';

/**
 * 障碍物配置
 */
export interface ObstacleConfig {
  type: ObstacleType;
  name: string;
  description: string;

  // 碰撞属性
  blocksPlayer: boolean;      // 是否阻挡玩家移动
  blocksBullet: boolean;      // 是否阻挡子弹
  bulletPenetration: number;  // 子弹穿透削弱系数 (0-1)，0=完全阻挡，1=完全穿透

  // 视野属性
  blocksVision: boolean;      // 是否阻挡视野
  providesConcealment: boolean; // 是否提供隐蔽（在内部对外不可见）

  // 可破坏属性
  destructible: boolean;      // 是否可破坏
  maxHp: number;              // 最大生命值

  // 移动属性
  speedMultiplier: number;    // 移动速度倍数 (0-1)，1=正常速度，0.5=减速50%

  // 视觉属性
  color: string;              // 渲染颜色
  alpha: number;              // 透明度 (0-1)
}

/**
 * 障碍物类型配置表
 */
export const OBSTACLE_CONFIGS: Record<ObstacleType, ObstacleConfig> = {
  [OBSTACLE_TYPE.WALL]: {
    type: OBSTACLE_TYPE.WALL,
    name: '石墙',
    description: '坚固的石墙，无法穿越或破坏',
    blocksPlayer: true,
    blocksBullet: true,
    bulletPenetration: 0,
    blocksVision: true,
    providesConcealment: false,
    destructible: false,
    maxHp: Infinity,
    speedMultiplier: 1.0,
    color: '#666666',
    alpha: 1.0,
  },

  [OBSTACLE_TYPE.CRATE]: {
    type: OBSTACLE_TYPE.CRATE,
    name: '木箱',
    description: '木制箱子，可作为掩体，可被破坏',
    blocksPlayer: true,
    blocksBullet: true,
    bulletPenetration: 0,
    blocksVision: true,
    providesConcealment: false,
    destructible: true,
    maxHp: 100,
    speedMultiplier: 1.0,
    color: '#A0522D',
    alpha: 1.0,
  },

  [OBSTACLE_TYPE.WEAPON_CRATE]: {
    type: OBSTACLE_TYPE.WEAPON_CRATE,
    name: '武器箱',
    description: '装有武器的箱子，破坏后掉落枪械',
    blocksPlayer: true,
    blocksBullet: true,
    bulletPenetration: 0,
    blocksVision: true,
    providesConcealment: false,
    destructible: true,
    maxHp: 100,
    speedMultiplier: 1.0,
    color: '#8B0000', // 暗红色
    alpha: 1.0,
  },

  [OBSTACLE_TYPE.THROWABLE_CRATE]: {
    type: OBSTACLE_TYPE.THROWABLE_CRATE,
    name: '投掷物箱',
    description: '装有手雷和投掷物的箱子',
    blocksPlayer: true,
    blocksBullet: true,
    bulletPenetration: 0,
    blocksVision: true,
    providesConcealment: false,
    destructible: true,
    maxHp: 100,
    speedMultiplier: 1.0,
    color: '#FF8C00', // 橙色
    alpha: 1.0,
  },

  [OBSTACLE_TYPE.MEDICAL_CRATE]: {
    type: OBSTACLE_TYPE.MEDICAL_CRATE,
    name: '医疗箱',
    description: '装有医疗用品的箱子',
    blocksPlayer: true,
    blocksBullet: true,
    bulletPenetration: 0,
    blocksVision: true,
    providesConcealment: false,
    destructible: true,
    maxHp: 100,
    speedMultiplier: 1.0,
    color: '#FFFFFF', // 白色
    alpha: 1.0,
  },

  [OBSTACLE_TYPE.EQUIPMENT_CRATE]: {
    type: OBSTACLE_TYPE.EQUIPMENT_CRATE,
    name: '装备箱',
    description: '装有护甲和背包的箱子',
    blocksPlayer: true,
    blocksBullet: true,
    bulletPenetration: 0,
    blocksVision: true,
    providesConcealment: false,
    destructible: true,
    maxHp: 100,
    speedMultiplier: 1.0,
    color: '#4169E1', // 蓝色
    alpha: 1.0,
  },

  [OBSTACLE_TYPE.VEHICLE]: {
    type: OBSTACLE_TYPE.VEHICLE,
    name: '废弃车辆',
    description: '生锈的废弃车辆，可能有剩余物资',
    blocksPlayer: true,
    blocksBullet: true,
    bulletPenetration: 0.2, // 子弹可穿透车窗
    blocksVision: false, // 可透过车窗看到
    providesConcealment: false,
    destructible: true,
    maxHp: 150,
    speedMultiplier: 1.0,
    color: '#808080',
    alpha: 1.0,
  },

  [OBSTACLE_TYPE.SUPPLY_STACK]: {
    type: OBSTACLE_TYPE.SUPPLY_STACK,
    name: '物资堆',
    description: '堆叠的木箱和物资',
    blocksPlayer: true,
    blocksBullet: true,
    bulletPenetration: 0.3,
    blocksVision: true,
    providesConcealment: false,
    destructible: true,
    maxHp: 100,
    speedMultiplier: 1.0,
    color: '#8B7355',
    alpha: 1.0,
  },

  [OBSTACLE_TYPE.FENCE_WOOD]: {
    type: OBSTACLE_TYPE.FENCE_WOOD,
    name: '木栅栏',
    description: '低矮的木栅栏',
    blocksPlayer: false, // 可以穿越
    blocksBullet: true,
    bulletPenetration: 0.7, // 子弹大部分穿透
    blocksVision: false,
    providesConcealment: false,
    destructible: true,
    maxHp: 50,
    speedMultiplier: 0.8, // 稍微减速
    color: '#D2691E',
    alpha: 0.9,
  },

  [OBSTACLE_TYPE.FENCE_METAL]: {
    type: OBSTACLE_TYPE.FENCE_METAL,
    name: '金属栅栏',
    description: '金属栅栏，中等掩体',
    blocksPlayer: true,
    blocksBullet: true,
    bulletPenetration: 0.5,
    blocksVision: false,
    providesConcealment: false,
    destructible: true,
    maxHp: 100,
    speedMultiplier: 1.0,
    color: '#778899',
    alpha: 1.0,
  },

  [OBSTACLE_TYPE.SHRUB]: {
    type: OBSTACLE_TYPE.SHRUB,
    name: '灌木丛',
    description: '低矮的灌木，提供轻微遮挡',
    blocksPlayer: false,
    blocksBullet: false,
    bulletPenetration: 1.0,
    blocksVision: false,
    providesConcealment: true, // 提供隐蔽
    destructible: false,
    maxHp: Infinity,
    speedMultiplier: 0.9,
    color: '#6B8E23',
    alpha: 0.7,
  },

  [OBSTACLE_TYPE.ROCK_LARGE]: {
    type: OBSTACLE_TYPE.ROCK_LARGE,
    name: '大岩石',
    description: '巨大的岩石，坚固掩体',
    blocksPlayer: true,
    blocksBullet: true,
    bulletPenetration: 0,
    blocksVision: true,
    providesConcealment: false,
    destructible: false,
    maxHp: Infinity,
    speedMultiplier: 1.0,
    color: '#696969',
    alpha: 1.0,
  },

  [OBSTACLE_TYPE.BUSH]: {
    type: OBSTACLE_TYPE.BUSH,
    name: '草丛',
    description: '茂密的灌木丛，提供隐蔽但不阻挡移动',
    blocksPlayer: false,
    blocksBullet: false,
    bulletPenetration: 1.0, // 完全穿透
    blocksVision: false,
    providesConcealment: true, // 在草丛内对外不可见
    destructible: false,
    maxHp: Infinity,
    speedMultiplier: 1.0,
    color: '#228B22',
    alpha: 0.6,
  },

  [OBSTACLE_TYPE.WATER]: {
    type: OBSTACLE_TYPE.WATER,
    name: '水域',
    description: '水域，可以穿越但移速减慢50%，子弹可通过',
    blocksPlayer: false,  // 允许玩家穿越
    blocksBullet: false,
    bulletPenetration: 1.0,
    blocksVision: false,
    providesConcealment: false,
    destructible: false,
    maxHp: Infinity,
    speedMultiplier: 0.5,  // 减速50%
    color: '#4169E1',
    alpha: 0.7,
  },

  [OBSTACLE_TYPE.DOOR_CLOSED]: {
    type: OBSTACLE_TYPE.DOOR_CLOSED,
    name: '门（关）',
    description: '关闭的门，阻挡移动和视野，可破坏',
    blocksPlayer: true,
    blocksBullet: true,
    bulletPenetration: 0,
    blocksVision: true,
    providesConcealment: false,
    destructible: true,
    maxHp: 100,
    speedMultiplier: 1.0,
    color: '#8B4513', // SaddleBrown
    alpha: 1.0,
  },

  [OBSTACLE_TYPE.DOOR_OPEN]: {
    type: OBSTACLE_TYPE.DOOR_OPEN,
    name: '门（开）',
    description: '打开的门，可以通行',
    blocksPlayer: false,
    blocksBullet: false,
    bulletPenetration: 1.0,
    blocksVision: false,
    providesConcealment: false,
    destructible: false,
    maxHp: Infinity,
    speedMultiplier: 1.0,
    color: '#8B4513',
    alpha: 0.3, // 半透明表示打开
  },

  [OBSTACLE_TYPE.GLASS]: {
    type: OBSTACLE_TYPE.GLASS,
    name: '玻璃',
    description: '易碎的玻璃，不阻挡视野，子弹可穿透但会减弱',
    blocksPlayer: true,
    blocksBullet: false,
    bulletPenetration: 0.9, // 略微减弱子弹
    blocksVision: false,
    providesConcealment: false,
    destructible: true,
    maxHp: 30, // 易碎
    speedMultiplier: 1.0,
    color: '#E0FFFF', // LightCyan
    alpha: 0.5,
  },

  [OBSTACLE_TYPE.CHEST_CLOSED]: {
    type: OBSTACLE_TYPE.CHEST_CLOSED,
    name: '宝箱（关）',
    description: '装有物资的宝箱，可破坏或打开',
    blocksPlayer: true,
    blocksBullet: true,
    bulletPenetration: 0,
    blocksVision: false, // 假设比较矮，不阻挡视野
    providesConcealment: false,
    destructible: true,
    maxHp: 100,
    speedMultiplier: 1.0,
    color: '#FFD700', // Gold
    alpha: 1.0,
  },

  [OBSTACLE_TYPE.CHEST_OPEN]: {
    type: OBSTACLE_TYPE.CHEST_OPEN,
    name: '宝箱（开）',
    description: '已被搜刮的宝箱',
    blocksPlayer: false, // 开启后即使存在也不阻挡？或者保持阻挡？假设为了方便通行改为不阻挡，或者保持阻挡但视觉不同。这里设为不阻挡以便区分。
    blocksBullet: false,
    bulletPenetration: 1.0,
    blocksVision: false,
    providesConcealment: false,
    destructible: false,
    maxHp: Infinity,
    speedMultiplier: 1.0,
    color: '#DAA520', // GoldenRod (darker)
    alpha: 0.8,
  },

  [OBSTACLE_TYPE.BROKEN]: {
    type: OBSTACLE_TYPE.BROKEN,
    name: '残骸',
    description: '破坏后的物体残骸',
    blocksPlayer: false,
    blocksBullet: false,
    bulletPenetration: 1.0,
    blocksVision: false,
    providesConcealment: false,
    destructible: false,
    maxHp: Infinity,
    speedMultiplier: 1.0,
    color: '#333333',
    alpha: 0.5,
  },
};

/**
 * 获取障碍物配置
 */
export function getObstacleConfig(type: ObstacleType): ObstacleConfig {
  const config = OBSTACLE_CONFIGS[type];
  if (!config) {
    // 静默回退到 WALL（兼容旧地图数据）
    return OBSTACLE_CONFIGS[OBSTACLE_TYPE.WALL];
  }
  return config;
}

/**
 * 检查障碍物是否阻挡玩家移动
 */
export function doesObstacleBlockPlayer(type: ObstacleType): boolean {
  return getObstacleConfig(type).blocksPlayer;
}

/**
 * 检查障碍物是否阻挡子弹
 */
export function doesObstacleBlockBullet(type: ObstacleType): boolean {
  return getObstacleConfig(type).blocksBullet;
}

/**
 * 获取子弹穿透系数
 */
export function getBulletPenetration(type: ObstacleType): number {
  return getObstacleConfig(type).bulletPenetration;
}

/**
 * 检查障碍物是否提供隐蔽
 */
export function doesObstacleProvideConcealment(type: ObstacleType): boolean {
  return getObstacleConfig(type).providesConcealment;
}

/**
 * 检查障碍物是否可破坏
 */
export function isObstacleDestructible(type: ObstacleType): boolean {
  return getObstacleConfig(type).destructible;
}

/**
 * 获取障碍物的速度倍数
 */
export function getObstacleSpeedMultiplier(type: ObstacleType): number {
  return getObstacleConfig(type).speedMultiplier;
}
