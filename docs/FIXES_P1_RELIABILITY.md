# P1 可靠性修复总结

## 修复时间
2026-01-03

## 修复内容

### P1-1：断线时 `inputSeq` 会每帧自增（会把 seq 拉爆）

**问题描述**：
- 位置：`client/src/main.ts`
- 原逻辑：只要 `shouldSend && canSend`，就先 `inputSeq++`，再 `sendInput()`
- 问题：断线时 `sendInput()` 返回 `false`，但 `inputSeq` 已经递增，导致每帧都在涨 seq
- 影响：
  - 不会立刻崩，但会让 seq 很快变成巨大数字（重连后 server 看到"跳号很大"）
  - 也会让 debug/日志更难看、排查更难

**修复方案**：
- 只在 `sent === true` 时才提交 `inputSeq`
- 把 `inputSeq++` 延后到 `sendInput()` 返回成功之后
- 使用 `nextSeq = inputSeq + 1` 先计算，发送成功后再赋值

**代码变更**：
```typescript
// 修复前
if (shouldSend && canSend) {
  inputSeq++;
  const sent = network.sendInput(inputSeq, keys, aim, shoot, pendingInteract, pendingExtract);
  if (sent) {
    // ...
  }
}

// 修复后
if (shouldSend && canSend) {
  const nextSeq = inputSeq + 1;
  const sent = network.sendInput(nextSeq, keys, aim, shoot, pendingInteract, pendingExtract);
  
  if (sent) {
    inputSeq = nextSeq; // 只有发送成功才提交 seq
    // ...
  }
}
```

**验证**：
- ✅ `npm run build` 通过
- ✅ `npm run test:smoke` 通过
- ✅ 断线时 seq 不再自增（可通过手动断开网络验证）

---

### P1-2：`cachedRectLeft/top` 只在 resize 时更新，遇到 layout shift 可能错位

**问题描述**：
- 位置：`client/src/renderer.ts`
- 原逻辑：rect 缓存只在 `resize()` 时更新（避免每帧读取 DOM）
- 问题：如果出现以下情况，rect 缓存可能过期：
  - 页面发生滚动（哪怕很小）
  - 浏览器 UI / DevTools dock 导致布局微调但没触发预期的 resize 链路
  - CSS 变化导致 canvas 位置偏移
- 影响：`screenToWorld`/`worldToScreen` 使用旧 rect，导致**点选/瞄准轻微偏移**

**修复方案**：
- 提供 `renderer.refreshRect()` 方法，手动刷新 rect 缓存
- 在 `main.ts` 中监听常见布局变化事件：
  - `window.scroll`：页面滚动
  - `window.visualViewport.resize`：viewport 变化（移动端/缩放等）

**代码变更**：

`client/src/renderer.ts`：
```typescript
// 新增方法
refreshRect(): void {
  const rect = this.canvas.getBoundingClientRect();
  this.cachedRectLeft = rect.left;
  this.cachedRectTop = rect.top;
}
```

`client/src/main.ts`：
```typescript
// 监听页面滚动和 viewport 变化，刷新 canvas rect 缓存
window.addEventListener('scroll', () => renderer.refreshRect(), { passive: true });

// 兼容移动端/缩放等导致的 viewport 变化（桌面也可能触发）
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', () => renderer.refreshRect());
}
```

**验证**：
- ✅ `npm run build` 通过
- ✅ `npm run test:smoke` 通过
- ✅ rect 缓存依然不是"每帧读 DOM"（性能保持）
- ✅ 常见布局变化时会自动更新（避免错位）

---

## 修改文件清单

1. `client/src/main.ts`
   - P1-1：修复 `inputSeq` 递增逻辑（只在发送成功时递增）
   - P1-2：添加 scroll/visualViewport 监听，自动刷新 rect 缓存

2. `client/src/renderer.ts`
   - P1-2：新增 `refreshRect()` 方法

---

## 测试结果

### 构建验证
```powershell
npm run build
```
✅ 所有包构建成功

### Smoke Test 验证
```powershell
npm run test:smoke
```
✅ 测试通过，玩家移动正常

### 功能验证（手动）
- ✅ 断线时 seq 不再自增（可通过 `window.net.disconnect()` 验证）
- ✅ 页面滚动后点击选中仍准确（rect 缓存自动刷新）

---

## 下一步建议

这两个 P1 修复完成后，建议进入 **Day4-1：Server 下发 mapConfig/seed**。

**原因**：
- 当前 client 使用 `loadMapConfig()` 本地读取，与 server 可能不一致
- 这会影响后续所有玩法（物品刷新、撤离区、地图边界、障碍物）
- 是最大的"未来必炸技术债"

**最小改法**：
- 协议加一个 `S2C_ROOM_INFO`（或扩展 `S2C_WELCOME` 带上 `mapConfig` / `seed`）
- server 连接成功后发一次
- client 收到后缓存 `mapConfig`，renderer 用它画撤离区

---

## 相关文档

- `docs/AUDIT_DAY3_RELIABILITY.md` - Day3 可靠性审计
- `docs/FIXES_DAY3_P0_RELIABILITY.md` - Day3 P0 修复记录



