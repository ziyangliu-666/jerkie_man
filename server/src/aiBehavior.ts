import type { Room } from './room.js';
import type { AI, PatrolConfig, GuardConfig } from './ai.js';
import type { Pathfinder } from './pathfinding.js';
import { Player } from './player.js';
import { Decoy } from './decoy.js';

type AITarget = Player | Decoy;
const DISGUISE_DETECTION_RADIUS = 150;
import type { OBSTACLE_STATE } from '@jerkie-man/shared';
import { msToTicks, getWeaponDef, advanceFireCooldown } from '@jerkie-man/shared';

// 注意：ATTACK_RANGE和CHASE_RANGE现在使用AI实例的aggroRange和chaseRange属性
const SEARCH_TIMEOUT_MS = 5000;  // 搜索超时5秒

export class AIBehaviorController {
  private room: Room;
  private pathfinder: Pathfinder;

  constructor(room: Room, pathfinder: Pathfinder) {
    this.room = room;
    this.pathfinder = pathfinder;
  }

  public updateAI(ai: AI, currentTick: number): void {
    if (ai.status !== 'ALIVE') {
      return;
    }

    const target = this.scanForTargets(ai);

    switch (ai.behaviorState) {
      case 'IDLE':
        this.handleIdleState(ai, target, currentTick);
        break;
      case 'PATROL':
        this.handlePatrolState(ai, target, currentTick);
        break;
      case 'SPOTTING':
        this.handleSpottingState(ai, target, currentTick);
        break;
      case 'CHASE':
        this.handleChaseState(ai, target, currentTick);
        break;
      case 'ATTACK':
        this.handleAttackState(ai, target, currentTick);
        break;
      case 'SEARCH':
        this.handleSearchState(ai, target, currentTick);
        break;
      case 'RETURN':
        this.handleReturnState(ai, target, currentTick);
        break;
    }

    this.moveAlongPath(ai, currentTick);
  }

  private scanForTargets(ai: AI): AITarget | null {
    let closestTarget: AITarget | null = null;
    let closestDist = Infinity;

    // 如果AI处于致盲状态，完全丧失目标感知能力
    const now = Date.now();
    if (ai.flashedUntil > now) {
      return null;
    }

    // 预先计算AI是否在烟雾内：在烟雾中的AI无法攻击任何目标
    const aiInSmoke = this.room.isPointInSmoke(ai.x, ai.y);

    // 收集所有潜在目标（玩家 + 诱饵）
    const potentialTargets: AITarget[] = [];
    for (const player of this.room.players.values()) {
      if (player.status === 'ALIVE') {
        potentialTargets.push(player);
      }
    }
    for (const decoy of this.room.decoys) {
      if (decoy.hp > 0) {
        potentialTargets.push(decoy);
      }
    }

    for (const target of potentialTargets) {
      const dx = target.x - ai.x;
      const dy = target.y - ai.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > ai.visionRange) {
        continue;
      }

      // 伪装检查：AI完全忽略伪装的玩家（简化逻辑）
      if (target instanceof Player && target.isDisguised()) {
        continue;
      }

      // 烟雾遮蔽逻辑
      const targetInSmoke = this.room.isPointInSmoke(target.x, target.y);
      if (aiInSmoke || targetInSmoke) {
        continue;
      }

      // 视野角度检测
      if (ai.visionAngleDeg < 360) {
        const angleToTarget = Math.atan2(dy, dx);
        const angleDiff = Math.abs(angleToTarget - ai.currentAimRad);
        const normalizedDiff = Math.min(angleDiff, Math.PI * 2 - angleDiff);
        if (normalizedDiff > (ai.visionAngleDeg * Math.PI / 180) / 2) {
          continue;
        }
      }

      // 检查目标是否在草丛中
      // 重用 isTargetInBush (原 isPlayerInBush)
      const targetInBush = this.isTargetInBush(target.x, target.y);
      
      // 检查AI是否已经追踪过这个目标
      const hasTrackedTarget = ai.currentTargetId === target.id || 
        (ai.lastSeenTargetX !== undefined && 
         ai.lastSeenTargetY !== undefined &&
         Math.sqrt(
           Math.pow(ai.lastSeenTargetX - target.x, 2) + 
           Math.pow(ai.lastSeenTargetY - target.y, 2)
         ) < 100); 
      
      const allowBushConcealment = targetInBush && hasTrackedTarget;
      const losResult = this.hasLineOfSight(ai.x, ai.y, target.x, target.y, allowBushConcealment);
      
      if (!losResult.visible) {
        continue; // 完全被遮挡
      }

      if (dist < closestDist) {
        closestTarget = target;
        closestDist = dist;
        ai.targetInBush = targetInBush && losResult.blockedByBush && hasTrackedTarget;
      }
    }

