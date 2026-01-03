# Day3 前状态检查

## 当前问题状态

### A. 文档/验收不一致 ✅ 已修复

- ✅ **README 更新**：已更新"已知限制"，反映 Day2 已实现的功能
- ✅ **TEST_REPORT_DAY1.md**：文件存在于 `docs/TEST_REPORT_DAY1.md`，不是 MISSING

### B. Server 安全/鲁棒性 ✅ 已修复

- ✅ **重复 HELLO 防护**：`server/src/main.ts` 已添加重复 HELLO 检测，防止幽灵玩家

### C. 表现层小瑕疵 ⚠️ 暂不修复（不影响 Day3）

- ⚠️ **子弹客户端不插值**：先不做预测，后续可改为 client 端用 (x,y,vx,vy,timestamp) 外推
- ⚠️ **Renderer hitTest 用 sqrt**：玩家少时无所谓，后续实体多了再换 dist²

**结论**：没有"卡死下一步"的问题，可以继续 Day3。

## Dump 工具状态 ✅ 已优化

### Plan 模式（默认）

**当前输出**：5 个核心文件
- `client/src/main.ts`
- `server/src/main.ts`
- `shared/src/protocol.ts`
- `shared/src/content.ts`
- `package.json`

**符合要求**：
- ✅ 不包含 `README.md`、`math.ts`、`index.ts`、`logger.ts`、`smoke.ts`
- ✅ 新加文件自动包含（通过 glob 扫描）
- ✅ 输出稳定，按路径排序

### 使用建议

**功能迭代规划**（最常用）：
```bash
npm run dump:key
```
输出核心闭环文件，适合"让 ChatGPT 规划 Cursor"的场景。

**定位 Bug**：
```bash
node tools/dump_key_code.mjs --mode debug
```
自动聚焦变更文件，适合"定位 bug"的场景。

## Day3 准备

### 目标玩法

**进局 → 搜（捡东西）→ 打（可选）→ 撤（撤离结算）**

- 物品生成/拾取
- 简单背包计数（lootCount）
- 撤离点
- 结算 HUD

### 规划文档

已创建 `docs/PLAN_DAY3_LOOT_EXTRACT.md`，包含：
- 目标玩法
- 详细改动点（协议、内容配置、Server、Client、Network）
- 验收标准
- 关键概念（脉冲输入、公共状态、Seeded 生成）

### 下一步

可以直接将 `docs/PLAN_DAY3_LOOT_EXTRACT.md` 的内容作为 Prompt 给 Cursor 执行。

