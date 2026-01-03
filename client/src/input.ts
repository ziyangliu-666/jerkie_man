export class InputManager {
  private keys: Map<string, boolean> = new Map();
  private mouseX = 0;
  private mouseY = 0;

  constructor() {
    window.addEventListener('keydown', (e) => {
      this.keys.set(e.key.toLowerCase(), true);
      // 防止默认行为（如页面滚动）
      if (['w', 'a', 's', 'd', ' '].includes(e.key.toLowerCase())) {
        e.preventDefault();
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys.set(e.key.toLowerCase(), false);
    });

    window.addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    });

    // 窗口失去焦点时清除所有按键状态
    window.addEventListener('blur', () => {
      this.keys.clear();
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
  getAimAngle(canvas: HTMLCanvasElement): number {
    const rect = canvas.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const dx = this.mouseX - centerX;
    const dy = this.mouseY - centerY;

    return Math.atan2(dy, dx);
  }

  // 获取鼠标世界坐标（需要renderer的screenToWorld）
  getMouseWorldPos(screenToWorld: (x: number, y: number) => { x: number; y: number }): { x: number; y: number } {
    return screenToWorld(this.mouseX, this.mouseY);
  }
}

