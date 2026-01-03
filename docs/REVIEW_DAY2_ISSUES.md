# Day2 代码审查 - 问题清单

## Step 0: 问题清单

### A) P0 - 会导致bug/体验很差的（必须修复）

1. **Canvas宽度保护不足**
   - 问题：HUD变宽（表格内容撑开）时，canvas可能被挤到最小，出现横向滚动条
   - 位置：`client/src/main.ts` - `updateCanvasSize()`
   - 影响：用户体验差，布局混乱

2. **Resize频繁触发导致抖动**
   - 问题：window resize事件直接调用`updateCanvasSize()`，频繁读写DOM导致布局抖动
   - 位置：`client/src/main.ts` - `window.addEventListener('resize')`
   - 影响：窗口resize时卡顿、闪烁

3. **HUD宽度变化不监听**
   - 问题：HUD表格变宽/变窄时，canvas宽度不会自动更新
   - 位置：`client/src/main.ts` - 缺少ResizeObserver
   - 影响：HUD内容变化时布局不正确

4. **瞄准角度计算错误**
   - 问题：使用canvas中心作为瞄准原点，camera不居中或本地玩家缺失时会错
   - 位置：`client/src/main.ts` - `getAimAngle(canvas)`
   - 影响：子弹方向不准确，体验差

5. **左键开火与选中冲突**
   - 问题：左键开火时会触发canvas click选中，导致HUD事件日志很吵
   - 位置：`client/src/main.ts` - canvas click事件
   - 影响：用户体验差，交互混乱

### B) P1 - 迟早会变成bug的边界情况（建议修复）

1. **子弹没有TTL**
   - 问题：极端情况下子弹可能无限存在，导致内存泄漏
   - 位置：`server/src/room.ts` - `updateBullets()`
   - 影响：长时间运行可能内存溢出

2. **碰撞检测性能问题**
   - 问题：每次命中检测都用`Math.sqrt()`，性能开销大
   - 位置：`server/src/room.ts` - `updateBullets()` 命中检测
   - 影响：子弹多时性能下降

3. **bulletsToRemove用数组includes**
   - 问题：`bullets.filter(b => !bulletsToRemove.includes(b.id))`是O(n^2)
   - 位置：`server/src/room.ts` - `updateBullets()`
   - 影响：子弹多时性能下降

4. **Renderer bullets类型不明确**
   - 问题：`Array<{x:number;y:number}>`，后续要画ownerId颜色时需要改签名
   - 位置：`client/src/renderer.ts` - `render()`方法
   - 影响：维护性差，类型不安全

5. **开火输入在window上监听**
   - 问题：canvas外按左键也会开火，不符合预期
   - 位置：`client/src/input.ts` - `window.addEventListener('mousedown')`
   - 影响：意外开火，体验差

### C) P2 - 维护性/性能的小坑（可选修复）

1. **瞄准角度计算依赖canvas中心**
   - 问题：未来camera变化时可能出问题
   - 位置：`client/src/input.ts` - `getAimAngle()`
   - 影响：维护性差

2. **选中逻辑在click上**
   - 问题：与开火冲突，需要明确交互规则
   - 位置：`client/src/main.ts` - canvas click事件
   - 影响：交互不清晰

3. **HUD宽度测量异常处理不足**
   - 问题：如果HUD宽度测量为0或超大值，可能导致canvas计算不合理
   - 位置：`client/src/main.ts` - `updateCanvasSize()`
   - 影响：边界情况可能出错

