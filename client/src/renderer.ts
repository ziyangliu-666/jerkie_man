import type { PLAYER_STATE, BULLET_STATE, ITEM_STATE, OBSTACLE_STATE, WorldItem, LootBag, DECOY_STATE, TURRET_STATE, Zone } from '@jerkie-man/shared';
import { getItemType, getWeaponDef, msToTicks, PLAYER_SPEED } from '@jerkie-man/shared';

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
  
  // 新增: 允许屏幕超出地图边界的像素值（用于避免 DOM UI 挡住操作）
  private cameraOverflowPixels: number = 300;
  
  // P2 优化: 缓存 canvas rect，避免每帧 getBoundingClientRect()
  private cachedRectLeft: number = 0;
  private cachedRectTop: number = 0;
  // 修复: 兜底刷新策略 - 记录上次刷新时间
  private lastRectUpdateAt: number = 0;
  private readonly RECT_REFRESH_INTERVAL_MS = 250; // 最多每 250ms 刷新一次
  private shakeEndAt = 0;
  private shakeStartAt = 0;
  private shakeIntensity = 0;
  private shakeDurationMs = 0;

  // 新增: 玩家拖影轨迹（世界坐标 + alpha）
  // key: playerId -> 最近若干帧的位置和透明度
  private playerTrails: Map<string, Array<{ x: number; y: number; alpha: number }>> = new Map();
  // 新增: 拖影强度（0-1，用于控制开启/结束的过渡）
  private playerTrailStrength: Map<string, number> = new Map();
  // 新增: 速度采样（基于世界位置 + 时间），用于判断当前“视觉速度”
  private playerLastSample: Map<string, { x: number; y: number; t: number }> = new Map();
  
  // 新增: 烟雾全屏覆盖过渡动画状态
  private smokeOverlayAlpha: number = 0; // 当前覆盖层透明度 (0-1)
  private smokeOverlayTargetAlpha: number = 0; // 目标透明度 (0-1)
  private readonly SMOKE_TRANSITION_MS = 200; // 过渡时间 200ms

  // 新增: 视觉反馈状态 (Decoy Glitch & Disguise Fizzle)
  private decoyStates: Map<string, { lastHp: number, glitchUntil: number }> = new Map();
  private disguisedPlayers: Set<string> = new Set();
  private fizzleEffects: Array<{ x: number; y: number; until: number; maxRadius: number }> = [];

  // 性能优化: 障碍物精灵缓存
  private obsSprite = new Map<string, HTMLCanvasElement>();
  // 性能优化: 文字宽度缓存
  private textWidthCache = new Map<string, number>();
  // 性能优化: 复用 Set 对象，避免每帧 new
  private activeIds = new Set<string>();
  private currentDecoyIds = new Set<string>();
  
  // 性能优化: 画质控制（限制 DPR 和渲染分辨率）
  private maxDpr: number = 1.5;     // 限制 dpr 上限（1.25~1.75 都行）
  private renderScale: number = 0.85;  // 额外分辨率缩放（0.6~1）
  
  // 性能优化: 烟雾噪点缓存（避免每帧随机生成）
  private smokeNoisePoints: Array<{ x: number; y: number; s: number; a: number }> = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', {
      alpha: false,          // 画布不透明：合成更省
      desynchronized: true,  // 降输入/渲染延迟：支持就赚
    } as CanvasRenderingContext2DSettings);
    if (!ctx) {
      throw new Error('Failed to get 2d context');
    }
    this.ctx = ctx;
    // 不再自动resize，由外部调用resize()方法
  }

  triggerShake(intensity: number, durationMs: number = 180): void {
    const clamped = Math.max(0, Math.min(1, intensity));
    if (clamped <= 0) return;
    const now = performance.now();
    if (now > this.shakeEndAt || clamped > this.shakeIntensity) {
      this.shakeIntensity = clamped;
      this.shakeDurationMs = durationMs;
      this.shakeStartAt = now;
      this.shakeEndAt = now + durationMs;
    } else {
      this.shakeEndAt = Math.max(this.shakeEndAt, now + durationMs);
    }
  }

  private getShakeOffset(): { x: number; y: number } {
    const now = performance.now();
    if (now >= this.shakeEndAt) {
      return { x: 0, y: 0 };
    }
    const remaining = this.shakeEndAt - now;
    const progress = Math.max(0, Math.min(1, remaining / this.shakeDurationMs));
    const strength = this.shakeIntensity * progress;
    const maxOffset = 14 * strength;
    return {
      x: (Math.random() - 0.5) * 2 * maxOffset,
      y: (Math.random() - 0.5) * 2 * maxOffset,
    };
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
  drawPlayer(
    player: PLAYER_STATE, 
    isLocal: boolean = false, 
    currentServerTick?: number,
    nowMs: number = Date.now(),
    flashTotalMs: number = 5000,
    localInBushOverride?: boolean
  ): void {
    // 🎭 伪装检测：如果该玩家伪装了，则渲染为AI（包括本地玩家自己）
    const isDisguised = player.buffs?.some(b => b.kind === 'disguise');
    const shouldRenderAsAi = isDisguised;
    
    if (shouldRenderAsAi) {
      // 🤖 渲染为AI样式（如果是本地玩家，会额外显示伪装进度条）
      this.drawDisguisedPlayerAsAi(player, currentServerTick, isLocal);
      return;
    }
    
    // 正常玩家渲染...
    const size = 20; // 像素大小
    // 将世界坐标转换为屏幕坐标（减去camera偏移）
    // 修复: round 到整数像素，避免子像素抗锯齿导致的重影
    const screenX = Math.round(player.x - this.camX);
    const screenY = Math.round(player.y - this.camY);

    // 玩家颜色（本地玩家蓝色，其他玩家红色）
    this.ctx.fillStyle = isLocal ? '#00aaff' : '#ff4444';
    this.ctx.fillRect(screenX - size / 2, screenY - size / 2, size, size);

    // 白色边框（与AI统一）
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


    // 新增: 绘制状态指示器 (Buffs / Debuffs)
    // 渲染顺序：致盲 -> 隐蔽 -> Buffs
    let indicatorIndex = 0;

    // 1. 致盲状态 (isFlashed)
    if (player.isFlashed) {
      const endTime = player.flashEndTime ?? 0;
      const remainingMs = Math.max(0, endTime - nowMs);
      const progress = Math.min(1, Math.max(0, remainingMs / flashTotalMs));
      
      this.drawFlashIndicator(player.x, player.y, progress, indicatorIndex++);
    }

    // 2. 隐蔽状态 (inBush) - 使用本地玩家覆盖值
    const inBush = (localInBushOverride !== undefined) ? localInBushOverride : (player.inBush ?? false);
    if (inBush) {
      this.drawConcealmentIndicator(player.x, player.y, indicatorIndex++);
    }

    // 3. 眩晕状态 (isStunned)
    if ((player as any).isStunned) {
      const stunnedEndTime = (player as any).stunnedEndTime ?? 0;
      const remainingMs = Math.max(0, stunnedEndTime - nowMs);
      const progress = Math.min(1, Math.max(0, remainingMs / 3000));
      this.drawStunIndicator(player.x, player.y, progress, indicatorIndex++);
    }

    // 4. 使用物品状态
    if (
      player.usingItemTypeId &&
      player.usingItemRemainingMs !== undefined &&
      player.usingItemTotalMs !== undefined &&
      player.usingItemTotalMs > 0
    ) {
      const usedMs = player.usingItemTotalMs - player.usingItemRemainingMs;
      const progress = Math.max(0, Math.min(1, usedMs / player.usingItemTotalMs));
      const isHealing = player.usingItemTypeId === 'medkit' || player.usingItemTypeId === 'advanced_medkit';
      const statusText = isHealing ? '💊 治疗中' : `📦 ${player.usingItemTypeId}`;
      const color = isHealing ? '#2ECC71' : '#F1C40F';
      this.drawStatusIndicator(player.x, player.y, statusText, progress, color, indicatorIndex++);
    }

    // 5. 其他 Buffs
    if (player.buffs && player.buffs.length > 0) {
      for (const buff of player.buffs) {
        const remainingMs = Math.max(0, buff.remainingMs ?? 0);
        const totalMs = Math.max(1, buff.totalMs ?? 1);
        const progress = Math.min(1, Math.max(0, remainingMs / totalMs));

        let label = buff.name;
        let color = '#4CAF50'; // 默认绿色

        // 根据 buff 类型定制颜色和图标
        switch (buff.kind) {
          case 'speed':
            label = `⚡ 兴奋`; // 简化：战斗兴奋剂 → 兴奋
            color = '#00BFFF'; // Deep Sky Blue
            break;
          case 'damage_reduction':
            label = `🛡️ ${buff.name}`; // 坚韧
            color = '#FFA500'; // Orange
            break;
          case 'regeneration':
            label = `💖 再生`; // 简化：再生血清 → 再生
            color = '#FF69B4'; // Hot Pink
            break;
          case 'disguise':
            label = `🌿 伪装`; // 伪装也显示进度条
            color = '#32CD32'; // Lime Green
            break;
        }

        this.drawStatusIndicator(player.x, player.y, label, progress, color, indicatorIndex++);
      }
    }
  }

  /**
   * 新增: 将伪装玩家渲染为AI样式（其他玩家看到的伪装玩家，或伪装者自己看到的自己）
   * @param isLocal 是否是本地玩家（本地玩家会显示伪装进度条）
   */
  private drawDisguisedPlayerAsAi(player: PLAYER_STATE, currentServerTick?: number, isLocal: boolean = false): void {
    // 根据AI角色调整大小和颜色（与真实AI一致）
    let size = 20;
    let color = '#ff8800'; // 默认橙色
    const role = player.disguisedAsAiRole || 'basic';

    // 角色特定的视觉效果（与真实AI一致）
    switch (role) {
      case 'sniper':
        size = 18; // 狙击手稍小
        color = '#9966ff'; // 紫色
        break;
      case 'heavy_gunner':
        size = 26; // 重机枪手更大
        color = '#ff3333'; // 红色
        break;
      case 'scout':
        size = 16; // 侦察兵最小
        color = '#00ff99'; // 青色
        break;
      case 'basic':
      default:
        size = 20;
        color = '#ff8800'; // 橙色
        break;
    }

    const screenX = Math.round(player.x - this.camX);
    const screenY = Math.round(player.y - this.camY);
    
    // 1. 绘制AI方块（根据角色调整颜色）
    this.ctx.fillStyle = player.status === 'ALIVE' ? color : '#666666';
    this.ctx.fillRect(screenX - size / 2, screenY - size / 2, size, size);
    
    // 2. 白色边框
    this.ctx.strokeStyle = '#fff';
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(screenX - size / 2, screenY - size / 2, size, size);
    
    // 3. HP条（与真实AI一致：宽度30px）
    if (player.status === 'ALIVE' && player.hp !== undefined) {
      const hpBarWidth = 30; // 与真实AI一致
      const hpBarHeight = 4;
      const hpBarY = screenY - size / 2 - 8;

      this.ctx.fillStyle = '#333';
      this.ctx.fillRect(screenX - hpBarWidth / 2, hpBarY, hpBarWidth, hpBarHeight);

      const hpRatio = player.hp / 100;
      this.ctx.fillStyle = hpRatio > 0.5 ? '#0f0' : hpRatio > 0.25 ? '#ff0' : '#f00';
      this.ctx.fillRect(screenX - hpBarWidth / 2, hpBarY, hpBarWidth * hpRatio, hpBarHeight);
    }
    
    // 4. 绘制枪口指向（基于移动方向）
    if (player.weaponRuntime && player.status === 'ALIVE' && player.disguisedAimRad !== undefined) {
      const barrelLength = 15;
      const barrelEndX = screenX + Math.cos(player.disguisedAimRad) * barrelLength;
      const barrelEndY = screenY + Math.sin(player.disguisedAimRad) * barrelLength;

      this.ctx.strokeStyle = '#fff';
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.moveTo(screenX, screenY);
      this.ctx.lineTo(barrelEndX, barrelEndY);
      this.ctx.stroke();
    }

    // 5. 新增: 绘制换弹进度条（与真实AI一致）
    if (player.weaponRuntime && player.status === 'ALIVE' && currentServerTick !== undefined) {
      const wr = player.weaponRuntime;
      if (wr.reloadingUntilTick > 0 && currentServerTick < wr.reloadingUntilTick) {
        try {
          const weaponDef = getWeaponDef(wr.weaponTypeId);
          const reloadTicks = msToTicks(weaponDef.reloadMs);
          const startTick = wr.reloadingUntilTick - reloadTicks;
          const progress = Math.min(1, (currentServerTick - startTick) / reloadTicks);
          
          const reloadBarWidth = size;
          const reloadBarHeight = 3;
          const reloadBarX = screenX - reloadBarWidth / 2;
          const reloadBarY = screenY + size / 2 + 4;
          
          this.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
          this.ctx.fillRect(reloadBarX, reloadBarY, reloadBarWidth, reloadBarHeight);
          
          this.ctx.fillStyle = '#00aaff';
          this.ctx.fillRect(reloadBarX, reloadBarY, reloadBarWidth * progress, reloadBarHeight);
        } catch (e) {
          // 忽略武器定义获取失败
        }
      }
    }
    
    // 6. 显示伪AI状态标签（与真实AI样式一致）
    const behavior = player.disguisedAsAiBehavior || 'IDLE';
    const stateLabelY = this.drawDisguisedAiStateLabel(screenX, screenY, size, behavior);
    
    // 7. 如果是本地玩家，在状态标签下方显示伪装进度条（与致盲进度条样式一致）
    if (isLocal) {
      const disguiseBuff = player.buffs?.find(b => b.kind === 'disguise');
      if (disguiseBuff) {
        const progress = Math.min(1, Math.max(0, (disguiseBuff.remainingMs ?? 0) / (disguiseBuff.totalMs ?? 1)));
        // 直接使用屏幕坐标绘制，避免 drawStatusIndicator 内部重新计算位置
        // 状态标签在 stateLabelY（屏幕坐标），进度条应该在状态标签上方适当间距
        const progressBarScreenY = stateLabelY - 26; // 增加间距 (-22 -> -26)
        
        this.ctx.save();
        this.ctx.font = 'bold 12px monospace';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        
        const text = '🌿 伪装';
        // 性能优化: 使用缓存的文字宽度测量
        const textWidth = this.measureCached('bold 12px monospace', text);
        const padding = 6;
        const boxWidth = textWidth + padding * 2;
        const boxHeight = 18;
        const boxX = screenX - boxWidth / 2;
        const boxY = progressBarScreenY - boxHeight / 2;
        
        // 背景框
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        this.ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
        
        // 进度条背景
        const clampedProgress = Math.max(0, Math.min(1, progress));
        const progressWidth = boxWidth * clampedProgress;
        if (progressWidth > 0) {
          this.ctx.fillStyle = 'rgba(50, 205, 50, 0.8)'; // 绿色
          this.ctx.fillRect(boxX, boxY, progressWidth, boxHeight);
        }
        
        // 描边
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);
        
        // 文字
        this.ctx.fillStyle = '#FFFFFF';
        this.ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
        this.ctx.shadowBlur = 2;
        this.ctx.shadowOffsetX = 0;
        this.ctx.shadowOffsetY = 0;
        this.ctx.fillText(text, screenX, progressBarScreenY);
        this.ctx.shadowBlur = 0;
        this.ctx.restore();
      }
    }
  }

  /**
   * 新增: 绘制伪装AI状态标签（与真实AI样式一致）
   * @returns 状态标签的Y坐标（用于在其下方绘制其他元素）
   */
  private drawDisguisedAiStateLabel(
    screenX: number,
    screenY: number,
    size: number,
    behavior: string
  ): number {
    let stateText = '';
    let bgColor = 'rgba(0, 0, 0, 0.8)';
    let borderColor = '#fff';

    switch (behavior) {
      case 'IDLE':
        stateText = '💤 摸鱼';
        bgColor = 'rgba(100, 100, 100, 0.8)';
        borderColor = '#aaa';
        break;
      case 'PATROL':
        stateText = '🚶 巡逻';
        bgColor = 'rgba(70, 130, 180, 0.85)';
        borderColor = '#87CEEB';
        break;
      case 'SPOTTING':
        stateText = '⚠️ 发现';
        bgColor = 'rgba(255, 165, 0, 0.85)';
        borderColor = '#FFD700';
        break;
      case 'CHASE':
        stateText = '🏃 追击';
        bgColor = 'rgba(255, 215, 0, 0.85)';
        borderColor = '#FFD700';
        break;
      case 'ATTACK':
        stateText = '🔥 攻击';
        bgColor = 'rgba(220, 20, 60, 0.85)';
        borderColor = '#FF6347';
        break;
      case 'SEARCH':
        stateText = '🔍 搜索';
        bgColor = 'rgba(255, 140, 0, 0.85)';
        borderColor = '#FFA500';
        break;
      case 'RETURN':
        stateText = '↩ 返回';
        bgColor = 'rgba(50, 205, 50, 0.85)';
        borderColor = '#90EE90';
        break;
      default:
        stateText = '💤 摸鱼';
        bgColor = 'rgba(100, 100, 100, 0.8)';
        borderColor = '#aaa';
        break;
    }

    if (stateText) {
      this.ctx.save();

      this.ctx.font = 'bold 12px monospace';
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';

      const textWidth = this.measureCached('bold 12px monospace', stateText);
      const padding = 6;
      const boxWidth = textWidth + padding * 2;
      const boxHeight = 20;
      const textY = screenY - size / 2 - 26; // 增加间距 (-22 -> -26)

      // 绘制背景框
      this.ctx.fillStyle = bgColor;
      this.ctx.fillRect(screenX - boxWidth / 2, textY - boxHeight / 2, boxWidth, boxHeight);

      // 绘制边框
      this.ctx.strokeStyle = borderColor;
      this.ctx.lineWidth = 1.5;
      this.ctx.strokeRect(screenX - boxWidth / 2, textY - boxHeight / 2, boxWidth, boxHeight);

      // 绘制文字
      this.ctx.fillStyle = '#FFFFFF';
      this.ctx.fillText(stateText, screenX, textY);

      this.ctx.restore();
      
      // 返回状态标签的Y坐标（用于在其下方绘制其他元素）
      return textY;
    }
    
    // 如果没有状态文本，返回默认位置
    return screenY - size / 2 - 26; // 增加间距 (-22 -> -26)
  }

  // 新增: 绘制诱饵（外观模仿玩家）
  drawDecoy(decoy: DECOY_STATE, isOwner: boolean = false): void {
    const size = 20; // 像素大小
    const screenX = Math.round(decoy.x - this.camX);
    const screenY = Math.round(decoy.y - this.camY);

    // 诱饵颜色：如果是拥有者，显示为蓝色但半透明（区分）；敌人看到的是红色（完全模仿玩家）
    // 为了达到迷惑效果，敌人看到的必须和普通玩家一模一样（红色）
    this.ctx.fillStyle = isOwner ? 'rgba(0, 170, 255, 0.7)' : '#ff4444'; 
    this.ctx.fillRect(screenX - size / 2, screenY - size / 2, size, size);

    // 边框
    this.ctx.strokeStyle = '#fff';
    this.ctx.lineWidth = 2;
    // HP条
    const barWidth = size;
    const barHeight = 4;
    
    // Glitch Effect: 如果受击，添加随机抖动和色差
    const state = this.decoyStates.get(decoy.id);
    const isGlitching = state && Date.now() < state.glitchUntil;
    let drawX = screenX;
    let drawY = screenY;
    
    this.ctx.save();
    
    if (isGlitching) {
      // 随机偏移
      drawX += (Math.random() - 0.5) * 10;
      drawY += (Math.random() - 0.5) * 10;
      
      // 色差错位效果 (模拟全息投影不稳定) - 绘制青色和红色残影
      this.ctx.globalAlpha = 0.6;
      this.ctx.fillStyle = '#0ff'; // Cyan
      this.ctx.fillRect(drawX - size / 2 - 2, drawY - size / 2, size, size);
      
      this.ctx.fillStyle = '#f0f'; // Magenta
      this.ctx.fillRect(drawX - size / 2 + 2, drawY - size / 2, size, size);
      
      this.ctx.globalAlpha = 1.0;
      
      // 偶尔闪烁透明度
      if (Math.random() < 0.3) {
        this.ctx.globalAlpha = 0.3;
      }
    }

    // 🎭 核心改变：诱饵完全模仿真实玩家外观
    // 对于拥有者：显示为略带蓝色的敌人（让你知道这是你的诱饵）
    // 对于其他人：显示为完全的红色敌人（无法区分）
    if (isOwner) {
      // 拥有者看到的：蓝紫色（介于蓝色和红色之间，暗示这是"假的敌人"）
      this.ctx.fillStyle = 'rgba(138, 43, 226, 0.85)'; // BlueViolet with slight transparency
    } else {
      // 其他人看到的：完全和真实敌方玩家一样的红色
      this.ctx.fillStyle = '#ff4444';
    }
    this.ctx.fillRect(drawX - size / 2, drawY - size / 2, size, size);

    // 白色边框（与真实玩家完全一致）
    this.ctx.strokeStyle = '#fff';
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(drawX - size / 2, drawY - size / 2, size, size);
    
    this.ctx.restore();

    // HP条（与玩家位置一致：在方块上方）
    const barX = drawX - barWidth / 2;
    const barY = drawY - size / 2 - 8;

    this.ctx.fillStyle = '#333';
    this.ctx.fillRect(barX, barY, barWidth, barHeight);

    const hpPercent = decoy.hp / decoy.maxHp;
    this.ctx.fillStyle = hpPercent > 0.5 ? '#0f0' : hpPercent > 0.25 ? '#ff0' : '#f00';
    this.ctx.fillRect(barX, barY, barWidth * hpPercent, barHeight);
    
    // 如果Glitch中，显示 "ERROR" 或 "FAIL" 文本
    if (isGlitching) {
      this.ctx.fillStyle = '#f00';
      this.ctx.textAlign = 'center';
      this.ctx.fillText('! ERROR !', drawX, drawY - size / 2 - 5);
      // 性能优化: 删除多余的 restore（没有对应的 save）
    }
    // 显示名字（模仿玩家）
    const displayName = decoy.name;
    if (displayName) {
      const nameY = screenY - size / 2 - 12;
      // 只在屏幕内才绘制名字
      if (nameY >= 0 && nameY < this.cssHeight && screenX >= 0 && screenX < this.cssWidth) {
        this.ctx.save();
        this.ctx.fillStyle = '#fff';
        this.ctx.font = 'bold 12px monospace';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'bottom';
        this.ctx.strokeStyle = '#000';
        this.ctx.lineWidth = 3;
        this.ctx.miterLimit = 2;
        this.ctx.strokeText(displayName, screenX, nameY);
        this.ctx.fillText(displayName, screenX, nameY);
        this.ctx.restore();
      }
    }
  }

  // 新增: 绘制伪装失效特效 (Fizzle)
  private drawFizzleEffect(effect: { x: number; y: number; until: number; maxRadius: number }, now: number): void {
    const screenX = Math.round(effect.x - this.camX);
    const screenY = Math.round(effect.y - this.camY);
    
    // 剩下多少时间
    const remaining = Math.max(0, effect.until - now);
    const totalDuration = 500; // 与之前设置的 一致
    const progress = 1 - (remaining / totalDuration); // 0 -> 1
    
    this.ctx.save();
    
    // 扩散的像素圆环
    const radius = effect.maxRadius * progress;
    this.ctx.beginPath();
    this.ctx.arc(screenX, screenY, radius, 0, Math.PI * 2);
    this.ctx.strokeStyle = `rgba(100, 255, 255, ${1 - progress})`; // 青色消失
    this.ctx.lineWidth = 2;
    this.ctx.stroke();
    
    // 随机像素块飞散
    const particleCount = 8;
    for (let i = 0; i < particleCount; i++) {
        // 让粒子旋转并扩散
        const angle = (i / particleCount) * Math.PI * 2 + progress * 5; 
        const dist = radius * (0.8 + Math.random() * 0.4);
        const px = screenX + Math.cos(angle) * dist;
        const py = screenY + Math.sin(angle) * dist;
        
        this.ctx.fillStyle = `rgba(200, 255, 255, ${1 - progress})`;
        const pSize = 3 * (1 - progress);
        this.ctx.fillRect(px - pSize/2, py - pSize/2, pSize, pSize);
    }
    
    this.ctx.restore();
  }



  /**
   * 新增: 更新玩家拖影轨迹（基于世界坐标）
   * 使用 trailStrength 实现“开启/结束”时的渐入/渐出过渡
   */
  private updatePlayerTrail(player: PLAYER_STATE, isFast: boolean): void {
    const id = player.id;
    let trail = this.playerTrails.get(id) ?? [];

    // 读取并更新当前的拖影强度（0~1）
    const prevStrength = this.playerTrailStrength.get(id) ?? 0;
    const upSpeed = 0.15;   // 每帧开启时增加量（降低，让开启更平滑）
    const downSpeed = 0.12; // 每帧关闭时减少量（降低，让关闭更平滑）
    let strength = prevStrength;
    if (isFast) {
      strength = Math.min(1, strength + upSpeed);
    } else {
      strength = Math.max(0, strength - downSpeed);
    }
    this.playerTrailStrength.set(id, strength);

    // 根据强度判断是否需要添加新的拖影点（即使 strength 较低也添加，但 alpha 会很低）
    // 这样可以让开启/关闭过渡更无缝
    if (strength > 0.01) {
      const baseAlpha = 0.65;
      // 即使 isFast 为 false，只要 strength > 0，也继续添加点（但 alpha 会很低）
      // 这样关闭时拖影会自然缩短，而不是突然消失
      const effectiveAlpha = isFast ? baseAlpha * strength : baseAlpha * strength * 0.3;
      trail.push({ x: player.x, y: player.y, alpha: effectiveAlpha });
    }

    // 性能优化: in-place 衰减和过滤，避免 map/filter 产生的 GC 压力
    // 降低衰减速度（0.88），让拖影保留更久
    for (let i = 0; i < trail.length; i++) {
      trail[i].alpha *= 0.88;
    }
    
    // in-place 过滤：只保留 alpha > 0.02 的点
    let write = 0;
    for (let i = 0; i < trail.length; i++) {
      if (trail[i].alpha > 0.02) {
        trail[write++] = trail[i];
      }
    }
    trail.length = write;

    if (trail.length === 0 && strength === 0) {
      this.playerTrails.delete(id);
      this.playerTrailStrength.delete(id);
    } else {
      // 限制最大长度，增加点数让拖影更长
      const MAX_POINTS = 15; // 从 8 增加到 15，让拖影更长
      if (trail.length > MAX_POINTS) {
        trail = trail.slice(trail.length - MAX_POINTS);
      }
      this.playerTrails.set(id, trail);
    }
  }

  /**
   * 新增: 绘制玩家拖影（使用屏幕坐标）
   * 颜色与玩家主体颜色保持一致，但更透明
   * 性能优化: 使用 globalAlpha 而非每次拼接 rgba 字符串
   */
  private drawPlayerTrail(playerId: string, isLocal: boolean): void {
    const trail = this.playerTrails.get(playerId);
    if (!trail || trail.length === 0) return;

    const size = 20;
    const rgb = isLocal ? '0,170,255' : '255,68,68';

    this.ctx.save();
    this.ctx.fillStyle = `rgb(${rgb})`;
    for (const p of trail) {
      const sx = Math.round(p.x - this.camX);
      const sy = Math.round(p.y - this.camY);
      this.ctx.globalAlpha = p.alpha;
      this.ctx.fillRect(sx - size / 2, sy - size / 2, size, size);
    }
    this.ctx.restore();
  }

  /**
   * 新增: 绘制AI实体
   */
  drawAI(ai: any, debug: boolean = false, currentServerTick?: number): void {
    // 根据AI角色调整大小和颜色
    let size = 20;
    let color = '#ff8800'; // 默认橙色
    const role = ai.role || 'basic';

    // 角色特定的视觉效果
    switch (role) {
      case 'sniper':
        size = 18; // 狙击手稍小
        color = '#9966ff'; // 紫色
        break;
      case 'heavy_gunner':
        size = 26; // 重机枪手更大
        color = '#ff3333'; // 红色
        break;
      case 'scout':
        size = 16; // 侦察兵最小
        color = '#00ff99'; // 青色
        break;
      case 'basic':
      default:
        size = 20;
        color = '#ff8800'; // 橙色
        break;
    }

    const screenX = Math.round(ai.x - this.camX);
    const screenY = Math.round(ai.y - this.camY);

    // AI颜色（根据角色类型）
    this.ctx.fillStyle = ai.status === 'ALIVE' ? color : '#666666';
    this.ctx.fillRect(screenX - size / 2, screenY - size / 2, size, size);

    // 白色边框
    this.ctx.strokeStyle = '#fff';
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(screenX - size / 2, screenY - size / 2, size, size);

    // 血条
    if (ai.status === 'ALIVE' && ai.hp !== undefined && ai.maxHp !== undefined) {
      const hpBarWidth = 30;
      const hpBarHeight = 4;
      const hpBarY = screenY - size / 2 - 8;

      this.ctx.fillStyle = '#333';
      this.ctx.fillRect(screenX - hpBarWidth / 2, hpBarY, hpBarWidth, hpBarHeight);

      const hpRatio = ai.hp / ai.maxHp;
      this.ctx.fillStyle = hpRatio > 0.5 ? '#0f0' : hpRatio > 0.25 ? '#ff0' : '#f00';
      this.ctx.fillRect(screenX - hpBarWidth / 2, hpBarY, hpBarWidth * hpRatio, hpBarHeight);
    }

    // 瞄准方向
    if (ai.weaponRuntime && ai.status === 'ALIVE' && ai.aimRad !== undefined) {
      const barrelLength = 15;
      const barrelEndX = screenX + Math.cos(ai.aimRad) * barrelLength;
      const barrelEndY = screenY + Math.sin(ai.aimRad) * barrelLength;

      this.ctx.strokeStyle = '#fff';
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.moveTo(screenX, screenY);
      this.ctx.lineTo(barrelEndX, barrelEndY);
      this.ctx.stroke();
    }

    // 新增: 绘制换弹进度条（AI下方，蓝色，与玩家一致）
    if (ai.weaponRuntime && ai.status === 'ALIVE' && currentServerTick !== undefined) {
      const wr = ai.weaponRuntime;
      if (wr.reloadingUntilTick > 0 && currentServerTick < wr.reloadingUntilTick) {
        // 正在换弹，计算进度
        try {
          const weaponDef = getWeaponDef(wr.weaponTypeId);
          const reloadTicks = msToTicks(weaponDef.reloadMs);
          const startTick = wr.reloadingUntilTick - reloadTicks;
          const progress = Math.min(1, (currentServerTick - startTick) / reloadTicks);
          
          // 在AI下方绘制蓝色进度条
          const reloadBarWidth = size;
          const reloadBarHeight = 3;
          const reloadBarX = screenX - reloadBarWidth / 2;
          const reloadBarY = screenY + size / 2 + 4; // AI下方4px
          
          // 背景
          this.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
          this.ctx.fillRect(reloadBarX, reloadBarY, reloadBarWidth, reloadBarHeight);
          
          // 进度条（蓝色）
          this.ctx.fillStyle = '#00aaff';
          this.ctx.fillRect(reloadBarX, reloadBarY, reloadBarWidth * progress, reloadBarHeight);
        } catch (e) {
          // 忽略武器定义获取失败
        }
      }
    }

    // AI状态标签（总是显示，类似"隐蔽"标签的样式）
    if (ai.behaviorState) {
      let stateText = '';
      let bgColor = 'rgba(0, 0, 0, 0.8)'; // 背景色
      let borderColor = '#fff'; // 边框色

      switch (ai.behaviorState) {
        case 'IDLE':
          stateText = '💤 摸鱼';
          bgColor = 'rgba(100, 100, 100, 0.8)';
          borderColor = '#aaa';
          break;
        case 'PATROL':
          stateText = '🚶 巡逻';
          bgColor = 'rgba(70, 130, 180, 0.85)';
          borderColor = '#87CEEB';
          break;
        case 'SPOTTING':
          stateText = '⚠️ 发现';
          bgColor = 'rgba(255, 165, 0, 0.85)'; // 橙色背景
          borderColor = '#FFD700'; // 金色边框
          break;
        case 'CHASE':
          stateText = '🏃 追击';
          bgColor = 'rgba(255, 215, 0, 0.85)';
          borderColor = '#FFD700';
          break;
        case 'ATTACK':
          stateText = '🔥 攻击';
          bgColor = 'rgba(220, 20, 60, 0.85)';
          borderColor = '#FF6347';
          break;
        case 'SEARCH':
          stateText = '🔍 搜索';
          bgColor = 'rgba(255, 140, 0, 0.85)';
          borderColor = '#FFA500';
          break;
        case 'RETURN':
          stateText = '↩ 返回';
          bgColor = 'rgba(50, 205, 50, 0.85)';
          borderColor = '#90EE90';
          break;
      }

      if (stateText) {
        this.ctx.save();

        // 使用与"隐蔽"标签相同的样式
        this.ctx.font = 'bold 12px monospace';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';

        const textWidth = this.measureCached('bold 12px monospace', stateText);
        const padding = 6;
        const boxWidth = textWidth + padding * 2;
        const boxHeight = 20;
        const textY = screenY - size / 2 - 26; // 增加间距 (-22 -> -26)

        // 绘制背景框
        this.ctx.fillStyle = bgColor;
        this.ctx.fillRect(screenX - boxWidth / 2, textY - boxHeight / 2, boxWidth, boxHeight);

        // 绘制边框（类似"隐蔽"标签）
        this.ctx.strokeStyle = borderColor;
        this.ctx.lineWidth = 1.5;
        this.ctx.strokeRect(screenX - boxWidth / 2, textY - boxHeight / 2, boxWidth, boxHeight);

        // 绘制文字（白色）
        this.ctx.fillStyle = '#FFFFFF';
        this.ctx.fillText(stateText, screenX, textY);

        this.ctx.restore();
      }
    }


  }

  /**
   * 新增: 判断玩家当前是否"高速移动"
   * 完全基于本地可见的位置变化，不依赖服务端的 isSprinting 或 buff 字段
   */
  private isPlayerFast(player: PLAYER_STATE): boolean {
    const id = player.id;
    const now = performance.now();
    const last = this.playerLastSample.get(id);

    if (!last) {
      this.playerLastSample.set(id, { x: player.x, y: player.y, t: now });
      return false;
    }

    const dtMs = now - last.t;
    // 间隔异常（时间倒流），直接更新采样点并认为不高速
    if (dtMs <= 0) {
      this.playerLastSample.set(id, { x: player.x, y: player.y, t: now });
      return false;
    }

    const dist = Math.hypot(player.x - last.x, player.y - last.y);
    const dtSec = dtMs / 1000;
    const speed = dist / dtSec; // px/s

    this.playerLastSample.set(id, { x: player.x, y: player.y, t: now });

    // 阈值：略高于基础速度，避免微小抖动就触发拖影
    const threshold = PLAYER_SPEED * 1.10;
    const isFast = speed > threshold;

    return isFast;
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
  // 优化: 为不同枪械定制酷炫的条形子弹 (Bar Projectiles)
  // 绘制炮塔
  private drawTurret(turret: TURRET_STATE, localPlayerId: string | null = null): void {
    const screenX = Math.round(turret.x - this.camX);
    const screenY = Math.round(turret.y - this.camY); 

    // 0. Range Circle (Faint)
    this.ctx.save();
    this.ctx.translate(screenX, screenY);
    this.ctx.strokeStyle = 'rgba(255, 50, 50, 0.4)'; // More visible red range
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash([8, 4]);
    this.ctx.beginPath();
    this.ctx.arc(0, 0, turret.range, 0, Math.PI * 2);
    this.ctx.stroke();
    this.ctx.restore();

    // 1. Base (Static relative to rotation)
    this.ctx.save();
    this.ctx.translate(screenX, screenY);
    this.ctx.fillStyle = '#333';
    // Draw 3 legs
    for(let i=0; i<3; i++) {
        this.ctx.save();
        this.ctx.rotate(i * (Math.PI * 2 / 3));
        this.ctx.fillRect(-2, 5, 4, 8); // Leg extending out
        this.ctx.restore();
    }
    this.ctx.restore();

    // 2. Head (Rotates with aimRad)
    this.ctx.save();
    this.ctx.translate(screenX, screenY);
    this.ctx.rotate(turret.aimRad);

    // Color based on state
    let color = '#777';
    // FIRING state might not be directly exposed in snapshot if not mapped, but AI shares similar states
    // Turret uses "state" field: IDLE, SPOT_TARGET, SPOOLING, FIRING, RELOADING
    if (turret.state === 'FIRING') color = '#ff5500';
    else if (turret.state === 'SPOOLING') color = '#ffaa00';
    else if (turret.state === 'RELOADING') color = '#999';

    // Barrel
    this.ctx.fillStyle = '#111';
    this.ctx.fillRect(8, -3, 16, 6);

    // Body
    this.ctx.fillStyle = color;
    this.ctx.fillRect(-8, -8, 16, 16);
    this.ctx.strokeStyle = '#000';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(-8, -8, 16, 16);

    // Armor Shield Effect
    if (turret.isArmored) {
       this.ctx.strokeStyle = 'rgba(100, 200, 255, 0.6)';
       this.ctx.lineWidth = 2;
       this.ctx.beginPath();
       this.ctx.arc(0, 0, 18, -Math.PI/4, Math.PI/4); // Shield arc front
       this.ctx.stroke();
       this.ctx.beginPath();
       this.ctx.arc(0, 0, 18, Math.PI - Math.PI/4, Math.PI + Math.PI/4); // Shield arc back? No only front usually.
       this.ctx.stroke();
    }

    this.ctx.restore();

    // 3. HP Bar
    const barW = 24;
    const barH = 4;
    const barX = screenX - barW / 2;
    const barY = screenY - 24;
    
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(barX, barY, barW, barH);
    this.ctx.fillStyle = turret.hp > turret.maxHp * 0.5 ? '#0f0' : '#f00';
    this.ctx.fillRect(barX, barY, barW * (turret.hp / turret.maxHp), barH);

    // UI Stacking Logic (from bottom to top)
    let stackY = screenY - 36; // Start above HP Bar

    // 4. Status Label (Draw first as it is the bottom-most UI element above HP)
    if (turret.state) {
      let stateText = '';
      let bgColor = 'rgba(0, 0, 0, 0.8)';
      let borderColor = '#fff';

      switch (turret.state) {
        case 'IDLE':
          stateText = '💤 待机';
          bgColor = 'rgba(100, 100, 100, 0.8)';
          borderColor = '#aaa';
          break;
        case 'SPOOLING':
          stateText = '⚠️ 预热';
          bgColor = 'rgba(255, 165, 0, 0.85)';
          borderColor = '#FFD700';
          break;
        case 'FIRING':
          stateText = '🔥 射击';
          bgColor = 'rgba(220, 20, 60, 0.85)';
          borderColor = '#FF6347';
          break;
        case 'RELOADING':
          stateText = '🔄 装弹';
          bgColor = 'rgba(70, 130, 180, 0.85)';
          borderColor = '#87CEEB';
          break;
      }

      if (stateText) {
        this.ctx.save();
        this.ctx.font = 'bold 12px monospace';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';

        // Use cached text measurement
        const textWidth = this.measureCached('bold 12px monospace', stateText);
        const padding = 6;
        const boxWidth = textWidth + padding * 2;
        const boxHeight = 20;
        
        // Draw centered at stackY
        const boxX = screenX - boxWidth / 2;
        const boxY = stackY - boxHeight / 2;

        // Background
        this.ctx.fillStyle = bgColor;
        this.ctx.fillRect(boxX, boxY, boxWidth, boxHeight);

        // Border
        this.ctx.strokeStyle = borderColor;
        this.ctx.lineWidth = 1.5;
        this.ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);

        // Text
        this.ctx.fillStyle = '#FFFFFF';
        this.ctx.fillText(stateText, screenX, stackY);

        this.ctx.restore();

        // Move stack up
        stackY -= 24; 
      }
    }
    
    // 5. Remaining Time Bar (Local Player Only) - Now displayed ABOVE the status label
    // Style matches the status label (Box + Text + Progress)
    if (localPlayerId && turret.ownerId === localPlayerId) {
      const durationMs = 30000; 
      const remaining = Math.max(0, turret.remainingTimeMs);
      const timeProgress = Math.min(1, Math.max(0, remaining / durationMs));
      
      const timeText = `⏳ ${(remaining / 1000).toFixed(1)}s`;
      
      this.ctx.save();
      this.ctx.font = 'bold 12px monospace';
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      
      const textWidth = this.measureCached('bold 12px monospace', timeText);
      const padding = 6;
      const boxWidth = textWidth + padding * 2;
      const boxHeight = 20;
      
      // Draw centered at current stackY
      const boxX = screenX - boxWidth / 2;
      const boxY = stackY - boxHeight / 2;
      
      // Determine color based on time
      let barColor = '#ffff00'; // Default Yellow
      if (timeProgress < 0.25) {
        barColor = '#ff3333'; // Red
      } else if (timeProgress < 0.5) {
        barColor = '#ff9900'; // Orange
      }
      
      // Background (Dark)
      this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      this.ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
      
      // Progress Bar Background (Fill part of the box)
      this.ctx.fillStyle = barColor;
      this.ctx.globalAlpha = 0.4; // Semi-transparent for background fill
      this.ctx.fillRect(boxX, boxY, boxWidth * timeProgress, boxHeight);
      this.ctx.globalAlpha = 1.0;
      
      // Border
      this.ctx.strokeStyle = barColor;
      this.ctx.lineWidth = 1.5;
      this.ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);
      
      // Text
      this.ctx.fillStyle = '#FFFFFF';
      this.ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
      this.ctx.shadowBlur = 2;
      this.ctx.fillText(timeText, screenX, stackY);
      
      this.ctx.restore();
      
      // Move stack up (in case we add more things later)
      stackY -= 24;
    }
  }

  drawBullet(bullet: BULLET_STATE): void {
    const screenX = bullet.x - this.camX;
    const screenY = bullet.y - this.camY;

    // 检查是否是手雷/榴弹类投掷物
    const isGrenade = bullet.weaponTypeId === 'w_grenade_launcher' || 
                     bullet.weaponTypeId === 'frag_grenade' || 
                     bullet.weaponTypeId === 'smoke_grenade' || 
                     bullet.weaponTypeId === 'flash_grenade' ||
                     bullet.weaponTypeId === 'molotov';

    if (isGrenade) {
      this.drawGrenadeProjectile(bullet, screenX, screenY);
      return;
    }

    if (bullet.weaponTypeId === 'w_bubble_gun') {
      this.drawBubbleProjectile(bullet, screenX, screenY);
      return;
    }

    // --- 条形子弹渲染逻辑 ---
    // 计算条形长度（基于每帧速度）
    const barDuration = 0.025; // 稍微调回 25ms 基础时长，让标准武器更有质感
    let tx = bullet.vx * barDuration;
    let ty = bullet.vy * barDuration;

    // 修复: 长度封顶逻辑 - 防止子弹在刚出生时长度超过已行进距离（避免插到身后）
    if (bullet.spawnTimeMs) {
      const ageMs = performance.now() - bullet.spawnTimeMs;
      const speed = Math.sqrt(bullet.vx * bullet.vx + bullet.vy * bullet.vy);
      const maxLen = (speed * ageMs) / 1000;
      const currentLen = Math.sqrt(tx * tx + ty * ty);
      
      if (currentLen > maxLen) {
        const ratio = maxLen / currentLen;
        tx *= ratio;
        ty *= ratio;
      }
    }

    this.ctx.save();

    // 根据不同武器类型定制样式
    let color = '#ffff00'; 
    let lineWidth = 2.5;
    let barFactor = 1.0;

    const wt = bullet.weaponTypeId;
    if (wt === 'w_minigun') {
        // Minigun: Orange/Red stream
        color = '#ffaa00';
        lineWidth = 2.0;
        barFactor = 0.8;
    } else if (wt === 'w_sniper' || wt === 'w_anti_material') {
      // 狙击枪：亮白色/青色，浓厚条形
      color = '#00ffff';
      lineWidth = 3.5;
      barFactor = 1.8;
    } else if (wt === 'w_laser_rifle') {
      // 激光步枪：大幅缩短视觉长度 (因为其初速极快)，并减细线条
      this.drawLaserBar(screenX, screenY, tx * 0.4, ty * 0.4, '#00ffcc', 3);
      this.ctx.restore();
      return;
    } else if (wt === 'w_shotgun' || wt === 'w_double_barrel' || wt === 'w_auto_shotgun') {
      // 霰弹枪：银白色，短促条形
      color = '#e0e0e0';
      lineWidth = 2;
      barFactor = 0.6;
    } else if (wt === 'w_crossbow') {
      // 弩：箭矢形状
      this.drawArrowProjectile(screenX, screenY, bullet.vx, bullet.vy);
      this.ctx.restore();
      return;
    } else {
      // 默认（手枪、SMG、AR）：亮金色
      color = '#ffcc00';
      lineWidth = 2.5;
      barFactor = 1.0;
    }

    // 绘制条形
    this.drawBar(screenX, screenY, tx * barFactor, ty * barFactor, color, lineWidth);

    this.ctx.restore();
  }

  /**
   * 绘制 实体条形 (Bar)
   */
  private drawBar(x: number, y: number, tx: number, ty: number, color: string, width: number): void {
    // 条的主体
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = width;
    this.ctx.lineCap = 'butt'; 
    this.ctx.beginPath();
    this.ctx.moveTo(x, y);
    this.ctx.lineTo(x - tx, y - ty);
    this.ctx.stroke();

    // 在条的头部加一个亮白核心，增加速度感且不 clip 到身后
    this.ctx.strokeStyle = '#fff';
    this.ctx.lineWidth = width * 0.5;
    this.ctx.beginPath();
    this.ctx.moveTo(x, y);
    // 核心长度也根据总长度按比例缩小，避免在极短时冲突
    const coreFactor = Math.min(0.3, 5 / (Math.sqrt(tx * tx + ty * ty) || 1));
    this.ctx.lineTo(x - tx * coreFactor, y - ty * coreFactor);
    this.ctx.stroke();
  }

  /**
   * 绘制 激光条 (带有发光效果)
   */
  private drawLaserBar(x: number, y: number, tx: number, ty: number, color: string, width: number): void {
    this.ctx.save();
    
    // 1. 外层发光 (较粗, 半透明)
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = width * 2;
    this.ctx.lineCap = 'round';
    this.ctx.globalAlpha = 0.3;
    this.ctx.beginPath();
    this.ctx.moveTo(x, y);
    this.ctx.lineTo(x - tx, y - ty);
    this.ctx.stroke();

    // 2. 中层光晕 (中等粗细, 较高不透明度)
    this.ctx.globalAlpha = 0.8;
    this.ctx.lineWidth = width;
    this.ctx.stroke();

    // 3. 内层核心 (白色主束)
    this.ctx.strokeStyle = '#fff';
    this.ctx.lineWidth = width * 0.4;
    this.ctx.globalAlpha = 1.0;
    this.ctx.stroke();

    this.ctx.restore();
  }


  /**
   * 绘制手雷/榴弹类弹药
   */
  private drawGrenadeProjectile(bullet: BULLET_STATE, screenX: number, screenY: number): void {
    const grenadeRadius = 8;
    const now = performance.now();
    
    // 基础球体
    this.ctx.save();
    
    // 增加一点闪烁效果（引信感）
    const flash = Math.abs(Math.sin(now * 0.01)) * 50;
    const color = bullet.weaponTypeId === 'molotov' ? '#ff4500' : '#444';
    
    this.ctx.fillStyle = color;
    this.ctx.beginPath();
    this.ctx.arc(screenX, screenY, grenadeRadius, 0, Math.PI * 2);
    this.ctx.fill();

    // 绘制边框
    this.ctx.strokeStyle = '#fff';
    this.ctx.lineWidth = 2;
    this.ctx.stroke();

    // 添加一些拖尾粒子 (可选)
    if (bullet.weaponTypeId === 'molotov') {
        const flicker = Math.random() > 0.5;
        this.ctx.fillStyle = flicker ? '#ff8800' : '#ffff00';
        this.ctx.beginPath();
        this.ctx.arc(screenX - (Math.random() * 10), screenY - (Math.random() * 10), 3, 0, Math.PI * 2);
        this.ctx.fill();
    }

    this.ctx.restore();
  }

  /**
   * 绘制泡泡
   */
  private drawBubbleProjectile(bullet: BULLET_STATE, screenX: number, screenY: number): void {
    const bubbleRadius = 6;
    this.ctx.save();
    this.ctx.fillStyle = 'rgba(135, 206, 250, 0.4)';
    this.ctx.beginPath();
    this.ctx.arc(screenX, screenY, bubbleRadius, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.strokeStyle = 'rgba(135, 206, 250, 0.8)';
    this.ctx.lineWidth = 1;
    this.ctx.stroke();
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    this.ctx.beginPath();
    this.ctx.arc(screenX - bubbleRadius * 0.3, screenY - bubbleRadius * 0.3, bubbleRadius * 0.25, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.restore();
  }

  /**
   * 绘制箭矢 (Crossbow)
   */
  private drawArrowProjectile(x: number, y: number, vx: number, vy: number): void {
    const angle = Math.atan2(vy, vx);
    const length = 15;
    this.ctx.save();
    this.ctx.translate(x, y);
    this.ctx.rotate(angle);
    
    // 箭杆
    this.ctx.strokeStyle = '#8b4513';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(0, 0);
    this.ctx.lineTo(-length, 0);
    this.ctx.stroke();
    
    // 箭羽
    this.ctx.fillStyle = '#fff';
    this.ctx.beginPath();
    this.ctx.moveTo(-length, 0);
    this.ctx.lineTo(-length - 4, -3);
    this.ctx.lineTo(-length - 4, 3);
    this.ctx.closePath();
    this.ctx.fill();
    
    this.ctx.restore();
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

  drawExplosionEffect(effect: { x: number; y: number; radius: number; age: number }): void {
    const screenX = effect.x - this.camX;
    const screenY = effect.y - this.camY;

    const alpha = Math.max(0, 1 - effect.age);
    const ringAlpha = alpha * 0.9;
    const fillAlpha = alpha * 0.12;

    this.ctx.save();
    this.ctx.strokeStyle = `rgba(255, 200, 80, ${ringAlpha})`;
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.arc(screenX, screenY, effect.radius, 0, Math.PI * 2);
    this.ctx.stroke();

    this.ctx.fillStyle = `rgba(255, 140, 0, ${fillAlpha})`;
    this.ctx.beginPath();
    this.ctx.arc(screenX, screenY, effect.radius, 0, Math.PI * 2);
    this.ctx.fill();

    const coreRadius = Math.max(6, Math.min(18, effect.radius * 0.2)) * (1 - effect.age * 0.5);
    this.ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.7})`;
    this.ctx.beginPath();
    this.ctx.arc(screenX, screenY, coreRadius, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.restore();
  }

  // 新增: 绘制烟雾（带出现/消失过渡动画）
  private drawSmoke(smoke: { x: number; y: number; radius: number; age: number; durationMs?: number }): void {
    const screenX = smoke.x - this.camX;
    const screenY = smoke.y - this.camY;

    // age: 0 -> 1 代表整段生命周期
    const clampedAge = Math.max(0, Math.min(1, smoke.age));
    const totalMs = smoke.durationMs ?? 15000; // 默认15秒
    const lifeMs = clampedAge * totalMs;

    // 出现阶段：前 0.2s 内从小到大快速膨胀
    const APPEAR_MS = 200;
    const appearPhase = Math.max(0, Math.min(1, lifeMs / APPEAR_MS));

    // 消失阶段：最后 1s 内慢慢淡出
    const FADE_MS = 1000;
    const fadeStartMs = Math.max(0, totalMs - FADE_MS);
    const disappearPhase =
      lifeMs <= fadeStartMs ? 0 : Math.max(0, Math.min(1, (lifeMs - fadeStartMs) / FADE_MS));

    // 半径动画：从 30% -> 100%
    const baseRadius = smoke.radius;
    const radiusScale = 0.3 + 0.7 * appearPhase;
    const animatedRadius = baseRadius * radiusScale;

    // 透明度动画：出现/消失阶段渐变，中间保持最浓
    const alpha =
      lifeMs <= APPEAR_MS
        ? 0.4 + 0.6 * appearPhase // 进入时从 0.4 -> 1.0
        : lifeMs >= fadeStartMs
        ? 1.0 - 0.8 * disappearPhase // 结束时从 1.0 -> 0.2
        : 1.0; // 中段保持 1.0

    this.ctx.save();

    // 烟雾圆形（黑灰色，带透明度）
    this.ctx.fillStyle = `rgba(100, 100, 100, ${alpha})`;
    this.ctx.beginPath();
    this.ctx.arc(screenX, screenY, animatedRadius, 0, Math.PI * 2);
    this.ctx.fill();

    // 中央进度条（显示剩余时间：0~1）
    const progress = Math.max(0, Math.min(1, 1 - clampedAge));
    const barWidth = 80;
    const barHeight = 8;
    const barX = screenX - barWidth / 2;
    const barY = screenY - barHeight / 2;

    // 进度条背景（深灰色）
    this.ctx.fillStyle = 'rgba(60, 60, 60, 0.8)';
    this.ctx.fillRect(barX, barY, barWidth, barHeight);

    // 进度条前景（浅灰色）
    this.ctx.fillStyle = 'rgba(200, 200, 200, 0.9)';
    this.ctx.fillRect(barX, barY, barWidth * progress, barHeight);

    // 进度条边框（黑色）
    this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(barX, barY, barWidth, barHeight);

    this.ctx.restore();
  }

  // 新增: 绘制全屏烟雾覆盖（当本地玩家在烟雾中时）
  // 性能优化: 使用简单的纯色填充代替每帧创建渐变
  private drawFullScreenSmokeOverlay(smokeCenterX: number, smokeCenterY: number, alpha: number): void {
    // 绘制全屏深色烟雾覆盖层（护眼黑色系），带透明度过渡
    if (alpha <= 0) return; // 完全透明时不绘制
    
    this.ctx.save();
    
    // 性能优化: 使用简单的纯色填充代替渐变（大幅减少 GPU 负担）
    // 原来的渐变效果在大窗口下非常昂贵
    this.ctx.globalAlpha = 0.95 * alpha;
    this.ctx.fillStyle = '#1a1a1a'; // 深灰色
    this.ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);
    
    // 添加烟雾噪点效果（深色系），使用缓存的噪点位置
    this.ensureSmokeNoise();
    this.ctx.globalAlpha = 0.08 * alpha;
    for (const p of this.smokeNoisePoints) {
      const x = p.x * this.cssWidth;
      const y = p.y * this.cssHeight;
      const size = p.s;
      this.ctx.fillStyle = p.a > 0.2 ? 'rgba(70, 70, 70, 0.15)' : 'rgba(25, 25, 25, 0.25)';
      this.ctx.fillRect(x, y, size, size);
    }
    this.ctx.globalAlpha = 1;
    
    this.ctx.restore();
  }

  // 新增: 绘制燃烧区域
  public drawFire(fire: { x: number; y: number; radius: number; age: number; durationMs: number }): void {
    const screenX = fire.x - this.camX;
    const screenY = fire.y - this.camY;
    const now = performance.now();

    // age: 0 -> 1 代表整段生命周期
    const alpha = fire.age < 0.1 ? fire.age * 10 : (fire.age > 0.9 ? (1 - fire.age) * 10 : 1);
    
    this.ctx.save();

    // 绘制多层闪烁的火焰
    const layers = 3;
    for (let i = 0; i < layers; i++) {
        // 每一层都有不同的缩放和颜色，以及基于时间的闪烁
        const layerScale = 1.0 - (i * 0.2);
        const flicker = Math.sin(now * 0.01 + i * 2) * 0.05 + 0.95;
        const radius = fire.radius * layerScale * flicker;
        
        const colors = [
            `rgba(255, 69, 0, ${0.4 * alpha})`,   // 橙红色
            `rgba(255, 140, 0, ${0.5 * alpha})`,  // 橙色
            `rgba(255, 215, 0, ${0.6 * alpha})`   // 金色
        ];
        
        this.ctx.fillStyle = colors[i];
        this.ctx.beginPath();
        
        // 使用不规则的多边形而不是完美的圆，让火焰看起来更真实
        const points = 12;
        for (let j = 0; j < points; j++) {
            const angle = (j / points) * Math.PI * 2;
            const dist = radius * (0.9 + Math.random() * 0.2);
            const px = screenX + Math.cos(angle) * dist;
            const py = screenY + Math.sin(angle) * dist;
            if (j === 0) this.ctx.moveTo(px, py);
            else this.ctx.lineTo(px, py);
        }
        
        this.ctx.closePath();
        this.ctx.fill();
    }

    // 绘制一些上升的火星
    const sparks = 5;
    for (let i = 0; i < sparks; i++) {
        const sparkAge = (now * 0.001 + i * 0.2) % 1.0;
        const angle = (i / sparks) * Math.PI * 2 + now * 0.0005;
        const dist = fire.radius * (0.2 + sparkAge * 0.8);
        const sparkX = screenX + Math.cos(angle) * dist;
        const sparkY = screenY + Math.sin(angle) * dist - sparkAge * 50; // 向上飘动
        
        const sparkAlpha = (1 - sparkAge) * alpha;
        this.ctx.fillStyle = `rgba(255, 255, 255, ${sparkAlpha})`;
        this.ctx.beginPath();
        this.ctx.arc(sparkX, sparkY, 2, 0, Math.PI * 2);
        this.ctx.fill();
    }

    // 绘制进度条（移至中心）
    const progress = Math.max(0, Math.min(1, 1 - fire.age));
    const barWidth = 40;
    const barHeight = 4;
    const barX = screenX - barWidth / 2;
    const barY = screenY - barHeight / 2; // 中心位置

    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    this.ctx.fillRect(barX, barY, barWidth, barHeight);
    this.ctx.fillStyle = `rgba(255, 69, 0, ${0.8 * alpha})`;
    this.ctx.fillRect(barX, barY, barWidth * progress, barHeight);
    
    this.ctx.restore();
  }
  
  /**
   * 性能优化: 预生成烟雾噪点位置（一次性），避免每帧随机生成
   */
  private ensureSmokeNoise(): void {
    if (this.smokeNoisePoints.length > 0) return;
    const n = 80;
    for (let i = 0; i < n; i++) {
      this.smokeNoisePoints.push({
        x: Math.random(),
        y: Math.random(),
        s: 1 + Math.random() * 3,
        a: Math.random() > 0.5 ? 0.15 : 0.25,
      });
    }
  }


  // 近战挥击特效（更加自然且高性能的扇形弧线）
  drawMeleeSwing(effect: { x: number; y: number; aimRad: number; range: number; arcRad: number; age: number; side?: number }): void {
    const screenX = Math.round(effect.x - this.camX);
    const screenY = Math.round(effect.y - this.camY);
    
    // 使用 age (0-1) 来控制动画阶段
    const age = effect.age;
    if (age < 0 || age > 1) return;

    this.ctx.save();
    
    // 全局透明度控制
    const alpha = Math.max(0, 1 - age);
    
    // 计算挥砍的角度范围
    const halfArc = effect.arcRad / 2;
    const totalArc = effect.arcRad;
    const side = effect.side || 1; // 1 或 -1
    
    // 动态扫过逻辑
    const t_forward = Math.min(1, age * 2.0); 
    const t_backward = Math.max(0, (age - 0.2) * 1.25);
    
    let drawStart, drawEnd;
    if (side > 0) {
      // 顺时针（从左向右）
      drawStart = effect.aimRad - halfArc + totalArc * t_backward;
      drawEnd = effect.aimRad - halfArc + totalArc * t_forward;
    } else {
      // 逆时针（从右向左）
      drawStart = effect.aimRad + halfArc - totalArc * t_forward;
      drawEnd = effect.aimRad + halfArc - totalArc * t_backward;
    }

    if (drawEnd > drawStart) {
      // 1. 绘制底层辉光 (Glow)
      this.ctx.globalAlpha = alpha * 0.2;
      this.ctx.strokeStyle = '#fff';
      this.ctx.lineWidth = 12;
      this.ctx.lineCap = 'round';
      this.ctx.beginPath();
      this.ctx.arc(screenX, screenY, effect.range, drawStart, drawEnd);
      this.ctx.stroke();

      // 2. 绘制运动轨迹填充 (Blade Trail)
      this.ctx.globalAlpha = alpha * 0.1;
      this.ctx.fillStyle = '#fff';
      this.ctx.beginPath();
      this.ctx.moveTo(screenX, screenY);
      this.ctx.arc(screenX, screenY, effect.range, drawStart, drawEnd);
      this.ctx.closePath();
      this.ctx.fill();

      // 3. 绘制核心锋刃 (Hard Blade)
      this.ctx.globalAlpha = alpha * 0.7;
      this.ctx.lineWidth = 2.5;
      this.ctx.beginPath();
      this.ctx.arc(screenX, screenY, effect.range, drawStart, drawEnd);
      this.ctx.stroke();
    }

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
    const now = Date.now();
    
    let color = '#00ff00';
    let isLegendary = false;
    let itemType;
    try {
      itemType = getItemType(worldItem.typeId);
      if (itemType.rarity === 'RARE') color = '#0088ff';
      else if (itemType.rarity === 'EPIC') color = '#9d4edd';
      else if (itemType.rarity === 'LEGENDARY') {
          color = '#ffaa00';
          isLegendary = true;
      }
    } catch {}

    this.ctx.save();
    
    // Legendary Special Effects
    if (isLegendary) {
        const time = now / 300; // Speed of animation
        const pulse = 1 + Math.sin(time) * 0.3; // 0.7 to 1.3
        
        // 1. Pulsating Outer Glow (Larger)
        const glowRadius = size * 2.5 * pulse;
        const glow = this.ctx.createRadialGradient(screenX, screenY, 0, screenX, screenY, glowRadius);
        glow.addColorStop(0, `rgba(255, 215, 0, 0.8)`); // Gold center
        glow.addColorStop(0.5, `rgba(255, 165, 0, 0.4)`); // Orange mid
        glow.addColorStop(1, `rgba(255, 165, 0, 0)`); // Transparent edge
        
        this.ctx.fillStyle = glow;
        this.ctx.beginPath();
        this.ctx.arc(screenX, screenY, glowRadius, 0, Math.PI * 2);
        this.ctx.fill();

        // 2. Rotating Halo / Star
        const angle = now / 500;
        this.ctx.translate(screenX, screenY);
        this.ctx.rotate(angle);
        
        this.ctx.strokeStyle = `rgba(255, 255, 200, 0.8)`;
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        const haloSize = size * 1.8;
        this.ctx.rect(-haloSize/2, -haloSize/2, haloSize, haloSize);
        this.ctx.stroke();
        
        // Reset transform for main item
        this.ctx.rotate(-angle);
        this.ctx.translate(-screenX, -screenY);
    } else {
        // Normal Glow
        const finalY = screenY;
        const glow = this.ctx.createRadialGradient(screenX, finalY, 0, screenX, finalY, size * 1.5);
        glow.addColorStop(0, `${color}66`); // 40% alpha
        glow.addColorStop(1, `${color}00`); // transparent
        this.ctx.fillStyle = glow;
        this.ctx.beginPath();
        this.ctx.arc(screenX, finalY, size * 1.5, 0, Math.PI * 2);
        this.ctx.fill();
    }

    // 绘制物品主体 (菱形旋转)
    const finalY = screenY;
    
    this.ctx.translate(screenX, finalY);
    this.ctx.rotate(Math.PI / 4); // 旋转45度成菱形
    
    // Legendary pulsates size too
    const scale = isLegendary ? (1 + Math.sin(now/200)*0.1) : 1;
    this.ctx.scale(scale, scale);

    this.ctx.fillStyle = color;
    this.ctx.fillRect(-size / 2, -size / 2, size, size);
    
    // 内部高光
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    this.ctx.fillRect(-size / 2, -size / 2, size / 2, size / 2);
    
    this.ctx.strokeStyle = '#fff';
    this.ctx.lineWidth = 1.5;
    this.ctx.strokeRect(-size / 2, -size / 2, size, size);
    
    this.ctx.restore();
  }

  // 新增: 绘制掉落包
  drawLootBag(bag: LootBag): void {
    const screenX = Math.round(bag.x - this.camX);
    const screenY = Math.round(bag.y - this.camY);
    const size = 18;
    
    this.ctx.save();
    
    // 阴影
    this.ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    this.ctx.shadowBlur = 4;
    this.ctx.shadowOffsetY = 2;

    // 掉落包主体 (带圆角的深棕色矩形)
    const r = 4;
    this.ctx.fillStyle = '#6d4c41'; // 更有质感的棕色
    this.ctx.beginPath();
    this.ctx.moveTo(screenX - size / 2 + r, screenY - size / 2);
    this.ctx.lineTo(screenX + size / 2 - r, screenY - size / 2);
    this.ctx.quadraticCurveTo(screenX + size / 2, screenY - size / 2, screenX + size / 2, screenY - size / 2 + r);
    this.ctx.lineTo(screenX + size / 2, screenY + size / 2 - r);
    this.ctx.quadraticCurveTo(screenX + size / 2, screenY + size / 2, screenX + size / 2 - r, screenY + size / 2);
    this.ctx.lineTo(screenX - size / 2 + r, screenY + size / 2);
    this.ctx.quadraticCurveTo(screenX - size / 2, screenY + size / 2, screenX - size / 2, screenY + size / 2 - r);
    this.ctx.lineTo(screenX - size / 2, screenY - size / 2 + r);
    this.ctx.quadraticCurveTo(screenX - size / 2, screenY - size / 2, screenX - size / 2 + r, screenY - size / 2);
    this.ctx.fill();
    
    // 装饰线条 (看起来像个包)
    this.ctx.strokeStyle = '#4e342e';
    this.ctx.lineWidth = 2;
    this.ctx.stroke();
    
    this.ctx.beginPath();
    this.ctx.moveTo(screenX - size / 2, screenY);
    this.ctx.lineTo(screenX + size / 2, screenY);
    this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
    this.ctx.stroke();

    this.ctx.restore();
    
    // 显示物品数量
    if (bag.items.length > 0) {
      this.ctx.fillStyle = '#ffffff';
      this.ctx.font = 'bold 10px monospace';
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText(bag.items.length.toString(), screenX, screenY);
    }
  }

  // 新增: 绘制物品信息提示框（在物品旁边显示内容）
  drawItemInfoTooltip(
    worldX: number,
    worldY: number,
    itemInfo: { type: 'worldItem' | 'lootBag'; worldItem?: WorldItem; lootBag?: LootBag },
    localPlayerX: number,
    localPlayerY: number
  ): void {
    const screenX = worldX - this.camX;
    const screenY = worldY - this.camY;
    
    // 只在屏幕内才绘制
    if (screenX < -100 || screenX > this.cssWidth + 100 || 
        screenY < -100 || screenY > this.cssHeight + 100) {
      return;
    }

    // 计算提示框位置（在物品上方，根据玩家位置调整）
    const offsetY = -30; // 物品上方30px
    const tooltipX = screenX;
    const tooltipY = screenY + offsetY;

    // 收集要显示的信息（支持颜色）
    interface TooltipLine {
      text: string;
      color?: string;
    }
    const lines: TooltipLine[] = [];
    
    if (itemInfo.type === 'worldItem' && itemInfo.worldItem) {
      try {
        const itemType = getItemType(itemInfo.worldItem.typeId);
        const itemValue = itemType.value * itemInfo.worldItem.qty;
        let color = '#ffffff';
        if (itemType.rarity === 'RARE') color = '#0088ff';
        else if (itemType.rarity === 'EPIC') color = '#9d4edd';
        else if (itemType.rarity === 'LEGENDARY') color = '#ffaa00';
        lines.push({ text: `${itemType.name} x${itemInfo.worldItem.qty} ($${itemValue})`, color });
      } catch {
        lines.push({ text: `${itemInfo.worldItem.typeId} x${itemInfo.worldItem.qty}`, color: '#ffffff' });
      }
    } else if (itemInfo.type === 'lootBag' && itemInfo.lootBag) {
      const bag = itemInfo.lootBag;
      if (bag.items.length === 0) {
        lines.push({ text: '空掉落包', color: '#ffffff' });
      } else {
        // 显示前几个物品
        const maxItems = 5; // 最多显示5个物品
        const itemsToShow = bag.items.slice(0, maxItems);
        for (const item of itemsToShow) {
          try {
            const itemType = getItemType(item.typeId);
            let color = '#ffffff';
            if (itemType.rarity === 'RARE') color = '#0088ff';
            else if (itemType.rarity === 'EPIC') color = '#9d4edd';
            else if (itemType.rarity === 'LEGENDARY') color = '#ffaa00';
            lines.push({ text: `${itemType.name} x${item.qty}`, color });
          } catch {
            lines.push({ text: `${item.typeId} x${item.qty}`, color: '#ffffff' });
          }
        }
        if (bag.items.length > maxItems) {
          lines.push({ text: `... 还有 ${bag.items.length - maxItems} 个物品`, color: '#ffffff' });
        }
      }
    }

    if (lines.length === 0) {
      return;
    }

    // 计算文本尺寸
    this.ctx.save();
    this.ctx.font = '12px monospace';
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'top';
    
    const padding = 8;
    const lineHeight = 16;
    let maxWidth = 0;
    for (const line of lines) {
      const metrics = this.ctx.measureText(line.text);
      maxWidth = Math.max(maxWidth, metrics.width);
    }
    
    const boxWidth = maxWidth + padding * 2;
    const boxHeight = lines.length * lineHeight + padding * 2;
    
    // 调整位置，确保不超出屏幕
    let finalX = tooltipX - boxWidth / 2; // 居中
    let finalY = tooltipY - boxHeight; // 在物品上方
    
    // 边界检查
    if (finalX < 10) finalX = 10;
    if (finalX + boxWidth > this.cssWidth - 10) finalX = this.cssWidth - boxWidth - 10;
    if (finalY < 10) finalY = tooltipY + 20; // 如果上方空间不够，显示在下方
    
    // 绘制背景框
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    this.ctx.fillRect(finalX, finalY, boxWidth, boxHeight);
    
    // 绘制边框
    this.ctx.strokeStyle = '#4CAF50';
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(finalX, finalY, boxWidth, boxHeight);
    
    // 绘制文本（每行可以使用不同颜色）
    for (let i = 0; i < lines.length; i++) {
      this.ctx.fillStyle = lines[i].color || '#ffffff';
      this.ctx.fillText(lines[i].text, finalX + padding, finalY + padding + i * lineHeight);
    }
    
    this.ctx.restore();
  }

  // Day3: 绘制撤离区 (简化版：减少 Draw Call 以优化性能)
  drawExtractZone(zone: { x: number; y: number; w: number; h: number }): void {
    const screenX = zone.x - this.camX;
    const screenY = zone.y - this.camY;
    const now = Date.now();
    
    this.ctx.save();
    
    // 基础填充
    this.ctx.fillStyle = 'rgba(0, 255, 0, 0.15)';
    this.ctx.fillRect(screenX, screenY, zone.w, zone.h);
    
    // 简单的呼吸效果扫描线 (不再使用渐变)
    const scanPos = (now / 1500) % 1.0;
    const scanY = screenY + zone.h * scanPos;
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(screenX, scanY);
    this.ctx.lineTo(screenX + zone.w, scanY);
    this.ctx.stroke();

    // 静态边框 (不使用阴影)
    this.ctx.strokeStyle = '#00ff00';
    this.ctx.lineWidth = 3;
    this.ctx.strokeRect(screenX, screenY, zone.w, zone.h);
    
    this.ctx.restore();
  }

  // 新增: 绘制地图背景和地板
  private drawFloor(zones: Zone[] = []): void {
    if (this.worldWidth <= 0 || this.worldHeight <= 0) return;

    this.ctx.save();
    
    // 1. 基础颜色 (深灰褐色，比单纯的 #2a2a2a 更有质感)
    this.ctx.fillStyle = '#222222';
    const floorX = Math.round(0 - this.camX);
    const floorY = Math.round(0 - this.camY);
    this.ctx.fillRect(floorX, floorY, this.worldWidth, this.worldHeight);

    // 2. 绘制区域 (Zones)
    for (const zone of zones) {
        // 简单的视锥剔除
        if (
            zone.x + zone.w < this.camX ||
            zone.x > this.camX + this.cssWidth ||
            zone.y + zone.h < this.camY ||
            zone.y > this.camY + this.cssHeight
        ) {
            continue;
        }

        const zx = Math.round(zone.x - this.camX);
        const zy = Math.round(zone.y - this.camY);
        const zw = zone.w;
        const zh = zone.h;

        // 生成种子
        const seedStr = zone.id || `${zone.x}_${zone.y}`;
        const seed = seedStr.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);

        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.rect(zx, zy, zw, zh);
        this.ctx.clip(); // 限制绘制区域

        switch (zone.type) {
            case 'grass':
                this.ctx.fillStyle = '#2d3a2d'; // 深绿
                this.ctx.fillRect(zx, zy, zw, zh);
                // 绘制草丛纹理 (杂点)
                this.ctx.fillStyle = '#3a4a3a';
                for (let i = 0; i < zw * zh / 400; i++) {
                     const rx = (seed * (i + 1) * 17) % zw;
                     const ry = (seed * (i + 1) * 23) % zh;
                     this.ctx.fillRect(zx + rx, zy + ry, 3, 3);
                }
                break;
            case 'wood':
                this.ctx.fillStyle = '#3e2723'; // 深棕
                this.ctx.fillRect(zx, zy, zw, zh);
                // 绘制木板条纹
                this.ctx.strokeStyle = '#281a17';
                this.ctx.lineWidth = 2;
                const plankSize = 25;
                for (let y = 0; y < zh; y += plankSize) {
                    this.ctx.beginPath();
                    this.ctx.moveTo(zx, zy + y);
                    this.ctx.lineTo(zx + zw, zy + y);
                    this.ctx.stroke();
                }
                break;
            case 'tile':
                this.ctx.fillStyle = '#37474f'; // 蓝灰地砖
                this.ctx.fillRect(zx, zy, zw, zh);
                // 绘制方砖网格
                this.ctx.strokeStyle = '#263238';
                this.ctx.lineWidth = 2;
                const tileSize = 40;
                this.ctx.beginPath();
                // 偏移以对齐世界坐标
                const startX = -(zone.x % tileSize);
                const startY = -(zone.y % tileSize);
                for (let x = startX; x < zw; x += tileSize) {
                    this.ctx.moveTo(zx + x, zy);
                    this.ctx.lineTo(zx + x, zy + zh);
                }
                for (let y = startY; y < zh; y += tileSize) {
                    this.ctx.moveTo(zx, zy + y);
                    this.ctx.lineTo(zx + zw, zy + y);
                }
                this.ctx.stroke();
                break;
            case 'pave':
            case 'concrete':
                this.ctx.fillStyle = '#424242'; // 混凝土灰
                this.ctx.fillRect(zx, zy, zw, zh);
                // 噪点
                this.ctx.fillStyle = '#303030';
                for (let i = 0; i < zw * zh / 800; i++) {
                     const rx = (seed * (i + 1) * 31) % zw;
                     const ry = (seed * (i + 1) * 37) % zh;
                     const s = ((seed * i) % 3) + 2;
                     this.ctx.fillRect(zx + rx, zy + ry, s, s);
                }
                break;
             case 'water':
                 this.ctx.fillStyle = '#01579b'; 
                 this.ctx.fillRect(zx, zy, zw, zh);
                 // 简单的波纹
                 this.ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
                 const time = performance.now() / 1000;
                 for (let i = 0; i < zw * zh / 1000; i++) {
                     const rx = (seed * (i + 1) * 11 + time * 10) % zw;
                     const ry = (seed * (i + 1) * 13) % zh;
                     this.ctx.fillRect(zx + rx, zy + ry, 10, 2);
                 }
                 break;
            default:
                // 通用/默认: 略微提亮
                this.ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
                this.ctx.fillRect(zx, zy, zw, zh);
                break;
        }

        this.ctx.restore();
    }

    // 3. 绘制全局网格 (暗色细线，统一视觉)
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    this.ctx.lineWidth = 1;
    const gridSize = 100;
    
    this.ctx.beginPath();
    // 垂直线
    for (let x = 0; x <= this.worldWidth; x += gridSize) {
      const sx = Math.round(x - this.camX);
      if (sx >= 0 && sx <= this.cssWidth) {
        this.ctx.moveTo(sx, floorY);
        this.ctx.lineTo(sx, floorY + this.worldHeight);
      }
    }
    // 水平线
    for (let y = 0; y <= this.worldHeight; y += gridSize) {
      const sy = Math.round(y - this.camY);
      if (sy >= 0 && sy <= this.cssHeight) {
        this.ctx.moveTo(floorX, sy);
        this.ctx.lineTo(floorX + this.worldWidth, sy);
      }
    }
    this.ctx.stroke();

    // 绘制一些随机的“灰尘/划痕”效果 (增加地面质感)
    // 使用简单的确定性假随机 (基于世界坐标)
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.02)';
    for (let i = 0; i < 50; i++) {
        const seed = 12345;
        const rx = ((seed * (i + 1) * 7919) % this.worldWidth);
        const ry = ((seed * (i + 1) * 104729) % this.worldHeight);
        const rw = ((seed * (i + 1) * 13) % 20) + 5;
        const rh = ((seed * (i + 1) * 17) % 20) + 5;
        
        const sx = rx - this.camX;
        const sy = ry - this.camY;
        
        if (sx > -rw && sx < this.cssWidth && sy > -rh && sy < this.cssHeight) {
            this.ctx.fillRect(sx, sy, rw, rh);
        }
    }

    this.ctx.restore();
  }

  /**
   * 性能优化: 文字宽度缓存
   * measureText 很贵，缓存结果避免重复计算
   */
  private measureCached(font: string, text: string): number {
    const key = font + '|' + text;
    const hit = this.textWidthCache.get(key);
    if (hit !== undefined) return hit;
    this.ctx.save();
    this.ctx.font = font;
    const w = this.ctx.measureText(text).width;
    this.ctx.restore();
    this.textWidthCache.set(key, w);
    return w;
  }

  /**
   * 性能优化: 障碍物精灵缓存
   * 把复杂的障碍物绘制预先画到离屏画布，主循环只需 drawImage
   */
  private getObsSprite(type: string, w: number, h: number, seed: number, damageTier: number): HTMLCanvasElement {
    const key = `${type}:${w}:${h}:${seed}:${damageTier}`;
    const hit = this.obsSprite.get(key);
    if (hit) return hit;
    
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    const g = c.getContext('2d')!;
    
    // 临时切换 ctx 到离屏画布
    const prev = this.ctx;
    (this as any).ctx = g;
    try {
      // 调用原有的绘制函数，但画到离屏画布上（坐标从 0,0 开始）
      if (type === 'wall') this.drawWall(0, 0, w, h, seed);
      else if (type === 'crate') this.drawCrateImprove(0, 0, w, h, seed);
      else if (type === 'weapon_crate') this.drawSpecializedCrate(0, 0, w, h, seed, '#8B0000', '🔫');
      else if (type === 'throwable_crate') this.drawSpecializedCrate(0, 0, w, h, seed, '#FF8C00', '💣');
      else if (type === 'medical_crate') this.drawSpecializedCrate(0, 0, w, h, seed, '#FFFFFF', '⚕️');
      else if (type === 'equipment_crate') this.drawSpecializedCrate(0, 0, w, h, seed, '#4169E1', '🎒');
      
      // 户外景观类（俯视图）
      else if (type === 'fence_wood') this.drawFence(0, 0, w, h, '#D2691E');
      else if (type === 'fence_metal') this.drawFence(0, 0, w, h, '#778899');
      else if (type === 'shrub') this.drawSimpleCircle(0, 0, w, h, '#6B8E23');
      else if (type === 'rock_large') this.drawRockLarge(0, 0, w, h, seed);
      
      else if (type === 'bush') this.drawBushImprove(0, 0, w, h, seed);
      else if (type === 'water') this.drawWaterImprove(0, 0, w, h, seed);
      else if (type === 'door_closed') this.drawDoor(0, 0, w, h, false, seed);
      else if (type === 'door_open') this.drawDoor(0, 0, w, h, true, seed);
      else if (type === 'glass') this.drawGlass(0, 0, w, h, seed);
      else if (type === 'chest_closed') this.drawChest(0, 0, w, h, false, seed);
      else if (type === 'chest_open') this.drawChest(0, 0, w, h, true, seed);
      else if (type === 'broken') this.drawBroken(0, 0, w, h, seed);
      
      // 绘制裂痕（根据 damageTier）
      if (damageTier > 0) {
        this.drawCracksOnSprite(g, w, h, seed, damageTier);
      }
    } finally {
      (this as any).ctx = prev;
    }
    
    this.obsSprite.set(key, c);
    return c;
  }

  /**
   * 性能优化: 在精灵上绘制裂痕（避免每帧重复计算）
   */
  private drawCracksOnSprite(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number, damageTier: number): void {
    // damageTier: 1=轻微(3条), 2=中度(5条), 3=严重(8条)
    let crackCount = 0;
    if (damageTier === 3) crackCount = 8;
    else if (damageTier === 2) crackCount = 5;
    else if (damageTier === 1) crackCount = 3;
    
    if (crackCount === 0) return;
    
    const centerX = w / 2 + ((seed % 20) - 10);
    const centerY = h / 2 + (((seed * 7) % 20) - 10);
    
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();
    
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    
    for (let i = 0; i < crackCount; i++) {
      const angle = ((seed + i * 137) % 360) * Math.PI / 180;
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      
      let tMax = Infinity;
      if (dx > 0) tMax = Math.min(tMax, (w - centerX) / dx);
      if (dx < 0) tMax = Math.min(tMax, (0 - centerX) / dx);
      if (dy > 0) tMax = Math.min(tMax, (h - centerY) / dy);
      if (dy < 0) tMax = Math.min(tMax, (0 - centerY) / dy);
      
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(centerX + dx * tMax, centerY + dy * tMax);
      ctx.stroke();
    }
    
    ctx.restore();
  }

  // 新增: 绘制墙壁 (石墙)
  private drawWall(screenX: number, screenY: number, w: number, h: number, seed: number): void {
    const ctx = this.ctx;
    
    // 基础渐变：深灰到更深的灰
    const gradient = ctx.createLinearGradient(screenX, screenY, screenX + w, screenY + h);
    gradient.addColorStop(0, '#555555');
    gradient.addColorStop(1, '#333333');
    ctx.fillStyle = gradient;
    ctx.fillRect(screenX, screenY, w, h);

    // 绘制内部“石块”纹理
    ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
    const stoneCount = Math.floor((w * h) / 800) + 2;
    for (let i = 0; i < stoneCount; i++) {
        const rx = (Math.abs(Math.sin(seed + i)) * (w - 15)) + 5;
        const ry = (Math.abs(Math.cos(seed * 1.3 + i)) * (h - 15)) + 5;
        const rw = (Math.abs(Math.sin(seed * 0.7 + i)) * 10) + 10;
        const rh = (Math.abs(Math.cos(seed * 0.9 + i)) * 10) + 10;
        ctx.fillRect(screenX + rx, screenY + ry, rw, rh);
    }
    
    // 高光边缘 (增加体积感)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 2;
    ctx.strokeRect(screenX + 1, screenY + 1, w - 2, h - 2);

    // 外部主边框
    ctx.strokeStyle = '#111111';
    ctx.lineWidth = 2;
    ctx.strokeRect(screenX, screenY, w, h);
  }

  // 新增: 绘制木箱
  private drawCrateImprove(screenX: number, screenY: number, w: number, h: number, seed: number): void {
    const ctx = this.ctx;
    
    // 基础渐变：棕色调
    const gradient = ctx.createLinearGradient(screenX, screenY, screenX, screenY + h);
    gradient.addColorStop(0, '#A0522D');
    gradient.addColorStop(1, '#6B3410');
    ctx.fillStyle = gradient;
    ctx.fillRect(screenX, screenY, w, h);

    // 绘制木板纹理 (几条横向/纵向线)
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.lineWidth = 2;
    const boardCount = 4;
    for (let i = 1; i < boardCount; i++) {
        const bx = screenX + (w * i) / boardCount;
        ctx.beginPath();
        ctx.moveTo(bx, screenY);
        ctx.lineTo(bx, screenY + h);
        ctx.stroke();
    }

    // 绘制“X”型加固木条
    ctx.strokeStyle = '#5D2E0B';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(screenX + 5, screenY + 5);
    ctx.lineTo(screenX + w - 5, screenY + h - 5);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(screenX + w - 5, screenY + 5);
    ctx.lineTo(screenX + 5, screenY + h - 5);
    ctx.stroke();

    // 边框
    ctx.strokeStyle = '#3E1F07';
    ctx.lineWidth = 2;
    ctx.strokeRect(screenX, screenY, w, h);
  }

  // 新增: 绘制专门类型的箱子（武器箱、投掷物箱、医疗箱、装备箱）
  private drawSpecializedCrate(screenX: number, screenY: number, w: number, h: number, seed: number, color: string, icon: string): void {
    const ctx = this.ctx;
    
    // 基础渐变：使用专门的颜色
    const gradient = ctx.createLinearGradient(screenX, screenY, screenX, screenY + h);
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, this.darkenColor(color, 0.4));
    ctx.fillStyle = gradient;
    ctx.fillRect(screenX, screenY, w, h);

    // 绘制加固边缘（金属/加强边框）
    ctx.strokeStyle = this.darkenColor(color, 0.6);
    ctx.lineWidth = 4;
    ctx.strokeRect(screenX + 3, screenY + 3, w - 6, h - 6);
    
    // 绘制对角线加固条
    ctx.strokeStyle = this.darkenColor(color, 0.5);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(screenX + 8, screenY + 8);
    ctx.lineTo(screenX + w - 8, screenY + h - 8);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(screenX + w - 8, screenY + 8);
    ctx.lineTo(screenX + 8, screenY + h - 8);
    ctx.stroke();

    // 绘制图标/符号
    ctx.font = `${Math.min(w, h) * 0.5}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // 图标阴影效果
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillText(icon, screenX + w / 2 + 2, screenY + h / 2 + 2);
    
    // 图标主体
    ctx.fillStyle = color === '#FFFFFF' ? '#000000' : '#FFFFFF'; // 白箱用黑图标，其他用白图标
    ctx.fillText(icon, screenX + w / 2, screenY + h / 2);

    // 外部主边框
    ctx.strokeStyle = this.darkenColor(color, 0.7);
    ctx.lineWidth = 2;
    ctx.strokeRect(screenX, screenY, w, h);
  }

  // 简洁渲染：集装箱（方形+文字）
  private drawContainer(x: number, y: number, w: number, h: number, seed: number): void {
    const ctx = this.ctx;
    
    // 背景色
    ctx.fillStyle = '#8B4513';
    ctx.fillRect(x, y, w, h);
    
    // 纵向条纹
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.lineWidth = 2;
    for (let i = 1; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(x + (w * i) / 5, y);
      ctx.lineTo(x + (w * i) / 5, y + h);
      ctx.stroke();
    }
    
    // 文字标识
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('集装箱', x + w / 2, y + h / 2);
    
    // 边框
    ctx.strokeStyle = '#654321';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
  }

  // 简洁渲染：车辆（方形+文字）
  private drawVehicle(x: number, y: number, w: number, h: number, seed: number): void {
    const ctx = this.ctx;
    
    // 背景色
    ctx.fillStyle = '#696969';
    ctx.fillRect(x, y, w, h);
    
    // 前后挡风玻璃（浅蓝）
    ctx.fillStyle = 'rgba(150, 200, 255, 0.5)';
    ctx.fillRect(x + w * 0.1, y + 5, w * 0.8, h * 0.2);
    ctx.fillRect(x + w * 0.1, y + h - h * 0.2 - 5, w * 0.8, h * 0.2);
    
    // 文字标识
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('车辆', x + w / 2, y + h / 2);
    
    // 边框
    ctx.strokeStyle = '#3F3F3F';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
  }

  // 简洁渲染：帐篷（方形+文字）
  private drawSupplyTent(x: number, y: number, w: number, h: number, seed: number): void {
    const ctx = this.ctx;
    
    // 背景色（军绿）
    ctx.fillStyle = '#556B2F';
    ctx.fillRect(x, y, w, h);
    
    // 交叉线（帐篷结构）
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + w / 2, y);
    ctx.lineTo(x + w / 2, y + h);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y + h / 2);
    ctx.lineTo(x + w, y + h / 2);
    ctx.stroke();
    
    // 文字标识
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('补给帐篷', x + w / 2, y + h / 2);
    
    // 边框
    ctx.strokeStyle = '#3E4A21';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
  }

  // 简洁渲染：瞭望塔（方形+文字）
  private drawWatchtower(x: number, y: number, w: number, h: number, seed: number): void {
    const ctx = this.ctx;
    
    // 背景色（木色）
    ctx.fillStyle = '#6D4C41';
    ctx.fillRect(x, y, w, h);
    
    // 木板纹理（横向）
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.lineWidth = 1;
    for (let i = 0; i < h; i += 12) {
      ctx.beginPath();
      ctx.moveTo(x, y + i);
      ctx.lineTo(x + w, y + i);
      ctx.stroke();
    }
    
    // 文字标识
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('瞭望塔', x + w / 2, y + h / 2);
    
    // 边框
    ctx.strokeStyle = '#4E342E';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
  }

  // 简洁渲染：小房屋（方形+文字）
  private drawSmallHouse(x: number, y: number, w: number, h: number, seed: number): void {
    const ctx = this.ctx;
    
    // 背景色（红褐）
    ctx.fillStyle = '#A0522D';
    ctx.fillRect(x, y, w, h);
    
    // 瓦片纹理（横向密集线）
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)';
    ctx.lineWidth = 1;
    for (let i = 0; i < h; i += 6) {
      ctx.beginPath();
      ctx.moveTo(x, y + i);
      ctx.lineTo(x + w, y + i);
      ctx.stroke();
    }
    
    // 文字标识
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('房屋', x + w / 2, y + h / 2);
    
    // 边框
    ctx.strokeStyle = '#654321';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
  }

  // 简洁渲染：树木（方形+文字）
  private drawTreeLarge(x: number, y: number, w: number, h: number, seed: number): void {
    const ctx = this.ctx;
    
    // 背景色（深绿）
    ctx.fillStyle = '#2E7D32';
    ctx.fillRect(x, y, w, h);
    
    // 叶子纹理（深绿斑点）
    ctx.fillStyle = 'rgba(27, 94, 32, 0.4)';
    for (let i = 0; i < 8; i++) {
      const px = x + (w * ((seed + i * 17) % 100)) / 100;
      const py = y + (h * ((seed + i * 23) % 100)) / 100;
      ctx.fillRect(px - 3, py - 3, 6, 6);
    }
    
    // 中心树干标记
    ctx.fillStyle = '#5D4037';
    ctx.fillRect(x + w / 2 - 5, y + h / 2 - 5, 10, 10);
    
    // 文字标识
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('树', x + w / 2, y + h / 2 + 20);
    
    // 边框
    ctx.strokeStyle = '#1B5E20';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
  }

  // 简洁渲染：岩石（方形+文字）
  private drawRockLarge(x: number, y: number, w: number, h: number, seed: number): void {
    const ctx = this.ctx;
    
    // 背景色（灰色）
    ctx.fillStyle = '#696969';
    ctx.fillRect(x, y, w, h);
    
    // 岩石纹理（深色斑点）
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    for (let i = 0; i < 6; i++) {
      const px = x + (w * ((seed + i * 19) % 100)) / 100;
      const py = y + (h * ((seed + i * 29) % 100)) / 100;
      const size = 4 + ((seed + i) % 6);
      ctx.fillRect(px - size / 2, py - size / 2, size, size);
    }
    
    // 高光
    ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.fillRect(x + w * 0.2, y + h * 0.2, w * 0.3, h * 0.3);
    
    // 文字标识
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('岩石', x + w / 2, y + h / 2);
    
    // 边框
    ctx.strokeStyle = '#4A4A4A';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
  }

  // 简化渲染：绘制简单方形（用于景观）
  private drawSimpleBox(x: number, y: number, w: number, h: number, color: string): void {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = this.darkenColor(color, 0.3);
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
  }

  // 简化渲染：绘制简单圆形（用于树/灌木）
  private drawSimpleCircle(x: number, y: number, w: number, h: number, color: string): void {
    const ctx = this.ctx;
    const centerX = x + w / 2;
    const centerY = y + h / 2;
    const radius = Math.min(w, h) / 2;
    
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.strokeStyle = this.darkenColor(color, 0.3);
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // 简化渲染：绘制栅栏
  private drawFence(x: number, y: number, w: number, h: number, color: string): void {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
    
    // 绘制栅栏条纹
    ctx.strokeStyle = this.darkenColor(color, 0.4);
    ctx.lineWidth = 2;
    const spacing = w > h ? h / 3 : w / 3;
    
    if (w > h) { // 横向栅栏
      for (let i = 0; i < w; i += spacing) {
        ctx.beginPath();
        ctx.moveTo(x + i, y);
        ctx.lineTo(x + i, y + h);
        ctx.stroke();
      }
    } else { // 纵向栅栏
      for (let i = 0; i < h; i += spacing) {
        ctx.beginPath();
        ctx.moveTo(x, y + i);
        ctx.lineTo(x + w, y + i);
        ctx.stroke();
      }
    }
  }

  // 新增: 绘制草丛 (改为方形，满足用户需求)
  private drawBushImprove(screenX: number, screenY: number, w: number, h: number, seed: number): void {
    const ctx = this.ctx;
    
    ctx.save();
    ctx.globalAlpha = 0.6; // 稍微透明一点，表示可以躲藏

    // 基础渐变：不同层次的绿色
    const gradient = ctx.createLinearGradient(screenX, screenY, screenX, screenY + h);
    gradient.addColorStop(0, '#2eab2e'); // 亮绿
    gradient.addColorStop(1, '#1a5e1a'); // 深绿
    ctx.fillStyle = gradient;
    ctx.fillRect(screenX, screenY, w, h);

    // 绘制一些内部的“草叶”线条
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1.5;
    
    // 使用种子生成确定性的草叶位置
    const grassCount = 6;
    for (let i = 0; i < grassCount; i++) {
        const offset = ((seed * (i + 1) * 137) % 100) / 100;
        const gx = screenX + w * offset;
        
        ctx.beginPath();
        ctx.moveTo(gx, screenY + h - 5);
        ctx.quadraticCurveTo(
            gx + (i % 2 === 0 ? 4 : -4),
            screenY + h / 2,
            gx + (i % 2 === 0 ? 2 : -2),
            screenY + 5
        );
        ctx.stroke();
    }

    // 外部边框
    ctx.strokeStyle = '#006400';
    ctx.lineWidth = 2;
    ctx.strokeRect(screenX, screenY, w, h);
    
    ctx.restore();
  }

  // 新增: 绘制水域
  private drawWaterImprove(screenX: number, screenY: number, w: number, h: number, seed: number): void {
    const ctx = this.ctx;
    const now = Date.now();
    
    // 基础渐变：水蓝色到深蓝
    const gradient = ctx.createRadialGradient(
        screenX + w / 2, screenY + h / 2, 0,
        screenX + w / 2, screenY + h / 2, Math.max(w, h)
    );
    gradient.addColorStop(0, '#4facfe');
    gradient.addColorStop(1, '#0061ff');
    
    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = gradient;
    ctx.fillRect(screenX, screenY, w, h);
    
    // 绘制波纹 (动画)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    
    const rippleCount = 3;
    for (let i = 0; i < rippleCount; i++) {
        // 基于时间计算水平偏移
        const offset = (now / 3000 + i / rippleCount) % 1.0;
        const waveY = screenY + (h * (i + 1)) / (rippleCount + 1);
        const waveStart = screenX + 10;
        const waveEnd = screenX + w - 10;
        const currentLen = (waveEnd - waveStart) * 0.3;
        const currentX = waveStart + (waveEnd - waveStart - currentLen) * offset;
        
        ctx.beginPath();
        ctx.moveTo(currentX, waveY);
        ctx.bezierCurveTo(
            currentX + currentLen / 3, waveY - 5 * Math.sin(now / 500 + i),
            currentX + 2 * currentLen / 3, waveY + 5 * Math.sin(now / 500 + i),
            currentX + currentLen, waveY
        );
        ctx.stroke();
    }
    
    // 内部微弱光晕
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 3;
    ctx.strokeRect(screenX + 2, screenY + 2, w - 4, h - 4);
    
    ctx.restore();
  }

  // 新增: 绘制门
  private drawDoor(x: number, y: number, w: number, h: number, isOpen: boolean, seed: number): void {
      const ctx = this.ctx;
      ctx.save();
      
      // 门框
      ctx.fillStyle = '#4a3b2a';
      ctx.fillRect(x, y, w, h);
      
      const frameSize = 4;
      const doorX = x + frameSize;
      const doorY = y + frameSize;
      const doorW = w - frameSize * 2;
      const doorH = h - frameSize * 2;
      
      if (isOpen) {
          // 打开的门：画一个半透明的深色区域表示内部，或者画开启的门扇
          // 简单起见：画半透明
          ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
          ctx.fillRect(doorX, doorY, doorW, doorH);
          
          // 画开着的门扇（稍微偏移）
          ctx.fillStyle = 'rgba(101, 67, 33, 0.6)'; // 半透明棕色
          // 假设向某侧开启
          ctx.beginPath();
          ctx.moveTo(doorX, doorY);
          ctx.lineTo(doorX + doorW * 0.2, doorY + doorH * 0.1); // 透视感
          ctx.lineTo(doorX + doorW * 0.2, doorY + doorH * 0.9);
          ctx.lineTo(doorX, doorY + doorH);
          ctx.fill();
      } else {
          // 关闭的门
          const grad = ctx.createLinearGradient(doorX, doorY, doorX + doorW, doorY);
          grad.addColorStop(0, '#8B4513');
          grad.addColorStop(1, '#A0522D');
          ctx.fillStyle = grad;
          ctx.fillRect(doorX, doorY, doorW, doorH);
          
          // 门把手
          const knobSize = 6;
          ctx.fillStyle = '#FFD700'; // 金色
          ctx.beginPath();
          ctx.arc(doorX + doorW - 10, doorY + doorH / 2, knobSize/2, 0, Math.PI*2);
          ctx.fill();
          
          // 门缝/纹理
          ctx.strokeStyle = 'rgba(0,0,0,0.3)';
          ctx.beginPath();
          ctx.moveTo(doorX + doorW/2, doorY);
          ctx.lineTo(doorX + doorW/2, doorY + doorH);
          ctx.stroke();
      }
      
      ctx.restore();
  }

  // 新增: 绘制玻璃
  private drawGlass(x: number, y: number, w: number, h: number, seed: number): void {
      const ctx = this.ctx;
      ctx.save();
      
      ctx.fillStyle = 'rgba(173, 216, 230, 0.3)'; // 浅蓝透明
      ctx.fillRect(x, y, w, h);
      
      // 高光反光线条
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + w * 0.7, y);
      ctx.lineTo(x + w * 0.3, y + h);
      ctx.stroke();
      
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + w * 0.8, y);
      ctx.lineTo(x + w * 0.4, y + h);
      ctx.stroke();
      
      // 边框
      ctx.strokeStyle = '#888888';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);
      
      ctx.restore();
  }

  // 新增: 绘制宝箱
  private drawChest(x: number, y: number, w: number, h: number, isOpen: boolean, seed: number): void {
      const ctx = this.ctx;
      ctx.save();
      
      // 阴影
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 10;
      
      const lidHeight = h * 0.4;
      const bodyHeight = h - lidHeight;
      const bodyY = y + lidHeight;

      // 材质颜色
      const woodDark = '#5D4037';
      const woodLight = '#8D6E63';
      const gold = '#FFD700';
      const goldDark = '#B8860B';

      if (isOpen) {
          // --- 开启状态 ---
          
          // 1. 内部（暗色背景 + 宝物光芒）
          ctx.fillStyle = '#26160e';
          ctx.fillRect(x + 2, bodyY, w - 4, bodyHeight - 2);
          
          // 金币堆积效果 (简单表示)
          ctx.fillStyle = gold;
          ctx.beginPath();
          ctx.arc(x + w * 0.3, bodyY + bodyHeight * 0.8, w * 0.2, 0, Math.PI * 2);
          ctx.arc(x + w * 0.7, bodyY + bodyHeight * 0.7, w * 0.25, 0, Math.PI * 2);
          ctx.fill();
          
          // 2. 箱体前壁 (下半部分)
          ctx.fillStyle = woodDark;
          ctx.fillRect(x, bodyY, w, bodyHeight);
          // 金边框
          ctx.strokeStyle = goldDark;
          ctx.lineWidth = 3;
          ctx.strokeRect(x, bodyY, w, bodyHeight);
          // 垂直金条
          ctx.fillStyle = goldDark;
          ctx.fillRect(x + 10, bodyY, 5, bodyHeight);
          ctx.fillRect(x + w - 15, bodyY, 5, bodyHeight);

          // 3. 开启的盖子 (梯形透视，向后上方)
          ctx.fillStyle = woodLight;
          ctx.strokeStyle = '#3E2723';
          ctx.lineWidth = 2;
          ctx.beginPath();
          // 盖子底部连接处
          ctx.moveTo(x, bodyY); 
          ctx.lineTo(x + w, bodyY);
          // 盖子顶部 (远端，稍窄)
          ctx.lineTo(x + w - 5, y - 10);
          ctx.lineTo(x + 5, y - 10);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          
          // 盖子内部阴影
          ctx.fillStyle = 'rgba(0,0,0,0.3)';
          ctx.fill();

      } else {
          // --- 关闭状态 ---
          
          // 1. 箱体 (下半部分)
          ctx.fillStyle = woodDark;
          ctx.fillRect(x, bodyY, w, bodyHeight);
          
          // 2. 箱盖 (上半部分，半圆拱形效果)
          // 通过渐变模拟圆柱面
          const lidGrad = ctx.createLinearGradient(x, y, x, bodyY);
          lidGrad.addColorStop(0, woodDark);
          lidGrad.addColorStop(0.5, woodLight); // 高光在中间
          lidGrad.addColorStop(1, woodDark);
          ctx.fillStyle = lidGrad;
          // 画一个稍微突出的盖子
          ctx.fillRect(x, y, w, lidHeight);
          
          // 3. 金色装饰带 (垂直环绕)
          ctx.fillStyle = gold;
          const bandWidth = 6;
          // 左带
          ctx.fillRect(x + 12, y, bandWidth, h);
          // 右带
          ctx.fillRect(x + w - 18, y, bandWidth, h);
          
          // 4. 锁头 (中间)
          const lockSize = 12;
          const lockX = x + w / 2 - lockSize / 2;
          const lockY = bodyY - lockSize / 2;
          
          // 锁底座
          ctx.fillStyle = goldDark;
          ctx.fillRect(lockX - 2, lockY - 2, lockSize + 4, lockSize + 4);
          // 锁孔
          ctx.fillStyle = '#000';
          ctx.beginPath();
          ctx.arc(x + w/2, bodyY, 3, 0, Math.PI*2);
          ctx.fill();
          
          // 5. 轮廓描边
          ctx.strokeStyle = '#3E2723';
          ctx.lineWidth = 2;
          ctx.strokeRect(x, y, w, h);
      }
      
      ctx.restore();
  }

  // 新增: 绘制残骸
  private drawBroken(x: number, y: number, w: number, h: number, seed: number): void {
      const ctx = this.ctx;
      ctx.save();
      
      // 地上的碎片
      ctx.fillStyle = '#555555';
      const count = 5;
      for (let i=0; i<count; i++) {
          const debrisX = x + ((seed * (i+1) * 17) % w);
          const debrisY = y + ((seed * (i+1) * 23) % h);
          const size = 5 + ((seed * i) % 10);
          ctx.fillRect(debrisX, debrisY, size, size);
      }
      
      // 很多灰尘/杂乱线条
      ctx.strokeStyle = '#333333';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + w, y + h);
      ctx.moveTo(x + w, y);
      ctx.lineTo(x, y + h);
      ctx.stroke();
      
      ctx.restore();
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

  // Day4-2: 绘制障碍物（根据类型渲染）
  // 性能优化: 视口裁剪 + 精灵缓存
  drawObstacle(obstacle: OBSTACLE_STATE): void {
    // 性能优化 1: 视口裁剪 - 屏幕外的障碍物直接跳过
    const viewX0 = this.camX - 50;
    const viewY0 = this.camY - 50;
    const viewX1 = this.camX + this.cssWidth + 50;
    const viewY1 = this.camY + this.cssHeight + 50;
    
    const x0 = obstacle.x;
    const y0 = obstacle.y;
    const x1 = obstacle.x + obstacle.w;
    const y1 = obstacle.y + obstacle.h;
    
    if (x1 < viewX0 || x0 > viewX1 || y1 < viewY0 || y0 > viewY1) {
      return; // 完全在屏幕外，跳过
    }
    
    // 修复: round 到整数像素，避免子像素抗锯齿导致的重影
    const screenX = Math.round(obstacle.x - this.camX);
    const screenY = Math.round(obstacle.y - this.camY);

    const obsType = (obstacle as any).type || 'wall';
    const obsHp = (obstacle as any).hp;
    const obsMaxHp = (obstacle as any).maxHp;

    // 使用障碍物ID或位置作为种子
    const seedStr = obstacle.id || `${obstacle.x}_${obstacle.y}`;
    const seed = seedStr.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);

    // 计算破损等级（用于缓存key）
    let damageTier = 0;
    if (obsHp !== undefined && obsMaxHp !== undefined && obsMaxHp > 0) {
      const hpRatio = obsHp / obsMaxHp;
      if (hpRatio < 0.3) damageTier = 3; // 严重
      else if (hpRatio < 0.6) damageTier = 2; // 中度
      else if (hpRatio < 0.9) damageTier = 1; // 轻微
    }

    // 性能优化 2: 精灵缓存 - 使用预渲染的离屏画布
    const sprite = this.getObsSprite(obsType, obstacle.w, obstacle.h, seed, damageTier);
    
    this.ctx.save();
    
    // 性能优化 3: 使用假阴影替代 shadowBlur（shadowBlur 非常耗 CPU）
    // 用偏移的半透明矩形模拟阴影效果
    if (obsType !== 'water' && obsType !== 'bush') {
      this.ctx.globalAlpha = 0.25;
      this.ctx.fillStyle = '#000';
      this.ctx.fillRect(screenX + 4, screenY + 6, obstacle.w, obstacle.h);
      this.ctx.globalAlpha = 1;
    }
    
    // 直接绘制精灵（一次 drawImage 替代所有复杂绘制）
    this.ctx.drawImage(sprite, screenX, screenY);
    
    this.ctx.restore();
  }

  // 辅助函数：使颜色变暗
  private darkenColor(color: string, factor: number): string {
    // 简单的颜色变暗实现
    const hex = color.replace('#', '');
    const r = Math.floor(parseInt(hex.substr(0, 2), 16) * factor);
    const g = Math.floor(parseInt(hex.substr(2, 2), 16) * factor);
    const b = Math.floor(parseInt(hex.substr(4, 2), 16) * factor);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }


  /**
   * 绘制通用的横向状态条（位于实体下方）
   */
  private drawStatusIndicator(
    entityX: number,
    entityY: number,
    text: string,
    progress: number = 1.0,
    color: string = '#4CAF50',
    index: number = 0
  ): void {
    const screenX = Math.round(entityX - this.camX);
    const screenY = Math.round(entityY - this.camY);

    // 计算位置，支持多个状态条堆叠
    const baseY = screenY + 25;
    const spacing = 22;
    const indicatorY = baseY + index * spacing;

    this.ctx.save();
    this.ctx.font = 'bold 12px monospace';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';

    // 性能优化: 使用缓存的文字宽度测量
    const textWidth = this.measureCached('bold 12px monospace', text);
    const padding = 6;
    const boxWidth = textWidth + padding * 2;
    const boxHeight = 18;
    const boxX = screenX - boxWidth / 2;
    const boxY = indicatorY - boxHeight / 2;

    // 背景框
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    this.ctx.fillRect(boxX, boxY, boxWidth, boxHeight);

    // 进度条背景
    const clampedProgress = Math.max(0, Math.min(1, progress));
    const progressWidth = boxWidth * clampedProgress;
    if (progressWidth > 0) {
      this.ctx.fillStyle = color;
      this.ctx.fillRect(boxX, boxY, progressWidth, boxHeight);
    }

    // 描边
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);

    // 文字
    this.ctx.fillStyle = '#FFFFFF';
    // 添加文字阴影提高可读性
    this.ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    this.ctx.shadowBlur = 2;
    this.ctx.fillText(text, screenX, indicatorY);

    this.ctx.restore();
  }

  // 绘制致盲状态提示
  private drawFlashIndicator(entityX: number, entityY: number, progress: number = 1.0, index: number = 0): void {
    this.drawStatusIndicator(entityX, entityY, '⚡ 致盲', progress, 'rgba(255, 255, 255, 0.8)', index);
  }

  // 绘制眩晕状态提示
  private drawStunIndicator(entityX: number, entityY: number, progress: number = 1.0, index: number = 0): void {
    this.drawStatusIndicator(entityX, entityY, '💫 眩晕', progress, 'rgba(255, 200, 0, 0.8)', index);
  }

  // 绘制隐蔽状态提示
  private drawConcealmentIndicator(entityX: number, entityY: number, index: number = 0): void {
    this.drawStatusIndicator(entityX, entityY, '🌿 隐蔽', 1.0, 'rgba(34, 139, 34, 0.8)', index);
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
    explosionEffects: Array<{ x: number; y: number; radius: number; age: number }> = [],
    smokes: { x: number; y: number; radius: number; age: number; durationMs?: number }[] = [],
    fires: { x: number; y: number; radius: number; age: number; durationMs: number }[] = [],
    currentServerTick: number = 0, // 新增: 当前服务器 tick（用于计算换弹进度）
    nearbyInteractable?: { type: 'worldItem' | 'lootBag' | 'extractZone'; name: string; distance: number } | null, // 新增: 附近可交互目标
    localPlayer?: PLAYER_STATE | null, // 新增: 本地玩家（用于计算相对位置）
    isLocalPlayerInBush: boolean = false, // 新增: 本地玩家是否在草丛内
    ais: any[] = [], // 新增: AI实体列表
    decoys: DECOY_STATE[] = [], // 新增: 诱饵列表
    turrets: TURRET_STATE[] = [], // 新增: 炮台列表
    zones: Zone[] = [] // 新增: 地图区域列表
  ): void {
    const t0 = performance.now();
    
    this.clear();

    // P0-3: 计算camera位置，让本地玩家显示在屏幕中心
    if (localPlayerId) {
      const localPlayer = players.find((p) => p.id === localPlayerId);
      if (localPlayer) {
        // camera位置 = 玩家世界坐标 - 屏幕中心偏移
        // 这样玩家就会显示在屏幕中心（screenX = player.x - camX = cssWidth/2）
        let targetCamX = localPlayer.x - this.cssWidth / 2;
        let targetCamY = localPlayer.y - this.cssHeight / 2;
        
        // P0-3 修复: Clamp camera 到世界边界（允许超出一定像素值，避免 DOM UI 挡住操作）
        if (this.worldWidth > 0 && this.worldHeight > 0) {
          // 允许相机位置超出边界 cameraOverflowPixels 像素
          // 这样当玩家在地图边缘时，屏幕可以超出地图一部分，避免 DOM UI 挡住操作
          targetCamX = Math.max(-this.cameraOverflowPixels, Math.min(targetCamX, this.worldWidth - this.cssWidth + this.cameraOverflowPixels));
          targetCamY = Math.max(-this.cameraOverflowPixels, Math.min(targetCamY, this.worldHeight - this.cssHeight + this.cameraOverflowPixels));
        }
        
        this.camX = targetCamX;
        this.camY = targetCamY;
      }
    }
    const shakeOffset = this.getShakeOffset();
    this.camX += shakeOffset.x;
    this.camY += shakeOffset.y;
    // 如果本地玩家不存在，camX/camY保持0（不移动camera）

    // 新增: 绘制地图背景和地板
    const a0 = performance.now();
    this.drawFloor(zones);
    const a1 = performance.now();

    // 新增: 绘制地图边界框（背景层之一）
    this.drawWorldBounds();

    // Day4-2: 绘制障碍物
    const b0 = performance.now();
    for (const obstacle of obstacles) {
      this.drawObstacle(obstacle);
    }
    const b1 = performance.now();

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

    const now = Date.now();
    let flashGrenadeDurationMs = 5000;
    try {
      const flashItem = getItemType('flash_grenade');
      const props = (flashItem as any).consumableProps;
      if (props && typeof props.flashDurationMs === 'number') {
        flashGrenadeDurationMs = props.flashDurationMs;
      }
    } catch {
      // fallback
    }

    // 绘制所有玩家（使用屏幕坐标）
    // 新增: 草丛/烟雾视野遮挡 - 只有在草丛/烟雾内的玩家才能看到其他在 *同一个* 草丛/烟雾内的玩家
    const localInBushId = localPlayer?.inBushId ?? null;
    const localInSmokeId = localPlayer?.inSmokeId ?? null;

    // 绘制诱饵
    // 性能优化: 复用 Set 对象
    this.currentDecoyIds.clear();
    for (const decoy of decoys) {
      this.currentDecoyIds.add(decoy.id);
      // 检查诱饵状态，检测受击
      let state = this.decoyStates.get(decoy.id);
      if (!state) {
        state = { lastHp: decoy.hp, glitchUntil: 0 };
        this.decoyStates.set(decoy.id, state);
      } else {
        if (decoy.hp < state.lastHp) {
          // 受到伤害，触发 Glitch 效果 (300ms)
          state.glitchUntil = now + 300;
        }
        state.lastHp = decoy.hp;
      }

      // 诱饵可见性规则：
      // 诱饵的目的是吸引注意力和迷惑敌人，所以应该几乎总是可见
      // 唯一例外：烟雾完全遮挡视线时（与玩家规则一致）
      // 注意：诱饵不受草丛影响，因为它们需要被看到才能起到诱骗作用
      const decoyInSmoke = decoy.inSmoke ?? false;
      const localInSmoke = localPlayer?.inSmoke ?? false;
      
      // 烟雾可见性规则：如果诱饵在烟雾内，或本地玩家在烟雾内，则不可见
      const isVisible = !decoyInSmoke && !localInSmoke;

      if (!isVisible) {
        continue; // 跳过被烟雾遮挡的诱饵
      }

      this.drawDecoy(decoy, decoy.ownerId === localPlayerId);
    }
    // 清理已销毁的诱饵状态
    for (const id of this.decoyStates.keys()) {
      if (!this.currentDecoyIds.has(id)) {
        this.decoyStates.delete(id);
      }
    }

    // 清理已离场玩家的拖影（不在 snapshot 里的玩家）
    // 性能优化: 复用 Set 对象
    this.activeIds.clear();
    for (const p of players) {
      this.activeIds.add(p.id);
    }
    for (const id of this.playerTrails.keys()) {
      if (!this.activeIds.has(id)) {
        this.playerTrails.delete(id);
        this.playerTrailStrength.delete(id);
      }
    }
    for (const id of this.playerLastSample.keys()) {
      if (!this.activeIds.has(id)) {
        this.playerLastSample.delete(id);
      }
    }

    const c0 = performance.now();
    for (const player of players) {
      const isLocal = player.id === localPlayerId;
      const playerInBush = player.inBush ?? false;
      const playerInSmoke = player.inSmoke ?? false;

      // 1. 本地玩家总是可见
      // 2. 烟雾完全遮挡：如果目标在烟雾内，或者本地玩家在烟雾内，则不可见（除自己外）
      // 3. 草丛遮挡：如果目标在草丛内，只有本地玩家也在同一个草丛内才可见
      const isVisible = isLocal || (
        !playerInSmoke && 
        !(localPlayer?.inSmoke ?? false) && 
        (!playerInBush || (player.inBushId !== null && player.inBushId === localInBushId))
      );

      if (isVisible) {
        // 使用“真正被画出来的位置”来判定速度：
        // - 对本地玩家，优先使用预测/平滑后的 localPlayer
        // - 其他玩家使用 snapshot/interpolated 的 player
        const visualPlayer = isLocal && localPlayer ? localPlayer : player;

        // 检测伪装破碎 (Disguise Fizzle)
        // 逻辑：如果上一帧在 disguisedPlayers 中，但当前 buff 中没有 disguise，则触发 Fizzle
        const wasDisguised = this.disguisedPlayers.has(visualPlayer.id);
        const isDisguised = visualPlayer.buffs?.some(b => b.kind === 'disguise') ?? false;
        
        if (wasDisguised && !isDisguised) {
          // 伪装刚刚失效，触发 Fizzle 特效
          this.fizzleEffects.push({
            x: visualPlayer.x,
            y: visualPlayer.y,
            until: now + 500, // 500ms 动画
            maxRadius: 35,
          });
        }
        
        // 更新状态
        if (isDisguised) {
          this.disguisedPlayers.add(visualPlayer.id);
        } else {
          this.disguisedPlayers.delete(visualPlayer.id);
        }

        // 判断该视觉位置下是否处于“高速”状态（>100% 基础速度）
        const isFast = this.isPlayerFast(visualPlayer);

        // 先更新拖影轨迹（基于视觉位置），再绘制拖影和主体
        this.updatePlayerTrail(visualPlayer, isFast);
        this.drawPlayerTrail(visualPlayer.id, isLocal);
        this.drawPlayer(visualPlayer, isLocal, currentServerTick, now, flashGrenadeDurationMs, isLocal ? isLocalPlayerInBush : undefined);
      }
    }
    const c1 = performance.now();
    
    // 新增: 绘制屏幕外玩家的箭头指引
    if (localPlayerId && localPlayer) {
      for (const player of players) {
        if (player.id !== localPlayerId && player.status === 'ALIVE') {
          const playerInBush = player.inBush ?? false;
  const playerInSmoke = player.inSmoke ?? false;
  const localInBushId = localPlayer.inBushId ?? null;
  const localInSmoke = localPlayer.inSmoke ?? false;

  const isVisible = 
    !playerInSmoke && 
    !localInSmoke &&
    (!playerInBush || (player.inBushId !== null && player.inBushId === localInBushId));
          if (isVisible) {
            this.drawOffscreenPlayerIndicator(localPlayer, player);
          }
        }
      }
    }

    // 近战挥击特效
    for (const swing of meleeSwings) {
      this.drawMeleeSwing(swing);
    }
    
    // 新增: 绘制AI实体（应用烟雾/闪光弹视野遮挡）
    for (const ai of ais) {
      if (ai.status !== 'ALIVE') continue;
      
      // AI视野遮挡逻辑（与玩家一致）：
      // 1. 如果本地玩家被闪光弹致盲，看不到任何AI
      // 2. 如果AI在草丛/烟雾内，只有本地玩家也在 *同一个* 草丛/烟雾内时才可见
      
      // 检查本地玩家是否被闪光弹致盲
      const isLocalFlashed = localPlayer?.isFlashed ?? false;
      if (isLocalFlashed) {
        continue;
      }
      
      const aiInBush = ai.inBush ?? false;
      const aiInSmoke = ai.inSmoke ?? false;
      
      // AI视野遮挡逻辑：烟雾全遮挡，草丛按ID匹配
      const isVisible = 
        !aiInSmoke && 
        !(localPlayer?.inSmoke ?? false) && 
        (!aiInBush || (ai.inBushId !== null && ai.inBushId === localInBushId));

      if (!isVisible) {
        continue;
      }
      
      // 绘制AI
      this.drawAI(ai, debug, currentServerTick);
    }

    // 新增: 绘制炮台（添加草丛和烟雾隐藏逻辑）
    for (const turret of turrets) {
        // 炮台视野遮挡逻辑（与AI相同）
        const turretInBush = (turret as any).inBush ?? false;
        const turretInSmoke = (turret as any).inSmoke ?? false;
        
        const isVisible = 
          !turretInSmoke && 
          !(localPlayer?.inSmoke ?? false) && 
          (!turretInBush || ((turret as any).inBushId !== null && (turret as any).inBushId === localInBushId));

        if (!isVisible) {
          continue;
        }
        
        this.drawTurret(turret, localPlayerId);
    }

    // Day2: 绘制所有子弹
    const d0 = performance.now();
    for (const bullet of bullets) {
      this.drawBullet(bullet);
    }
    const d1 = performance.now();

    // 爆炸特效（真实半径）
    for (const explosion of explosionEffects) {
      this.drawExplosionEffect(explosion);
    }

    // 新增: 烟雾特效（持续白色大圆）
    for (const smoke of smokes) {
      this.drawSmoke(smoke);
    }

    // 新增: 燃烧特效
    for (const fire of fires) {
      this.drawFire(fire);
    }

    // 绘制命中特效（简易闪光）
    for (const effect of hitEffects) {
      this.drawHitEffect(effect);
    }

    // 绘制 Disguise Fizzle 特效 (Holographic glitch/fade out)
    // 渲染在玩家之上
    this.fizzleEffects = this.fizzleEffects.filter(eff => eff.until > now);
    for (const eff of this.fizzleEffects) {
      this.drawFizzleEffect(eff, now);
    }

    // 新增: 绘制物品信息提示框（当接近物品时）
    if (nearbyInteractable && localPlayer) {
      const INTERACT_DISTANCE = 40;
      if (nearbyInteractable.type === 'worldItem') {
        // 找到距离最近的世界物品（在交互范围内）
        let nearestItem: WorldItem | null = null;
        let minDist = INTERACT_DISTANCE;
        for (const item of worldItems) {
          const dist = Math.hypot(item.x - localPlayer.x, item.y - localPlayer.y);
          if (dist < minDist) {
            minDist = dist;
            nearestItem = item;
          }
        }
        if (nearestItem && Math.abs(minDist - nearbyInteractable.distance) < 2) {
          this.drawItemInfoTooltip(
            nearestItem.x,
            nearestItem.y,
            { type: 'worldItem', worldItem: nearestItem },
            localPlayer.x,
            localPlayer.y
          );
        }
      } else if (nearbyInteractable.type === 'lootBag') {
        // 找到距离最近的掉落包（在交互范围内）
        let nearestBag: LootBag | null = null;
        let minDist = INTERACT_DISTANCE;
        for (const bag of lootBags) {
          const dist = Math.hypot(bag.x - localPlayer.x, bag.y - localPlayer.y);
          if (dist < minDist) {
            minDist = dist;
            nearestBag = bag;
          }
        }
        if (nearestBag && Math.abs(minDist - nearbyInteractable.distance) < 2) {
          this.drawItemInfoTooltip(
            nearestBag.x,
            nearestBag.y,
            { type: 'lootBag', lootBag: nearestBag },
            localPlayer.x,
            localPlayer.y
          );
        }
      }
    }

    // Debug模式：显示本地玩家坐标文本（使用屏幕坐标，固定在左上角）
    if (debug && localPlayerId) {
      const debugLocalPlayer = players.find((p) => p.id === localPlayerId);
      if (debugLocalPlayer) {
        this.ctx.fillStyle = '#fff';
        this.ctx.font = '12px monospace';
        // 使用屏幕坐标绘制，固定在左上角（10, 20）
        this.ctx.fillText(
          `Local: (${debugLocalPlayer.x.toFixed(1)}, ${debugLocalPlayer.y.toFixed(1)})`,
          10,
          20
        );
      }
    }


    for (const p of players) {
      if (p.status === 'DEAD' || p.status === 'EXTRACTED') continue;

      const isLocal = p.id === localPlayerId;
      const visualPlayer = isLocal && localPlayer ? localPlayer : p;
      
      // 检查可见性（与玩家渲染逻辑一致）
        const playerInBush = p.inBush ?? false;
        const playerInSmoke = p.inSmoke ?? false;
        
        // 可见性判定：烟雾全遮挡，草丛按ID匹配
        const isVisible = (p.id === localPlayerId) || (
          !playerInSmoke && 
          !(localPlayer?.inSmoke ?? false) && 
          (!playerInBush || (p.inBushId !== null && p.inBushId === localInBushId))
        );
      if (!isLocal && !isVisible) continue;

      let statusIndex = 0;

      // 修复：状态标识需要严格遵循可见性规则（包括本地玩家自己）
      // 烟雾中的任何玩家（包括自己）都不应该显示状态标识
      // 只有在没有烟雾遮挡的情况下才显示状态标识
      const shouldShowStatus = !playerInSmoke && !(localPlayer?.inSmoke ?? false) && 
        (!playerInBush || (p.inBushId !== null && p.inBushId === localInBushId));
      
      if (shouldShowStatus) {
        // 1. 隐蔽状态
        // 本地玩家使用 isLocalPlayerInBush 标志（预测），其他玩家使用 snapshot 同步的 inBush
        const inBush = isLocal ? isLocalPlayerInBush : p.inBush;
        if (inBush) {
          this.drawConcealmentIndicator(visualPlayer.x, visualPlayer.y, statusIndex++);
        }

        // 2. 致盲状态
        if ((p as any).isFlashed) {
          const flashEndTime = (p as any).flashEndTime ?? 0;
          const remainingMs = Math.max(0, flashEndTime - now);
          const progress = remainingMs / flashGrenadeDurationMs;
          this.drawFlashIndicator(visualPlayer.x, visualPlayer.y, progress, statusIndex++);
        }

        // 3. 眩晕状态
        if ((p as any).isStunned) {
          const stunnedEndTime = (p as any).stunnedEndTime ?? 0;
          const remainingMs = Math.max(0, stunnedEndTime - now);
          const progress = remainingMs / 3000; // 3秒眩晕时长
          this.drawStunIndicator(visualPlayer.x, visualPlayer.y, progress, statusIndex++);
        }

        // 4. 正在使用物品 (治疗中)
        if (
          p.usingItemTypeId &&
          p.usingItemRemainingMs !== undefined &&
          p.usingItemTotalMs !== undefined &&
          p.usingItemTotalMs > 0
        ) {
          const usedMs = p.usingItemTotalMs - p.usingItemRemainingMs;
          const progress = Math.max(0, Math.min(1, usedMs / p.usingItemTotalMs));
          
          // 只有医疗包显示"治疗中"，其他物品显示原本的名字
          const isHealing = p.usingItemTypeId === 'medkit' || p.usingItemTypeId === 'advanced_medkit';
          const statusText = isHealing ? '💊 治疗中' : `📦 ${p.usingItemTypeId}`;
          const color = isHealing ? '#2ECC71' : '#F1C40F';

          this.drawStatusIndicator(visualPlayer.x, visualPlayer.y, statusText, progress, color, statusIndex++);
        }
      }
    }

    // 绘制 AI 状态指示器
    for (const ai of ais) {
      if (ai.status !== 'ALIVE') continue;
      
      // AI 也需要基本的可见性检查（被闪光弹致盲时看不见 AI）
      if (localPlayer?.isFlashed) continue;
      
      let statusIndex = 0;
      
      // 1. 致盲状态
      if ((ai as any).isFlashed) {
        const flashEndTime = (ai as any).flashEndTime ?? 0;
        const remainingMs = Math.max(0, flashEndTime - now);
        const progress = remainingMs / flashGrenadeDurationMs;
        this.drawFlashIndicator(ai.x, ai.y, progress, statusIndex++);
      }
      
      // 2. 眩晕状态
      if ((ai as any).isStunned) {
        const stunnedEndTime = (ai as any).stunnedEndTime ?? 0;
        const remainingMs = Math.max(0, stunnedEndTime - now);
        const progress = remainingMs / 3000; // 3秒眩晕时长
        this.drawStunIndicator(ai.x, ai.y, progress, statusIndex++);
      }
    }
    
    // 新增: 烟雾覆盖过渡动画
    const nowMs = performance.now();
    const inSmoke = localPlayer?.inSmoke ?? false;
    
    // 更新目标alpha
    this.smokeOverlayTargetAlpha = inSmoke ? 1 : 0;
    
    // 平滑过渡当前alpha到目标alpha
    const alphaDiff = this.smokeOverlayTargetAlpha - this.smokeOverlayAlpha;
    if (Math.abs(alphaDiff) > 0.001) {
      // 使用线性插值，每帧根据时间增量调整alpha
      const deltaAlphaPerMs = 1 / this.SMOKE_TRANSITION_MS; // 每毫秒的alpha变化量
      const maxDelta = deltaAlphaPerMs * 16.67; // 假设60fps，约16.67ms一帧
      const delta = Math.sign(alphaDiff) * Math.min(Math.abs(alphaDiff), maxDelta);
      this.smokeOverlayAlpha = Math.max(0, Math.min(1, this.smokeOverlayAlpha + delta));
    } else {
      this.smokeOverlayAlpha = this.smokeOverlayTargetAlpha;
    }
    
    // 如果有alpha，绘制烟雾覆盖
    const e0 = performance.now();
    if (this.smokeOverlayAlpha > 0 && localPlayer) {
      // 找到玩家所在的烟雾，获取其中心位置
      let smokeCenterX = localPlayer.x; // 默认使用玩家位置
      let smokeCenterY = localPlayer.y;
      
      if (inSmoke) {
        for (const smoke of smokes) {
          const dx = localPlayer.x - smoke.x;
          const dy = localPlayer.y - smoke.y;
          const distSq = dx * dx + dy * dy;
          if (distSq <= smoke.radius * smoke.radius) {
            // 找到玩家所在的烟雾
            smokeCenterX = smoke.x;
            smokeCenterY = smoke.y;
            break;
          }
        }
      }
      
      this.drawFullScreenSmokeOverlay(smokeCenterX, smokeCenterY, this.smokeOverlayAlpha);
    }
    const e1 = performance.now();

    // 性能测量输出（已禁用以提升性能）
    if (false && debug) {
      console.log({
        floor: (a1 - a0).toFixed(2),
        obstacles: (b1 - b0).toFixed(2),
        players: (c1 - c0).toFixed(2),
        bullets: (d1 - d0).toFixed(2),
        smokeOverlay: (e1 - e0).toFixed(2),
        total: (performance.now() - t0).toFixed(2),
        bulletsCount: bullets.length,
        obstaclesCount: obstacles.length,
        playersCount: players.length,
      });
    }
  }

  // P0-3 修复: 设置世界边界（用于 camera clamp）
  setWorldBounds(width: number, height: number): void {
    this.worldWidth = width;
    this.worldHeight = height;
  }
  
  // 新增: 设置相机超出地图边界的像素值（用于避免 DOM UI 挡住操作）
  setCameraOverflowPixels(pixels: number): void {
    this.cameraOverflowPixels = Math.max(0, pixels); // 确保不为负数
  }
  
  // 新增: 获取当前相机超出地图边界的像素值
  getCameraOverflowPixels(): number {
    return this.cameraOverflowPixels;
  }

  // Resize方法：由外部调用，负责所有canvas尺寸和transform设置
  // 单一真相：所有resize逻辑都在这里，不再有内部自动resize
  // P2 优化: 在 resize 时缓存 rect，避免每帧 getBoundingClientRect()
  // 性能优化: 限制 DPR 和渲染分辨率，避免大窗口时像素数爆炸
  resize(cssWidth: number, cssHeight: number): void {
    this.cssWidth = cssWidth;
    this.cssHeight = cssHeight;
    
    const rawDpr = window.devicePixelRatio || 1;
    const dpr = Math.min(rawDpr, this.maxDpr);
    const scale = dpr * this.renderScale;
    
    // 设置CSS显示尺寸
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;

    // 设置实际渲染尺寸（backing store）- 使用 scale 而非 rawDpr
    this.canvas.width = Math.max(1, Math.floor(cssWidth * scale));
    this.canvas.height = Math.max(1, Math.floor(cssHeight * scale));

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
    this.ctx.setTransform(scale, 0, 0, scale, 0, 0);
    this.scale = scale;
    
    // 像素风：关掉平滑（更清晰，也更省一点点）
    this.ctx.imageSmoothingEnabled = false;
    
    // P2 优化: 缓存 canvas rect（resize 时更新，避免每帧读取 DOM）
    this.refreshRect();
  }
  
  /**
   * 性能优化: 设置画质控制参数
   * @param opts.maxDpr - 限制 DPR 上限（推荐 1.25~1.75）
   * @param opts.renderScale - 额外分辨率缩放（推荐 0.6~1）
   */
  setQuality(opts: { maxDpr?: number; renderScale?: number }): void {
    if (opts.maxDpr !== undefined) this.maxDpr = Math.max(1, opts.maxDpr);
    if (opts.renderScale !== undefined) this.renderScale = Math.max(0.5, Math.min(1, opts.renderScale));
    // 注意：这里不主动 resize，因为外部已有统一 resize 调用点
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
