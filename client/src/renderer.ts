import type { PLAYER_STATE, BULLET_STATE, ITEM_STATE, OBSTACLE_STATE, WorldItem, LootBag } from '@jerkie-man/shared';
import { getItemType } from '@jerkie-man/shared';

export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private scale: number = 1; // DPI缩放因子

  private cssWidth: number = 0;
  private cssHeight: number = 0;
  
  // P0-3: Camera位置（世界坐标），用于将世界坐标转换为屏幕坐标
  // camera跟随本地玩家，让玩家始终在屏幕中心附近可见
  private camX = 0;
  private camY = 0;
  
  // P0-3 修复: 世界边界（用于 camera clamp）
  private worldWidth: number = 0;
  private worldHeight: number = 0;
  
  // P2 优化: 缓存 canvas rect，避免每帧 getBoundingClientRect()
  private cachedRectLeft: number = 0;
  private cachedRectTop: number = 0;
  // 修复: 兜底刷新策略 - 记录上次刷新时间
  private lastRectUpdateAt: number = 0;
  private readonly RECT_REFRESH_INTERVAL_MS = 250; // 最多每 250ms 刷新一次

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2d context');
    }
    this.ctx = ctx;
    // 不再自动resize，由外部调用resize()方法
  }

  // 屏幕坐标转世界坐标
  // P0-3: 考虑camera偏移，确保点击选中准确
  // P2 优化: 使用缓存的 rect，避免每帧 getBoundingClientRect()
  // 修复: 兜底刷新策略 - 如果距离上次刷新超过 250ms，自动刷新
  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    // 兜底刷新：如果距离上次刷新超过阈值，自动刷新 rect
    const now = Date.now();
    if (now - this.lastRectUpdateAt > this.RECT_REFRESH_INTERVAL_MS) {
      this.refreshRect();
    }
    
    // screenX/Y是浏览器窗口坐标（clientX/clientY）
    // 先减去canvas的rect偏移，得到canvas内的屏幕坐标（CSS像素）
    const canvasScreenX = screenX - this.cachedRectLeft;
    const canvasScreenY = screenY - this.cachedRectTop;
    // 加上camera偏移，得到世界坐标
    // 因为camera是世界坐标，所以：worldX = screenX + camX
    return {
      x: canvasScreenX + this.camX,
      y: canvasScreenY + this.camY,
    };
  }

  // 世界坐标转屏幕坐标
  // P0-3: 考虑camera偏移
  // P2 优化: 使用缓存的 rect，避免每帧 getBoundingClientRect()
  // 修复: 兜底刷新策略 - 如果距离上次刷新超过 250ms，自动刷新
  worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
    // 兜底刷新：如果距离上次刷新超过阈值，自动刷新 rect
    const now = Date.now();
    if (now - this.lastRectUpdateAt > this.RECT_REFRESH_INTERVAL_MS) {
      this.refreshRect();
    }
    
    // 世界坐标减去camera偏移，得到canvas内的屏幕坐标（CSS像素）
    const canvasScreenX = worldX - this.camX;
    const canvasScreenY = worldY - this.camY;
    // 加上缓存的rect偏移，得到浏览器窗口坐标
    return {
      x: canvasScreenX + this.cachedRectLeft,
      y: canvasScreenY + this.cachedRectTop,
    };
  }

  // 清除画布（使用 device-pixel 尺寸清屏，避免 transform/dpr/合成导致的残留）
  clear(): void {
    const ctx = this.ctx;
    ctx.save();
    // 用真实 backing store 清屏，避免 transform / dpr / 合成导致的残留
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.restore();
  }

  // 绘制玩家（简单方块）
  // P0-3: 使用屏幕坐标绘制，考虑camera偏移
  drawPlayer(player: PLAYER_STATE, isLocal: boolean = false): void {
    const size = 20; // 像素大小
    // 将世界坐标转换为屏幕坐标（减去camera偏移）
    // 修复: round 到整数像素，避免子像素抗锯齿导致的重影
    const screenX = Math.round(player.x - this.camX);
    const screenY = Math.round(player.y - this.camY);

    // 玩家颜色（本地玩家蓝色，其他红色）
    this.ctx.fillStyle = isLocal ? '#00aaff' : '#ff4444';
    this.ctx.fillRect(screenX - size / 2, screenY - size / 2, size, size);

    // 边框
    this.ctx.strokeStyle = '#fff';
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(screenX - size / 2, screenY - size / 2, size, size);

    // HP条
    const barWidth = size;
    const barHeight = 4;
    const barX = screenX - barWidth / 2;
    const barY = screenY - size / 2 - 8;

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

  // Day2: 绘制子弹
  // Step5: 使用BULLET_STATE类型，后续要画ownerId颜色时不需要改签名
  drawBullet(bullet: BULLET_STATE): void {
    // 修复: round 到整数像素，避免子像素抗锯齿导致的重影
    const screenX = Math.round(bullet.x - this.camX);
    const screenY = Math.round(bullet.y - this.camY);
    
    // 绘制小圆点
    this.ctx.fillStyle = '#ffff00'; // 黄色
    this.ctx.beginPath();
    this.ctx.arc(screenX, screenY, 3, 0, Math.PI * 2);
    this.ctx.fill();
  }

  // Day3: 绘制物品（保留兼容）
  drawItem(item: ITEM_STATE): void {
    // 修复: round 到整数像素，避免子像素抗锯齿导致的重影
    const screenX = Math.round(item.x - this.camX);
    const screenY = Math.round(item.y - this.camY);
    const size = 12; // 物品大小
    
    // 绘制小方块（先用统一颜色，后续可按type区分）
    this.ctx.fillStyle = '#00ff00'; // 绿色
    this.ctx.fillRect(screenX - size / 2, screenY - size / 2, size, size);

    // 边框
    this.ctx.strokeStyle = '#fff';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(screenX - size / 2, screenY - size / 2, size, size);
  }

  // 新增: 绘制世界物品
  drawWorldItem(worldItem: WorldItem): void {
    const screenX = Math.round(worldItem.x - this.camX);
    const screenY = Math.round(worldItem.y - this.camY);
    const size = 12;
    
    try {
      const itemType = getItemType(worldItem.typeId);
      // 根据稀有度设置颜色
      if (itemType.rarity === 'COMMON') {
        this.ctx.fillStyle = '#00ff00'; // 绿色
      } else if (itemType.rarity === 'RARE') {
        this.ctx.fillStyle = '#0088ff'; // 蓝色
      } else {
        this.ctx.fillStyle = '#ff8800'; // 橙色（QUEST）
      }
    } catch {
      this.ctx.fillStyle = '#00ff00'; // 默认绿色
    }
    
    this.ctx.fillRect(screenX - size / 2, screenY - size / 2, size, size);
    this.ctx.strokeStyle = '#000000';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(screenX - size / 2, screenY - size / 2, size, size);
  }

  // 新增: 绘制掉落包
  drawLootBag(bag: LootBag): void {
    const screenX = Math.round(bag.x - this.camX);
    const screenY = Math.round(bag.y - this.camY);
    const size = 16; // 掉落包稍大一些
    
    // 掉落包用棕色表示
    this.ctx.fillStyle = '#8b4513';
    this.ctx.fillRect(screenX - size / 2, screenY - size / 2, size, size);
    this.ctx.strokeStyle = '#654321';
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(screenX - size / 2, screenY - size / 2, size, size);
    
    // 显示物品数量（如果有）
    if (bag.items.length > 0) {
      this.ctx.fillStyle = '#ffffff';
      this.ctx.font = '10px monospace';
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText(bag.items.length.toString(), screenX, screenY);
    }
  }

  // Day3: 绘制撤离区
  drawExtractZone(zone: { x: number; y: number; w: number; h: number }): void {
    const screenX = zone.x - this.camX;
    const screenY = zone.y - this.camY;
    
    // 半透明矩形填充
    this.ctx.fillStyle = 'rgba(0, 255, 0, 0.2)';
    this.ctx.fillRect(screenX, screenY, zone.w, zone.h);
    
    // 边框线
    this.ctx.strokeStyle = '#0f0';
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(screenX, screenY, zone.w, zone.h);
  }

  // Day4-2: 绘制障碍物（灰色矩形）
  drawObstacle(obstacle: OBSTACLE_STATE): void {
    // 修复: round 到整数像素，避免子像素抗锯齿导致的重影
    const screenX = Math.round(obstacle.x - this.camX);
    const screenY = Math.round(obstacle.y - this.camY);

    // 填充（深灰色）
    this.ctx.fillStyle = '#666';
    this.ctx.fillRect(screenX, screenY, obstacle.w, obstacle.h);

    // 边框（深色）
    this.ctx.strokeStyle = '#333';
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(screenX, screenY, obstacle.w, obstacle.h);
  }

  // 渲染所有玩家和子弹
  // P0-3: 计算camera让本地玩家居中，保证玩家永远可见
  // Step5: bullets参数类型改为BULLET_STATE[]，类型明确且可扩展
  // Day3: 增加items和extractZone参数
  render(
    players: PLAYER_STATE[],
    localPlayerId: string | null,
    debug: boolean = false,
    bullets: BULLET_STATE[] = [],
    items: ITEM_STATE[] = [],
    extractZone?: { x: number; y: number; w: number; h: number },
    obstacles: OBSTACLE_STATE[] = [], // Day4-2: 障碍物列表
    worldItems: WorldItem[] = [], // 新增: 世界物品列表
    lootBags: LootBag[] = [] // 新增: 掉落包列表
  ): void {
    this.clear();

    // P0-3: 计算camera位置，让本地玩家显示在屏幕中心
    if (localPlayerId) {
      const localPlayer = players.find((p) => p.id === localPlayerId);
      if (localPlayer) {
        // camera位置 = 玩家世界坐标 - 屏幕中心偏移
        // 这样玩家就会显示在屏幕中心（screenX = player.x - camX = cssWidth/2）
        let targetCamX = localPlayer.x - this.cssWidth / 2;
        let targetCamY = localPlayer.y - this.cssHeight / 2;
        
        // P0-3 修复: Clamp camera 到世界边界（避免看到出界空白）
        if (this.worldWidth > 0 && this.worldHeight > 0) {
          targetCamX = Math.max(0, Math.min(targetCamX, this.worldWidth - this.cssWidth));
          targetCamY = Math.max(0, Math.min(targetCamY, this.worldHeight - this.cssHeight));
        }
        
        this.camX = targetCamX;
        this.camY = targetCamY;
      }
    }
    // 如果本地玩家不存在，camX/camY保持0（不移动camera）

    // Day4-2: 先绘制障碍物（背景层）
    for (const obstacle of obstacles) {
      this.drawObstacle(obstacle);
    }

    // Day3: 绘制撤离区（如果有）
    if (extractZone) {
      this.drawExtractZone(extractZone);
    }

    // P2-1: 旧 items 系统已停用，不再绘制
    // for (const item of items) {
    //   this.drawItem(item);
    // }

    // 绘制世界物品（只使用新系统）
    for (const worldItem of worldItems) {
      this.drawWorldItem(worldItem);
    }

    // 新增: 绘制掉落包
    for (const bag of lootBags) {
      this.drawLootBag(bag);
    }

    // 绘制所有玩家（使用屏幕坐标）
    for (const player of players) {
      this.drawPlayer(player, player.id === localPlayerId);
    }

    // Day2: 绘制所有子弹
    for (const bullet of bullets) {
      this.drawBullet(bullet);
    }

    // Debug模式：显示本地玩家坐标文本（使用屏幕坐标，固定在左上角）
    if (debug && localPlayerId) {
      const localPlayer = players.find((p) => p.id === localPlayerId);
      if (localPlayer) {
        this.ctx.fillStyle = '#fff';
        this.ctx.font = '12px monospace';
        // 使用屏幕坐标绘制，固定在左上角（10, 20）
        this.ctx.fillText(
          `Local: (${localPlayer.x.toFixed(1)}, ${localPlayer.y.toFixed(1)})`,
          10,
          20
        );
      }
    }
  }

  // P0-3 修复: 设置世界边界（用于 camera clamp）
  setWorldBounds(width: number, height: number): void {
    this.worldWidth = width;
    this.worldHeight = height;
  }

  // Resize方法：由外部调用，负责所有canvas尺寸和transform设置
  // 单一真相：所有resize逻辑都在这里，不再有内部自动resize
  // P2 优化: 在 resize 时缓存 rect，避免每帧 getBoundingClientRect()

  resize(cssWidth: number, cssHeight: number): void {
    this.cssWidth = cssWidth;
    this.cssHeight = cssHeight;
    const dpr = window.devicePixelRatio || 1;
    
    // 设置CSS显示尺寸
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;

    // 设置实际渲染尺寸（backing store）
    this.canvas.width = cssWidth * dpr;
    this.canvas.height = cssHeight * dpr;

    // P0-4 修复: resetTransform 兼容性（Safari 等环境可能不支持）
    // 使用 setTransform(1,0,0,1,0,0) 作为 fallback
    try {
      if (this.ctx.resetTransform) {
        this.ctx.resetTransform();
      } else {
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
    } catch {
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.scale = dpr;
    
    // P2 优化: 缓存 canvas rect（resize 时更新，避免每帧读取 DOM）
    this.refreshRect();
  }
  
  // P1-2 修复: 提供 refreshRect 方法，在 layout shift 时手动刷新
  // 用于处理页面滚动、浏览器 UI 变化、CSS 变化等导致的 canvas 位置偏移
  // 修复: 更新 lastRectUpdateAt 时间戳
  refreshRect(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.cachedRectLeft = rect.left;
    this.cachedRectTop = rect.top;
    this.lastRectUpdateAt = Date.now();
  }
}

