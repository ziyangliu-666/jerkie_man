import type { OBSTACLE_STATE } from '@ziyang-protocol/shared';
import { doesObstacleBlockPlayer } from '@ziyang-protocol/shared';

export type PathNode = {
  x: number;
  y: number;
  gCost: number;
  hCost: number;
  fCost: number;
  parent?: PathNode;
};

export class NavigationGrid {
  private grid: boolean[][];
  public readonly cellSize: number;
  public readonly gridWidth: number;
  public readonly gridHeight: number;

  constructor(
    worldWidth: number,
    worldHeight: number,
    obstacles: OBSTACLE_STATE[],
    cellSize: number = 20
  ) {
    this.cellSize = cellSize;
    this.gridWidth = Math.ceil(worldWidth / cellSize);
    this.gridHeight = Math.ceil(worldHeight / cellSize);

    // 初始化所有格子为可行走
    this.grid = Array(this.gridHeight)
      .fill(null)
      .map(() => Array(this.gridWidth).fill(true));

    // 标记障碍物格子为不可行走
    for (const obstacle of obstacles) {
      const obsType = (obstacle as any).type || 'wall';
      if (!doesObstacleBlockPlayer(obsType)) {
        continue; // bush/water 可穿过
      }

      const minX = Math.floor(obstacle.x / cellSize);
      const minY = Math.floor(obstacle.y / cellSize);
      const maxX = Math.ceil((obstacle.x + obstacle.w) / cellSize);
      const maxY = Math.ceil((obstacle.y + obstacle.h) / cellSize);

      for (let gy = minY; gy < maxY; gy++) {
        for (let gx = minX; gx < maxX; gx++) {
          if (this.isInBounds(gx, gy)) {
            this.grid[gy][gx] = false;
          }
        }
      }
    }
  }

  public worldToGrid(worldX: number, worldY: number): { x: number; y: number } {
    return {
      x: Math.floor(worldX / this.cellSize),
      y: Math.floor(worldY / this.cellSize),
    };
  }

  public gridToWorld(gridX: number, gridY: number): { x: number; y: number } {
    return {
      x: (gridX + 0.5) * this.cellSize,
      y: (gridY + 0.5) * this.cellSize,
    };
  }

  public isInBounds(gridX: number, gridY: number): boolean {
    return gridX >= 0 && gridX < this.gridWidth && gridY >= 0 && gridY < this.gridHeight;
  }

  public isWalkable(gridX: number, gridY: number): boolean {
    if (!this.isInBounds(gridX, gridY)) {
      return false;
    }
    return this.grid[gridY][gridX];
  }

  public getNeighbors(node: PathNode): PathNode[] {
    const neighbors: PathNode[] = [];
    const directions = [
      { dx: 0, dy: -1, cost: 1.0 },   // N
      { dx: 1, dy: 0, cost: 1.0 },    // E
      { dx: 0, dy: 1, cost: 1.0 },    // S
      { dx: -1, dy: 0, cost: 1.0 },   // W
      { dx: 1, dy: -1, cost: 1.414 }, // NE diagonal
      { dx: 1, dy: 1, cost: 1.414 },  // SE
      { dx: -1, dy: 1, cost: 1.414 }, // SW
      { dx: -1, dy: -1, cost: 1.414 }, // NW
    ];

    for (const dir of directions) {
      const nx = node.x + dir.dx;
      const ny = node.y + dir.dy;

      if (!this.isWalkable(nx, ny)) {
        continue;
      }

      // 防止对角线"切角"
      const isDiagonal = dir.dx !== 0 && dir.dy !== 0;
      if (isDiagonal) {
        const canMoveX = this.isWalkable(node.x + dir.dx, node.y);
        const canMoveY = this.isWalkable(node.x, node.y + dir.dy);
        if (!canMoveX || !canMoveY) {
          continue;
        }
      }

      neighbors.push({
        x: nx,
        y: ny,
        gCost: node.gCost + dir.cost,
        hCost: 0,
        fCost: 0,
      });
    }

    return neighbors;
  }

  public findNearestWalkable(gridX: number, gridY: number, maxRadius: number = 10): { x: number; y: number } | null {
    if (this.isWalkable(gridX, gridY)) {
      return { x: gridX, y: gridY };
    }

    // 螺旋搜索最近的可行走格子
    for (let radius = 1; radius <= maxRadius; radius++) {
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) {
            continue; // 只检查外圈
          }
          const nx = gridX + dx;
          const ny = gridY + dy;
          if (this.isWalkable(nx, ny)) {
            return { x: nx, y: ny };
          }
        }
      }
    }

    return null;
  }
}