    return closestTarget;
  }

  // 新增: 检测目标(玩家或诱饵)是否在草丛中
  private isTargetInBush(x: number, y: number): boolean {
    const TARGET_RADIUS = 10;
    for (const obstacle of this.room.obstacles) {
      const obsType = (obstacle as any).type || 'wall';
      if (obsType === 'bush') {
        // 使用圆形与AABB碰撞检测
        if (
          x + TARGET_RADIUS >= obstacle.x &&
          x - TARGET_RADIUS <= obstacle.x + obstacle.w &&
          y + TARGET_RADIUS >= obstacle.y &&
          y - TARGET_RADIUS <= obstacle.y + obstacle.h
        ) {
          return true;
        }
      }
    }
    return false;
  }

  // 新增: 找到包含玩家的草丛障碍物
  private findBushContainingPlayer(x: number, y: number): OBSTACLE_STATE | null {
    const PLAYER_RADIUS = 10;
    for (const obstacle of this.room.obstacles) {
      const obsType = (obstacle as any).type || 'wall';
      if (obsType === 'bush') {
        // 使用圆形与AABB碰撞检测
        if (
          x + PLAYER_RADIUS >= obstacle.x &&
          x - PLAYER_RADIUS <= obstacle.x + obstacle.w &&
          y + PLAYER_RADIUS >= obstacle.y &&
          y - PLAYER_RADIUS <= obstacle.y + obstacle.h
        ) {
          return obstacle;
        }
      }
    }
    return null;
  }

  // 检测某个方向是否开阔（没有障碍物阻挡）
  private isDirectionOpen(x: number, y: number, angle: number, checkDistance: number = 150): boolean {
    const endX = x + Math.cos(angle) * checkDistance;
    const endY = y + Math.sin(angle) * checkDistance;
    const dx = endX - x;
    const dy = endY - y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.ceil(dist / 10);

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const checkX = x + dx * t;
      const checkY = y + dy * t;

      for (const obstacle of this.room.obstacles) {
        const obsType = (obstacle as any).type || 'wall';
        // 水和草丛不算阻挡（可以看穿）
        if (obsType === 'water' || obsType === 'bush') {
          continue;
        }
        
        // 其他障碍物（墙、木箱）阻挡视线
        if (
          checkX >= obstacle.x &&
          checkX <= obstacle.x + obstacle.w &&
          checkY >= obstacle.y &&
          checkY <= obstacle.y + obstacle.h
        ) {
          return false; // 被障碍物阻挡
        }
      }
    }

    return true; // 方向开阔
  }

  // 查找最开阔的方向（在指定角度范围内）
  private findOpenDirection(x: number, y: number, baseAngle: number, angleRange: number, sampleCount: number = 8): number | null {
    const step = angleRange / (sampleCount - 1);
    let bestAngle: number | null = null;
    let maxOpenDistance = 0;

    // 从 -angleRange/2 到 +angleRange/2 扫描
    for (let i = 0; i < sampleCount; i++) {
      const offset = -angleRange / 2 + i * step;
      const testAngle = baseAngle + offset;
      // 规范化角度
      let normalizedAngle = testAngle;
      while (normalizedAngle < 0) normalizedAngle += Math.PI * 2;
      while (normalizedAngle >= Math.PI * 2) normalizedAngle -= Math.PI * 2;

      // 检测这个方向能看多远
      const openDistance = this.getOpenDistance(x, y, normalizedAngle);
      if (openDistance > maxOpenDistance) {
        maxOpenDistance = openDistance;
        bestAngle = normalizedAngle;
      }
    }

    return bestAngle;
  }

  // 扫描左右两侧的所有开阔区域，返回带权重的区域列表
  private scanOpenAreas(x: number, y: number, baseAngle: number, leftRange: number, rightRange: number, sampleCount: number = 20): Array<{ angle: number; distance: number; weight: number }> {
    const areas: Array<{ angle: number; distance: number; weight: number }> = [];
    const minOpenDistance = 30; // 最小开阔距离阈值（小于这个值不算开阔区域）

    // 扫描左侧（-leftRange 到 0）
    const leftStep = leftRange / (sampleCount / 2);
    for (let i = 0; i <= sampleCount / 2; i++) {
      const offset = -leftRange + i * leftStep;
      const testAngle = baseAngle + offset;
      let normalizedAngle = testAngle;
      while (normalizedAngle < 0) normalizedAngle += Math.PI * 2;
      while (normalizedAngle >= Math.PI * 2) normalizedAngle -= Math.PI * 2;

      const openDistance = this.getOpenDistance(x, y, normalizedAngle);
      if (openDistance >= minOpenDistance) {
        // 权重 = 开阔距离的平方（更开阔的区域权重更高）
        const weight = openDistance * openDistance;
        areas.push({ angle: normalizedAngle, distance: openDistance, weight });
      }
    }

    // 扫描右侧（0 到 +rightRange）
    const rightStep = rightRange / (sampleCount / 2);
    for (let i = 0; i <= sampleCount / 2; i++) {
      const offset = i * rightStep;
      const testAngle = baseAngle + offset;
      let normalizedAngle = testAngle;
      while (normalizedAngle < 0) normalizedAngle += Math.PI * 2;
      while (normalizedAngle >= Math.PI * 2) normalizedAngle -= Math.PI * 2;

      const openDistance = this.getOpenDistance(x, y, normalizedAngle);
      if (openDistance >= minOpenDistance) {
        const weight = openDistance * openDistance;
        areas.push({ angle: normalizedAngle, distance: openDistance, weight });
      }
    }

    // 合并相近的区域（避免重复）
    const mergedAreas: Array<{ angle: number; distance: number; weight: number }> = [];
    const mergeThreshold = 15 * Math.PI / 180; // 15度内的区域合并

    for (const area of areas) {
      let merged = false;
      for (const mergedArea of mergedAreas) {
        let angleDiff = Math.abs(area.angle - mergedArea.angle);
        if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;

        if (angleDiff < mergeThreshold) {
          // 合并：取平均角度，最大距离，累加权重
          mergedArea.angle = (mergedArea.angle + area.angle) / 2;
          mergedArea.distance = Math.max(mergedArea.distance, area.distance);
          mergedArea.weight += area.weight;
          merged = true;
          break;
        }
      }

      if (!merged) {
        mergedAreas.push({ ...area });
      }
    }

    // 规范化角度
    for (const area of mergedAreas) {
      while (area.angle < 0) area.angle += Math.PI * 2;
      while (area.angle >= Math.PI * 2) area.angle -= Math.PI * 2;
    }

    // 按权重排序（权重高的在前）
    mergedAreas.sort((a, b) => b.weight - a.weight);

    return mergedAreas;
  }

  // 根据权重随机选择一个开阔区域
  private selectOpenAreaByWeight(areas: Array<{ angle: number; distance: number; weight: number }>): number | null {
    if (areas.length === 0) return null;
    if (areas.length === 1) return areas[0].angle;

    // 计算总权重
    const totalWeight = areas.reduce((sum, area) => sum + area.weight, 0);
    if (totalWeight === 0) return areas[0].angle;

    // 加权随机选择
    let random = Math.random() * totalWeight;
    for (const area of areas) {
      random -= area.weight;
      if (random <= 0) {
        return area.angle;
      }
    }

    // 兜底：返回权重最高的
    return areas[0].angle;
  }

  // 获取某个方向能看多远（直到遇到障碍物）
  private getOpenDistance(x: number, y: number, angle: number, maxDistance: number = 200): number {
    const step = 10; // 每10像素检测一次
    let distance = 0;

    while (distance < maxDistance) {
      distance += step;
      const checkX = x + Math.cos(angle) * distance;
      const checkY = y + Math.sin(angle) * distance;

      for (const obstacle of this.room.obstacles) {
        const obsType = (obstacle as any).type || 'wall';
        // 水和草丛不算阻挡
        if (obsType === 'water' || obsType === 'bush') {
          continue;
        }
        
        // 其他障碍物阻挡视线
        if (
          checkX >= obstacle.x &&
          checkX <= obstacle.x + obstacle.w &&
          checkY >= obstacle.y &&
          checkY <= obstacle.y + obstacle.h
        ) {
          return distance - step; // 返回障碍物前的距离
        }
      }
    }

    return maxDistance; // 没有障碍物，返回最大距离
  }

  // 修改: 返回视线检测结果（包含是否可见和是否被草丛遮挡）
  private hasLineOfSight(x1: number, y1: number, x2: number, y2: number, targetInBush: boolean): { visible: boolean; blockedByBush: boolean } {
    // 如果目标在草丛中，AI可以"感知"到位置（半遮挡机制）
    if (targetInBush) {
      // 检查射线上是否有非草丛障碍物阻挡
      const dx = x2 - x1;
      const dy = y2 - y1;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const steps = Math.ceil(dist / 10);

      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = x1 + dx * t;
        const y = y1 + dy * t;

        for (const obstacle of this.room.obstacles) {
          const obsType = (obstacle as any).type || 'wall';
          if (obsType === 'water' || obsType === 'bush') {
            continue; // 水和草丛不阻挡对草丛内目标的视线
          }
          
          // 其他障碍物（墙、木箱）完全阻挡视线
          if (
            x >= obstacle.x &&
            x <= obstacle.x + obstacle.w &&
            y >= obstacle.y &&
            y <= obstacle.y + obstacle.h
          ) {
            return { visible: false, blockedByBush: false };
          }
        }
      }
      
      // 目标在草丛中，AI可以感知到位置（半遮挡）
      return { visible: true, blockedByBush: true };
    }

    // 目标不在草丛中，正常视线检测
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.ceil(dist / 10);

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x1 + dx * t;
      const y = y1 + dy * t;

      for (const obstacle of this.room.obstacles) {
        const obsType = (obstacle as any).type || 'wall';
        if (obsType === 'water') {
          continue; // 水不阻挡视线
        }
        
        // 草丛阻挡对草丛外目标的视线（半遮挡）
        if (obsType === 'bush') {
          if (
            x >= obstacle.x &&
            x <= obstacle.x + obstacle.w &&
            y >= obstacle.y &&
            y <= obstacle.y + obstacle.h
          ) {
            return { visible: false, blockedByBush: true };
          }
        }
        
        // 其他障碍物（墙、木箱）完全阻挡视线
        if (
          x >= obstacle.x &&
          x <= obstacle.x + obstacle.w &&
          y >= obstacle.y &&
          y <= obstacle.y + obstacle.h
        ) {
          return { visible: false, blockedByBush: false };
        }
      }
    }

    return { visible: true, blockedByBush: false };
  }

  private handleIdleState(ai: AI, target: AITarget | null, currentTick: number): void {
    if (target) {
      // 发现目标，立即进入SPOTTING状态（反应延迟期）
      const now = Date.now();
      ai.firstSpottedTime = now;
      ai.currentTargetId = target.id;
      ai.behaviorState = 'SPOTTING';

      // 清除IDLE行为状态
      ai.idleLookTargetAngle = undefined;
      ai.idleNextLookChangeTime = undefined;
      ai.idleLookDirection = undefined;
      ai.idleBaseAngle = undefined;
      ai.idleOpenAreas = undefined;
      ai.idleCurrentAreaIndex = undefined;
      ai.idleWanderTarget = undefined;
      ai.idleNextWanderTime = undefined;
      return;
    }

    // 如果AI有最后已知的敌人位置（比如被攻击后），进入搜索状态
    if (ai.lastSeenTargetX !== undefined && ai.lastSeenTargetY !== undefined) {
      const timeSinceLastSeen = ai.lastSeenTargetTime ? Date.now() - ai.lastSeenTargetTime : Infinity;
      if (timeSinceLastSeen < SEARCH_TIMEOUT_MS) {
        // 清除 IDLE 行为状态
        ai.idleLookTargetAngle = undefined;
        ai.idleNextLookChangeTime = undefined;
        ai.idleLookDirection = undefined;
        ai.idleBaseAngle = undefined;
        ai.idleOpenAreas = undefined;
        ai.idleCurrentAreaIndex = undefined;
        ai.idleWanderTarget = undefined;
        ai.idleNextWanderTime = undefined;
        ai.behaviorState = 'SEARCH';
        return;
      }
    }

    // 如果是巡逻类型，切换到巡逻状态
    if (ai.behaviorType === 'PATROL' && ai.patrolConfig) {
      // 清除 IDLE 行为状态
      ai.idleLookTargetAngle = undefined;
      ai.idleNextLookChangeTime = undefined;
      ai.idleLookDirection = undefined;
      ai.idleBaseAngle = undefined;
      ai.idleOpenAreas = undefined;
      ai.idleCurrentAreaIndex = undefined;
      ai.idleWanderTarget = undefined;
      ai.idleNextWanderTime = undefined;
      ai.behaviorState = 'PATROL';
      return;
    }

    // ===== IDLE 状态活跃行为 =====
    const now = Date.now();

    // 初始化基础角度（第一次进入 IDLE 时）
    if (ai.idleBaseAngle === undefined) {
      ai.idleBaseAngle = ai.currentAimRad;
    }

    // 1. 大幅转动视角（模拟人类守卫左顾右盼，在多个开阔区域之间切换）
    if (ai.idleOpenAreas === undefined || ai.idleOpenAreas.length === 0 || (ai.idleNextLookChangeTime && now >= ai.idleNextLookChangeTime)) {
      // 扫描左右两侧的所有开阔区域
      const baseAngle = ai.idleBaseAngle;
      const leftRange = 120 * Math.PI / 180;  // 左侧扫描范围 120 度
      const rightRange = 120 * Math.PI / 180; // 右侧扫描范围 120 度
      ai.idleOpenAreas = this.scanOpenAreas(ai.x, ai.y, baseAngle, leftRange, rightRange, 30);

      if (ai.idleOpenAreas.length === 0) {
        // 如果没有开阔区域（比如被墙包围），使用基础角度
        ai.idleLookTargetAngle = baseAngle;
        ai.idleCurrentAreaIndex = undefined;
        ai.idleNextLookChangeTime = now + 2000; // 2秒后重试
      } else {
        // 根据权重选择下一个开阔区域
        // 如果当前有区域列表，避免连续选择同一个区域
        let selectedAngle: number | null = null;
        let selectedIndex: number | undefined = undefined;

        if (ai.idleCurrentAreaIndex !== undefined && ai.idleCurrentAreaIndex < ai.idleOpenAreas.length) {
          // 移除当前区域，从剩余区域中选择
          const remainingAreas = [...ai.idleOpenAreas];
          remainingAreas.splice(ai.idleCurrentAreaIndex, 1);
          if (remainingAreas.length > 0) {
            selectedAngle = this.selectOpenAreaByWeight(remainingAreas);
            if (selectedAngle !== null) {
              // 找到选中角度在原列表中的索引
              const foundIndex = ai.idleOpenAreas.findIndex(area => 
                Math.abs(area.angle - selectedAngle!) < 0.01
              );
              if (foundIndex >= 0) {
                selectedIndex = foundIndex;
              }
            }
          }
        }

        // 如果没找到或第一次选择，从所有区域中选择
        if (selectedAngle === null) {
          selectedAngle = this.selectOpenAreaByWeight(ai.idleOpenAreas);
          if (selectedAngle !== null) {
            const foundIndex = ai.idleOpenAreas.findIndex(area => 
              Math.abs(area.angle - selectedAngle!) < 0.01
            );
            if (foundIndex >= 0) {
              selectedIndex = foundIndex;
            }
          }
        }

        if (selectedAngle !== null) {
          ai.idleLookTargetAngle = selectedAngle;
          ai.idleCurrentAreaIndex = selectedIndex;

          // 根据开阔程度调整停留时间（更开阔的区域停留更久）
          if (selectedIndex !== undefined && selectedIndex < ai.idleOpenAreas.length) {
            const currentArea = ai.idleOpenAreas[selectedIndex];
            const baseWaitTime = 1500; // 基础等待时间 1.5秒
            const extraWaitTime = (currentArea.distance / 200) * 1000; // 根据开阔程度增加时间（最多+1秒）
            ai.idleNextLookChangeTime = now + baseWaitTime + extraWaitTime + Math.random() * 500;
          } else {
            ai.idleNextLookChangeTime = now + 1500 + Math.random() * 500;
          }
        } else {
          // 兜底：使用基础角度
          ai.idleLookTargetAngle = baseAngle;
          ai.idleCurrentAreaIndex = undefined;
          ai.idleNextLookChangeTime = now + 2000;
        }
      }
    }

    // 快速转向目标角度（模拟人类快速转头）
    if (ai.idleLookTargetAngle !== undefined) {
      let angleDiff = ai.idleLookTargetAngle - ai.currentAimRad;
      // 规范化角度差到 [-π, π]
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

      // 快速转向（每秒约 270 度，模拟人类快速转头）
      const turnSpeed = (270 * Math.PI / 180) * 0.05; // 每 tick 转动的弧度
      if (Math.abs(angleDiff) > turnSpeed) {
        ai.currentAimRad += Math.sign(angleDiff) * turnSpeed;
      } else {
        ai.currentAimRad = ai.idleLookTargetAngle;
      }
      // 规范化角度
      while (ai.currentAimRad < 0) ai.currentAimRad += Math.PI * 2;
      while (ai.currentAimRad >= Math.PI * 2) ai.currentAimRad -= Math.PI * 2;
    }

    // 2. 小幅随机移动（模拟警戒状态）
    if (ai.idleWanderTarget === undefined || (ai.idleNextWanderTime && now >= ai.idleNextWanderTime)) {
      // 在出生点周围 30-80 像素范围内随机移动
      const wanderRadius = 30 + Math.random() * 50;
      const wanderAngle = Math.random() * Math.PI * 2;
      ai.idleWanderTarget = {
        x: ai.spawnX + Math.cos(wanderAngle) * wanderRadius,
        y: ai.spawnY + Math.sin(wanderAngle) * wanderRadius
      };
      // 3-8秒后改变移动目标
      ai.idleNextWanderTime = now + 3000 + Math.random() * 5000;
    }

    // 移动到随机目标位置
    if (ai.idleWanderTarget) {
      const dx = ai.idleWanderTarget.x - ai.x;
      const dy = ai.idleWanderTarget.y - ai.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > 10) {
        // 缓慢移动（正常速度的 30%，应用角色速度倍率）
        const baseSpeed = 400 * 0.3; // 120 像素/秒
        const speed = baseSpeed * ai.moveSpeed; // 应用角色速度倍率
        const deltaTime = 0.05; // 50ms tick
        const moveDistance = speed * deltaTime;

        const moveX = (dx / dist) * moveDistance;
        const moveY = (dy / dist) * moveDistance;

        ai.x += moveX;
        ai.y += moveY;
      } else {
        // 到达目标，清除目标（等待下次生成新目标）
        ai.idleWanderTarget = undefined;
      }
    }
  }

  private handlePatrolState(ai: AI, target: AITarget | null, currentTick: number): void {
    if (target) {
      // 发现目标，立即进入SPOTTING状态（反应延迟期）
      const now = Date.now();
      ai.firstSpottedTime = now;
      ai.currentTargetId = target.id;
      ai.behaviorState = 'SPOTTING';
      return;
    }

    if (!ai.patrolConfig) {
      ai.behaviorState = 'IDLE';
      return;
    }

    const patrol = ai.patrolConfig;
    const now = Date.now();

    // 在巡逻点等待
    if (now < patrol.waitUntil) {
      ai.currentPath = [];
      return;
    }

    // 导航到下一个巡逻点
    const targetPoint = patrol.points[patrol.currentIndex];
    const dx = targetPoint.x - ai.x;
    const dy = targetPoint.y - ai.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // 修复：只有在AI已经有路径的情况下，才认为"到达巡逻点"
    // 这样可以避免AI在生成时距离巡逻点很近时，错误地进入等待状态
    if (dist < 30 && ai.currentPath.length > 0) {
      // 到达巡逻点
      patrol.currentIndex = (patrol.currentIndex + 1) % patrol.points.length;
      patrol.waitUntil = now + patrol.waitTimeMs;
      ai.currentPath = [];
    } else {
      // 未到达或刚生成，生成前往巡逻点的路径
      this.updatePath(ai, targetPoint.x, targetPoint.y);
    }
  }

  // 新增：处理SPOTTING状态（反应延迟期，发现目标后的1秒）
  private handleSpottingState(ai: AI, target: AITarget | null, currentTick: number): void {
    if (target) {
      const now = Date.now();

      // 更新最后已知位置
      ai.lastSeenTargetX = target.x;
      ai.lastSeenTargetY = target.y;
      ai.lastSeenTargetTime = now;

      // 检查反应延迟是否结束
      if (ai.firstSpottedTime) {
        const reactionElapsed = now - ai.firstSpottedTime;
        if (reactionElapsed >= ai.reactionDelayMs) {
          // 反应延迟结束，切换到CHASE状态
          ai.behaviorState = 'CHASE';
          ai.firstSpottedTime = undefined; // 清除反应计时
          return;
        }
      }

      // 仍在反应延迟期间，继续瞄准目标但不移动
      // 更新瞄准方向
      const dx = target.x - ai.x;
      const dy = target.y - ai.y;
      ai.currentAimRad = Math.atan2(dy, dx);
      return;
    } else {
      // 失去目标
      ai.firstSpottedTime = undefined;
      ai.currentTargetId = undefined;

      // 如果有最后已知位置且刚看到不久，进入短暂搜索
      if (ai.lastSeenTargetX !== undefined && ai.lastSeenTargetY !== undefined) {
        const timeSinceLastSeen = ai.lastSeenTargetTime ? Date.now() - ai.lastSeenTargetTime : Infinity;
        // 如果是刚失去目标（3秒内），进入搜索
        if (timeSinceLastSeen < 3000) {
          ai.behaviorState = 'SEARCH';
          return;
        }
      }

      // 否则返回原状态（根据AI类型）
      if (ai.patrolConfig) {
        ai.behaviorState = 'PATROL';
      } else {
        ai.behaviorState = 'IDLE';
      }
    }
  }

  private handleChaseState(ai: AI, target: AITarget | null, currentTick: number): void {
    if (target) {
      const dx = target.x - ai.x;
      const dy = target.y - ai.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // 更新最后已知位置
      ai.lastSeenTargetX = target.x;
      ai.lastSeenTargetY = target.y;
      ai.lastSeenTargetTime = Date.now();

      // 进入攻击范围
      if (dist <= ai.aggroRange) { // 使用AI的aggroRange属性
        ai.behaviorState = 'ATTACK';
        ai.currentPath = [];
        return;
      }

      // 继续追击
      this.updatePath(ai, target.x, target.y);
    } else {
      // 失去目标，进入搜索状态
      ai.behaviorState = 'SEARCH';
      ai.targetInBush = undefined;
    }
  }

  private handleAttackState(ai: AI, target: AITarget | null, currentTick: number): void {
    if (target) {
      const dx = target.x - ai.x;
      const dy = target.y - ai.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // 更新最后已知位置
      ai.lastSeenTargetX = target.x;
      ai.lastSeenTargetY = target.y;
      ai.lastSeenTargetTime = Date.now();

      // 目标逃离攻击范围，切换到追击
      if (dist > ai.chaseRange) { // 使用AI的chaseRange属性
        ai.behaviorState = 'CHASE';
        return;
      }

      // 如果目标在草丛中，瞄准草丛区域进行扫射；否则正常跟踪瞄准
      if (ai.targetInBush) {
        // 找到目标所在的草丛障碍物
        const bushObstacle = this.findBushContainingPlayer(target.x, target.y);
        if (bushObstacle) {
          // 瞄准草丛内的随机位置（扫射草丛）
          const bushCenterX = bushObstacle.x + bushObstacle.w / 2;
          const bushCenterY = bushObstacle.y + bushObstacle.h / 2;
          // 在草丛范围内随机偏移（±草丛宽度/高度的30%）
          const offsetX = (Math.random() - 0.5) * bushObstacle.w * 0.6;
          const offsetY = (Math.random() - 0.5) * bushObstacle.h * 0.6;
          const targetX = bushCenterX + offsetX;
          const targetY = bushCenterY + offsetY;
          // 瞄准草丛内的随机位置
          const aimAngle = Math.atan2(targetY - ai.y, targetX - ai.x);
          ai.currentAimRad = aimAngle;
        } else {
          // 找不到草丛，回退到目标方向±30度随机
          const baseAngle = Math.atan2(dy, dx);
          const randomOffset = (Math.random() - 0.5) * 2 * (30 * Math.PI / 180);
          ai.currentAimRad = baseAngle + randomOffset;
        }
      } else {
        // 正常瞄准（带误差）
        this.updateAim(ai, target.x, target.y, currentTick);
      }

      // 尝试开火
      this.attemptFire(ai, currentTick);

      // 战术移动：每1秒侧向移动
      if (currentTick % 20 === 0 && dist < ai.aggroRange && dist > 80) { // 使用AI的aggroRange属性
        const perpAngle = Math.atan2(dy, dx) + (Math.random() > 0.5 ? Math.PI / 2 : -Math.PI / 2);
        const strafeDistance = 60;
        const strafeX = ai.x + Math.cos(perpAngle) * strafeDistance;
        const strafeY = ai.y + Math.sin(perpAngle) * strafeDistance;
        this.updatePath(ai, strafeX, strafeY);
      }
    } else {
      // 失去目标
      ai.behaviorState = 'SEARCH';
      ai.targetInBush = undefined;
    }
  }

  private handleSearchState(ai: AI, target: AITarget | null, currentTick: number): void {
    if (target) {
      // 重新发现目标时，同样先进入 SPOTTING 状态，统一使用反应延迟
      const now = Date.now();
      ai.firstSpottedTime = now;
      ai.currentTargetId = target.id;
      ai.lastSeenTargetX = target.x;
      ai.lastSeenTargetY = target.y;
      ai.lastSeenTargetTime = now;
      ai.behaviorState = 'SPOTTING';
      ai.currentPath = [];
      return;
    }

    // 搜索超时，返回原点
    if (ai.lastSeenTargetTime && Date.now() - ai.lastSeenTargetTime > SEARCH_TIMEOUT_MS) {
      ai.behaviorState = 'RETURN';
      ai.currentTargetId = undefined;
      return;
    }

    // 前往最后已知位置
    if (ai.lastSeenTargetX !== undefined && ai.lastSeenTargetY !== undefined) {
      const dx = ai.lastSeenTargetX - ai.x;
      const dy = ai.lastSeenTargetY - ai.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 50) {
        // 到达最后已知位置，仍未发现目标
        ai.lastSeenTargetX = undefined;
        ai.lastSeenTargetY = undefined;
      } else {
        this.updatePath(ai, ai.lastSeenTargetX, ai.lastSeenTargetY);
      }
    }
  }

  private handleReturnState(ai: AI, target: AITarget | null, currentTick: number): void {
    if (target) {
      // 返回途中发现目标时，也先进入 SPOTTING 状态，使用统一的 1 秒反应延迟
      const now = Date.now();
      ai.firstSpottedTime = now;
      ai.behaviorState = 'SPOTTING';
      ai.currentTargetId = target.id;
      ai.lastSeenTargetX = target.x;
      ai.lastSeenTargetY = target.y;
      ai.lastSeenTargetTime = now;
      ai.currentPath = [];
      return;
    }

    // 返回出生点
    const dx = ai.spawnX - ai.x;
    const dy = ai.spawnY - ai.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 50) {
      // 到达出生点，恢复原始状态
      ai.behaviorState = ai.behaviorType === 'PATROL' ? 'PATROL' : 'IDLE';
      ai.currentPath = [];
      ai.currentTargetId = undefined;
      ai.lastSeenTargetX = undefined;
      ai.lastSeenTargetY = undefined;
      ai.lastSeenTargetTime = undefined;
    } else {
      this.updatePath(ai, ai.spawnX, ai.spawnY);
    }
  }

  private updatePath(ai: AI, targetX: number, targetY: number): void {
    // 路径更新冷却
    if (ai.pathUpdateCooldown > 0) {
      ai.pathUpdateCooldown--;
      return;
    }

    const path = this.pathfinder.findPath(ai.x, ai.y, targetX, targetY);
    if (path.length > 0) {
      ai.currentPath = path;
      ai.pathUpdateCooldown = ai.PATH_UPDATE_INTERVAL;
    }
  }

  private moveAlongPath(ai: AI, currentTick: number): void {
    if (ai.currentPath.length === 0) {
      return;
    }

    const nextWaypoint = ai.currentPath[0];
    const dx = nextWaypoint.x - ai.x;
    const dy = nextWaypoint.y - ai.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 15) {
      // 到达路径点，移除
      ai.currentPath.shift();
      if (ai.currentPath.length > 0) {
        this.moveAlongPath(ai, currentTick);
      }
      return;
    }

    // 移动向路径点（应用角色速度倍率）
    const baseSpeed = 100; // AI基础移动速度 (像素/秒)
    const speed = baseSpeed * ai.moveSpeed; // 应用角色速度倍率
    const deltaTime = 0.05; // 50ms tick
    const moveDistance = speed * deltaTime;

    const moveX = (dx / dist) * moveDistance;
    const moveY = (dy / dist) * moveDistance;

    ai.x += moveX;
    ai.y += moveY;

    // 更新瞄准方向为移动方向
    ai.currentAimRad = Math.atan2(dy, dx);
  }

  private updateAim(ai: AI, targetX: number, targetY: number, currentTick: number): void {
    const UPDATE_INTERVAL = 5; // 每250ms更新瞄准

    if (currentTick < ai.nextAimUpdateTick) {
      return;
    }
    ai.nextAimUpdateTick = currentTick + UPDATE_INTERVAL;

    const dx = targetX - ai.x;
    const dy = targetY - ai.y;
    const idealAim = Math.atan2(dy, dx);

    // 添加随机误差（使用AI的aimErrorDeg属性）
    const errorRad = ((Math.random() - 0.5) * 2 * ai.aimErrorDeg * Math.PI) / 180;
    ai.currentAimRad = idealAim + errorRad;
  }

  private attemptFire(ai: AI, currentTick: number): void {
    if (!ai.weaponRuntime) {
      return;
    }

    const wr = ai.weaponRuntime;
    if (currentTick < wr.reloadingUntilTick) {
      return;
    }
    if (currentTick < wr.nextFireTick) {
      return;
    }

    if (wr.ammoInMag <= 0) {
      // 自动换弹
      const weaponDef = getWeaponDef(wr.weaponTypeId);
      wr.reloadingUntilTick = currentTick + msToTicks(weaponDef.reloadMs);
      wr.ammoInMag = weaponDef.magSize;
      return;
    }

    // 开火
    this.room.aiFireWeapon(ai, ai.currentAimRad, currentTick);
  }
}
