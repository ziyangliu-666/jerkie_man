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
    color: '#666666',
    alpha: 1.0,
  },

  [OBSTACLE_TYPE.WOODEN_WALL]: {
    type: OBSTACLE_TYPE.WOODEN_WALL,
    name: '木墙',
    description: '木质墙壁，子弹可穿透但会削弱，可被破坏',
    blocksPlayer: true,
    blocksBullet: false,
    bulletPenetration: 0.4, // 穿透时伤害削弱60%
    blocksVision: true,
    providesConcealment: false,
    destructible: true,
    maxHp: 200,
    color: '#8B4513',
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
    color: '#A0522D',
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
    color: '#228B22',
    alpha: 0.6,
  },

  [OBSTACLE_TYPE.WATER]: {
    type: OBSTACLE_TYPE.WATER,
    name: '水域',
    description: '池塘或河流，无法穿越但子弹可通过',
    blocksPlayer: true,
    blocksBullet: false,
    bulletPenetration: 1.0,
    blocksVision: false,
    providesConcealment: false,
    destructible: false,
    maxHp: Infinity,
    color: '#4169E1',
    alpha: 0.7,
  },

  [OBSTACLE_TYPE.COVER]: {
    type: OBSTACLE_TYPE.COVER,
    name: '半身掩体',
    description: '低矮掩体，可提供部分保护',
    blocksPlayer: true,
    blocksBullet: false,
    bulletPenetration: 0.7, // 30%削弱
    blocksVision: false,
    providesConcealment: false,
    destructible: true,
    maxHp: 150,
    color: '#696969',
    alpha: 1.0,
  },
};

/**
 * 获取障碍物配置
 */
export function getObstacleConfig(type: ObstacleType): ObstacleConfig {
  const config = OBSTACLE_CONFIGS[type];
  if (!config) {
    console.warn(`Unknown obstacle type: ${type}, using WALL as fallback`);
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