export class Pathfinder {
  public navGrid: NavigationGrid;

  constructor(navGrid: NavigationGrid) {
    this.navGrid = navGrid;
  }

  public findPath(
    startWorldX: number,
    startWorldY: number,
    goalWorldX: number,
    goalWorldY: number
  ): { x: number; y: number }[] {
    const start = this.navGrid.worldToGrid(startWorldX, startWorldY);
    const goal = this.navGrid.worldToGrid(goalWorldX, goalWorldY);

    // 验证起点
    if (!this.navGrid.isWalkable(start.x, start.y)) {
      const nearestStart = this.navGrid.findNearestWalkable(start.x, start.y);
      if (!nearestStart) {
        return [];
      }
      start.x = nearestStart.x;
      start.y = nearestStart.y;
    }

    // 验证终点
    if (!this.navGrid.isWalkable(goal.x, goal.y)) {
      const nearestGoal = this.navGrid.findNearestWalkable(goal.x, goal.y);
      if (!nearestGoal) {
        return [];
      }
      goal.x = nearestGoal.x;
      goal.y = nearestGoal.y;
    }

    const openSet: PathNode[] = [];
    const closedSet = new Set<string>();

    const startNode: PathNode = {
      x: start.x,
      y: start.y,
      gCost: 0,
      hCost: this.heuristic(start.x, start.y, goal.x, goal.y),
      fCost: 0,
    };
    startNode.fCost = startNode.gCost + startNode.hCost;
    openSet.push(startNode);

    const MAX_ITERATIONS = 1000;
    let iterations = 0;

    while (openSet.length > 0 && iterations < MAX_ITERATIONS) {
      iterations++;

      // 找到最小fCost的节点
      let currentIndex = 0;
      for (let i = 1; i < openSet.length; i++) {
        if (openSet[i].fCost < openSet[currentIndex].fCost) {
          currentIndex = i;
        }
      }

      const current = openSet[currentIndex];
      openSet.splice(currentIndex, 1);
      closedSet.add(`${current.x},${current.y}`);

      // 到达目标
      if (current.x === goal.x && current.y === goal.y) {
        return this.reconstructPath(current);
      }

      // 探索邻居
      const neighbors = this.navGrid.getNeighbors(current);
      for (const neighbor of neighbors) {
        const key = `${neighbor.x},${neighbor.y}`;
        if (closedSet.has(key)) {
          continue;
        }

        neighbor.hCost = this.heuristic(neighbor.x, neighbor.y, goal.x, goal.y);
        neighbor.fCost = neighbor.gCost + neighbor.hCost;
        neighbor.parent = current;

        const existingIndex = openSet.findIndex((n) => n.x === neighbor.x && n.y === neighbor.y);
        if (existingIndex >= 0) {
          if (neighbor.gCost < openSet[existingIndex].gCost) {
            openSet[existingIndex] = neighbor;
          }
        } else {
          openSet.push(neighbor);
        }
      }
    }

    // 未找到路径
    return [];
  }

  private heuristic(x1: number, y1: number, x2: number, y2: number): number {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy); // 欧氏距离
  }

  private reconstructPath(node: PathNode): { x: number; y: number }[] {
    const gridPath: PathNode[] = [];
    let current: PathNode | undefined = node;
    while (current) {
      gridPath.unshift(current);
      current = current.parent;
    }

    // 转换为世界坐标
    const worldPath = gridPath.map((n) => this.navGrid.gridToWorld(n.x, n.y));

    // 路径简化（可选，删除中间共线点）
    return this.simplifyPath(worldPath);
  }

  private simplifyPath(path: { x: number; y: number }[]): { x: number; y: number }[] {
    if (path.length <= 2) {
      return path;
    }

    const simplified: { x: number; y: number }[] = [path[0]];

    for (let i = 1; i < path.length - 1; i++) {
      const prev = path[i - 1];
      const curr = path[i];
      const next = path[i + 1];

      const dx1 = curr.x - prev.x;
      const dy1 = curr.y - prev.y;
      const dx2 = next.x - curr.x;
      const dy2 = next.y - curr.y;

      // 检查是否共线（叉积为0）
      const crossProduct = dx1 * dy2 - dy1 * dx2;
      if (Math.abs(crossProduct) > 0.1) {
        simplified.push(curr);
      }
    }

    simplified.push(path[path.length - 1]);
    return simplified;
  }
}
