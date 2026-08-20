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

const SQRT2 = Math.SQRT2;

// 八向邻居，顺序与 cost 一一对应
const DIR_X = [0, 1, 0, -1, 1, 1, -1, -1];
const DIR_Y = [-1, 0, 1, 0, -1, 1, 1, -1];
const DIR_COST = [1, 1, 1, 1, SQRT2, SQRT2, SQRT2, SQRT2];

export class NavigationGrid {
  private grid: Uint8Array;
  // 每格所属的连通分量编号；不可行走的格子为 -1。
  // 有了它，跨区域的寻路请求可以 O(1) 判否，不必让 A* 把整片区域穷举一遍。
  private components: Int32Array;
  private componentSizes: number[] = [];

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

    const cells = this.gridWidth * this.gridHeight;
    this.grid = new Uint8Array(cells);
    this.components = new Int32Array(cells);

    this.rebuild(obstacles);
  }

  /**
   * 按当前障碍物重新标记可行走格并重算连通分量。
   * 门被打开/关闭、可破坏障碍物被摧毁之后必须调用，否则 AI 会一直按旧地形寻路。
   */
  public rebuild(obstacles: OBSTACLE_STATE[]): void {
    this.grid.fill(1);

    for (const obstacle of obstacles) {
      const obsType = (obstacle as any).type || 'wall';
      if (!doesObstacleBlockPlayer(obsType)) {
        continue; // bush/water 可穿过
      }

      const minX = Math.floor(obstacle.x / this.cellSize);
      const minY = Math.floor(obstacle.y / this.cellSize);
      const maxX = Math.ceil((obstacle.x + obstacle.w) / this.cellSize);
      const maxY = Math.ceil((obstacle.y + obstacle.h) / this.cellSize);

      for (let gy = minY; gy < maxY; gy++) {
        if (gy < 0 || gy >= this.gridHeight) continue;
        const rowBase = gy * this.gridWidth;
        for (let gx = minX; gx < maxX; gx++) {
          if (gx < 0 || gx >= this.gridWidth) continue;
          this.grid[rowBase + gx] = 0;
        }
      }
    }

    this.computeComponents();
  }

  /** 洪水填充给每个可行走格打上连通分量编号 */
  private computeComponents(): void {
    const { gridWidth, gridHeight } = this;
    const total = gridWidth * gridHeight;
    this.components.fill(-1);
    this.componentSizes = [];

    // 显式栈，避免深递归；复用同一个数组减少分配
    const stack = new Int32Array(total);

    for (let seed = 0; seed < total; seed++) {
      if (this.grid[seed] === 0 || this.components[seed] !== -1) continue;

      const id = this.componentSizes.length;
      let size = 0;
      let top = 0;
      stack[top++] = seed;
      this.components[seed] = id;

      while (top > 0) {
        const idx = stack[--top];
        size++;
        const cx = idx % gridWidth;
        const cy = (idx - cx) / gridWidth;

        for (let d = 0; d < 8; d++) {
          const nx = cx + DIR_X[d];
          const ny = cy + DIR_Y[d];
          if (nx < 0 || nx >= gridWidth || ny < 0 || ny >= gridHeight) continue;
          const nIdx = ny * gridWidth + nx;
          if (this.grid[nIdx] === 0 || this.components[nIdx] !== -1) continue;
          // 与 A* 一致：对角线不允许切角
          if (DIR_X[d] !== 0 && DIR_Y[d] !== 0) {
            if (this.grid[cy * gridWidth + nx] === 0 || this.grid[ny * gridWidth + cx] === 0) {
              continue;
            }
          }
          this.components[nIdx] = id;
          stack[top++] = nIdx;
        }
      }

      this.componentSizes.push(size);
    }
  }

  public get componentCount(): number {
    return this.componentSizes.length;
  }

  /** 该格所属连通分量；不可行走或越界返回 -1 */
  public getComponentAt(gridX: number, gridY: number): number {
    if (!this.isInBounds(gridX, gridY)) return -1;
    return this.components[gridY * this.gridWidth + gridX];
  }

  public index(gridX: number, gridY: number): number {
    return gridY * this.gridWidth + gridX;
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
    return this.grid[gridY * this.gridWidth + gridX] === 1;
  }

  public getNeighbors(node: PathNode): PathNode[] {
    const neighbors: PathNode[] = [];

    for (let d = 0; d < 8; d++) {
      const nx = node.x + DIR_X[d];
      const ny = node.y + DIR_Y[d];

      if (!this.isWalkable(nx, ny)) {
        continue;
      }

      // 防止对角线"切角"
      if (DIR_X[d] !== 0 && DIR_Y[d] !== 0) {
        if (!this.isWalkable(node.x + DIR_X[d], node.y) || !this.isWalkable(node.x, node.y + DIR_Y[d])) {
          continue;
        }
      }

      neighbors.push({
        x: nx,
        y: ny,
        gCost: node.gCost + DIR_COST[d],
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

  /**
   * 在指定连通分量内找最近的可行走格。
   * 用于把目标点吸附到与起点同一块区域，避免"目标就在墙那头"时直接放弃。
   */
  public findNearestWalkableInComponent(
    gridX: number,
    gridY: number,
    component: number,
    maxRadius: number = 10
  ): { x: number; y: number } | null {
    if (this.getComponentAt(gridX, gridY) === component) {
      return { x: gridX, y: gridY };
    }

    for (let radius = 1; radius <= maxRadius; radius++) {
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) {
            continue;
          }
          if (this.getComponentAt(gridX + dx, gridY + dy) === component) {
            return { x: gridX + dx, y: gridY + dy };
          }
        }
      }
    }

    return null;
  }
}

