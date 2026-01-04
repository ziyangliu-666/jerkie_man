import type { PLAYER_STATE, BULLET_STATE, ITEM_STATE, OBSTACLE_STATE, WorldItem, LootBag } from '@jerkie-man/shared';
import { getItemType, getWeaponDef, msToTicks } from '@jerkie-man/shared';

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
  drawPlayer(player: PLAYER_STATE, isLocal: boolean = false, currentServerTick?: number): void {
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

    // 新增: 显示玩家名字（如果有）
    // 如果玩家已死亡且有击杀信息，显示坟墓格式的名字
    let displayName: string | undefined;
    if (player.status === 'DEAD') {
      // 如果玩家已死亡，检查是否有击杀信息
      if (player.killedBy && player.killedByWeaponName) {
        // 显示为：xxx 的坟墓（被 xxx 用 xxx 所击杀）
        displayName = `${player.name || player.id} 的坟墓（被 ${player.killedBy} 用 ${player.killedByWeaponName} 所击杀）`;
      } else if (player.name) {
        // 死亡但没有击杀信息，仍然显示名字
        displayName = player.name;
      } else {
        // 死亡但没有名字，显示ID
        displayName = player.id;
      }
    } else if (player.name) {
      // 活着的玩家显示名字
      displayName = player.name;
    }
    
    if (displayName) {
      const nameY = screenY - size / 2 - 12;
      // 只在屏幕内才绘制名字（避免绘制在屏幕外）
      if (nameY >= 0 && nameY < this.cssHeight && screenX >= 0 && screenX < this.cssWidth) {
        this.ctx.save();
        // 死亡玩家的名字颜色改为灰色
        this.ctx.fillStyle = player.status === 'DEAD' ? '#999' : '#fff';
        this.ctx.font = 'bold 12px monospace';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'bottom';
        // 文字描边（保证在复杂背景上可读）
        this.ctx.strokeStyle = '#000';
        this.ctx.lineWidth = 3;
        this.ctx.miterLimit = 2;
        this.ctx.strokeText(displayName, screenX, nameY);
        this.ctx.fillText(displayName, screenX, nameY);
        this.ctx.restore();
      }
    }

    // 新增: 绘制换弹进度条（玩家下方，蓝色）
    if (player.weaponRuntime && currentServerTick !== undefined) {
      const wr = player.weaponRuntime;
      if (wr.reloadingUntilTick > 0 && currentServerTick < wr.reloadingUntilTick) {
        // 正在换弹，计算进度
        // 需要知道武器定义来计算总时长
        try {
          const weaponDef = getWeaponDef(wr.weaponTypeId);
          const reloadTicks = msToTicks(weaponDef.reloadMs);
          const startTick = wr.reloadingUntilTick - reloadTicks;
          const progress = Math.min(1, (currentServerTick - startTick) / reloadTicks);
          
          // 在玩家下方绘制蓝色进度条
          const reloadBarWidth = size;
          const reloadBarHeight = 3;
          const reloadBarX = screenX - reloadBarWidth / 2;
          const reloadBarY = screenY + size / 2 + 4; // 玩家下方4px
          
          // 背景
          this.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
          this.ctx.fillRect(reloadBarX, reloadBarY, reloadBarWidth, reloadBarHeight);
          
          // 进度条（蓝色）
          this.ctx.fillStyle = '#0088ff'; // 蓝色
          this.ctx.fillRect(reloadBarX, reloadBarY, reloadBarWidth * progress, reloadBarHeight);
        } catch {
          // 无法获取武器定义，跳过绘制
        }
      }
    }
  }

  // 新增: 绘制屏幕外玩家的箭头指引
  private drawOffscreenPlayerIndicator(localPlayer: PLAYER_STATE, otherPlayer: PLAYER_STATE): void {
    // 计算其他玩家相对于本地玩家的屏幕坐标
    const screenX = otherPlayer.x - this.camX;
    const screenY = otherPlayer.y - this.camY;
    
    // 检查是否在屏幕外
    const margin = 30; // 边缘边距
    const isOffscreen = 
      screenX < -margin || 
      screenX > this.cssWidth + margin || 
      screenY < -margin || 
      screenY > this.cssHeight + margin;
    
    if (!isOffscreen) {
      // 在屏幕内，不需要显示箭头
      return;
    }
    
    // 计算方向（从屏幕中心指向其他玩家）
    const centerX = this.cssWidth / 2;
    const centerY = this.cssHeight / 2;
    const dx = screenX - centerX;
    const dy = screenY - centerY;
    const angle = Math.atan2(dy, dx);
    
    // 计算箭头在屏幕边缘的位置
    // 使用射线与屏幕边界的交点
    const padding = 20; // 箭头距离边缘的边距
    let arrowX = centerX;
    let arrowY = centerY;
    
    // 计算射线与四条边的交点，选择最近的一个
    const intersections: Array<{ x: number; y: number; dist: number }> = [];
    
    // 上边 (y = padding)
    if (Math.sin(angle) < 0) {
      const t = (padding - centerY) / Math.sin(angle);
      const x = centerX + Math.cos(angle) * t;
      if (x >= padding && x <= this.cssWidth - padding) {
        intersections.push({ x, y: padding, dist: t });
      }
    }
    
    // 下边 (y = cssHeight - padding)
    if (Math.sin(angle) > 0) {
      const t = (this.cssHeight - padding - centerY) / Math.sin(angle);
      const x = centerX + Math.cos(angle) * t;
      if (x >= padding && x <= this.cssWidth - padding) {
        intersections.push({ x, y: this.cssHeight - padding, dist: t });
      }
    }
    
    // 左边 (x = padding)
    if (Math.cos(angle) < 0) {
      const t = (padding - centerX) / Math.cos(angle);
      const y = centerY + Math.sin(angle) * t;
      if (y >= padding && y <= this.cssHeight - padding) {
        intersections.push({ x: padding, y, dist: t });
      }
    }
    
    // 右边 (x = cssWidth - padding)
    if (Math.cos(angle) > 0) {
      const t = (this.cssWidth - padding - centerX) / Math.cos(angle);
      const y = centerY + Math.sin(angle) * t;
      if (y >= padding && y <= this.cssHeight - padding) {
        intersections.push({ x: this.cssWidth - padding, y, dist: t });
      }
    }
    
    // 选择最近的交点
    if (intersections.length > 0) {
      const nearest = intersections.reduce((min, curr) => curr.dist < min.dist ? curr : min);
      arrowX = nearest.x;
      arrowY = nearest.y;
    } else {
      // 如果没有交点（不应该发生），使用默认位置
      arrowX = Math.max(padding, Math.min(this.cssWidth - padding, centerX + Math.cos(angle) * 100));
      arrowY = Math.max(padding, Math.min(this.cssHeight - padding, centerY + Math.sin(angle) * 100));
    }
    
    // 绘制箭头
    this.ctx.save();
    
    // 移动到箭头位置并旋转
    this.ctx.translate(arrowX, arrowY);
    this.ctx.rotate(angle + Math.PI / 2); // 箭头指向目标
    
    // 绘制箭头（三角形）
    const arrowSize = 12;
    this.ctx.fillStyle = '#ff4444';
    this.ctx.strokeStyle = '#fff';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(0, -arrowSize);
    this.ctx.lineTo(-arrowSize / 2, arrowSize / 2);
    this.ctx.lineTo(arrowSize / 2, arrowSize / 2);
    this.ctx.closePath();
    this.ctx.fill();
    this.ctx.stroke();
    
    this.ctx.restore();
    
    // 绘制玩家名字（根据箭头方向智能调整位置，确保在屏幕内）
    if (otherPlayer.name) {
      this.ctx.save();
      
      // 根据箭头在屏幕边缘的位置，决定名字应该放在箭头的哪一侧
      const nameOffset = arrowSize + 20; // 名字距离箭头的距离
      let nameX = arrowX;
      let nameY = arrowY;
      
      // 判断箭头在屏幕的哪一边，名字放在相反方向（确保在屏幕内）
      if (arrowY <= padding + 10) {
        // 箭头在屏幕上方，名字放在箭头下方
        nameY = arrowY + nameOffset;
      } else if (arrowY >= this.cssHeight - padding - 10) {
        // 箭头在屏幕下方，名字放在箭头上方
        nameY = arrowY - nameOffset;
      } else if (arrowX <= padding + 10) {
        // 箭头在屏幕左边，名字放在箭头右边
        nameX = arrowX + nameOffset;
      } else if (arrowX >= this.cssWidth - padding - 10) {
        // 箭头在屏幕右边，名字放在箭头左边
        nameX = arrowX - nameOffset;
      } else {
        // 默认情况（不应该发生），放在箭头下方
        nameY = arrowY + nameOffset;
      }
      
      // 确保名字在屏幕内（添加额外的边距检查）
      const textPadding = 8;
      nameX = Math.max(textPadding, Math.min(this.cssWidth - textPadding, nameX));
      nameY = Math.max(textPadding, Math.min(this.cssHeight - textPadding, nameY));
      
      // 绘制名字文字（无背景，只有描边确保可读性）
      this.ctx.font = 'bold 12px monospace';
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      
      // 绘制名字文字（使用描边确保在复杂背景上可读）
      this.ctx.fillStyle = '#fff';
      this.ctx.strokeStyle = '#000';
      this.ctx.lineWidth = 3;
      this.ctx.miterLimit = 2;
      this.ctx.strokeText(otherPlayer.name, nameX, nameY);
      this.ctx.fillText(otherPlayer.name, nameX, nameY);
      
      this.ctx.restore();
    }
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
    // 修复: 不 round，允许 subpixel 绘制（子弹是小圆点，用 subpixel 更丝滑）
    const screenX = bullet.x - this.camX;
    const screenY = bullet.y - this.camY;
    
    // 绘制小圆点
    this.ctx.fillStyle = '#ffff00'; // 黄色
    this.ctx.beginPath();
    this.ctx.arc(screenX, screenY, 3, 0, Math.PI * 2);
    this.ctx.fill();
  }

  // 命中特效（简易版：圆形闪光，逐渐消失）
  drawHitEffect(effect: { x: number; y: number; age: number; type: 'obstacle' | 'player' }): void {
    const screenX = effect.x - this.camX;
    const screenY = effect.y - this.camY;
    
    // age: 0~1，0 表示刚生成，1 表示即将消失
    const alpha = 1 - effect.age; // 逐渐透明
    const radius = 4 + effect.age * 12; // 逐渐扩大
    
    // 玩家命中：红色闪光；障碍物命中：白色闪光
    const color = effect.type === 'player' ? `rgba(255, 100, 100, ${alpha})` : `rgba(255, 255, 255, ${alpha})`;
    
    this.ctx.fillStyle = color;
    this.ctx.beginPath();
    this.ctx.arc(screenX, screenY, radius, 0, Math.PI * 2);
    this.ctx.fill();
  }

  // 近战挥击特效（扇形弧线）
  drawMeleeSwing(effect: { x: number; y: number; aimRad: number; range: number; arcRad: number; age: number }): void {
    const screenX = effect.x - this.camX;
    const screenY = effect.y - this.camY;
    const alpha = Math.max(0, 1 - effect.age);
    const start = effect.aimRad - effect.arcRad / 2;
    const end = effect.aimRad + effect.arcRad / 2;

    this.ctx.save();
    this.ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.15})`;
    this.ctx.beginPath();
    this.ctx.moveTo(screenX, screenY);
    this.ctx.arc(screenX, screenY, effect.range, start, end);
    this.ctx.closePath();
    this.ctx.fill();

    this.ctx.strokeStyle = `rgba(255, 255, 255, ${alpha * 0.6})`;
    this.ctx.lineWidth = 3;
    this.ctx.lineCap = 'round';
    this.ctx.beginPath();
    this.ctx.arc(screenX, screenY, effect.range, start, end);
    this.ctx.stroke();
    this.ctx.restore();
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

  // 新增: 绘制地图边界框
  drawWorldBounds(): void {
    if (this.worldWidth <= 0 || this.worldHeight <= 0) {
      return; // 边界未设置，不绘制
    }

    // 计算边界框在屏幕上的位置
    const screenX = 0 - this.camX;
    const screenY = 0 - this.camY;
    
    // 绘制边界框（只绘制可见部分）
    this.ctx.save();
    
    // 使用明显的颜色和线宽
    this.ctx.strokeStyle = '#ffff00'; // 黄色，比较醒目
    this.ctx.lineWidth = 4; // 较粗的线条
    this.ctx.setLineDash([10, 5]); // 虚线样式，更明显
    
    // 绘制矩形边界
    this.ctx.strokeRect(screenX, screenY, this.worldWidth, this.worldHeight);
    
    this.ctx.restore();
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
    lootBags: LootBag[] = [], // 新增: 掉落包列表
    meleeSwings: Array<{ x: number; y: number; aimRad: number; range: number; arcRad: number; age: number }> = [],
    hitEffects: Array<{ x: number; y: number; age: number; type: 'obstacle' | 'player' }> = [], // 命中特效
    currentServerTick?: number // 新增: 当前服务器 tick（用于计算换弹进度）
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

    // 新增: 绘制地图边界框（最底层）
    this.drawWorldBounds();

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
      this.drawPlayer(player, player.id === localPlayerId, currentServerTick);
    }
    
    // 新增: 绘制屏幕外玩家的箭头指引
    if (localPlayerId) {
      const localPlayer = players.find((p) => p.id === localPlayerId);
      if (localPlayer) {
        for (const player of players) {
          if (player.id !== localPlayerId && player.status === 'ALIVE') {
            this.drawOffscreenPlayerIndicator(localPlayer, player);
          }
        }
      }
    }

    // 近战挥击特效
    for (const swing of meleeSwings) {
      this.drawMeleeSwing(swing);
    }

    // Day2: 绘制所有子弹
    for (const bullet of bullets) {
      this.drawBullet(bullet);
    }

    // 绘制命中特效（简易闪光）
    for (const effect of hitEffects) {
      this.drawHitEffect(effect);
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
