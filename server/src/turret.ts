
import { TURRET_STATE, OBSTACLE_STATE, getWeaponDef, msToTicks, applySpread, createRng } from '@jerkie-man/shared';
import { Player } from './player.js';
import { AI } from './ai.js';
// Using 'any' for Room to avoid circular dependency issues during runtime if strict, 
// but type import is safe.
import type { Room } from './room.js';

export class Turret {
  public id: string;
  public x: number;
  public y: number;
  public ownerId: string;
  public hp: number = 150;
  public maxHp: number = 150;
  
  public state: 'IDLE' | 'SPOOLING' | 'FIRING' | 'RELOADING' = 'IDLE';
  public aimRad: number = 0;
  public targetId: string | undefined;
  
  public createdAt: number;
  public durationMs: number;
  
  // Combat stats
  public range: number = 400;
  // Using properties that mimic WeaponRuntime/WeaponDef
  public weaponTypeId: string = 'w_minigun'; 
  public ammo: number = 100;
  public maxAmmo: number = 100;
  public reloadTimeMs: number = 3000;
  public spoolTimeMs: number = 1000; // Reaction time
  
  // Timers
  public stateTimer: number = 0; // Tracks time in current state (e.g. spooling progress)
  public nextFireTick: number = 0;
  public lastTargetSeenTime: number = 0;
  public reactionDelayMs: number = 500; // Delay before starting to spool
  
  // Visuals
  public inBush: boolean = false;
  public inSmoke: boolean = false;
  
  // 射击计数器（用于生成确定性散布种子）
  private shotCounter: number = 0;
  
  constructor(id: string, x: number, y: number, ownerId: string, durationMs: number) {
    this.id = id;
    this.x = x;
    this.y = y;
    this.ownerId = ownerId;
    this.durationMs = durationMs;
    this.createdAt = Date.now();
  }

  update(dt: number, room: Room): boolean {
    const now = Date.now();
    const currentTick = room.tick;

    // 1. Check lifespan
    if (now - this.createdAt > this.durationMs) {
      this.hp = 0; // Mark for death
      return false; // Dead
    }
    
    // 2. Check HP
    if (this.hp <= 0) return false;

    // 3. Update visibility (Bush/Smoke)
    // Simplified: check room functions if available, or just primitive check
    // Assuming room has helper or we iterate obstacles. For now, keep simple.
    
    // 4. State Machine
    switch (this.state) {
      case 'IDLE':
        this.handleIdle(room, now);
        break;
      case 'SPOOLING':
        this.handleSpooling(room, now);
        break;
      case 'FIRING':
        this.handleFiring(room, now, currentTick);
        break;
      case 'RELOADING':
        this.handleReloading(room, now);
        break;
    }
    return true; // Alive
  }
  
  private handleIdle(room: Room, now: number): void {
    // Search for target
    const target = this.scanForTarget(room);
    if (target) {
      this.targetId = target.id;
      // Found target, wait for reaction delay before spooling
      // Actually, let's go straight to SPOOLING but stateTimer tracks the delay
      this.state = 'SPOOLING';
      this.stateTimer = now + this.reactionDelayMs; 
    } else {
      // Rotate scanner (slowly)
      this.aimRad = (this.aimRad + 0.02) % (Math.PI * 2);
    }
  }

  private handleSpooling(room: Room, now: number): void {
    const target = this.getTarget(room, this.targetId);
    if (!target) {
      this.state = 'IDLE';
      this.targetId = undefined;
      return;
    }

    // Track target
    this.aimAt(target.x, target.y);

    // Check line of sight / range again
    if (!this.isValidTarget(room, target)) {
        this.state = 'IDLE';
        this.targetId = undefined;
        return;
    }

    if (now >= this.stateTimer) {
      // Finished reaction/spooling
      this.state = 'FIRING';
    }
  }

