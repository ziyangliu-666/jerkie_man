/**
 * UIOverlay - 屏幕固定 HUD 层（Layer 1: UI Canvas）
 * 
 * 用于绘制"高频 + 屏幕固定"的 HUD 元素：
 * - 受伤红边 vignette、闪白
 * - 命中标记
 * - 撤离进度环
 * 
 * 设计原则：
 * - 每帧更新（快路径），不走 DOM
 * - 使用屏幕坐标（不跟随 camera）
 * - pointer-events: none（永不接鼠标）
 */

export interface UIOverlayState {
  // 受伤效果
  damage: {
    alpha: number; // 0~1，红边透明度（逐渐消失）
    direction?: number; // 可选：被打方向（弧度），用于显示方向指示
  };
  
  // 命中反馈
  hitMarker: {
    alpha: number; // 0~1，命中标记透明度（逐渐消失）
  };
  
  // 撤离进度
  extractProgress: {
    enabled: boolean;
    progress: number; // 0~1
  };
  
  // 武器状态（新增）
  weaponStatus: {
    enabled: boolean;
    weaponName: string;
    ammoInMag: number;
    magSize: number;
    reloading: boolean;
    reloadProgress: number; // 0~1（换弹进度）
  };
  
  // 文本提示（新增）
  textHint: {
    alpha: number; // 0~1，文本透明度（逐渐消失）
    text: string; // 提示文本
    color?: string; // 可选：文本颜色，默认为白色
  };

  // 闪光弹效果（新增）
  flash: {
    enabled: boolean; // 是否被闪
    progress: number; // 0~1，剩余致盲时间百分比
  };
}

export class UIOverlay {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private scale: number = 1;
  private cssWidth: number = 0;
  private cssHeight: number = 0;
  
