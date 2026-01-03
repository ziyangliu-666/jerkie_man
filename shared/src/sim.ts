/**
 * 共享的玩家移动模拟逻辑
 * 确保 client 和 server 使用完全相同的移动/碰撞算法，避免位置漂移
 */
import { circleVsAABB, clampCircleInBounds } from './math.js';
import type { OBSTACLE_STATE } from './protocol.js';

/**
 * 玩家移动速度（像素/秒）
 */
export const PLAYER_SPEED = 200; // 200px/s，在20Hz tick下约10px/tick

/**
 * 玩家碰撞半径（与 server Player.processInput 一致）
 */
export const PLAYER_RADIUS = 10;

/**
 * 模拟玩家移动（分轴移动，实现沿墙滑动）
 * 这个函数必须与 server/src/player.ts 的 processInput 逻辑完全一致
 * 
 * @param pos 当前位置 {x, y}
 * @param keys 按键状态 {up, down, left, right}
 * @param deltaTime 时间步长（秒）
 * @param mapWidth 地图宽度
 * @param mapHeight 地图高度
 * @param obstacles 障碍物列表
 * @returns 新位置 {x, y}
 */
export function simulatePlayerMove(
  pos: { x: number; y: number },
  keys: { up: boolean; down: boolean; left: boolean; right: boolean },
  deltaTime: number,
  mapWidth: number,
  mapHeight: number,
  obstacles: OBSTACLE_STATE[] = []
): { x: number; y: number } {
  // 计算移动方向
  let dx = 0;
  let dy = 0;

  if (keys.up) dy -= 1;
  if (keys.down) dy += 1;
  if (keys.left) dx -= 1;
  if (keys.right) dx += 1;

  // 归一化对角线移动
  if (dx !== 0 && dy !== 0) {
    dx *= 0.707; // 1/sqrt(2)
    dy *= 0.707;
  }

  // 计算期望的新位置
  const desiredX = pos.x + dx * PLAYER_SPEED * deltaTime;
  const desiredY = pos.y + dy * PLAYER_SPEED * deltaTime;
  
  // 第一步：尝试 X 轴移动（newX, oldY）
  let finalX = pos.x;
  if (dx !== 0) {
    let testX = desiredX;
    // 边界检测
    const clampedX = clampCircleInBounds(testX, pos.y, PLAYER_RADIUS, 0, 0, mapWidth, mapHeight);
    testX = clampedX.x;
    
    // 障碍物碰撞检测
    let xCollided = false;
    for (const obstacle of obstacles) {
      if (circleVsAABB(testX, pos.y, PLAYER_RADIUS, obstacle)) {
        xCollided = true;
        break;
      }
    }
    
    if (!xCollided) {
      finalX = testX;
    }
  }
  
  // 第二步：尝试 Y 轴移动（finalX, newY）
  let finalY = pos.y;
  if (dy !== 0) {
    let testY = desiredY;
    // 边界检测
    const clampedY = clampCircleInBounds(finalX, testY, PLAYER_RADIUS, 0, 0, mapWidth, mapHeight);
    testY = clampedY.y;
    
    // 障碍物碰撞检测
    let yCollided = false;
    for (const obstacle of obstacles) {
      if (circleVsAABB(finalX, testY, PLAYER_RADIUS, obstacle)) {
        yCollided = true;
        break;
      }
    }
    
    if (!yCollided) {
      finalY = testY;
    }
  }
  
  return { x: finalX, y: finalY };
}


