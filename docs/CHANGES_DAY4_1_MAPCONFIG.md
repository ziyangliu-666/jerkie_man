# Day4-1: Server 下发 mapConfig + seed（世界配置单一真相）

## 修复时间
2026-01-03

## 目标
实现 server 在玩家加入时下发 mapConfig + seed，client 不再本地生成 mapConfig，确保 client/server 世界配置一致。

## 修改文件清单

### 1. `shared/src/protocol.ts`
**变更**：扩展 `S2C_WELCOME_SCHEMA`，添加可选字段 `seed` 和 `mapConfig`
- 新增 `seed: z.number().int().optional()`
- 新增 `mapConfig: MAP_CONFIG_SCHEMA.optional()`
- 导入 `MAP_CONFIG_SCHEMA` 从 `./content.js`

**原因**：协议需要支持 server 下发世界配置

---

### 2. `server/src/room.ts`
**变更**：
- 添加 `readonly seed: number` 字段（Room 构造时生成：`Math.floor(Math.random() * 2**31)`）
- 将 `mapConfig` 类型从 `ReturnType<typeof loadMapConfig>` 改为 `MAP_CONFIG`
- 添加 TODO 注释：未来 item/obstacle 生成应使用 `this.seed` 作为 RNG seed

**原因**：Room 作为世界配置的单一真相来源，持有 seed 和 mapConfig

---

### 3. `server/src/main.ts`
**变更**：发送 `S2C_WELCOME` 时带上 `room.seed` 和 `room.mapConfig`
```typescript
S2C_WELCOME_SCHEMA.parse({
  type: 'S2C_WELCOME',
  playerId: playerId,
  seed: room.seed,
  mapConfig: room.mapConfig,
})
```

**原因**：server 需要将世界配置下发给 client

---

### 4. `client/src/network.ts`
**变更**：
- 新增 `RoomInfo` 接口（包含 `seed?` 和 `mapConfig?`）
- 更新 `NetworkCallbacks.onWelcome` 签名：`(playerId: string, roomInfo?: RoomInfo) => void`
- 在 `onmessage` 处理 `S2C_WELCOME` 时传递 `roomInfo`

**原因**：支持接收并传递 server 下发的世界配置

---

### 5. `client/src/main.ts`
**变更**：
- 删除直接 `loadMapConfig()` 作为渲染来源
- 新增变量：
  - `serverMapConfig: MAP_CONFIG | null = null`
  - `serverSeed: number | null = null`
  - `fallbackMapConfig = loadMapConfig()`（仅用于兼容）
- 在 `onWelcome` 回调中：
  - 接收 `roomInfo`，保存 `serverMapConfig` 和 `serverSeed`
  - 如果 `mapConfig` 为空，显示警告并 fallback
- 在 `renderLoop` 中使用：`serverMapConfig?.extractZone ?? fallbackMapConfig.extractZone`
- 导入 `MAP_CONFIG` 类型

**原因**：client 使用 server 下发的配置作为单一真相来源，fallback 仅用于兼容

---

### 6. `server/src/smoke.ts`
**变更**：增加断言验证 welcome 消息包含 `seed` 和 `mapConfig`
- 断言 `message.seed` 存在且为整数
- 断言 `message.mapConfig` 存在且 `extractZone` 有效
- 打印验证信息到控制台

**原因**：确保 Day4-1 功能正常工作

---

### 7. `README.md`
**变更**：在 README 中新增"世界配置（Day4-1）"章节
- 说明 server 权威配置
- 说明 client 使用 server 配置
- 说明兼容模式

**原因**：文档同步

---

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
- Welcome 消息包含 `seed`（整数）
- Welcome 消息包含 `mapConfig.extractZone`（有效）
- 玩家移动正常（258.20px）

### 功能验证（手动）
- ✅ 两个窗口都能接收到 server 下发的 mapConfig
- ✅ HUD event 显示 "Server mapConfig received (seed: ...)"
- ✅ 撤离区正常显示（使用 server 下发的配置）
- ✅ 断线重连后仍正常（重新接收 mapConfig）

---

## 兼容性

- ✅ 如果 server 未下发 `mapConfig`，client 会 fallback 到本地配置并显示警告
- ✅ 协议字段为可选（`optional()`），不会破坏旧版本 client
- ✅ 如果 server 未下发 `seed`，`serverSeed` 为 `null`（不影响功能）

---

## 下一步建议

1. **基于 seed 生成物品/障碍物**：使用 `room.seed` 作为 RNG seed，确保 client/server 生成一致
2. **地图边界/碰撞**：使用 `serverMapConfig.width/height` 作为世界边界
3. **动态地图生成**：基于 seed 生成随机地图布局（障碍物、房间等）

---

## 相关文档

- `docs/FIXES_P1_RELIABILITY.md` - P1 可靠性修复
- `docs/FIXES_DAY3_P0_RELIABILITY.md` - Day3 P0 修复记录