  // UI 状态（外部更新，每帧读取绘制）
  private state: UIOverlayState = {
    damage: { alpha: 0 },
    hitMarker: { alpha: 0 },
    extractProgress: { enabled: false, progress: 0 },
    weaponStatus: { enabled: false, weaponName: '', ammoInMag: 0, magSize: 0, reloading: false, reloadProgress: 0 },
    textHint: { alpha: 0, text: '', color: undefined },
    flash: { enabled: false, progress: 0 },
  };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2d context for UI overlay');
    }
    this.ctx = ctx;
  }

  /**
   * 更新 UI 状态（由外部调用，每帧或事件驱动）
   */
  updateState(partial: Partial<UIOverlayState>): void {
    if (partial.damage) {
      Object.assign(this.state.damage, partial.damage);
    }
    if (partial.hitMarker) {
      Object.assign(this.state.hitMarker, partial.hitMarker);
    }
    if (partial.extractProgress) {
      Object.assign(this.state.extractProgress, partial.extractProgress);
    }
    if (partial.weaponStatus) {
      Object.assign(this.state.weaponStatus, partial.weaponStatus);
    }
    if (partial.textHint) {
      Object.assign(this.state.textHint, partial.textHint);
    }
    if (partial.flash) {
      Object.assign(this.state.flash, partial.flash);
    }
  }

  /**
   * 设置受伤效果（闪一下红边）
   */
  triggerDamage(direction?: number): void {
    this.state.damage.alpha = 1.0;
    this.state.damage.direction = direction;
  }

  /**
   * 设置命中反馈（闪一下命中标记）
   */
  triggerHitMarker(): void {
    this.state.hitMarker.alpha = 1.0;
  }

  /**
   * 显示文本提示（屏幕中央）
   */
  showText(text: string, color?: string): void {
    this.state.textHint.alpha = 1.0;
    this.state.textHint.text = text;
    this.state.textHint.color = color;
  }

  /**
   * 每帧更新（衰减动画）
   */
  update(dtSec: number): void {
    // 受伤效果衰减
    if (this.state.damage.alpha > 0) {
      this.state.damage.alpha = Math.max(0, this.state.damage.alpha - dtSec * 3);
    }
    
    // 命中标记衰减
    if (this.state.hitMarker.alpha > 0) {
      this.state.hitMarker.alpha = Math.max(0, this.state.hitMarker.alpha - dtSec * 5);
    }
    
    // 文本提示衰减
    if (this.state.textHint.alpha > 0) {
      this.state.textHint.alpha = Math.max(0, this.state.textHint.alpha - dtSec * 1);
    }
  }

  /**
   * 绘制所有 UI 元素（每帧调用）
   */
  draw(): void {
    const ctx = this.ctx;
    const w = this.cssWidth;
    const h = this.cssHeight;
    const cx = w / 2;
    const cy = h / 2;

    // 清空画布
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.restore();

    // 1. 受伤红边 vignette
    if (this.state.damage.alpha > 0) {
      this.drawDamageVignette(ctx, w, h, this.state.damage.alpha);
    }

    // 2. 命中标记
    if (this.state.hitMarker.alpha > 0) {
      this.drawHitMarker(ctx, cx, cy, this.state.hitMarker.alpha);
    }

    // 3. 撤离进度环
    if (this.state.extractProgress.enabled) {
      this.drawExtractProgress(ctx, cx, cy, this.state.extractProgress.progress);
    }
    
    // 4. 武器状态（左下角）- 已禁用
    // if (this.state.weaponStatus.enabled) {
    //   this.drawWeaponStatus(ctx, w, h, this.state.weaponStatus);
    // }
    
    // 5. 文本提示（屏幕中央）
    if (this.state.textHint.alpha > 0 && this.state.textHint.text) {
      this.drawTextHint(ctx, cx, cy, this.state.textHint.text, this.state.textHint.alpha, this.state.textHint.color);
    }

    // 6. 闪光弹效果（全屏偏灰白色 + 中央进度条）
    if (this.state.flash.enabled) {
      this.drawFlashEffect(ctx, w, h, cx, cy, this.state.flash.progress);
    }
  }

  /**
   * 绘制受伤红边 vignette
   */
  private drawDamageVignette(ctx: CanvasRenderingContext2D, w: number, h: number, alpha: number): void {
    const gradient = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.8);
    gradient.addColorStop(0, 'rgba(255, 0, 0, 0)');
    gradient.addColorStop(1, `rgba(200, 0, 0, ${alpha * 0.5})`);

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  }

  /**
   * 绘制命中标记（X 形状）
   */
  private drawHitMarker(ctx: CanvasRenderingContext2D, cx: number, cy: number, alpha: number): void {
    const size = 10;

    ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';

    ctx.beginPath();
    ctx.moveTo(cx - size, cy - size);
    ctx.lineTo(cx - size / 2, cy - size / 2);
    ctx.moveTo(cx + size, cy - size);
    ctx.lineTo(cx + size / 2, cy - size / 2);
    ctx.moveTo(cx - size, cy + size);
    ctx.lineTo(cx - size / 2, cy + size / 2);
    ctx.moveTo(cx + size, cy + size);
    ctx.lineTo(cx + size / 2, cy + size / 2);
    ctx.stroke();
  }

  /**
   * 绘制撤离进度条（重新设计：顶部水平进度条）
   */
  private drawExtractProgress(ctx: CanvasRenderingContext2D, cx: number, cy: number, progress: number): void {
    const w = this.cssWidth;
    const h = this.cssHeight;
    
    // 进度条位置：屏幕顶部中央
    const barWidth = 400;
    const barHeight = 8;
    const barPadding = 4;
    const totalHeight = 60; // 总高度（包括文字和间距）
    const topMargin = 80;
    
    const barX = cx - barWidth / 2;
    const barY = topMargin;
    
    // 绘制背景模糊效果（增强可见性）
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#000000';
    ctx.fillRect(barX - 20, barY - 35, barWidth + 40, totalHeight);
    ctx.restore();
    
    // 绘制外框（带圆角效果）
    ctx.save();
    ctx.fillStyle = 'rgba(40, 40, 40, 0.9)';
    ctx.strokeStyle = 'rgba(150, 150, 150, 0.6)';
    ctx.lineWidth = 2;
    
    // 绘制圆角矩形背景
    const cornerRadius = 4;
    this.roundRect(ctx, barX - barPadding, barY - barPadding - 20, barWidth + barPadding * 2, barHeight + barPadding * 2 + 30, cornerRadius);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    
    // 绘制进度条背景（内层）
    ctx.fillStyle = 'rgba(20, 20, 20, 0.8)';
    ctx.fillRect(barX, barY, barWidth, barHeight);
    
    // 绘制进度条前景（带渐变）
    if (progress > 0) {
      const progressWidth = barWidth * progress;
      
      // 创建渐变（从绿色到亮绿色）
      const gradient = ctx.createLinearGradient(barX, barY, barX + progressWidth, barY);
      gradient.addColorStop(0, '#4CAF50');
      gradient.addColorStop(0.5, '#66BB6A');
      gradient.addColorStop(1, '#81C784');
      
      ctx.fillStyle = gradient;
      ctx.fillRect(barX, barY, progressWidth, barHeight);
      
      // 绘制进度条发光效果（顶部高光）
      ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.fillRect(barX, barY, progressWidth, barHeight * 0.3);
    }
    
    // 绘制进度条边框
    ctx.strokeStyle = 'rgba(100, 100, 100, 0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, barWidth, barHeight);
    
    // 绘制文字标签
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 16px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // 文字阴影（增强可读性）
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2;
    
    // 绘制标题
    ctx.fillText('正在撤离...', cx, barY - 20);
    
    // 绘制进度百分比
    ctx.font = 'bold 14px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#4CAF50';
    ctx.fillText(`${Math.floor(progress * 100)}%`, cx, barY + barHeight / 2);
    
    // 重置阴影
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }
  
  /**
   * 绘制圆角矩形（辅助方法）
   */
  private roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  /**
   * 绘制文本提示（屏幕中央）
   */
  private drawTextHint(ctx: CanvasRenderingContext2D, cx: number, cy: number, text: string, alpha: number, color?: string): void {
    // 默认白色，如果指定了颜色则使用指定颜色
    const textColor = color || '255, 255, 255';
    ctx.fillStyle = `rgba(${textColor}, ${alpha})`;
    ctx.font = 'bold 24px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // 绘制文字阴影（增强可读性）
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;
    
    ctx.fillText(text, cx, cy);
    
    // 重置阴影
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }

  /**
   * 绘制武器状态（左下角）
   */
  private drawWeaponStatus(ctx: CanvasRenderingContext2D, w: number, h: number, status: UIOverlayState['weaponStatus']): void {
    const leftMargin = 20;
    const bottomMargin = 20;
    const x = leftMargin;
    const y = h - bottomMargin;
    
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    
    // 武器名称
    ctx.fillText(status.weaponName, x, y - 30);
    
    // 弹匣信息
    const ammoText = `${status.ammoInMag} / ${status.magSize}`;
    ctx.fillStyle = status.ammoInMag === 0 ? '#ff4444' : '#ffffff';
    ctx.font = '14px monospace';
    ctx.fillText(ammoText, x, y - 10);
    
    // 换弹进度条
    if (status.reloading) {
      const barWidth = 120;
      const barHeight = 4;
      const barX = x;
      const barY = y - 5;
      
      // 背景
      ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.fillRect(barX, barY, barWidth, barHeight);
      
      // 进度
      ctx.fillStyle = '#4CAF50';
      ctx.fillRect(barX, barY, barWidth * status.reloadProgress, barHeight);
      
      // 文字提示
      ctx.fillStyle = '#ffffff';
      ctx.font = '12px monospace';
      ctx.textAlign = 'left';
      ctx.fillText('RELOADING', x, barY - 5);
    }
  }

  /**
   * 绘制闪光弹效果（全屏偏灰白色 + 中央进度条）
   */
  private drawFlashEffect(ctx: CanvasRenderingContext2D, w: number, h: number, cx: number, cy: number, progress: number): void {
    // 全屏黑色遮罩（完全不透明）
    ctx.fillStyle = 'rgba(0, 0, 0, 1.0)';
    ctx.fillRect(0, 0, w, h);

    // 中央进度条
    const barWidth = 120;
    const barHeight = 10;
    const barX = cx - barWidth / 2;
    const barY = cy - barHeight / 2;

    // 进度条背景（深灰色）
    ctx.fillStyle = 'rgba(60, 60, 60, 0.8)';
    ctx.fillRect(barX, barY, barWidth, barHeight);

    // 进度条前景（浅灰色）
    ctx.fillStyle = 'rgba(200, 200, 200, 0.9)';
    ctx.fillRect(barX, barY, barWidth * progress, barHeight);

    // 进度条边框（黑色）
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, barWidth, barHeight);
  }

  /**
   * 调整大小（跟随窗口）
   */
  resize(cssWidth: number, cssHeight: number): void {
    this.cssWidth = cssWidth;
    this.cssHeight = cssHeight;
    const dpr = window.devicePixelRatio || 1;

    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    this.canvas.width = cssWidth * dpr;
    this.canvas.height = cssHeight * dpr;

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
  }
}
