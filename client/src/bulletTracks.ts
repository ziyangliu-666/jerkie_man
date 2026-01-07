/**
 * 子弹轨迹管理器（纯本地计算版）
 * 
 * 核心设计：
 * 1. 子弹完全在客户端本地模拟（rAF 每帧更新位置）
 * 2. 服务端子弹只用于"同步起点"和"确认存在/销毁"
 * 3. 本地检测碰撞（障碍物、玩家边界），提前终止子弹
 * 4. 服务端仍然是权威的（命中判定由服务端决定）
 * 5. 命中时显示特效，避免服务端子弹"回放"的割裂感
 */

import type { S2C_SNAPSHOT, BULLET_STATE, OBSTACLE_STATE, PLAYER_STATE } from '@jerkie-man/shared';
import { getWeaponDef, applySpread, createRng, getBulletPenetration } from '@jerkie-man/shared';

// 子弹常量（与服务端保持一致）
const DEFAULT_BULLET_SPEED = 800; // px/s（默认值，实际使用武器参数）
const BULLET_RADIUS = 3; // 子弹碰撞半径
const DEFAULT_BULLET_TTL_MS = 2000; // 子弹最大生命周期（默认值，实际使用武器参数）
const MUZZLE_OFFSET = 12; // 枪口偏移

// 命中特效常量
const HIT_EFFECT_TTL_MS = 150; // 特效持续时间
const HIT_EFFECT_RADIUS = 8; // 特效半径

interface LocalBullet {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  spawnTimeMs: number; // 生成时间（客户端时间）
  isLocalPrediction: boolean; // 是否为本地预测（尚未收到服务端确认）
  localShotId?: number; // 本地发射 ID（用于对齐）
  bulletLifeMs: number; // 子弹生命周期（毫秒）
  weaponTypeId?: string; // 武器类型ID（用于区分手雷、子弹等视觉样式）
  isGrenade?: boolean; // 是否是手雷（用于特殊物理模拟）
  targetX?: number; // 手雷目标位置X
  targetY?: number; // 手雷目标位置Y
  keepClientTrajectory?: boolean; // 在未经过确认前一直保持客户端计算的运动
  spawnX?: number;
  spawnY?: number;
  localHitReported?: boolean;
}

// 命中特效
interface HitEffect {
  x: number;
  y: number;
  spawnTimeMs: number;
  type: 'obstacle' | 'player';
}

interface LocalHitInfo {
  bulletId: string;
  ownerId: string;
  targetId: string;
  targetX: number;
  targetY: number;
  hitX: number;
  hitY: number;
  spawnX: number;
  spawnY: number;
  clientShotId?: number;
  timestamp: number;
}

// 碰撞检测：圆 vs AABB
function circleVsAABB(
  cx: number, cy: number, r: number,
  rx: number, ry: number, rw: number, rh: number
): boolean {
  const closestX = Math.max(rx, Math.min(cx, rx + rw));
  const closestY = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - closestX;
  const dy = cy - closestY;
  return (dx * dx + dy * dy) < (r * r);
}

// 碰撞检测：点 vs 圆
function pointVsCircle(px: number, py: number, cx: number, cy: number, r: number): boolean {
  const dx = px - cx;
  const dy = py - cy;
  return (dx * dx + dy * dy) < (r * r);
}

export class BulletTrackManager {
  private bullets = new Map<string, LocalBullet>();
  private renderList: BULLET_STATE[] = [];
  private localPredictions = new Map<number, string>(); // shotId -> bulletId
  private tempIdCounter = 0;
  private localHitCallbacks: Array<(info: LocalHitInfo) => void> = [];
  
  // 本地已销毁的子弹 ID（防止服务端子弹"回放"）
  private locallyDestroyedIds = new Set<string>();
  private destroyedCleanupTime = new Map<string, number>(); // id -> 销毁时间
  
  // 命中特效列表
  private hitEffects: HitEffect[] = [];
  
