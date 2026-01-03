import type { PLAYER_STATE } from '@jerkie-man/shared';

export class Player {
  public id: string;
  public x: number;
  public y: number;
  public hp: number;
  public status: 'ALIVE' | 'DEAD' | 'EXTRACTED';
  public lastInputSeq: number;
  public lastInputTick: number;

  // 移动速度（像素/秒）
  private readonly SPEED = 200; // 200px/s，在20Hz tick下约10px/tick

  constructor(id: string, x: number = 0, y: number = 0) {
    this.id = id;
    this.x = x;
    this.y = y;
    this.hp = 100;
    this.status = 'ALIVE';
    this.lastInputSeq = 0;
    this.lastInputTick = 0;
  }

  // 处理输入，更新位置
  processInput(
    keys: { up: boolean; down: boolean; left: boolean; right: boolean },
    deltaTime: number, // 秒
    mapWidth: number,
    mapHeight: number
  ): void {
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

    // 计算新位置
    const newX = this.x + dx * this.SPEED * deltaTime;
    const newY = this.y + dy * this.SPEED * deltaTime;

    // 边界clamp
    this.x = Math.max(0, Math.min(mapWidth, newX));
    this.y = Math.max(0, Math.min(mapHeight, newY));
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
    };
  }
}

