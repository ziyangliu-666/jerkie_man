/**
 * 全局常量 - 单一数据源
 * 用于替换硬编码的魔法常量
 */

// Tick系统常量
export const TICK_MS = 50; // 服务端tick间隔：50ms = 20Hz
export const SNAPSHOT_MS = 100; // 快照广播间隔：100ms = 10Hz

// Tick换算工具函数
export function msToTicks(ms: number): number {
  return Math.ceil(ms / TICK_MS);
}

export function ticksToMs(ticks: number): number {
  return ticks * TICK_MS;
}

// 默认值常量
export const DEFAULT_BAG_CAP = 4; // 默认背包容量
export const DEFAULT_FIRE_INTERVAL_MS = 150; // 默认射速（用于fists）
export const DEFAULT_BULLET_SPEED = 800; // 默认子弹速度

// 游戏平衡常量
export const PLAYER_HIT_RADIUS = 16; // 玩家碰撞半径（用于命中判定）
export const PLAYER_RADIUS = 10; // 玩家移动碰撞半径
export const PLAYER_SPEED = 200; // 玩家移动速度（像素/秒）

// 延迟补偿常量
export const LAG_COMP_SAFETY_MARGIN_MS = 50; // 延迟补偿安全裕量
export const LAG_COMP_MAX_REWIND_MS = 500; // 最大回溯时间
export const POSITION_HISTORY_SIZE = 50; // 位置历史缓冲区大小（约2.5秒@20Hz）

// 提取区常量
export const EXTRACT_DURATION_MS = 2000; // 撤离持续时间
export const EXTRACT_ZONE_RADIUS = 100; // 撤离区半径

// 拾取交互常量
export const INTERACT_DISTANCE = 50; // 交互距离
