import type { WeaponRuntime, AI_STATE } from '@jerkie-man/shared';
import { getWeaponDef, PositionHistory } from '@jerkie-man/shared';
import type { PathNode } from './pathfinding.js';

export type AIBehaviorType = 'PATROL' | 'GUARD';
export type AIBehaviorState = 'IDLE' | 'PATROL' | 'CHASE' | 'ATTACK' | 'SEARCH' | 'RETURN';

export type PatrolConfig = {
  points: Array<{ x: number; y: number }>;
  currentIndex: number;
  waitTimeMs: number;
  waitUntil: number;
};

export type GuardConfig = {
  centerX: number;
  centerY: number;
  radius: number;
  nextMoveTime?: number;
};

export class AI {
  public id: string;
  public x: number;
  public y: number;
  public hp: number;
  public maxHp: number;
  public status: 'ALIVE' | 'DEAD';
  public weaponRuntime: WeaponRuntime;
  public armorReduction: number = 0;
  public positionHistory: PositionHistory;

  public behaviorType: AIBehaviorType;
  public behaviorState: AIBehaviorState;
  public patrolConfig?: PatrolConfig;
  public guardConfig?: GuardConfig;

  public visionRange: number;
  public visionAngleDeg: number;
  public currentTargetId?: string;
  public lastSeenTargetX?: number;
  public lastSeenTargetY?: number;
  public lastSeenTargetTime?: number;

  public currentPath: Array<{ x: number; y: number }> = [];
  public pathUpdateCooldown: number = 0;
  public readonly PATH_UPDATE_INTERVAL = 10; // 每0.5秒（10 ticks）更新路径

  public currentAimRad: number = 0;
  public nextAimUpdateTick: number = 0;

  public spawnX: number;
  public spawnY: number;

  constructor(params: {
    id: string;
    x: number;
    y: number;
    behaviorType: AIBehaviorType;
    weaponTypeId: string;
    visionRange?: number;
    visionAngleDeg?: number;
    patrolConfig?: PatrolConfig;
    guardConfig?: GuardConfig;
    currentTick: number;
  }) {
    this.id = params.id;
    this.x = params.x;
    this.y = params.y;
    this.spawnX = params.x;
    this.spawnY = params.y;
    this.hp = 100;
    this.maxHp = 100;
    this.status = 'ALIVE';
    this.behaviorType = params.behaviorType;
    this.behaviorState = params.behaviorType === 'PATROL' ? 'PATROL' : 'IDLE';
    this.visionRange = params.visionRange ?? 300;
    this.visionAngleDeg = params.visionAngleDeg ?? 360;
    this.patrolConfig = params.patrolConfig;
    this.guardConfig = params.guardConfig;
    this.currentAimRad = 0;
    this.positionHistory = new PositionHistory(50);
    this.positionHistory.add(params.currentTick, Date.now(), this.x, this.y);

    const weaponDef = getWeaponDef(params.weaponTypeId);
    this.weaponRuntime = {
      weaponTypeId: params.weaponTypeId,
      ammoInMag: weaponDef.magSize,
      reloadingUntilTick: 0,
      nextFireTick: params.currentTick,
    };
  }

  public toState(currentTick: number): AI_STATE {
    return {
      id: this.id,
      x: this.x,
      y: this.y,
      hp: this.hp,
      maxHp: this.maxHp,
      status: this.status,
      weaponRuntime: this.weaponRuntime,
      aimRad: this.currentAimRad,
      behaviorState: this.behaviorState,
    };
  }

  public takeDamage(damage: number): void {
    this.hp = Math.max(0, this.hp - damage);
    if (this.hp <= 0) {
      this.status = 'DEAD';
    }
  }
}