  private handleFiring(room: Room, now: number, currentTick: number): void {
    const target = this.getTarget(room, this.targetId);
    if (!target) {
      this.state = 'IDLE'; // Or spool down?
      this.targetId = undefined;
      return;
    }

    // Aim
    this.aimAt(target.x, target.y);
    
    // Check constraints
    if (!this.isValidTarget(room, target)) {
        this.state = 'IDLE';
        this.targetId = undefined;
        return;
    }

    if (this.ammo <= 0) {
      this.state = 'RELOADING';
      this.stateTimer = now + this.reloadTimeMs;
      return;
    }

    // Fire!
    if (currentTick >= this.nextFireTick) {
      this.shoot(room, currentTick);
    }
  }

  private handleReloading(room: Room, now: number): void {
    if (now >= this.stateTimer) {
      this.ammo = this.maxAmmo;
      this.state = 'IDLE'; // Re-acquire target
      this.nextFireTick = 0;
    }
  }

  private scanForTarget(room: Room): { id: string, x: number, y: number } | null {
    let closest: { id: string, x: number, y: number, dist: number } | null = null;
    
    // Check players
    for (const player of room.players.values()) {
        if (player.status !== 'ALIVE') continue;
        if (player.id === this.ownerId) continue; // Don't shoot owner
        // NOTE: Even if owner is disguised or changed, ID remains same.
        
        const dist = Math.hypot(player.x - this.x, player.y - this.y);
        if (dist > this.range) continue;
        
        if (!this.hasLineOfSight(room, player.x, player.y)) continue;
        
        // 修复: 炮台不能检测到草丛中的玩家（隐蔽效果）
        const playerBushId = (room as any).isPlayerInBush?.(player.x, player.y);
        if (playerBushId) continue;
        
        // 修复: 炮台不能检测到烟雾中的玩家
        const playerSmokeId = (room as any).isPointInSmoke?.(player.x, player.y);
        if (playerSmokeId) continue;
        
        if (!closest || dist < closest.dist) {
            closest = { id: player.id, x: player.x, y: player.y, dist };
        }
    }
    
    // Check AIs
    for (const ai of room.ais.values()) {
        if (ai.status !== 'ALIVE') continue;
        const dist = Math.hypot(ai.x - this.x, ai.y - this.y);
        if (dist > this.range) continue;
        
        if (!this.hasLineOfSight(room, ai.x, ai.y)) continue;

        // 修复: 炮台不能检测到草丛中的AI
        const aiBushId = (room as any).isPlayerInBush?.(ai.x, ai.y);
        if (aiBushId) continue;
        
        // 修复: 炮台不能检测到烟雾中的AI
        const aiSmokeId = (room as any).isPointInSmoke?.(ai.x, ai.y);
        if (aiSmokeId) continue;

        if (!closest || dist < closest.dist) {
            closest = { id: ai.id, x: ai.x, y: ai.y, dist };
        }
    }

    // Check other Turrets (hostile ones)
    if (room.turrets) { 
        for (const otherTurret of room.turrets.values()) {
            if (otherTurret === this) continue;
            if (otherTurret.hp <= 0) continue;
            if (otherTurret.ownerId === this.ownerId) continue; // Friendly turret

            const dist = Math.hypot(otherTurret.x - this.x, otherTurret.y - this.y);
            if (dist > this.range) continue;
            
            if (!this.hasLineOfSight(room, otherTurret.x, otherTurret.y)) continue;

            if (!closest || dist < closest.dist) {
                closest = { id: otherTurret.id, x: otherTurret.x, y: otherTurret.y, dist };
            }
        }
    }

    return closest;
  }

  private getTarget(room: Room, id: string | undefined): { x: number, y: number } | null {
      if (!id) return null;
      const p = room.players.get(id);
      if (p && p.status === 'ALIVE') return { x: p.x, y: p.y };
      
      const a = room.ais.get(id);
      if (a && a.status === 'ALIVE') return { x: a.x, y: a.y };
      
      if (room.turrets) {
          const t = room.turrets.get(id);
          if (t && t.hp > 0) return { x: t.x, y: t.y };
      }
      
      return null;
  }

  private isValidTarget(room: Room, target: { x: number, y: number }): boolean {
      const dist = Math.hypot(target.x - this.x, target.y - this.y);
      if (dist > this.range) return false;
      return this.hasLineOfSight(room, target.x, target.y);
  }