  private localPlayerId: string | null = null;
  private mapWidth = 4000;
  private mapHeight = 3000;
  private obstacles: OBSTACLE_STATE[] = [];
  private players: PLAYER_STATE[] = [];
  private ais: any[] = []; // 新增: AI列表

  setLocalPlayerId(id: string | null): void {
    this.localPlayerId = id;
  }

  setMapSize(width: number, height: number): void {
    this.mapWidth = width;
    this.mapHeight = height;
  }

  setObstacles(obstacles: OBSTACLE_STATE[]): void {
    this.obstacles = obstacles;
  }

  onLocalHit(callback: (info: LocalHitInfo) => void): void {
    this.localHitCallbacks.push(callback);
  }

  private matchPendingLocalPrediction(ownerId: string, targetSpawnTime: number): LocalBullet | null {
    let bestMatch: LocalBullet | null = null;
    let bestDelta = Infinity;
    for (const bullet of this.bullets.values()) {
      if (!bullet.isLocalPrediction || bullet.ownerId !== ownerId) continue;
      const delta = Math.abs(bullet.spawnTimeMs - targetSpawnTime);
      if (delta < bestDelta && delta < 50) {
        bestDelta = delta;
        bestMatch = bullet;
      }
    }
    return bestMatch;
  }

  /**
   * 本地投掷手雷时立即生成预测手雷
   */
  spawnLocalGrenade(
    playerX: number,
    playerY: number,
    targetX: number,
    targetY: number,
    weaponTypeId: string
  ): void {
    const nowMs = Date.now();
    const tempId = `local_grenade_${this.tempIdCounter++}`;

    // 计算飞行速度（速度3倍）
    const flightTime = 1.0 / 3; // 飞行时间缩短为1/3，速度提升3倍
    const dx = targetX - playerX;
    const dy = targetY - playerY;
    const vx = dx / flightTime;
    const vy = dy / flightTime;

    const grenade: LocalBullet = {
      id: tempId,
      ownerId: this.localPlayerId ?? 'local',
      x: playerX,
      y: playerY,
      vx,
      vy,
      spawnTimeMs: nowMs,
      isLocalPrediction: true,
      bulletLifeMs: 750, // 0.75秒引信
      weaponTypeId,
      isGrenade: true,
      targetX,
      targetY,
      keepClientTrajectory: true,
      spawnX: playerX,
      spawnY: playerY,
      localHitReported: false,
    };

    this.bullets.set(tempId, grenade);
    console.log('[BulletTracks] 本地手雷已创建:', { id: tempId, targetX, targetY });
  }

