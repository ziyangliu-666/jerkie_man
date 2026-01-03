import type { PLAYER_STATE, OBSTACLE_STATE } from '@jerkie-man/shared';
import { simulatePlayerMove } from '@jerkie-man/shared';

export class Player {
  public id: string;
  public x: number;
  public y: number;
  public hp: number;
  public status: 'ALIVE' | 'DEAD' | 'EXTRACTED';
  public lastInputSeq: number;
  public lastInputTick: number;
  public lootCount: number; // Day3: 战利品计数
  public extractProgress: number = 0; // 游戏化增强: 撤离进度（毫秒，0-2000）

  // 修复: 移动速度已移至 shared/sim.ts，这里不再需要（保留注释用于文档）
  // SPEED = 200 (在 shared/sim.ts 中定义)
  
  // Day2: 开火冷却（毫秒）
  private lastFireTime = 0;
  private readonly FIRE_COOLDOWN_MS = 150; // 150ms冷却，约6.67发/秒
  private readonly EXTRACT_DURATION_MS = 2000; // 游戏化增强: 撤离需要持续2秒

  constructor(id: string, x: number = 0, y: number = 0) {
    this.id = id;
    this.x = x;
    this.y = y;
    this.hp = 100;
    this.status = 'ALIVE';
    this.lastInputSeq = 0;
    this.lastInputTick = 0;
    this.lootCount = 0; // Day3: 初始化为0
  }

  // 处理输入，更新位置
  // Day2: 如果玩家已死亡，不允许移动
  // Day3: EXTRACTED 玩家也不能移动
  // Day4-2: 添加碰撞检测（世界边界 + obstacles）
  processInput(
    keys: { up: boolean; down: boolean; left: boolean; right: boolean },
    deltaTime: number, // 秒
    mapWidth: number,
    mapHeight: number,
    obstacles: OBSTACLE_STATE[] = [] // Day4-2: 障碍物列表
  ): void {
    // Day2/Day3: 死亡或已撤离的玩家不能移动
    if (this.status === 'DEAD' || this.status === 'EXTRACTED') {
      return;
    }

    // 修复: 使用 shared 的 simulatePlayerMove，确保 client/server 逻辑一致
    const newPos = simulatePlayerMove(
      { x: this.x, y: this.y },
      keys,
      deltaTime,
      mapWidth,
      mapHeight,
      obstacles
    );
    
    // 更新位置
    this.x = newPos.x;
    this.y = newPos.y;
  }

  // Day2: 检查是否可以开火（冷却时间）
  canFire(now: number): boolean {
    return now - this.lastFireTime >= this.FIRE_COOLDOWN_MS;
  }

  // Day2: 记录开火时间
  recordFire(now: number): void {
    this.lastFireTime = now;
  }

  // Day2: 受到伤害
  takeDamage(amount: number): void {
    if (this.status === 'DEAD') {
      return; // 已死亡不再扣血
    }
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp <= 0) {
      this.hp = 0;
      this.status = 'DEAD';
    }
  }

  toState(): PLAYER_STATE {
    return {
      id: this.id,
      x: this.x,
      y: this.y,
      hp: this.hp,
      status: this.status,
      lastInputSeq: this.lastInputSeq,
      lastInputTick: this.lastInputTick,
      lootCount: this.lootCount, // Day3: 包含战利品计数
      extractProgress: this.extractProgress, // 游戏化增强: 包含撤离进度
    };
  }
}

