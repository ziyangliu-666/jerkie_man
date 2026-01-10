/**
 * 投掷瞄准系统
 * 按数字键进入瞄准模式，显示投掷范围和目标位置
 */

export interface ThrowingState {
  isAiming: boolean;
  targetX: number;
  targetY: number;
  playerX: number;
  playerY: number;
  maxRange: number;
}

export class ThrowingAim {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private state: ThrowingState = {
    isAiming: false,
    targetX: 0,
    targetY: 0,
    playerX: 0,
    playerY: 0,
    maxRange: 300, // 最大投掷距离
  };
  
  // 性能优化：缓存轨迹点，避免每帧重新计算
  private cachedTrajectoryPoints: { x: number; y: number }[] = [];
  private lastTrajectoryHash = '';

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D context');
    }
    this.ctx = ctx;
  }

  /**
   * 进入瞄准模式
   */
  startAiming(): void {
    this.state.isAiming = true;
    // 不再初始化位置，由 render 时传入
  }

  /**
   * 退出瞄准模式
   */
  stopAiming(): void {
    this.state.isAiming = false;
    // 清理缓存
    this.cachedTrajectoryPoints = [];
    this.lastTrajectoryHash = '';
  }

  /**
   * 更新目标位置（鼠标位置）
   * @param mouseWorldX 鼠标世界坐标X
   * @param mouseWorldY 鼠标世界坐标Y
   * @param playerX 玩家世界坐标X
   * @param playerY 玩家世界坐标Y
   */
  updateTarget(mouseWorldX: number, mouseWorldY: number, playerX: number, playerY: number): void {
    if (!this.state.isAiming) return;

    // 更新玩家位置（每次更新目标时自动跟随玩家）
    this.state.playerX = playerX;
    this.state.playerY = playerY;

    const dx = mouseWorldX - playerX;
    const dy = mouseWorldY - playerY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance <= this.state.maxRange) {
      // 在范围内，直接设置目标
      this.state.targetX = mouseWorldX;
      this.state.targetY = mouseWorldY;
    } else {
      // 超出范围，限制到最大距离
      const angle = Math.atan2(dy, dx);
      this.state.targetX = playerX + Math.cos(angle) * this.state.maxRange;
      this.state.targetY = playerY + Math.sin(angle) * this.state.maxRange;
    }
  }

  /**
   * 获取当前状态
   */
  getState(): ThrowingState {
    return { ...this.state };
  }

  /**
   * 计算投掷轨迹点（带缓存优化）
   */
  private calculateTrajectoryOptimized(startX: number, startY: number, endX: number, endY: number): { x: number; y: number }[] {
    // 创建轨迹哈希，用于缓存判断
    const hash = `${Math.round(startX)},${Math.round(startY)},${Math.round(endX)},${Math.round(endY)}`;
    
    // 如果轨迹没有变化，返回缓存的结果
    if (hash === this.lastTrajectoryHash && this.cachedTrajectoryPoints.length > 0) {
      return this.cachedTrajectoryPoints;
    }
    
    // 重新计算轨迹
    const points: { x: number; y: number }[] = [];
    const steps = 15; // 减少步数，提高性能
    
    const dx = endX - startX;
    const dy = endY - startY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // 抛物线高度基于距离
    const maxHeight = Math.min(distance * 0.4, 120);
    
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = startX + dx * t;
      
      // 抛物线轨迹
      const parabola = 4 * maxHeight * t * (1 - t);
      const y = startY + dy * t - parabola;
      
      points.push({ x, y });
    }
    
    // 缓存结果
    this.cachedTrajectoryPoints = points;
    this.lastTrajectoryHash = hash;
    
    return points;
  }

  /**
   * 渲染瞄准界面
   */
  render(worldToScreen: (x: number, y: number) => { x: number; y: number }): void {
    if (!this.state.isAiming) {
      return;
    }

    this.ctx.save();
    
    const playerScreen = worldToScreen(this.state.playerX, this.state.playerY);
    const targetScreen = worldToScreen(this.state.targetX, this.state.targetY);
    
    // 1. 绘制投掷范围圆圈
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash([5, 5]);
    
    this.ctx.beginPath();
    this.ctx.arc(playerScreen.x, playerScreen.y, this.state.maxRange, 0, Math.PI * 2);
    this.ctx.stroke();
    
    // 2. 绘制投掷轨迹（使用缓存优化）
    const trajectoryPoints = this.calculateTrajectoryOptimized(
      this.state.playerX, 
      this.state.playerY, 
      this.state.targetX, 
      this.state.targetY
    );
    
    this.ctx.strokeStyle = 'rgba(255, 87, 34, 0.8)';
    this.ctx.lineWidth = 3;
    this.ctx.setLineDash([8, 4]);
    
    this.ctx.beginPath();
    for (let i = 0; i < trajectoryPoints.length; i++) {
      const point = trajectoryPoints[i];
      const screenPos = worldToScreen(point.x, point.y);
      
      if (i === 0) {
        this.ctx.moveTo(screenPos.x, screenPos.y);
      } else {
        this.ctx.lineTo(screenPos.x, screenPos.y);
      }
    }
    this.ctx.stroke();
    
    // 3. 绘制目标位置标记
    this.ctx.fillStyle = 'rgba(255, 87, 34, 0.3)';
    this.ctx.strokeStyle = 'rgba(255, 87, 34, 0.8)';
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash([]);
    
    // 爆炸范围圆圈
    this.ctx.beginPath();
    this.ctx.arc(targetScreen.x, targetScreen.y, 100, 0, Math.PI * 2); // 100px爆炸半径
    this.ctx.fill();
    this.ctx.stroke();
    
    // 十字标记
    this.ctx.strokeStyle = 'rgba(255, 87, 34, 1.0)';
    this.ctx.lineWidth = 3;
    
    this.ctx.beginPath();
    this.ctx.moveTo(targetScreen.x - 15, targetScreen.y);
    this.ctx.lineTo(targetScreen.x + 15, targetScreen.y);
    this.ctx.moveTo(targetScreen.x, targetScreen.y - 15);
    this.ctx.lineTo(targetScreen.x, targetScreen.y + 15);
    this.ctx.stroke();
    
    // 4. 绘制提示文字
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    this.ctx.font = '16px Rajdhani, sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('左键投掷 | 右键取消', this.canvas.width / 2, 50);
    
    this.ctx.restore();
  }

  /**
   * 调整画布大小
   */
  resize(width: number, height: number): void {
    // ThrowingAim 使用与主渲染器相同的画布，不需要单独调整大小
  }
}