  private aimAt(tx: number, ty: number) {
      this.aimRad = Math.atan2(ty - this.y, tx - this.x);
  }

  private hasLineOfSight(room: Room, tx: number, ty: number): boolean {
    const dist = Math.hypot(tx - this.x, ty - this.y);
    const steps = Math.ceil(dist / 20);
    const dx = (tx - this.x) / steps;
    const dy = (ty - this.y) / steps;

    for (let i = 1; i < steps; i++) { // Skip start and end slightly
        const cx = this.x + dx * i;
        const cy = this.y + dy * i;
        
        // Simple obstacle check
        for (const obs of room.obstacles) {
            const obsType = (obs as any).type || 'wall';
            if (obsType === 'bush' || obsType === 'water') continue;
            if (cx >= obs.x && cx <= obs.x + obs.w && cy >= obs.y && cy <= obs.y + obs.h) {
                return false;
            }
        }
    }
    return true;
  }

  private shoot(room: Room, currentTick: number) {
      try {
          const weaponDef = getWeaponDef(this.weaponTypeId);
          this.ammo--;
          this.shotCounter++; // 增加射击计数
          
          // Next fire tick
          const fireInterval = msToTicks(weaponDef.fireIntervalMs);
          this.nextFireTick = currentTick + fireInterval;

          // 生成确定性散布种子（基于炮台ID和射击计数）
          // 使用简单的哈希函数将字符串ID转换为数字种子
          let idHash = 0;
          for (let i = 0; i < this.id.length; i++) {
              idHash = ((idHash << 5) - idHash) + this.id.charCodeAt(i);
              idHash = idHash & idHash; // Convert to 32bit integer
          }
          const spreadSeed = idHash + this.shotCounter * 1000;
          
          // 使用确定性随机数生成器
          const bulletRng = createRng(spreadSeed);
          
          // Apply spread - 使用更合理的散布值（3度，而不是0.05度）
          const spreadDeg = 3.0; // 炮台散布角度（度）
          const angle = applySpread(this.aimRad, spreadDeg, bulletRng);
          
          const speed = weaponDef.bulletSpeed || 1000;
          const vx = Math.cos(angle) * speed;
          const vy = Math.sin(angle) * speed;
          
          // Create bullet
          const bullet = {
              id: `b_turret_${this.id}_${currentTick}_${this.shotCounter}`,
              x: this.x + Math.cos(this.aimRad) * 20, // Offset spawn
              y: this.y + Math.sin(this.aimRad) * 20,
              vx,
              vy,
              ownerId: this.id, // Turret owns the bullet
              // 注意: ownerId 是炮台ID，不是玩家ID
              // 这样击杀反馈会显示"Turret"而不是玩家名
              
              clientShotId: 0,
              weaponTypeId: this.weaponTypeId,
              spawnAt: Date.now(),
              spawnTimeMs: Date.now(), // For client visual
              damage: weaponDef.damage * 0.5, // 炮台伤害为加特林的50%
              bulletLifeMs: 2000,
              spawnX: this.x,
              spawnY: this.y,
              spreadSeed, // 传递种子给客户端，用于重现散布
          };
          
          room.bullets.push(bullet);
          
      } catch (e) {
          console.error("Turret shoot error", e);
      }
  }

  takeDamage(amount: number) {
      // Armor protection when IDLE
      if (this.state === 'IDLE') {
          // Protected armor mode
          this.hp -= amount * 0.1; // 90% reduction
      } else {
          this.hp -= amount;
      }
  }
  
  toState(): TURRET_STATE {
      return {
          id: this.id,
          x: this.x,
          y: this.y,
          ownerId: this.ownerId,
          hp: Math.ceil(this.hp),
          maxHp: this.maxHp,
          aimRad: this.aimRad,
          state: this.state,
          targetId: this.targetId,
          remainingTimeMs: Math.max(0, this.durationMs - (Date.now() - this.createdAt)),
          isArmored: this.state === 'IDLE',
          range: this.range,
      };
  }
}
