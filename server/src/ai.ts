import type { WeaponRuntime, AI_STATE, AIRole } from '@jerkie-man/shared';
import { getWeaponDef, PositionHistory } from '@jerkie-man/shared';
import type { PathNode } from './pathfinding.js';

export type AIBehaviorType = 'PATROL' | 'GUARD';
export type AIBehaviorState = 'IDLE' | 'PATROL' | 'SPOTTING' | 'CHASE' | 'ATTACK' | 'SEARCH' | 'RETURN';

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
  public targetInBush?: boolean; // 新增: 目标是否在草丛中（用于半遮挡机制）
  public firstSpottedTime?: number; // 新增: 首次发现目标的时间（毫秒），用于反应延迟
  public reactionDelayMs: number = 1000; // 新增: 反应延迟时间（默认1秒）

  public currentPath: Array<{ x: number; y: number }> = [];
  public pathUpdateCooldown: number = 0;
  public readonly PATH_UPDATE_INTERVAL = 10; // 每0.5秒（10 ticks）更新路径

  public currentAimRad: number = 0;
  public nextAimUpdateTick: number = 0;

  // AI角色相关属性
  public role: AIRole; // AI角色类型
  public moveSpeed: number; // 移动速度倍率
  public aimErrorDeg: number; // 瞄准误差（度）
  public fireRateMultiplier: number; // 射速倍率
  public aggroRange: number; // 攻击距离
  public chaseRange: number; // 追击距离

  // IDLE 状态活跃行为相关字段
  public idleLookTargetAngle?: number; // 当前要转向的目标角度
  public idleNextLookChangeTime?: number; // 下次改变视角的时间
  public idleLookDirection?: 'left' | 'right'; // 当前转向方向（左/右）
  public idleBaseAngle?: number; // 基础角度（初始朝向）
  public idleOpenAreas?: Array<{ angle: number; distance: number; weight: number }>; // 开阔区域列表（带权重）
  public idleCurrentAreaIndex?: number; // 当前看向的开阔区域索引
  public idleWanderTarget?: { x: number; y: number }; // 随机移动的目标位置
  public idleNextWanderTime?: number; // 下次随机移动的时间

  public spawnX: number;
  public spawnY: number;
  public flashedUntil: number = 0; // 新增: 闪光弹致盲结束时间（毫秒时间戳，0表示未被闪）

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
    // 新增：角色相关参数
    role?: AIRole;
    hp?: number;
    maxHp?: number;
    armorReduction?: number;
    moveSpeed?: number;
    aimErrorDeg?: number;
    fireRateMultiplier?: number;
    aggroRange?: number;
    chaseRange?: number;
  }) {
    this.id = params.id;
    this.x = params.x;
    this.y = params.y;
    this.spawnX = params.x;
    this.spawnY = params.y;
    this.hp = params.hp ?? 100;
    this.maxHp = params.maxHp ?? 100;
    this.status = 'ALIVE';
    this.behaviorType = params.behaviorType;
    this.behaviorState = params.behaviorType === 'PATROL' ? 'PATROL' : 'IDLE';
    this.visionRange = params.visionRange ?? 300;
    this.visionAngleDeg = params.visionAngleDeg ?? 360;
    this.patrolConfig = params.patrolConfig;
    this.guardConfig = params.guardConfig;
    this.currentAimRad = 0;
    this.armorReduction = params.armorReduction ?? 0;
    this.positionHistory = new PositionHistory(50);
    this.positionHistory.add(params.currentTick, Date.now(), this.x, this.y);

    // 角色相关属性
    this.role = params.role ?? 'basic';
    this.moveSpeed = params.moveSpeed ?? 1.0;
    this.aimErrorDeg = params.aimErrorDeg ?? 5;
    this.fireRateMultiplier = params.fireRateMultiplier ?? 1.0;
    this.aggroRange = params.aggroRange ?? 250;
    this.chaseRange = params.chaseRange ?? 300;

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
      role: this.role, // 新增：角色类型
      currentTargetId: this.currentTargetId, // 新增：当前目标ID（用于显示"瞄准中"）
      isFlashed: this.flashedUntil > Date.now(),
      flashEndTime: this.flashedUntil,
    };
  }

  public takeDamage(damage: number, attackerX?: number, attackerY?: number): void {
    this.hp = Math.max(0, this.hp - damage);
    if (this.hp <= 0) {
      this.status = 'DEAD';
      return;
    }

    // 如果AI还活着且被攻击，记录攻击者位置并进入搜索状态
    if (attackerX !== undefined && attackerY !== undefined) {
      this.lastSeenTargetX = attackerX;
      this.lastSeenTargetY = attackerY;
      this.lastSeenTargetTime = Date.now();
      // 如果当前处于IDLE或PATROL状态，立即进入搜索状态
      if (this.behaviorState === 'IDLE' || this.behaviorState === 'PATROL') {
        this.behaviorState = 'SEARCH';
      }
    }
  }
}