  /**
   * 本地开火时立即生成预测子弹
   */
  spawnLocalPrediction(
    shotId: number | undefined,
    originX: number,
    originY: number,
    aimRad: number,
    bulletSpeed: number = DEFAULT_BULLET_SPEED,
    weaponTypeId?: string,
    spreadSeed?: number
  ): void {
    const nowMs = Date.now();
    
    
    // 获取武器定义（用于检查是否有pelletCount）
    let weaponDef: ReturnType<typeof getWeaponDef> | null = null;
    let bulletLifeMs = DEFAULT_BULLET_TTL_MS;
    let pelletCount = 1;
    let spreadDeg = 0;
    
    if (weaponTypeId) {
      try {
        weaponDef = getWeaponDef(weaponTypeId);
        bulletLifeMs = weaponDef.bulletLifeMs;
        pelletCount = weaponDef.pelletCount ?? 1;
        spreadDeg = weaponDef.spreadDeg;
      } catch (err) {
        // 无效武器类型，使用默认值
      }
    } else {
    }
    
    // 霰弹枪：一次发射多颗弹丸
    if (pelletCount > 1) {
      const spreadRad = (spreadDeg * Math.PI) / 180; // 总散布角度（弧度）

      for (let i = 0; i < pelletCount; i++) {
        const tempId = `local_${this.tempIdCounter++}`;

        // 为每颗弹丸生成随机角度偏移（使用客户端生成的种子，与服务端一致）
        const bulletRng = spreadSeed !== undefined ? createRng(spreadSeed + i) : Math.random;
        const randomOffset = (bulletRng() - 0.5) * spreadRad;
        const actualAimRad = aimRad + randomOffset;
        
        // 从玩家位置 + 枪口偏移生成
        const x = originX + Math.cos(actualAimRad) * MUZZLE_OFFSET;
        const y = originY + Math.sin(actualAimRad) * MUZZLE_OFFSET;
        const vx = Math.cos(actualAimRad) * bulletSpeed;
        const vy = Math.sin(actualAimRad) * bulletSpeed;
        
        const bullet: LocalBullet = {
          id: tempId,
          ownerId: this.localPlayerId ?? 'local',
          x,
          y,
          vx,
          vy,
          spawnTimeMs: nowMs,
          isLocalPrediction: true,
          localShotId: i === 0 ? shotId : undefined, // 只有第一颗子弹使用shotId
          bulletLifeMs,
          weaponTypeId, // 保存武器类型ID
          keepClientTrajectory: true,
          spawnX: x,
          spawnY: y,
          localHitReported: false,
        };
        
        this.bullets.set(tempId, bullet);
        // 只有第一颗子弹记录到localPredictions（用于对齐服务端子弹）
        if (i === 0 && shotId !== undefined) {
          this.localPredictions.set(shotId, tempId);
        }
      }
    } else {
      // 普通武器：单颗子弹
      const tempId = `local_${this.tempIdCounter++}`;

      // 应用散布（普通武器）- 使用客户端生成的种子，与服务端一致
      let actualAimRad = aimRad;
      if (weaponDef) {
        const bulletRng = spreadSeed !== undefined ? createRng(spreadSeed) : Math.random;
        actualAimRad = applySpread(aimRad, spreadDeg, bulletRng);
      }
      
      // 从玩家位置 + 枪口偏移生成
      const x = originX + Math.cos(actualAimRad) * MUZZLE_OFFSET;
      const y = originY + Math.sin(actualAimRad) * MUZZLE_OFFSET;
      const vx = Math.cos(actualAimRad) * bulletSpeed;
      const vy = Math.sin(actualAimRad) * bulletSpeed;
      
      const bullet: LocalBullet = {
        id: tempId,
        ownerId: this.localPlayerId ?? 'local',
        x,
        y,
        vx,
        vy,
        spawnTimeMs: nowMs,
        isLocalPrediction: true,
        localShotId: shotId,
        bulletLifeMs,
        weaponTypeId, // 保存武器类型ID
        keepClientTrajectory: true,
        spawnX: x,
        spawnY: y,
        localHitReported: false,
      };
      
      this.bullets.set(tempId, bullet);
      if (shotId !== undefined) {
        this.localPredictions.set(shotId, tempId);
      }
    }
  }

