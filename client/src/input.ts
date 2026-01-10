export class InputManager {
  private keys: Map<string, boolean> = new Map();
  private mouseX = 0;
  private mouseY = 0;
  private shoot = false; // Day2: 开火状态
  private rightClick = false; // 新增: 右键状态
  private reloadFlag = false; // 新增: 换弹脉冲事件标志（R键）
  private interactFlag = false; // Day3: 拾取脉冲事件标志（E键）
  private extractFlag = false; // Day3: 撤离脉冲事件标志（F键）
  private useItemFlags: boolean[] = [false, false, false, false, false]; // 新增: 使用物品脉冲事件标志（1-5键）

  // P0-3 修复: 使用 pointer events + 捕获，解决鼠标拖出 canvas 松开导致开火卡住的问题
  private capturedPointerId: number | null = null;
  
  // 新增: 耐力检查回调函数（返回当前耐力百分比，用于UI限制）
  private staminaCheckCallback: (() => number) | null = null;
  
  // 新增: 耐力UI摇晃回调函数
  private staminaShakeCallback: (() => void) | null = null;
  
  // 新增: 跟踪耐力是否曾经耗尽（用于判断是否需要35%限制）
  private staminaWasExhausted: boolean = false;

  constructor(canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      // 忽略输入框内的按键
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        return;
      }

      const key = e.key.toLowerCase();
      
      // 性能优化: 如果是重复按键（长按），且不是需要特殊处理的键，直接返回
      // 这避免了长按 WASD 时每帧都执行完整的处理逻辑
      if (e.repeat) {
        // 只有特定键需要处理 repeat（目前没有）
        // 其他键直接返回，避免重复设置 Map 和调用回调
        return;
      }
      
      // 新增: 耐力限制检查（空格键）
      // 允许耐力消耗到0，但一旦为0后需要恢复到35%以上才能再按
      if (key === ' ') {
        if (this.staminaCheckCallback) {
          const staminaPercent = this.staminaCheckCallback();
          
          // 更新耐力耗尽状态：如果耐力为0或接近0，标记为已耗尽
          if (staminaPercent <= 0.1) {
            this.staminaWasExhausted = true;
          }
          
          // 如果耐力曾经耗尽，且当前还没恢复到35%以上，阻止输入并摇晃
          if (this.staminaWasExhausted && staminaPercent < 35) {
            if (this.staminaShakeCallback) {
              this.staminaShakeCallback();
            }
            e.preventDefault();
            e.stopPropagation();
            return; // 不设置空格键状态
          }
          
          // 如果耐力恢复到35%以上，清除耗尽标记
          if (staminaPercent >= 35) {
            this.staminaWasExhausted = false;
          }
        }
      }
      
      this.keys.set(key, true);
      
      // Day3: 脉冲事件（edge-trigger）
      // 注意: e.repeat 已在上面处理，这里不需要再检查
      if (key === 'r') {
        this.reloadFlag = true;
        e.preventDefault();
        e.stopPropagation();
      } else if (key === 'e') {
        this.interactFlag = true;
        e.preventDefault();
        e.stopPropagation();
      } else if (key === 'f') {
        this.extractFlag = true;
        e.preventDefault();
        e.stopPropagation();
      }
      
      // 新增: 数字键1-5使用物品
      const numKey = parseInt(key);
      if (numKey >= 1 && numKey <= 5) {
        this.useItemFlags[numKey - 1] = true;
        e.preventDefault();
        e.stopPropagation();
      }
      
      // 防止默认行为（如页面滚动）及事件冒泡（防止由空格触发的按钮点击）
      if (['w', 'a', 's', 'd', ' ', 'r', 'e', 'f', '1', '2', '3', '4', '5'].includes(key)) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, { capture: true });

    window.addEventListener('keyup', (e) => {
      // 忽略输入框内的按键
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        return;
      }

      const key = e.key.toLowerCase();
      this.keys.set(key, false);
      
      // 新增: 当空格键松开时，如果耐力已经恢复，清除耗尽标记
      if (key === ' ') {
        if (this.staminaCheckCallback) {
          const staminaPercent = this.staminaCheckCallback();
          if (staminaPercent >= 35) {
            this.staminaWasExhausted = false;
          }
        }
        // 同样阻止冒泡，防止 Space keyup 触发按钮点击
        e.preventDefault();
        e.stopPropagation();
      }
    }, { capture: true });

    // 修复: 统一坐标更新函数
    const updatePointer = (clientX: number, clientY: number) => {
      this.mouseX = clientX;
      this.mouseY = clientY;
    };

    // 兼容：普通鼠标移动
    window.addEventListener('mousemove', (e) => {
      updatePointer(e.clientX, e.clientY);
    });

    // 关键：pointer 链路（在 pointer capture 时依然可靠）
    window.addEventListener('pointermove', (e) => {
      if (!e.isPrimary) return;
      updatePointer(e.clientX, e.clientY);
    });

    // 关键：捕获期间 pointermove 会稳定打到 canvas
    canvas.addEventListener('pointermove', (e) => {
      if (!e.isPrimary) return;
      updatePointer(e.clientX, e.clientY);
    });

    // P0-3 修复: 使用 pointerdown/pointerup/pointercancel 替换 mousedown/mouseup
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 0 && e.isPrimary) { // 左键 + 主指针
        this.shoot = true;
        this.capturedPointerId = e.pointerId;
        // 尝试捕获指针（兼容性处理）
        try {
          canvas.setPointerCapture(e.pointerId);
        } catch (err) {
          // 某些浏览器可能不支持，忽略错误
        }
        e.preventDefault();
      } else if (e.button === 2 && e.isPrimary) { // 右键 + 主指针
        this.rightClick = true;
        e.preventDefault();
      }
    });

    canvas.addEventListener('pointerup', (e) => {
      if (e.pointerId === this.capturedPointerId) {
        this.shoot = false;
        this.capturedPointerId = null;
        // 释放捕获
        try {
          canvas.releasePointerCapture(e.pointerId);
        } catch (err) {
          // 忽略错误
        }
        e.preventDefault();
      } else if (e.button === 2 && e.isPrimary) { // 右键释放
        this.rightClick = false;
        e.preventDefault();
      }
    });

    canvas.addEventListener('pointercancel', (e) => {
      if (e.pointerId === this.capturedPointerId) {
        this.shoot = false;
        this.capturedPointerId = null;
        // 释放捕获
        try {
          canvas.releasePointerCapture(e.pointerId);
        } catch (err) {
          // 忽略错误
        }
        e.preventDefault();
      }
    });

    // P0-3 修复: 兜底处理 - 如果指针在 canvas 外松开，也能清理状态
    window.addEventListener('pointerup', (e) => {
      if (this.shoot && e.pointerId === this.capturedPointerId) {
        this.shoot = false;
        this.capturedPointerId = null;
      }
    });

    // 禁用右键菜单
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });

    // 窗口失去焦点时清除所有按键状态
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.shoot = false;
      this.rightClick = false;
      this.capturedPointerId = null;
      this.reloadFlag = false; // 新增: 清除换弹脉冲事件标志
      this.interactFlag = false; // Day3: 清除脉冲事件标志
      this.extractFlag = false;
      this.useItemFlags.fill(false); // 新增: 清除使用物品脉冲事件标志
      // 注意: 不重置 staminaWasExhausted，因为这是游戏状态，不是输入状态
    });
  }

  // 获取WASD输入状态
  getKeys(): { up: boolean; down: boolean; left: boolean; right: boolean } {
    return {
      up: this.keys.get('w') ?? false,
      down: this.keys.get('s') ?? false,
      left: this.keys.get('a') ?? false,
      right: this.keys.get('d') ?? false,
    };
  }

  // 计算鼠标角度（相对于canvas中心，弧度）
  // 保留此方法以兼容旧代码，但推荐使用getAimAngleFromPoint
  getAimAngle(canvas: HTMLCanvasElement): number {
    const rect = canvas.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    return this.getAimAngleFromPoint(centerX, centerY);
  }

  // Step2: 计算鼠标角度（相对于指定点，弧度）
  // 用于瞄准角度计算：鼠标相对本地玩家屏幕位置的角度（永远正确）
  getAimAngleFromPoint(originClientX: number, originClientY: number): number {
    const dx = this.mouseX - originClientX;
    const dy = this.mouseY - originClientY;
    return Math.atan2(dy, dx);
  }

  // 获取鼠标世界坐标（需要renderer的screenToWorld）
  getMouseWorldPos(screenToWorld: (x: number, y: number) => { x: number; y: number }): { x: number; y: number } {
    return screenToWorld(this.mouseX, this.mouseY);
  }

  // Day2: 获取开火状态
  getShoot(): boolean {
    return this.shoot;
  }

  // 新增: 消费开火状态（用于投掷模式，防止同时触发开火）
  consumeShoot(): boolean {
    const value = this.shoot;
    if (value) {
      this.shoot = false; // 消费掉这次点击
    }
    return value;
  }

  // 新增: 获取右键状态
  getRightClick(): boolean {
    return this.rightClick;
  }

  // 新增: 消费换弹脉冲事件（edge-trigger：返回当前值并清零）
  consumeReload(): boolean {
    const value = this.reloadFlag;
    this.reloadFlag = false;
    return value;
  }

  // Day3: 消费拾取脉冲事件（edge-trigger：返回当前值并清零）
  consumeInteract(): boolean {
    const value = this.interactFlag;
    this.interactFlag = false;
    return value;
  }

  // Day3: 消费撤离脉冲事件（edge-trigger：返回当前值并清零）
  consumeExtract(): boolean {
    const value = this.extractFlag;
    this.extractFlag = false;
    return value;
  }

  // 游戏化增强: 获取撤离持续状态（按住F键）
  getExtractHeld(): boolean {
    return this.keys.get('f') ?? false;
  }

  // 新增: 消费使用物品脉冲事件（1-5键）
  consumeUseItem(slot: number): boolean {
    if (slot < 1 || slot > 5) return false;
    const value = this.useItemFlags[slot - 1];
    this.useItemFlags[slot - 1] = false;
    return value;
  }

  // 新增: 获取冲刺状态（空格键）
  getSprintHeld(): boolean {
    return this.keys.get(' ') ?? false;
  }
  
  // 新增: 设置耐力检查回调函数
  setStaminaCheckCallback(callback: (() => number) | null): void {
    this.staminaCheckCallback = callback;
  }
  
  // 新增: 设置耐力UI摇晃回调函数
  setStaminaShakeCallback(callback: (() => void) | null): void {
    this.staminaShakeCallback = callback;
  }
  
  // 新增: 更新耐力耗尽状态（由外部调用，用于在耐力恢复时清除标记）
  updateStaminaExhaustedState(staminaPercent: number): void {
    if (staminaPercent <= 0.1) {
      this.staminaWasExhausted = true;
      // 长按空格把耐力耗到0时，自动“松开”冲刺键（逻辑层面）
      this.keys.set(' ', false);
    } else if (staminaPercent >= 35) {
      this.staminaWasExhausted = false;
    }
  }
}
