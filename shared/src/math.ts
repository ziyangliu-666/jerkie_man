export class Vec2 {
  constructor(public x: number = 0, public y: number = 0) {}

  add(other: Vec2): Vec2 {
    return new Vec2(this.x + other.x, this.y + other.y);
  }

  sub(other: Vec2): Vec2 {
    return new Vec2(this.x - other.x, this.y - other.y);
  }

  mul(scalar: number): Vec2 {
    return new Vec2(this.x * scalar, this.y * scalar);
  }

  length(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }

  normalize(): Vec2 {
    const len = this.length();
    if (len === 0) return new Vec2(0, 0);
    return new Vec2(this.x / len, this.y / len);
  }

  clone(): Vec2 {
    return new Vec2(this.x, this.y);
  }
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Day4-2: 碰撞检测工具函数

/**
 * Circle vs AABB 碰撞检测
 * @param cx 圆心 x
 * @param cy 圆心 y
 * @param r 圆半径
 * @param rect 矩形 {x, y, w, h}
 * @returns true 如果碰撞
 */
export function circleVsAABB(
  cx: number,
  cy: number,
  r: number,
  rect: { x: number; y: number; w: number; h: number }
): boolean {
  // 找到矩形上距离圆心最近的点
  const closestX = clamp(cx, rect.x, rect.x + rect.w);
  const closestY = clamp(cy, rect.y, rect.y + rect.h);
  
  // 计算圆心到最近点的距离平方
  const dx = cx - closestX;
  const dy = cy - closestY;
  const distSq = dx * dx + dy * dy;
  
  // 如果距离平方 < 半径平方，则碰撞
  return distSq < r * r;
}

/**
 * 将圆形限制在世界边界内
 * @param cx 圆心 x
 * @param cy 圆心 y
 * @param r 圆半径
 * @param minX 最小 x（世界左边界）
 * @param minY 最小 y（世界上边界）
 * @param maxX 最大 x（世界右边界）
 * @param maxY 最大 y（世界下边界）
 * @returns 修正后的位置 {x, y}，确保圆心在 [minX+r, maxX-r] x [minY+r, maxY-r] 范围内
 */
export function clampCircleInBounds(
  cx: number,
  cy: number,
  r: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): { x: number; y: number } {
  return {
    x: clamp(cx, minX + r, maxX - r),
    y: clamp(cy, minY + r, maxY - r),
  };
}

/**
 * 矩形 AABB 相交检测
 * @param rect1 矩形1 {x, y, w, h}
 * @param rect2 矩形2 {x, y, w, h}
 * @returns true 如果两个矩形相交
 */
export function rectIntersects(
  rect1: { x: number; y: number; w: number; h: number },
  rect2: { x: number; y: number; w: number; h: number }
): boolean {
  return (
    rect1.x < rect2.x + rect2.w &&
    rect1.x + rect1.w > rect2.x &&
    rect1.y < rect2.y + rect2.h &&
    rect1.y + rect1.h > rect2.y
  );
}

/**
 * 计算线段到点的最短距离平方（连续碰撞检测用）
 * @param ax 线段起点 x
 * @param ay 线段起点 y
 * @param bx 线段终点 x
 * @param by 线段终点 y
 * @param px 点 x
 * @param py 点 y
 * @returns 距离平方（避免 sqrt）
 */
export function segmentPointDistanceSquared(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  px: number,
  py: number
): number {
  // 线段向量
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  
  // 如果线段长度为 0，退化为点到点距离
  if (lenSq < 1e-10) {
    const dpx = px - ax;
    const dpy = py - ay;
    return dpx * dpx + dpy * dpy;
  }
  
  // 计算点 P 到线段 AB 的投影参数 t
  // t = dot(AP, AB) / |AB|^2
  const apx = px - ax;
  const apy = py - ay;
  const t = clamp((apx * dx + apy * dy) / lenSq, 0, 1);
  
  // 线段上最近点
  const closestX = ax + t * dx;
  const closestY = ay + t * dy;
  
  // 返回距离平方
  const distX = px - closestX;
  const distY = py - closestY;
  return distX * distX + distY * distY;
}

/**
 * 线段与圆形相交检测（连续碰撞检测用）
 * @param ax 线段起点 x
 * @param ay 线段起点 y
 * @param bx 线段终点 x
 * @param by 线段终点 y
 * @param cx 圆心 x
 * @param cy 圆心 y
 * @param r 圆半径
 * @returns true 如果线段与圆相交
 */
export function segmentIntersectsCircle(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  r: number
): boolean {
  const distSq = segmentPointDistanceSquared(ax, ay, bx, by, cx, cy);
  return distSq <= r * r;
}

