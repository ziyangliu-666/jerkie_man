import type { PLAYER_STATE } from '@jerkie-man/shared';

export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private scale: number = 1; // DPI缩放因子

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2d context');
    }
    this.ctx = ctx;

    this.setupCanvas();
    window.addEventListener('resize', () => this.setupCanvas());
  }

  private setupCanvas(): void {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    // 设置实际渲染尺寸（backing store）
    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;

    // 设置CSS显示尺寸
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;

    // 重置transform，然后设置scale（避免重复scale）
    this.ctx.resetTransform();
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.scale = dpr;
  }

  // 屏幕坐标转世界坐标
  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    // 由于使用了setTransform(dpr,0,0,dpr,0,0)，坐标已经自动缩放
    // 所以只需要减去rect偏移，不需要再除以scale
    return {
      x: screenX - rect.left,
      y: screenY - rect.top,
    };
  }

  // 世界坐标转屏幕坐标
  worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    // 由于使用了setTransform，世界坐标直接对应屏幕坐标（已缩放）
    return {
      x: worldX + rect.left,
      y: worldY + rect.top,
    };
  }

  // 清除画布
  clear(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.ctx.clearRect(0, 0, rect.width, rect.height);
  }

  // 绘制玩家（简单方块）
  drawPlayer(player: PLAYER_STATE, isLocal: boolean = false): void {
    const size = 20; // 像素大小
    const x = player.x;
    const y = player.y;

    // 玩家颜色（本地玩家蓝色，其他红色）
    this.ctx.fillStyle = isLocal ? '#00aaff' : '#ff4444';
    this.ctx.fillRect(x - size / 2, y - size / 2, size, size);

    // 边框
    this.ctx.strokeStyle = '#fff';
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(x - size / 2, y - size / 2, size, size);

    // HP条
    const barWidth = size;
    const barHeight = 4;
    const barX = x - barWidth / 2;
    const barY = y - size / 2 - 8;

    this.ctx.fillStyle = '#333';
    this.ctx.fillRect(barX, barY, barWidth, barHeight);

    const hpPercent = player.hp / 100;
    this.ctx.fillStyle = hpPercent > 0.5 ? '#0f0' : hpPercent > 0.25 ? '#ff0' : '#f00';
    this.ctx.fillRect(barX, barY, barWidth * hpPercent, barHeight);
  }

  // Hit test：检查点击是否命中玩家
  hitTest(
    worldX: number,
    worldY: number,
    players: PLAYER_STATE[],
    threshold: number = 30
  ): PLAYER_STATE | null {
    for (const player of players) {
      const dx = worldX - player.x;
      const dy = worldY - player.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= threshold) {
        return player;
      }
    }
    return null;
  }

  // 渲染所有玩家
  render(players: PLAYER_STATE[], localPlayerId: string | null): void {
    this.clear();

    // 绘制所有玩家
    for (const player of players) {
      this.drawPlayer(player, player.id === localPlayerId);
    }

    // 临时调试：显示本地玩家坐标文本
    if (localPlayerId) {
      const localPlayer = players.find((p) => p.id === localPlayerId);
      if (localPlayer) {
        this.ctx.fillStyle = '#fff';
        this.ctx.font = '12px monospace';
        this.ctx.fillText(
          `Local: (${localPlayer.x.toFixed(1)}, ${localPlayer.y.toFixed(1)})`,
          10,
          20
        );
      }
    }
  }
}

