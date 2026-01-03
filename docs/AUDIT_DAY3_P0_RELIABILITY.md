# Day3 P0 可靠性审计报告

## 检查范围

已读取以下文件：
- client/src/main.ts
- client/src/network.ts
- client/src/input.ts
- client/src/renderer.ts

## 发现的问题

### P0-1：pendingInteract/pendingExtract 可能"发送失败也清零" ⚠️ **严重**

**现象**：断线/重连瞬间按 E/F，有概率永远丢一次。

**根因**：
- `client/src/main.ts:193` 调用 `network.sendInput(...)` 后立即清零 pending
- 但 `client/src/network.ts:sendInput()` 如果 `ws.readyState !== WebSocket.OPEN`，会 `return`，等于这次根本没发出去
- pending 却被清掉了，导致事件丢失

**证据**：
```typescript
// client/src/main.ts:193
network.sendInput(inputSeq, keys, aim, shoot, pendingInteract, pendingExtract);
// ...
pendingInteract = false; // 即使发送失败也会清零！
pendingExtract = false;
```

```typescript
// client/src/network.ts:sendInput()
if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
  return; // 发送失败，但没有返回值
}
```

**影响**：断线/重连瞬间按 E/F，事件会丢失。

---

### P0-2：重连后，client 的"发送状态缓存"没重置 ⚠️ **严重**

**现象**：重连后长时间不发 input，server 端就像收不到键盘一样。

**根因**：
- `client/src/main.ts` 中的发送状态缓存：
  - `lastSentKeys`, `lastSentAim`, `lastSentShoot`, `lastInputSendTime`
  - `pendingInteract`, `pendingExtract`
- 在 `network.onDisconnect` 回调中只清理了 `localPlayerId` 和 `selectedEntity`
- 如果重连后当前 keys/aim 状态刚好和断线前一致，`keysChanged/aimChanged` 可能一直 false
- 导致 `shouldSend` 一直 false，长时间不发 input

**证据**：
```typescript
// client/src/main.ts:53-59
onDisconnect: () => {
  // ...
  localPlayerId = null;
  selectedEntity = null;
  // ❌ 没有重置发送状态缓存
}
```

```typescript
// client/src/main.ts:182-188
const keysChanged = !lastSentKeys || ...; // 如果重连后 keys 和断线前一样，keysChanged = false
const aimChanged = isNaN(lastSentAim) || ...; // 如果重连后 aim 和断线前一样，aimChanged = false
// shouldSend = false，不发 input
```

**影响**：重连后如果输入状态和断线前一致，会长时间不发 input。

---

### P1：keydown 自动重复会把"脉冲事件"变成"连发事件" ⚠️ **中等**

**现象**：长按 E/F 会因为系统 key repeat 一直触发，疯狂发包、疯狂拾取。

**根因**：
- `client/src/input.ts:11-22` 对 E/F 的 keydown 事件没有处理 `e.repeat`
- 系统 key repeat 会持续触发 keydown，导致 `interactFlag/extractFlag` 一直被设置为 true
- pending bypass 节流，导致疯狂发包

**证据**：
```typescript
// client/src/input.ts:16-21
if (key === 'e') {
  this.interactFlag = true; // 没有检查 e.repeat
  e.preventDefault();
}
```

**影响**：长按 E/F 会疯狂发包，不符合"按一次触发一次"的预期。

---

### P2：Renderer.worldToScreen() 每帧 getBoundingClientRect() ⚠️ **性能问题**

**现象**：每帧计算 aim 时会调用 `worldToScreen()`，里面调用 `getBoundingClientRect()`，性能会被 DOM 读拖慢。

**根因**：
- `client/src/renderer.ts:44-54` `worldToScreen()` 每帧都调用 `getBoundingClientRect()`
- `client/src/main.ts:160` 每帧计算 aim 时调用 `renderer.worldToScreen()`
- DOM 读取是同步操作，会阻塞渲染

**证据**：
```typescript
// client/src/renderer.ts:44-54
worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
  const rect = this.canvas.getBoundingClientRect(); // 每帧都读 DOM
  // ...
}
```

**影响**：后面加 UI、加 minimap、加更多 draw，性能会被这些 DOM 读拖慢。

---

## 修复方案

### 修复 P0-1：pending 只有在发送成功后才清零

**改动**：
- `client/src/network.ts`：`sendInput()` 返回 `boolean`（是否真的发送了）
- `client/src/main.ts`：只有 `sent === true` 才更新 `lastInputSendTime/lastSent*`，并清 pending

**为什么能修**：返回值明确标识是否发送成功，只有成功才清 pending。

**风险**：低，只改客户端逻辑。

---

### 修复 P0-2：重连后重置发送状态缓存

**改动**：
- `client/src/main.ts`：在 `network.onWelcome` 回调里重置：
  - `lastSentKeys = null`
  - `lastSentAim = NaN`
  - `lastSentShoot = false`
  - `lastInputSendTime = 0`
  - `pendingInteract = false`
  - `pendingExtract = false`

**为什么能修**：重置缓存后，下一帧的 `keysChanged/aimChanged` 会为 true，强制发送一次 input。

**风险**：低，只改客户端逻辑。

---

### 修复 P1：处理 keydown repeat（可选）

**改动**：
- `client/src/input.ts`：对 E/F 的 keydown 事件，如果 `e.repeat` 为 true，则忽略

**为什么能修**：忽略 repeat 后，只有第一次按下才会触发，符合"按一次触发一次"的预期。

**风险**：低，只改客户端逻辑。

**注意**：如果未来要支持"长按连拾取"，可以保留现状，但需要加发送上限/冷却。

---

### 修复 P2：缓存 canvas rect（可选）

**改动**：
- `client/src/renderer.ts`：在 `resize()` 时缓存 `rect.left/top`
- `worldToScreen()` 和 `screenToWorld()` 使用缓存值，不每帧读 DOM

**为什么能修**：缓存后，每帧不再读 DOM，性能提升。

**风险**：低，只改客户端逻辑。

---

## 修复优先级

1. **P0（必须修复）**：P0-1（pending 清零）、P0-2（重连后重置缓存）
2. **P1（建议修复）**：keydown repeat 处理
3. **P2（可选优化）**：缓存 canvas rect



