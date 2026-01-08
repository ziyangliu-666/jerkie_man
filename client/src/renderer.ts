import type { PLAYER_STATE, BULLET_STATE, ITEM_STATE, OBSTACLE_STATE, WorldItem, LootBag, DECOY_STATE } from '@jerkie-man/shared';
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

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
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
  drawPlayer(player: PLAYER_STATE, isLocal: boolean = false, currentServerTick?: number): void {
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
      const now = Date.now();
      const endTime = player.flashEndTime ?? 0;
      const remainingMs = Math.max(0, endTime - now);
      // 默认3000ms，或者需要从配置获取。这里简单处理，如果 remainingMs 很大则 progress=1
      // 为了平滑显示，我们需要总时长。Snapshot里没有总时长，只给了结束时间。
      // 近似处理：如果剩余时间大于3秒，认为刚开始。或者只显示剩余时间的比例（假设最大5秒）
      // 实际上 drawFlashIndicator 的 progress 参数主要用于显示进度条长度。
      // 我们可以简单地让进度条随时间缩短。假设最大时长 5000ms。
      const totalMs = 5000; 
      const progress = Math.min(1, Math.max(0, remainingMs / totalMs));
      
      this.drawFlashIndicator(player.x, player.y, progress, indicatorIndex++);
    }

    // 2. 隐蔽状态 (inBush) - 只有当玩家在草丛且对本地玩家可见时（例如队友或自己在草丛）
    // 注意：如果隐蔽了通常渲染为草丛(isDisguised logic above covers 'disguise' buff). 
    // 这里指普通的"进入草丛"状态.
    // 如果玩家在草丛中，显示隐蔽标签
    if (player.inBush) {
      this.drawConcealmentIndicator(player.x, player.y, indicatorIndex++);
    }

    // 3. 其他 Buffs
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
        // 状态标签在 stateLabelY（屏幕坐标），进度条应该在状态标签下方适当间距
        const progressBarScreenY = stateLabelY + 25; // 状态标签下方25px（适当间距）
        
        this.ctx.save();
        this.ctx.font = 'bold 12px monospace';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        
        const text = '🌿 伪装';
        const metrics = this.ctx.measureText(text);
        const textWidth = metrics.width;
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

      const metrics = this.ctx.measureText(stateText);
      const textWidth = metrics.width;
      const padding = 6;
      const boxWidth = textWidth + padding * 2;
      const boxHeight = 20;
      const textY = screenY + size / 2 + 15;

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
    return screenY + size / 2 + 15;
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
      this.ctx.restore();
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

    // 对全部拖影点做 alpha 衰减，并过滤掉几乎不可见的点
    // 降低衰减速度（0.88 替代 0.82），让拖影保留更久
    trail = trail
      .map((p) => ({ ...p, alpha: p.alpha * 0.88 }))
      .filter((p) => p.alpha > 0.02); // 降低过滤阈值，让更淡的点也能显示

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
   */
  private drawPlayerTrail(playerId: string, isLocal: boolean): void {
    const trail = this.playerTrails.get(playerId);
    if (!trail || trail.length === 0) return;

    const size = 20;
    const baseColor = isLocal ? { r: 0, g: 170, b: 255 } : { r: 255, g: 68, b: 68 };

    for (const point of trail) {
      const screenX = Math.round(point.x - this.camX);
      const screenY = Math.round(point.y - this.camY);

      this.ctx.fillStyle = `rgba(${baseColor.r}, ${baseColor.g}, ${baseColor.b}, ${point.alpha})`;
      this.ctx.fillRect(screenX - size / 2, screenY - size / 2, size, size);
    }
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

        const metrics = this.ctx.measureText(stateText);
        const textWidth = metrics.width;
        const padding = 6;
        const boxWidth = textWidth + padding * 2;
        const boxHeight = 20;
        const textY = screenY + size / 2 + 15; // AI下方15px

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

    // Debug模式：显示原始状态名称
    if (debug && ai.behaviorState) {
      this.ctx.font = '9px monospace';
      this.ctx.fillStyle = '#0ff';
      this.ctx.textAlign = 'center';
      this.ctx.fillText(`[${ai.behaviorState}]`, screenX, screenY - size / 2 - 28);
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
  drawBullet(bullet: BULLET_STATE): void {
    // 修复: 不 round，允许 subpixel 绘制（子弹是小圆点，用 subpixel 更丝滑）
    const screenX = bullet.x - this.camX;
    const screenY = bullet.y - this.camY;

    // 检查是否是手雷/榴弹（包括榴弹炮的子弹和投掷手雷）
    const isGrenade = bullet.weaponTypeId === 'w_grenade_launcher' || bullet.weaponTypeId === 'frag_grenade' || bullet.weaponTypeId === 'smoke_grenade';


    if (isGrenade) {
      // 手雷：更大、更明显，使用橙红色渐变
      const grenadeRadius = 8; // 比普通子弹大很多

      // 绘制外圈（深橙色）
      this.ctx.fillStyle = '#ff4500';
      this.ctx.beginPath();
      this.ctx.arc(screenX, screenY, grenadeRadius, 0, Math.PI * 2);
      this.ctx.fill();

      // 绘制内圈（亮橙色）
      this.ctx.fillStyle = '#ff8c00';
      this.ctx.beginPath();
      this.ctx.arc(screenX, screenY, grenadeRadius * 0.6, 0, Math.PI * 2);
      this.ctx.fill();

      // 绘制中心高光（黄色）
      this.ctx.fillStyle = '#ffff00';
      this.ctx.beginPath();
      this.ctx.arc(screenX, screenY, grenadeRadius * 0.3, 0, Math.PI * 2);
      this.ctx.fill();

      // 绘制边框（黑色，增加辨识度）
      this.ctx.strokeStyle = '#000000';
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.arc(screenX, screenY, grenadeRadius, 0, Math.PI * 2);
      this.ctx.stroke();
    } else if (bullet.weaponTypeId === 'w_bubble_gun') {
      // 泡泡枪：绘制泡泡效果
      const bubbleRadius = 6;
      
      // 泡泡本体（半透明青色）
      this.ctx.fillStyle = 'rgba(135, 206, 250, 0.4)'; // LightSkyBlue translucent
      this.ctx.beginPath();
      this.ctx.arc(screenX, screenY, bubbleRadius, 0, Math.PI * 2);
      this.ctx.fill();
      
      // 泡泡边缘（较不透明青色）
      this.ctx.strokeStyle = 'rgba(135, 206, 250, 0.8)';
      this.ctx.lineWidth = 1;
      this.ctx.stroke();
      
      // 高光（白色反光，增加立体感）
      this.ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      this.ctx.beginPath();
      // 高光位置在左上侧
      this.ctx.arc(screenX - bubbleRadius * 0.3, screenY - bubbleRadius * 0.3, bubbleRadius * 0.25, 0, Math.PI * 2);
      this.ctx.fill();
    } else {
      // 普通子弹：小黄色圆点
      this.ctx.fillStyle = '#ffff00'; // 黄色
      this.ctx.beginPath();
      this.ctx.arc(screenX, screenY, 3, 0, Math.PI * 2);
      this.ctx.fill();
    }
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
  private drawFullScreenSmokeOverlay(smokeCenterX: number, smokeCenterY: number, alpha: number): void {
    // 绘制全屏深色烟雾覆盖层（护眼黑色系），带透明度过渡
    if (alpha <= 0) return; // 完全透明时不绘制
    
    this.ctx.save();
    
    // 使用径向渐变，中心对齐到烟雾弹位置（世界坐标转屏幕坐标）
    const screenCenterX = smokeCenterX - this.camX;
    const screenCenterY = smokeCenterY - this.camY;
    const radius = Math.max(this.cssWidth, this.cssHeight) * 0.6;
    
    const gradient = this.ctx.createRadialGradient(screenCenterX, screenCenterY, 0, screenCenterX, screenCenterY, radius);
    gradient.addColorStop(0, `rgba(60, 60, 60, ${0.93 * alpha})`); // 中心深灰色，更不透明 93%
    gradient.addColorStop(0.4, `rgba(35, 35, 35, ${0.97 * alpha})`); // 中间区域更深更不透明 97%
    gradient.addColorStop(1, `rgba(15, 15, 15, ${0.99 * alpha})`); // 边缘接近完全黑 99%
    
    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);
    
    // 添加烟雾噪点效果（深色系），也应用过渡alpha
    this.ctx.globalAlpha = 0.08 * alpha;
    for (let i = 0; i < 60; i++) {
      const x = Math.random() * this.cssWidth;
      const y = Math.random() * this.cssHeight;
      const size = Math.random() * 3 + 1;
      this.ctx.fillStyle = Math.random() > 0.5 ? 'rgba(70, 70, 70, 0.15)' : 'rgba(25, 25, 25, 0.25)';
      this.ctx.fillRect(x, y, size, size);
    }
    
    this.ctx.restore();
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
    const now = Date.now();
    
    let color = '#00ff00';
    try {
      const itemType = getItemType(worldItem.typeId);
      if (itemType.rarity === 'RARE') color = '#0088ff';
      else if (itemType.rarity === 'EPIC') color = '#9d4edd';
    } catch {}

    this.ctx.save();
    
    // 浮动效果
    const floatOffset = Math.sin(now / 400) * 3;
    const finalY = screenY + floatOffset;

    // 绘制底部光晕
    const glow = this.ctx.createRadialGradient(screenX, finalY, 0, screenX, finalY, size * 1.5);
    glow.addColorStop(0, `${color}66`); // 40% alpha
    glow.addColorStop(1, `${color}00`); // transparent
    this.ctx.fillStyle = glow;
    this.ctx.beginPath();
    this.ctx.arc(screenX, finalY, size * 1.5, 0, Math.PI * 2);
    this.ctx.fill();

    // 绘制物品主体 (菱形旋转)
    this.ctx.translate(screenX, finalY);
    this.ctx.rotate(Math.PI / 4); // 旋转45度成菱形
    
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
        lines.push({ text: `${itemType.name} x${itemInfo.worldItem.qty} ($${itemValue})`, color: '#ffffff' });
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
            lines.push({ text: `${itemType.name} x${item.qty}`, color: '#ffffff' });
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

  // 新增: 绘制地图背景（地板、网格、灰尘等）
  private drawFloor(): void {
    if (this.worldWidth <= 0 || this.worldHeight <= 0) return;

    this.ctx.save();
    
    // 基础颜色 (深灰褐色，比单纯的 #2a2a2a 更有质感)
    this.ctx.fillStyle = '#222222';
    const floorX = Math.round(0 - this.camX);
    const floorY = Math.round(0 - this.camY);
    this.ctx.fillRect(floorX, floorY, this.worldWidth, this.worldHeight);

    // 绘制网格 (暗色细线)
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
  drawObstacle(obstacle: OBSTACLE_STATE): void {
    // 修复: round 到整数像素，避免子像素抗锯齿导致的重影
    const screenX = Math.round(obstacle.x - this.camX);
    const screenY = Math.round(obstacle.y - this.camY);

    const obsType = (obstacle as any).type || 'wall';
    const obsHp = (obstacle as any).hp;
    const obsMaxHp = (obstacle as any).maxHp;

    // 使用障碍物ID或位置作为种子
    const seedStr = obstacle.id || `${obstacle.x}_${obstacle.y}`;
    const seed = seedStr.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);

    this.ctx.save();
    
    // 添加阴影效果 (提升边缘美感)
    if (obsType !== 'water' && obsType !== 'bush') {
        this.ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
        this.ctx.shadowBlur = 8;
        this.ctx.shadowOffsetY = 4;
    }

    // 根据类型调用增强版绘制函数
    switch (obsType) {
      case 'wall':
        this.drawWall(screenX, screenY, obstacle.w, obstacle.h, seed);
        break;
      case 'crate':
        this.drawCrateImprove(screenX, screenY, obstacle.w, obstacle.h, seed);
        break;
      case 'bush':
        this.drawBushImprove(screenX, screenY, obstacle.w, obstacle.h, seed);
        break;
      case 'water':
        this.drawWaterImprove(screenX, screenY, obstacle.w, obstacle.h, seed);
        break;
      default:
        // 后备渲染
        this.ctx.fillStyle = '#666';
        this.ctx.fillRect(screenX, screenY, obstacle.w, obstacle.h);
        this.ctx.strokeStyle = '#333';
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(screenX, screenY, obstacle.w, obstacle.h);
    }
    
    this.ctx.restore();

    // 绘制破损裂痕（仅对可破坏物体）- 辐射状裂痕
    if (obsHp !== undefined && obsMaxHp !== undefined && obsMaxHp > 0) {
      const hpRatio = obsHp / obsMaxHp;
      
      // 根据破损程度决定裂痕数量
      let crackCount = 0;
      if (hpRatio < 0.3) {
        crackCount = 8; // 严重损坏：8条裂痕
      } else if (hpRatio < 0.6) {
        crackCount = 5; // 中度损坏：5条裂痕
      } else if (hpRatio < 0.9) {
        crackCount = 3; // 轻微损坏：3条裂痕
      }

      if (crackCount > 0) {
        // 裂痕中心点（略微偏移，但保持在物体内）
        const centerX = screenX + obstacle.w / 2 + ((seed % 20) - 10);
        const centerY = screenY + obstacle.h / 2 + (((seed * 7) % 20) - 10);
        
        this.ctx.save();
        // 裁剪区域，确保裂痕不超出物体边界
        this.ctx.beginPath();
        this.ctx.rect(screenX, screenY, obstacle.w, obstacle.h);
        this.ctx.clip();
        
        this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
        this.ctx.lineWidth = 1.8;
        this.ctx.lineCap = 'round';
        
        for (let i = 0; i < crackCount; i++) {
          // 计算裂痕方向（辐射状）
          const angle = ((seed + i * 137) % 360) * Math.PI / 180; // 黄金角度分布
          
          // 计算射线与物边界的交点（延伸到边缘）
          const dx = Math.cos(angle);
          const dy = Math.sin(angle);
          
          let tMax = Infinity;
          if (dx > 0) tMax = Math.min(tMax, (screenX + obstacle.w - centerX) / dx);
          if (dx < 0) tMax = Math.min(tMax, (screenX - centerX) / dx);
          if (dy > 0) tMax = Math.min(tMax, (screenY + obstacle.h - centerY) / dy);
          if (dy < 0) tMax = Math.min(tMax, (screenY - centerY) / dy);
          
          this.ctx.beginPath();
          this.ctx.moveTo(centerX, centerY);
          this.ctx.lineTo(centerX + dx * tMax, centerY + dy * tMax);
          this.ctx.stroke();
        }
        
        this.ctx.restore();
      }
    }
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

    const metrics = this.ctx.measureText(text);
    const textWidth = metrics.width;
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
    smokes: Array<{ x: number; y: number; radius: number; age: number }> = [],
    currentServerTick?: number, // 新增: 当前服务器 tick（用于计算换弹进度）
    nearbyInteractable?: { type: 'worldItem' | 'lootBag' | 'extractZone'; name: string; distance: number } | null, // 新增: 附近可交互目标
    localPlayer?: PLAYER_STATE | null, // 新增: 本地玩家（用于计算相对位置）
    isLocalPlayerInBush: boolean = false, // 新增: 本地玩家是否在草丛内
    ais: any[] = [], // 新增: AI实体列表
    decoys: DECOY_STATE[] = [] // 新增: 诱饵列表
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
    this.drawFloor();

    // 新增: 绘制地图边界框（背景层之一）
    this.drawWorldBounds();

    // Day4-2: 绘制障碍物
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
    const currentDecoyIds = new Set<string>();
    for (const decoy of decoys) {
      currentDecoyIds.add(decoy.id);
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
      if (!currentDecoyIds.has(id)) {
        this.decoyStates.delete(id);
      }
    }

    // 清理已离场玩家的拖影（不在 snapshot 里的玩家）
    const activeIds = new Set(players.map((p) => p.id));
    for (const id of this.playerTrails.keys()) {
      if (!activeIds.has(id)) {
        this.playerTrails.delete(id);
        this.playerTrailStrength.delete(id);
      }
    }
    for (const id of this.playerLastSample.keys()) {
      if (!activeIds.has(id)) {
        this.playerLastSample.delete(id);
      }
    }

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
        this.drawPlayer(visualPlayer, isLocal, currentServerTick);
      }
    }
    
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

    // Day2: 绘制所有子弹
    for (const bullet of bullets) {
      this.drawBullet(bullet);
    }

    // 爆炸特效（真实半径）
    for (const explosion of explosionEffects) {
      this.drawExplosionEffect(explosion);
    }

    // 新增: 烟雾特效（持续白色大圆）
    for (const smoke of smokes) {
      this.drawSmoke(smoke);
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
          console.log('[Stun Debug] Drawing stun indicator:', { playerId: p.id, isStunned: (p as any).isStunned, stunnedEndTime, remainingMs, progress });
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