  /**
   * 收到 snapshot 时同步服务端子弹
   */
  onSnapshot(snapshot: S2C_SNAPSHOT, players: PLAYER_STATE[]): void {
    const nowMs = Date.now();
    this.players = players;
    this.ais = snapshot.ais ?? []; // 新增: 更新AI列表

    // 清理过期的"本地销毁"记录（500ms 后允许服务端重新添加同 ID 子弹）
    for (const [id, destroyTime] of this.destroyedCleanupTime) {
      if (nowMs - destroyTime > 500) {
        this.locallyDestroyedIds.delete(id);
        this.destroyedCleanupTime.delete(id);
      }
    }

    const serverBulletIds = new Set<string>();
    // 用于跟踪已匹配的多弹丸发射（shotId -> 是否已处理）
    const matchedShots = new Set<number>();
    
    // 第一遍：处理有clientShotId的子弹（第一颗子弹），并标记已匹配的发射
    for (const b of snapshot.bullets) {
      serverBulletIds.add(b.id);
      
      // 如果这个子弹已被本地销毁，忽略服务端更新
      if (this.locallyDestroyedIds.has(b.id)) {
        continue;
      }


      // 检查是否有对应的本地预测子弹需要对齐
      if (b.clientShotId !== undefined && b.ownerId === this.localPlayerId) {
        const tempId = this.localPredictions.get(b.clientShotId);
        if (tempId) {
          const localBullet = this.bullets.get(tempId);
          if (localBullet) {
            // 修复: 本地预测子弹保持isLocalPrediction=true（防止被服务端清理逻辑删除）
            // 服务端子弹不渲染，本地预测子弹继续使用本地ID和轨迹，由TTL/碰撞自然清理
            this.localPredictions.delete(b.clientShotId);
            matchedShots.add(b.clientShotId);
            // 注意：不添加到serverBulletIds，因为本地预测子弹通过isLocalPrediction=true免疫清理
            continue; // 不添加服务端子弹
          }
        }
      }
    }
    
    // 第二遍：处理所有服务端子弹（包括多弹丸的其他子弹）
    for (const b of snapshot.bullets) {
      // 如果这个子弹已被本地销毁，跳过
      if (this.locallyDestroyedIds.has(b.id)) {
        continue;
      }

      const isGrenade = b.weaponTypeId === 'frag_grenade' || b.weaponTypeId === 'smoke_grenade' || b.weaponTypeId === 'flash_grenade' || (b.targetX !== undefined && b.targetY !== undefined);


      // 如果子弹已存在（第一遍匹配的或之前的快照创建的）
      if (this.bullets.has(b.id)) {
        const existingBullet = this.bullets.get(b.id)!;

        if (isGrenade) {
          existingBullet.isGrenade = true;
          if (b.targetX !== undefined && b.targetY !== undefined) {
            existingBullet.targetX = b.targetX;
            existingBullet.targetY = b.targetY;
          }
        }

        // 手雷特殊处理：本地预测的手雷不同步位置（本地模拟更流畅）
        if (existingBullet.isGrenade && existingBullet.isLocalPrediction) {
          // 本地预测手雷：只确认存在，不更新位置（避免卡顿）
          console.log('[BulletTracks] 本地手雷服务端确认，保持本地模拟:', b.id);
          continue;
        }

        if (existingBullet.keepClientTrajectory) {
          // 该子弹已经由客户端模拟轨迹，不从服务端跳变
          continue;
        }

        // 其他玩家的手雷或普通子弹：同步位置

        // 普通子弹：同步位置和速度
        const prevX = existingBullet.x;
        const prevY = existingBullet.y;
        const correctionDelta = Math.hypot(prevX - b.x, prevY - b.y);
        if (correctionDelta > 4) {
          console.log(`[BulletTracks] correction(${b.id}) owner=${b.ownerId} delta=${correctionDelta.toFixed(1)} prev=(${prevX.toFixed(1)},${prevY.toFixed(1)}) -> server=(${b.x.toFixed(1)},${b.y.toFixed(1)})`);
        }
        existingBullet.x = b.x;
        existingBullet.y = b.y;
        existingBullet.vx = b.vx;
        existingBullet.vy = b.vy;
        continue;
      }
      
      // 检查是否是手雷且是本地玩家投掷的
      if (isGrenade && b.ownerId === this.localPlayerId) {
        // 这是本地玩家投掷的手雷，检查是否已有本地预测版本
        const hasLocalGrenade = Array.from(this.bullets.values()).some(
          bullet => bullet.isGrenade && bullet.isLocalPrediction && bullet.ownerId === this.localPlayerId
        );
        if (hasLocalGrenade) {
          continue;
        }
      }

      // 修复: 本地玩家的子弹不渲染服务端版本（只渲染本地预测）
      if (b.ownerId === this.localPlayerId) {
        // 检查是否有对应的本地预测子弹
        const localMatch = this.matchPendingLocalPrediction(b.ownerId, nowMs);
        if (localMatch) {
          // 找到本地预测（可能是霰弹枪的其他弹丸），保持isLocalPrediction=true
          // 本地预测子弹由TTL/碰撞自然清理，不受服务端清理逻辑影响
          if (localMatch.localShotId !== undefined) {
            this.localPredictions.delete(localMatch.localShotId);
          }
          // 注意：不添加到serverBulletIds，因为本地预测子弹通过isLocalPrediction=true免疫清理
        }
        // 不添加服务端子弹（本地玩家的子弹只显示本地预测版本）
        continue;
      }

      // 其他玩家的子弹：从服务端创建
      // 从玩家武器获取bulletLifeMs
      let bulletLifeMs = DEFAULT_BULLET_TTL_MS;
      const bulletOwner = this.players.find(p => p.id === b.ownerId);
      if (bulletOwner?.weaponRuntime?.weaponTypeId) {
        try {
          const weaponDef = getWeaponDef(bulletOwner.weaponRuntime.weaponTypeId);
          bulletLifeMs = weaponDef.bulletLifeMs;
        } catch {
          // 无效武器类型，使用默认值
        }
      }

      // 计算子弹的生成时间：根据当前位置和速度反推
      let spawnTimeMs = nowMs;
      if (bulletOwner) {
        const dx = b.x - bulletOwner.x;
        const dy = b.y - bulletOwner.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
        if (speed > 0) {
          const travelTimeMs = (dist / speed) * 1000; // 转换为毫秒
          spawnTimeMs = nowMs - travelTimeMs;
        }
      }

      // 优先使用服务端传来的 bulletLifeMs，如果没有则使用从武器定义获取的值
      const finalBulletLifeMs = b.bulletLifeMs ?? bulletLifeMs;

      // 创建其他玩家的子弹
      this.bullets.set(b.id, {
        id: b.id,
        ownerId: b.ownerId,
        x: b.x,
        y: b.y,
        vx: b.vx,
        vy: b.vy,
        spawnTimeMs: spawnTimeMs,
        isLocalPrediction: false,
        bulletLifeMs: finalBulletLifeMs,
        weaponTypeId: b.weaponTypeId, // 保存武器类型ID
        isGrenade,
        targetX: b.targetX,
        targetY: b.targetY,
        keepClientTrajectory: true, // 所有子弹都保持客户端轨迹（避免服务端同步卡顿）
        spawnX: b.x,
        spawnY: b.y,
        localHitReported: false,
      });

      // 日志：记录添加的手雷子弹
      if (b.weaponTypeId === 'frag_grenade' || b.weaponTypeId === 'smoke_grenade' || b.weaponTypeId === 'flash_grenade' || b.weaponTypeId === 'w_grenade_launcher') {
        console.log('[BulletTracks] 添加手雷到bullets:', {
          id: b.id,
          weaponTypeId: b.weaponTypeId,
          spawnTimeMs,
          bulletLifeMs,
          age: nowMs - spawnTimeMs
        });
      }
    }

    // 清理服务端已销毁的子弹（非本地预测的，且不在本地销毁列表中）
    for (const [id, bullet] of this.bullets) {
      if (!bullet.isLocalPrediction && !serverBulletIds.has(id)) {
        this.bullets.delete(id);
      }
    }
  }