export class Pathfinder {
  public navGrid: NavigationGrid;

  // A* 的工作区。用定长 TypedArray + 代际标记代替 Map/Set 和字符串 key，
  // 每次搜索无需清空数组，也没有 GC 压力。
  private gScore: Float64Array;
  private fScore: Float64Array;
  private cameFrom: Int32Array;
  private state: Uint8Array; // 0=未访问 1=开集 2=闭集
  private stamp: Int32Array; // 上次写入时的代际号
  private heap: Int32Array;  // 二叉最小堆，存格子下标
  private heapPos: Int32Array; // 格子在堆中的位置，-1 表示不在堆里
  private heapSize = 0;
  private generation = 0;

  constructor(navGrid: NavigationGrid) {
    this.navGrid = navGrid;
    const cells = navGrid.gridWidth * navGrid.gridHeight;
    this.gScore = new Float64Array(cells);
    this.fScore = new Float64Array(cells);
    this.cameFrom = new Int32Array(cells);
    this.state = new Uint8Array(cells);
    this.stamp = new Int32Array(cells).fill(-1);
    this.heap = new Int32Array(cells);
    this.heapPos = new Int32Array(cells);
  }

  public findPath(
    startWorldX: number,
    startWorldY: number,
    goalWorldX: number,
    goalWorldY: number
  ): { x: number; y: number }[] {
    const grid = this.navGrid;
    const start = grid.worldToGrid(startWorldX, startWorldY);
    const goal = grid.worldToGrid(goalWorldX, goalWorldY);

    // 验证起点
    if (!grid.isWalkable(start.x, start.y)) {
      const nearestStart = grid.findNearestWalkable(start.x, start.y);
      if (!nearestStart) {
        return [];
      }
      start.x = nearestStart.x;
      start.y = nearestStart.y;
    }

    const startComponent = grid.getComponentAt(start.x, start.y);
    if (startComponent < 0) {
      return [];
    }

    // 验证终点：优先吸附到与起点同一连通分量的格子。
    // 目标在另一块封闭区域（例如关着门的房间）时这里就会失败，
    // 不会再让 A* 把整片可达区域白跑一遍。
    if (grid.getComponentAt(goal.x, goal.y) !== startComponent) {
      const nearestGoal = grid.findNearestWalkableInComponent(goal.x, goal.y, startComponent);
      if (!nearestGoal) {
        return [];
      }
      goal.x = nearestGoal.x;
      goal.y = nearestGoal.y;
    }

    const width = grid.gridWidth;
    const startIdx = start.y * width + start.x;
    const goalIdx = goal.y * width + goal.x;

    if (startIdx === goalIdx) {
      return [];
    }

    const gen = ++this.generation;
    this.heapSize = 0;

    this.stamp[startIdx] = gen;
    this.state[startIdx] = 1;
    this.gScore[startIdx] = 0;
    this.fScore[startIdx] = this.heuristic(start.x, start.y, goal.x, goal.y);
    this.cameFrom[startIdx] = -1;
    this.heapPush(startIdx);

    // 连通性已经保证了目标可达，这里只是防御性上限（最坏情况遍历整个网格）
    const maxIterations = width * grid.gridHeight;
    let iterations = 0;

    while (this.heapSize > 0 && iterations < maxIterations) {
      iterations++;

      const currentIdx = this.heapPop();
      if (currentIdx === goalIdx) {
        return this.reconstructPath(currentIdx, gen);
      }
      this.state[currentIdx] = 2;

      const cx = currentIdx % width;
      const cy = (currentIdx - cx) / width;
      const currentG = this.gScore[currentIdx];

      for (let d = 0; d < 8; d++) {
        const nx = cx + DIR_X[d];
        const ny = cy + DIR_Y[d];
        if (!grid.isWalkable(nx, ny)) continue;

        // 防止对角线"切角"
        if (DIR_X[d] !== 0 && DIR_Y[d] !== 0) {
          if (!grid.isWalkable(nx, cy) || !grid.isWalkable(cx, ny)) continue;
        }

        const nIdx = ny * width + nx;
        const fresh = this.stamp[nIdx] !== gen;
        if (!fresh && this.state[nIdx] === 2) continue;

        const tentativeG = currentG + DIR_COST[d];
        if (!fresh && tentativeG >= this.gScore[nIdx]) continue;

        this.stamp[nIdx] = gen;
        this.gScore[nIdx] = tentativeG;
        this.fScore[nIdx] = tentativeG + this.heuristic(nx, ny, goal.x, goal.y);
        this.cameFrom[nIdx] = currentIdx;

        if (fresh || this.state[nIdx] !== 1) {
          this.state[nIdx] = 1;
          this.heapPush(nIdx);
        } else {
          this.heapSiftUp(this.heapPos[nIdx]);
        }
      }
    }

    // 未找到路径
    return [];
  }

