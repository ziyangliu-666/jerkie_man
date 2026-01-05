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
import { getWeaponDef, applySpread } from '@jerkie-man/shared';

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
}

// 命中特效
interface HitEffect {
  x: number;
  y: number;
  spawnTimeMs: number;
  type: 'obstacle' | 'player';
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

  /**
   * 本地开火时立即生成预测子弹
   */
  spawnLocalPrediction(
    shotId: number,
    originX: number,
    originY: number,
    aimRad: number,
    bulletSpeed: number = DEFAULT_BULLET_SPEED,
    weaponTypeId?: string
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
        
        // 为每颗弹丸生成随机角度偏移（与服务端逻辑一致）
        const randomOffset = (Math.random() - 0.5) * spreadRad;
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
        };
        
        this.bullets.set(tempId, bullet);
        // 只有第一颗子弹记录到localPredictions（用于对齐服务端子弹）
        if (i === 0) {
          this.localPredictions.set(shotId, tempId);
        }
      }
    } else {
      // 普通武器：单颗子弹
      const tempId = `local_${this.tempIdCounter++}`;
      
      // 应用散布（普通武器）
      let actualAimRad = aimRad;
      if (weaponDef) {
        actualAimRad = applySpread(aimRad, spreadDeg, () => Math.random());
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
      };
      
      this.bullets.set(tempId, bullet);
      this.localPredictions.set(shotId, tempId);
    }
  }

  /**
   * 收到 snapshot 时同步服务端子弹
   */
  onSnapshot(snapshot: S2C_SNAPSHOT, players: PLAYER_STATE[]): void {
    const nowMs = Date.now();
    this.players = players;
    
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
            // 找到匹配的第一颗子弹！收集所有属于同一发射的本地预测子弹并删除
            const spawnTime = localBullet.spawnTimeMs;
            const localPellets: LocalBullet[] = [];
            
            for (const [id, bullet] of this.bullets) {
              if (bullet.isLocalPrediction && 
                  bullet.ownerId === this.localPlayerId &&
                  Math.abs(bullet.spawnTimeMs - spawnTime) < 10) { // 同一时间生成（10ms容差）
                localPellets.push(bullet);
              }
            }
            
            // 删除所有匹配的本地预测子弹
            for (const pellet of localPellets) {
              this.bullets.delete(pellet.id);
              if (pellet.localShotId !== undefined) {
                this.localPredictions.delete(pellet.localShotId);
              }
            }
            
            // 标记这个发射已处理
            matchedShots.add(b.clientShotId);
            
            // 创建确认后的第一颗子弹（保留本地位置，不跳变）
            this.bullets.set(b.id, {
              id: b.id,
              ownerId: b.ownerId,
              x: localBullet.x, // 保留本地位置
              y: localBullet.y,
              vx: b.vx,
              vy: b.vy,
              spawnTimeMs: localBullet.spawnTimeMs,
              isLocalPrediction: false,
              bulletLifeMs: localBullet.bulletLifeMs, // 保留本地预测的TTL
            });
            continue;
          }
        }
      }
    }
    
    // 第二遍：处理所有服务端子弹（包括多弹丸的其他子弹）
    for (const b of snapshot.bullets) {
      // 如果这个子弹已被本地销毁或已处理，跳过
      if (this.locallyDestroyedIds.has(b.id) || this.bullets.has(b.id)) {
        continue;
      }
      
      // 检查是否是新的服务端子弹
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
      
      // 如果是本地玩家的子弹且没有clientShotId，可能是多弹丸的其他子弹
      // 使用服务端的位置和速度（因为本地预测已被删除）
      // 计算子弹的生成时间：根据当前位置和速度反推
      // 假设子弹从玩家位置发射，计算需要多长时间到达当前位置
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
      
      this.bullets.set(b.id, {
        id: b.id,
        ownerId: b.ownerId,
        x: b.x,
        y: b.y,
        vx: b.vx,
        vy: b.vy,
        spawnTimeMs: spawnTimeMs,
        isLocalPrediction: false,
        bulletLifeMs,
      });
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
   */
  update(dtSec: number): void {
    const nowMs = Date.now();
    const toRemove: Array<{ id: string; reason: 'ttl' | 'boundary' | 'obstacle' | 'player' }> = [];

    for (const [id, bullet] of this.bullets) {
      // 更新位置
      bullet.x += bullet.vx * dtSec;
      bullet.y += bullet.vy * dtSec;

      // 检查 TTL（使用武器特定的bulletLifeMs）
      if (nowMs - bullet.spawnTimeMs > bullet.bulletLifeMs) {
        toRemove.push({ id, reason: 'ttl' });
        continue;
      }

      // 检查边界碰撞
      if (bullet.x < 0 || bullet.x > this.mapWidth || 
          bullet.y < 0 || bullet.y > this.mapHeight) {
        toRemove.push({ id, reason: 'boundary' });
        continue;
      }

      // 检查障碍物碰撞
      let hitObstacle = false;
      for (const obs of this.obstacles) {
        if (circleVsAABB(bullet.x, bullet.y, BULLET_RADIUS, obs.x, obs.y, obs.w, obs.h)) {
          hitObstacle = true;
          break;
        }
      }
      if (hitObstacle) {
        toRemove.push({ id, reason: 'obstacle' });
        continue;
      }

      // 检查玩家碰撞（不检测自己发射的子弹打自己）
      let hitPlayer = false;
      for (const player of this.players) {
        if (player.id === bullet.ownerId) continue; // 不打自己
        if (player.status !== 'ALIVE') continue; // 只打活人
        
        // 玩家碰撞半径约 16px（方块大小的一半）
        if (pointVsCircle(bullet.x, bullet.y, player.x, player.y, 16)) {
          hitPlayer = true;
          break;
        }
      }
      if (hitPlayer) {
        toRemove.push({ id, reason: 'player' });
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
      });
    }
    
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
}