  /**
   * 每帧更新子弹位置（纯本地计算）
   * @param dtSec 时间增量（秒）
   * @param interpolatedPlayers 插值后的玩家位置（用于碰撞检测，必须与渲染位置一致）
   */
  update(dtSec: number, interpolatedPlayers?: PLAYER_STATE[]): void {
    const nowMs = Date.now();
    const toRemove: Array<{ id: string; reason: 'ttl' | 'boundary' | 'obstacle' | 'player' }> = [];

    // 日志：update 开始时检查手雷
    const grenadesBeforeUpdate = Array.from(this.bullets.values()).filter(b =>
      b.weaponTypeId === 'frag_grenade' || b.weaponTypeId === 'smoke_grenade' || b.weaponTypeId === 'flash_grenade' || b.weaponTypeId === 'w_grenade_launcher'
    );

    for (const [id, bullet] of this.bullets) {
      // 手雷特殊物理模拟
      if (bullet.isGrenade && bullet.targetX !== undefined && bullet.targetY !== undefined) {
        const dx = bullet.targetX - bullet.x;
        const dy = bullet.targetY - bullet.y;
        const distToTarget = Math.sqrt(dx * dx + dy * dy);
        const speed = Math.sqrt(bullet.vx * bullet.vx + bullet.vy * bullet.vy);
        const moveDistance = speed * dtSec;

        // 如果接近目标，停在目标位置
        if (distToTarget <= moveDistance || speed === 0) {
          bullet.x = bullet.targetX;
          bullet.y = bullet.targetY;
          bullet.vx = 0;
          bullet.vy = 0;
        } else {
          // 继续飞行
          bullet.x += bullet.vx * dtSec;
          bullet.y += bullet.vy * dtSec;
        }
      } else {
        // 普通子弹：匀速移动
        bullet.x += bullet.vx * dtSec;
        bullet.y += bullet.vy * dtSec;
      }

      // 检查 TTL（使用武器特定的bulletLifeMs）
      if (nowMs - bullet.spawnTimeMs > bullet.bulletLifeMs) {
        toRemove.push({ id, reason: 'ttl' });
        continue;
      }

      // 手雷不检测碰撞（穿过墙体和玩家，只在 TTL 到期时移除）
      if (bullet.isGrenade) {
        continue;
      }

      // 检查边界碰撞
      if (bullet.x < 0 || bullet.x > this.mapWidth || 
          bullet.y < 0 || bullet.y > this.mapHeight) {
        toRemove.push({ id, reason: 'boundary' });
        continue;
      }

      // 检查障碍物碰撞（只有完全阻挡的障碍物才删除子弹）
      let hitBlockingObstacle = false;
      for (const obs of this.obstacles) {
        if (circleVsAABB(bullet.x, bullet.y, BULLET_RADIUS, obs.x, obs.y, obs.w, obs.h)) {
          // 检查障碍物的穿透系数
          const obsType = (obs as any).type || 'wall';
          const penetration = getBulletPenetration(obsType);

          // 只有完全阻挡（penetration = 0）的障碍物才删除子弹
          if (penetration === 0) {
            hitBlockingObstacle = true;
            break;
          }
          // 穿透系数 > 0 的障碍物（如水域、草丛、木墙等）让子弹继续飞行
        }
      }
      if (hitBlockingObstacle) {
        toRemove.push({ id, reason: 'obstacle' });
        continue;
      }

      // 检查玩家碰撞（不检测自己发射的子弹打自己）
      // 修复: 使用插值后的玩家位置（与渲染一致），而不是 snapshot 原始位置
      let hitPlayer = false;
      let hitTarget: PLAYER_STATE | null = null;
      const playersForCollision = interpolatedPlayers ?? this.players; // 优先使用插值位置
      for (const player of playersForCollision) {
        if (player.id === bullet.ownerId) continue; // 不打自己
        if (player.status !== 'ALIVE') continue; // 只打活人

        // 玩家碰撞半径约 16px（方块大小的一半）
        if (pointVsCircle(bullet.x, bullet.y, player.x, player.y, 16)) {
          hitPlayer = true;
          hitTarget = player;
          break;
        }
      }
      if (hitPlayer) {
        if (hitTarget) {
          this.emitLocalHit(bullet, hitTarget);
        }
        toRemove.push({ id, reason: 'player' });
        continue;
      }
      
      // 新增: 检查AI碰撞（只有玩家的子弹才检测AI碰撞）
      let hitAI = false;
      if (bullet.ownerId === this.localPlayerId) {
        for (const ai of this.ais) {
          if (ai.status !== 'ALIVE') continue; // 只打活着的AI

          // AI碰撞半径约 16px（与玩家相同）
          if (pointVsCircle(bullet.x, bullet.y, ai.x, ai.y, 16)) {
            hitAI = true;
            // AI命中：创建一个临时的"玩家"对象用于emitLocalHit
            const aiAsTarget: PLAYER_STATE = {
              id: ai.id,
              x: ai.x,
              y: ai.y,
              hp: ai.hp,
              stamina: 100,
              maxStamina: 100,
              isSprinting: false,
              status: 'ALIVE',
              lastInputSeq: 0,
              lastInputTick: 0,
            };
            this.emitLocalHit(bullet, aiAsTarget);
            break;
          }
        }
      }
      if (hitAI) {
        toRemove.push({ id, reason: 'player' }); // 使用'player'类型的特效
        continue;
      }
    }

    // 移除碰撞/过期的子弹，并添加命中特效
    for (const { id, reason } of toRemove) {
      const bullet = this.bullets.get(id);
      if (bullet) {

        // 添加命中特效（只对碰撞类型添加，TTL/边界不需要）
        if (reason === 'obstacle' || reason === 'player') {
          this.hitEffects.push({
            x: bullet.x,
            y: bullet.y,
            spawnTimeMs: nowMs,
            type: reason,
          });
        }

        // 记录本地销毁的子弹 ID（防止服务端"回放"）
        if (!bullet.isLocalPrediction) {
          this.locallyDestroyedIds.add(id);
          this.destroyedCleanupTime.set(id, nowMs);
        }

        if (bullet.localShotId !== undefined) {
          this.localPredictions.delete(bullet.localShotId);
        }
        this.bullets.delete(id);
      }
    }

    // 清理过期的命中特效
    this.hitEffects = this.hitEffects.filter(e => nowMs - e.spawnTimeMs < HIT_EFFECT_TTL_MS);

    // 构建渲染列表
    this.renderList.length = 0;
    for (const bullet of this.bullets.values()) {
      this.renderList.push({
        id: bullet.id,
        ownerId: bullet.ownerId,
        x: bullet.x,
        y: bullet.y,
        vx: bullet.vx,
        vy: bullet.vy,
        weaponTypeId: bullet.weaponTypeId, // 传递武器类型ID给渲染器
      });
    }

    // 日志：记录渲染列表中的手雷
    
    // 调试日志：每10帧打印一次子弹数量
    if (Math.random() < 0.1) { // 10%概率打印，避免日志过多
      const localCount = Array.from(this.bullets.values()).filter(b => b.isLocalPrediction).length;
      const serverCount = Array.from(this.bullets.values()).filter(b => !b.isLocalPrediction).length;
    }
  }

