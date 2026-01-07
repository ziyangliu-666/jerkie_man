import type { Room } from './room.js';
import type { AI, PatrolConfig, GuardConfig } from './ai.js';
import type { Pathfinder } from './pathfinding.js';
import { Player } from './player.js';
import { msToTicks, getWeaponDef, advanceFireCooldown } from '@jerkie-man/shared';

const ATTACK_RANGE = 250;  // 攻击距离
const CHASE_RANGE = 300;   // 追击距离
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

  private scanForTargets(ai: AI): Player | null {
    let closestTarget: Player | null = null;
    let closestDist = Infinity;

    // 只扫描玩家作为目标，AI之间不互相攻击
    for (const [playerId, player] of this.room.players.entries()) {
      if (player.status !== 'ALIVE') {
        continue;
      }

      const dx = player.x - ai.x;
      const dy = player.y - ai.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > ai.visionRange) {
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

      // 视线遮挡检测
      if (!this.hasLineOfSight(ai.x, ai.y, player.x, player.y)) {
        continue;
      }

      if (dist < closestDist) {
        closestTarget = player;
        closestDist = dist;
      }
    }

    return closestTarget;
  }

  private hasLineOfSight(x1: number, y1: number, x2: number, y2: number): boolean {
    // 射线检测：每10像素采样一次
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
        if (obsType === 'bush' || obsType === 'water') {
          continue; // 草丛和水不阻挡视线
        }

        if (
          x >= obstacle.x &&
          x <= obstacle.x + obstacle.w &&
          y >= obstacle.y &&
          y <= obstacle.y + obstacle.h
        ) {
          return false;
        }
      }
    }

    return true;
  }

  private handleIdleState(ai: AI, target: Player | null, currentTick: number): void {
    if (target) {
      ai.behaviorState = 'CHASE';
      ai.currentTargetId = target.id;
      ai.lastSeenTargetX = target.x;
      ai.lastSeenTargetY = target.y;
      ai.lastSeenTargetTime = Date.now();
      return;
    }

    // 如果是巡逻类型，切换到巡逻状态
    if (ai.behaviorType === 'PATROL' && ai.patrolConfig) {
      ai.behaviorState = 'PATROL';
    }
  }

  private handlePatrolState(ai: AI, target: Player | null, currentTick: number): void {
    if (target) {
      ai.behaviorState = 'CHASE';
      ai.currentTargetId = target.id;
      ai.lastSeenTargetX = target.x;
      ai.lastSeenTargetY = target.y;
      ai.lastSeenTargetTime = Date.now();
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

    if (dist < 30) {
      // 到达巡逻点
      patrol.currentIndex = (patrol.currentIndex + 1) % patrol.points.length;
      patrol.waitUntil = now + patrol.waitTimeMs;
      ai.currentPath = [];
    } else {
      this.updatePath(ai, targetPoint.x, targetPoint.y);
    }
  }

  private handleChaseState(ai: AI, target: Player | null, currentTick: number): void {
    if (target) {
      const dx = target.x - ai.x;
      const dy = target.y - ai.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // 更新最后已知位置
      ai.lastSeenTargetX = target.x;
      ai.lastSeenTargetY = target.y;
      ai.lastSeenTargetTime = Date.now();

      // 进入攻击范围
      if (dist <= ATTACK_RANGE) {
        ai.behaviorState = 'ATTACK';
        ai.currentPath = [];
        return;
      }

      // 继续追击
      this.updatePath(ai, target.x, target.y);
    } else {
      // 失去目标，进入搜索状态
      ai.behaviorState = 'SEARCH';
    }
  }

  private handleAttackState(ai: AI, target: Player | null, currentTick: number): void {
    if (target) {
      const dx = target.x - ai.x;
      const dy = target.y - ai.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // 更新最后已知位置
      ai.lastSeenTargetX = target.x;
      ai.lastSeenTargetY = target.y;
      ai.lastSeenTargetTime = Date.now();

      // 目标逃离攻击范围，切换到追击
      if (dist > CHASE_RANGE) {
        ai.behaviorState = 'CHASE';
        return;
      }

      // 更新瞄准
      this.updateAim(ai, target.x, target.y, currentTick);

      // 尝试开火
      this.attemptFire(ai, currentTick);

      // 战术移动：每1秒侧向移动
      if (currentTick % 20 === 0 && dist < ATTACK_RANGE && dist > 80) {
        const perpAngle = Math.atan2(dy, dx) + (Math.random() > 0.5 ? Math.PI / 2 : -Math.PI / 2);
        const strafeDistance = 60;
        const strafeX = ai.x + Math.cos(perpAngle) * strafeDistance;
        const strafeY = ai.y + Math.sin(perpAngle) * strafeDistance;
        this.updatePath(ai, strafeX, strafeY);
      }
    } else {
      // 失去目标
      ai.behaviorState = 'SEARCH';
    }
  }

  private handleSearchState(ai: AI, target: Player | null, currentTick: number): void {
    if (target) {
      // 重新发现目标
      ai.behaviorState = 'CHASE';
      ai.currentTargetId = target.id;
      ai.lastSeenTargetX = target.x;
      ai.lastSeenTargetY = target.y;
      ai.lastSeenTargetTime = Date.now();
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

  private handleReturnState(ai: AI, target: Player | null, currentTick: number): void {
    if (target) {
      // 返回途中发现目标
      ai.behaviorState = 'CHASE';
      ai.currentTargetId = target.id;
      ai.lastSeenTargetX = target.x;
      ai.lastSeenTargetY = target.y;
      ai.lastSeenTargetTime = Date.now();
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

    // 移动向路径点
    const speed = 120; // AI移动速度 (像素/秒，略慢于玩家的200)
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

    // 添加随机误差（±5度）
    const errorRad = ((Math.random() - 0.5) * 2 * 5 * Math.PI) / 180;
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
