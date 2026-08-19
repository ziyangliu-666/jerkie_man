import { getBulletPenetration, isObstacleDestructible, OBSTACLE_STATE } from '@ziyang-protocol/shared';

export class Decoy {
  public id: string;
  public x: number;
  public y: number;
  public vx: number;
  public vy: number;
  public ownerId: string;
  public name: string | undefined;
  public weaponTypeId: string | undefined;
  public armorTypeId: string | undefined;
  public hp: number;
  public maxHp: number;
  public createdAt: number;
  public durationMs: number = 15000; // 15 seconds lifetime
  public aimRad: number = 0; // 瞄准角度（用于眼睛渲染）

  constructor(
    id: string,
    x: number,
    y: number,
    ownerId: string,
    name: string | undefined,
    weaponTypeId: string | undefined,
    armorTypeId: string | undefined,
    angle: number
  ) {
    this.id = id;
    this.x = x;
    this.y = y;
    this.ownerId = ownerId;
    this.name = name;
    this.weaponTypeId = weaponTypeId;
    this.armorTypeId = armorTypeId;
    this.hp = 50; // Low HP but enough to trick
    this.maxHp = 50;
    this.createdAt = Date.now();
    this.aimRad = Math.random() * Math.PI * 2; // 随机瞄准角度
    
    // Run in the direction thrown/spawned at normal player speed
    const SPEED = 200; // Match player speed
    this.vx = Math.cos(angle) * SPEED;
    this.vy = Math.sin(angle) * SPEED;
  }

  update(deltaTime: number, obstacles: OBSTACLE_STATE[], mapW: number, mapH: number): void {
    const nextX = this.x + this.vx * deltaTime;
    const nextY = this.y + this.vy * deltaTime;

    // Simple collision with map bounds - bounce
    if (nextX <= 0 || nextX >= mapW) {
        this.vx = -this.vx;
    }
    if (nextY <= 0 || nextY >= mapH) {
        this.vy = -this.vy;
    }

    // Simple collision with obstacles - bounce or stop?
    // Let's just walk through or stop. Bounce is funnier/more distracting.
    // For MVP, just update position. Collisions might be too expensive if full physics.
    // Let's do simple bounding box check.
    
    let hitObstacle = false;
    // Check against obstacles (simplified point check)
    for (const obs of obstacles) {
        if ((obs as any).type === 'bush') continue; // Ignore bushes
        
        if (nextX >= obs.x && nextX <= obs.x + obs.w &&
            nextY >= obs.y && nextY <= obs.y + obs.h) {
            hitObstacle = true;
            break;
        }
    }

    if (hitObstacle) {
        // Reverse direction on hit
        this.vx = -this.vx;
        this.vy = -this.vy;
    } else {
        this.x += this.vx * deltaTime;
        this.y += this.vy * deltaTime;
    }
    
    // 随机改变瞄准角度（模拟假人随机看向不同方向）
    if (Math.random() < 0.02) { // 2% 概率每帧改变方向
      this.aimRad = Math.random() * Math.PI * 2;
    }
    
    // Check lifetime
    if (Date.now() - this.createdAt > this.durationMs) {
        this.hp = 0; // Die naturally
    }
  }

  takeDamage(amount: number): void {
    this.hp -= amount;
  }
}