  // ---- 二叉最小堆（按 fScore 排序） ----

  private heapPush(idx: number): void {
    const pos = this.heapSize++;
    this.heap[pos] = idx;
    this.heapPos[idx] = pos;
    this.heapSiftUp(pos);
  }

  private heapPop(): number {
    const top = this.heap[0];
    this.heapPos[top] = -1;
    const last = --this.heapSize;
    if (last > 0) {
      const moved = this.heap[last];
      this.heap[0] = moved;
      this.heapPos[moved] = 0;
      this.heapSiftDown(0);
    }
    return top;
  }

  private heapSiftUp(pos: number): void {
    const heap = this.heap;
    const f = this.fScore;
    const idx = heap[pos];
    const key = f[idx];

    while (pos > 0) {
      const parent = (pos - 1) >> 1;
      const parentIdx = heap[parent];
      if (f[parentIdx] <= key) break;
      heap[pos] = parentIdx;
      this.heapPos[parentIdx] = pos;
      pos = parent;
    }

    heap[pos] = idx;
    this.heapPos[idx] = pos;
  }

  private heapSiftDown(pos: number): void {
    const heap = this.heap;
    const f = this.fScore;
    const size = this.heapSize;
    const idx = heap[pos];
    const key = f[idx];

    for (;;) {
      const left = pos * 2 + 1;
      if (left >= size) break;
      const right = left + 1;
      let child = left;
      if (right < size && f[heap[right]] < f[heap[left]]) {
        child = right;
      }
      const childIdx = heap[child];
      if (f[childIdx] >= key) break;
      heap[pos] = childIdx;
      this.heapPos[childIdx] = pos;
      pos = child;
    }

    heap[pos] = idx;
    this.heapPos[idx] = pos;
  }

  private heuristic(x1: number, y1: number, x2: number, y2: number): number {
    const dx = Math.abs(x2 - x1);
    const dy = Math.abs(y2 - y1);
    // 八向移动的精确启发式：对角线走 √2，剩下的走直线
    const min = dx < dy ? dx : dy;
    return (dx + dy - 2 * min) + SQRT2 * min;
  }

  private reconstructPath(goalIdx: number, gen: number): { x: number; y: number }[] {
    const width = this.navGrid.gridWidth;
    const gridPath: { x: number; y: number }[] = [];

    let cursor = goalIdx;
    while (cursor !== -1 && this.stamp[cursor] === gen) {
      const x = cursor % width;
      gridPath.push({ x, y: (cursor - x) / width });
      cursor = this.cameFrom[cursor];
    }
    gridPath.reverse();

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
