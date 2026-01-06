/**
 * 共享的游戏模拟逻辑
 * 用于客户端预测和服务端权威计算，确保双端一致
 */

import { circleVsAABB, clamp } from './math.js';
import type { OBSTACLE_STATE } from './protocol.js';

// 玩家移动速度（像素/秒）
const PLAYER_SPEED = 200;

// 玩家碰撞半径
const PLAYER_RADIUS = 10;

// 耐力系统常量
const STAMINA_SPRINT_MULTIPLIER = 1.5; // 冲刺速度倍数
const STAMINA_DRAIN_RATE = 20; // 冲刺时耐力消耗速率（点/秒）
const STAMINA_REGEN_IDLE = 25; // 静止时耐力恢复速率（点/秒）
const STAMINA_REGEN_MOVING = 10; // 移动时耐力恢复速率（点/秒）
const STAMINA_MIN_TO_SPRINT = 1; // 开始冲刺所需的最小耐力

/**
 * 模拟玩家移动（包含碰撞检测）
 * 
 * @param pos 当前位置 { x, y }
 * @param keys 按键状态 { up, down, left, right }
 * @param deltaTime 时间间隔（秒）
 * @param mapWidth 地图宽度
 * @param mapHeight 地图高度
 * @param obstacles 障碍物列表
 * @param speedMultiplier 速度倍数（可选，用于装备 buff，默认为 1.0）
 * @param sprintMultiplier 冲刺倍数（可选，用于耐力冲刺，默认为 1.0）
 * @returns 新位置 { x, y }
 */
export function simulatePlayerMove(
  pos: { x: number; y: number },
  keys: { up: boolean; down: boolean; left: boolean; right: boolean },
  deltaTime: number,
  mapWidth: number,
  mapHeight: number,
  obstacles: OBSTACLE_STATE[] = [],
  speedMultiplier: number = 1.0,
  sprintMultiplier: number = 1.0
): { x: number; y: number } {
  // 计算移动向量
  let dx = 0;
  let dy = 0;
  
  if (keys.up) dy -= 1;
  if (keys.down) dy += 1;
  if (keys.left) dx -= 1;
  if (keys.right) dx += 1;
  
  // 归一化对角线移动（避免对角移动更快）
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len > 0) {
    dx = dx / len;
    dy = dy / len;
  }
  
  // 计算移动距离（应用速度倍数和冲刺倍数）
  const effectiveSpeed = PLAYER_SPEED * speedMultiplier * sprintMultiplier;
  const moveX = dx * effectiveSpeed * deltaTime;
  const moveY = dy * effectiveSpeed * deltaTime;
  
  // 新位置（未检查碰撞）
  let newX = pos.x + moveX;
  let newY = pos.y + moveY;
  
  // 分离轴碰撞检测：先处理 X 轴，再处理 Y 轴
  // 这样可以实现"滑动"效果，而不是完全停止
  
  // 检查 X 轴移动
  const testX = newX;
  let xBlocked = false;
  
  for (const obstacle of obstacles) {
    if (circleVsAABB(testX, pos.y, PLAYER_RADIUS, obstacle)) {
      xBlocked = true;
      break;
    }
  }
  
  if (xBlocked) {
    newX = pos.x; // 回退 X 轴移动
  }
  
  // 检查 Y 轴移动
  const testY = newY;
  let yBlocked = false;
  
  for (const obstacle of obstacles) {
    if (circleVsAABB(newX, testY, PLAYER_RADIUS, obstacle)) {
      yBlocked = true;
      break;
    }
  }
  
  if (yBlocked) {
    newY = pos.y; // 回退 Y 轴移动
  }
  
  // 世界边界限制（考虑玩家半径）
  newX = clamp(newX, PLAYER_RADIUS, mapWidth - PLAYER_RADIUS);
  newY = clamp(newY, PLAYER_RADIUS, mapHeight - PLAYER_RADIUS);
  
  return { x: newX, y: newY };
}

/**
 * 计算耐力变化
 * 
 * @param currentStamina 当前耐力值
 * @param maxStamina 最大耐力值
 * @param isSprinting 是否正在冲刺
 * @param isMoving 是否正在移动
 * @param deltaTime 时间间隔（秒）
 * @returns 新的耐力值
 */
export function calculateStaminaChange(
  currentStamina: number,
  maxStamina: number,
  isSprinting: boolean,
  isMoving: boolean,
  deltaTime: number
): number {
  let newStamina = currentStamina;
  
  if (isSprinting) {
    // 冲刺时消耗耐力
    newStamina -= STAMINA_DRAIN_RATE * deltaTime;
  } else {
    // 非冲刺时恢复耐力
    const regenRate = isMoving ? STAMINA_REGEN_MOVING : STAMINA_REGEN_IDLE;
    newStamina += regenRate * deltaTime;
  }
  
  // 限制在 0 到 maxStamina 之间
  return clamp(newStamina, 0, maxStamina);
}

/**
 * 检查是否可以开始冲刺
 * 
 * @param currentStamina 当前耐力值
 * @param wantsSprint 玩家是否想要冲刺
 * @returns 是否可以冲刺
 */
export function canSprint(currentStamina: number, wantsSprint: boolean): boolean {
  return wantsSprint && currentStamina >= STAMINA_MIN_TO_SPRINT;
}

/**
 * 计算冲刺速度倍数
 * 
 * @param isSprinting 是否正在冲刺
 * @returns 速度倍数
 */
export function getSprintSpeedMultiplier(isSprinting: boolean): number {
  return isSprinting ? STAMINA_SPRINT_MULTIPLIER : 1.0;
}










