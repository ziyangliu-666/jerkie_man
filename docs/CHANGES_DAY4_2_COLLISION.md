# Day4-2: Server 权威碰撞与世界边界

## 实现时间
2026-01-03

## 目标
实现 server 权威的玩家碰撞与世界边界检测，并将 obstacles 下发给 client 渲染。玩家不能穿墙/出界，两个窗口看到一致的障碍物布局。

## 修改文件清单

### 1. `shared/src/protocol.ts`
**变更**：添加 `OBSTACLE_STATE_SCHEMA` 和更新 `S2C_SNAPSHOT_SCHEMA`
- 新增 `OBSTACLE_STATE_SCHEMA = z.object({ x, y, w, h })`
- 在 `S2C_SNAPSHOT_SCHEMA` 中添加 `obstacles: z.array(OBSTACLE_STATE_SCHEMA)`
- 导出 `OBSTACLE_STATE` 类型

**原因**：协议需要支持 obstacles 传输

---

### 2. `shared/src/math.ts`
**变更**：添加碰撞检测工具函数
- `circleVsAABB(cx, cy, r, rect)`: Circle vs AABB 碰撞检测
- `clampCircleInBounds(cx, cy, r, minX, minY, maxX, maxY)`: 世界边界检测

**原因**：提供可复用的碰撞检测算法

---

### 3. `server/src/room.ts`
**变更**：
- 添加 `public obstacles: OBSTACLE_STATE[]` 字段
- 在构造函数中调用 `this.generateObstacles()`（基于 seed）
- 实现 `generateObstacles()`：生成 10-20 个矩形障碍物，避免与玩家出生点重叠
- 在 `processInput()` 中传递 `this.obstacles` 给 `Player.processInput()`
- 在 `getSnapshot()` 中返回 `obstacles: this.obstacles`

**原因**：Room 负责生成和管理 obstacles，并传递给 Player 进行碰撞检测

---

### 4. `server/src/player.ts`
**变更**：
- 修改 `processInput()` 签名：添加 `obstacles: OBSTACLE_STATE[] = []` 参数
- 在计算 `newX, newY` 后：
  1. 先检测世界边界（使用 `clampCircleInBounds`）
  2. 再检测 obstacles（使用 `circleVsAABB`，如果碰撞则回退到 `oldX, oldY`）

**原因**：Player 负责碰撞检测和位置修正

---

### 5. `server/src/main.ts`
**变更**：
- 在发送 `S2C_SNAPSHOT` 时包含 `obstacles: snapshot.obstacles`

**原因**：将 obstacles 广播给所有客户端

---

### 6. `client/src/snapshot.ts`
**变更**：
- 更新 `getInterpolatedState()` 返回类型，添加 `obstacles: OBSTACLE_STATE[]`
- 在所有返回路径中包含 `obstacles`（不需要插值，直接使用最新）

**原因**：SnapshotBuffer 需要传递 obstacles 给渲染层

---

### 7. `client/src/renderer.ts`
**变更**：
- 添加 `drawObstacle(obstacle: OBSTACLE_STATE)` 方法（绘制灰色矩形）
- 在 `render()` 方法中添加 `obstacles: OBSTACLE_STATE[] = []` 参数
- 在 `render()` 中先绘制 obstacles（背景层），再绘制其他元素

**原因**：Client 负责渲染 obstacles

---

### 8. `client/src/main.ts`
**变更**：
- 在 `renderLoop()` 中，从 `state.obstacles` 获取 obstacles
- 调用 `renderer.render()` 时传递 `state.obstacles`

**原因**：将 obstacles 传递给 renderer

---

### 9. `server/src/smoke.ts`
**变更**：
- 添加碰撞检测测试：验证玩家不能超出边界
- 验证 obstacles 存在于 snapshot 中

**原因**：自动化测试验证碰撞功能

---

## 碰撞模型

- **玩家**：圆形（Circle），半径 `r=10`（与渲染 size 20 对齐）
- **障碍物**：矩形（AABB），`{x, y, w, h}`
- **世界边界**：`[0, mapConfig.width] x [0, mapConfig.height]`

## 碰撞检测算法

### Circle vs AABB
```typescript
// 找到矩形上距离圆心最近的点
const closestX = clamp(cx, rect.x, rect.x + rect.w);
const closestY = clamp(cy, rect.y, rect.y + rect.h);
const dx = cx - closestX;
const dy = cy - closestY;
const distSq = dx * dx + dy * dy;
return distSq < r * r; // 碰撞
```

### 碰撞响应
- 如果碰撞 obstacles，玩家位置回退到 `oldX, oldY`（不移动）
- 世界边界：使用 `clampCircleInBounds` 确保玩家圆心在 `[r, mapWidth-r] x [r, mapHeight-r]` 范围内

## 验证结果

### 构建验证
```powershell
npm run build
```
✅ 所有包构建成功

### Smoke Test 验证
```powershell
npm run test:smoke
```
✅ 测试通过
- 玩家移动正常（320.00px）
- Obstacles 存在于 snapshot（18 个障碍物）
- 边界碰撞测试通过（玩家不能超出边界）

### 功能验证（手动）
- ✅ 两个窗口都能看到相同的障碍物布局
- ✅ 玩家移动到地图边界时不能出界
- ✅ 玩家移动到障碍物时不能穿墙
- ✅ 障碍物渲染在玩家下方（背景层）

---

## 下一步建议

1. **优化碰撞检测性能**：使用空间分区（如四叉树）优化大量 obstacles 的碰撞检测
2. **障碍物类型**：支持不同类型的障碍物（可破坏、可攀爬等）
3. **动态障碍物**：支持移动或可交互的障碍物

---

## 相关文档

- `docs/CHANGES_DAY4_1_MAPCONFIG.md` - Day4-1 实现记录
- `docs/FIXES_P0_P1_DAY4_1.md` - P0/P1 修复记录