  /**
   * 获取渲染用的子弹列表
   */
  getBulletsForRender(): BULLET_STATE[] {
    return this.renderList;
  }

  /**
   * 获取命中特效列表
   */
  getHitEffects(): Array<{ x: number; y: number; age: number; type: 'obstacle' | 'player' }> {
    const nowMs = Date.now();
    return this.hitEffects.map(e => ({
      x: e.x,
      y: e.y,
      age: (nowMs - e.spawnTimeMs) / HIT_EFFECT_TTL_MS, // 0~1
      type: e.type,
    }));
  }

  /**
   * 清空所有子弹（重连时调用）
   */
  clear(): void {
    this.bullets.clear();
    this.renderList.length = 0;
    this.localPredictions.clear();
    this.locallyDestroyedIds.clear();
    this.destroyedCleanupTime.clear();
    this.hitEffects = [];
    this.tempIdCounter = 0;
  }

  private emitLocalHit(bullet: LocalBullet, target: PLAYER_STATE): void {
    if (bullet.ownerId !== this.localPlayerId) return;
    if (bullet.localHitReported) return;
    const spawnX = bullet.spawnX ?? bullet.x;
    const spawnY = bullet.spawnY ?? bullet.y;
    const hitInfo: LocalHitInfo = {
      bulletId: bullet.id,
      ownerId: bullet.ownerId,
      targetId: target.id,
      targetX: target.x,
      targetY: target.y,
      hitX: bullet.x,
      hitY: bullet.y,
      spawnX,
      spawnY,
      clientShotId: bullet.localShotId,
      timestamp: Date.now(),
    };
    bullet.localHitReported = true;
    for (const cb of this.localHitCallbacks) {
      cb(hitInfo);
    }
  }
}
