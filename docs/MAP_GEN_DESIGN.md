# 地图生成系统设计文档（搜打撤版）

## 目标与基线
目标：在现有 2D 俯视/矩形碰撞框架内，升级到“可复现、可扩展、可叙事”的复杂搜打撤地图生成系统，既能支持对战节奏，也能承载探索与经济循环。

现有基线（参考当前代码）：
- `MAP_CONFIG` 仅包含 `width/height/seed/extractZone`（`shared/src/content.ts`）。
- 地图由服务端生成：`Room` 根据 `seed` 生成障碍物与世界物品（`server/src/room.ts`）。
- 静态世界数据通过 `S2C_WORLD_INIT` 一次性下发（障碍物 + mapConfig）。
- 客户端根据 `mapConfig` 绘制边界、撤离区，障碍物在渲染层表现为矩形遮挡。

本设计在保持上述“单一真相源 + 可复现 seed”的基础上分层扩展。

## 地图元素规划（复杂搜打撤所需元素）
### 1) 宏观区域（Macro Zones）
建议构成一个“生态与资源梯度”：
- 核心区：高价值 POI + 高危险度，PVP密集。
- 过渡区：道路/河流/丘陵穿插，提供多条战术路径。
- 资源区：分散的资源点、农田、伐木场、小型工坊。
- 脱离边缘区：撤离点、边境哨站、稀疏掩体。

### 2) 生物群落与地貌（Biomes）
参考“Minecraft + 星露谷”氛围融合，但维持废土/对战感：
- 林地、农田、湿地、废城、矿坑、断裂溪谷、旧铁路。
- 水体/沼泽形成“速度惩罚与视野遮蔽”的软障碍。
- 高低地通过“射击视野奖励/惩罚”在系统层体现（未来扩展）。

### 3) POI 结构（可掉落/可交互）
建议以“模板印章 + 随机变体”生成：
- 旧工厂、避难所、疗养院、谷仓、温室、采石场、矿井入口。
- “路径节点”：桥梁、隧道、堤坝、崖道、林间木栈道。
- 每个 POI 提供独特 loot 主题和战斗地形（狭窄/开阔/高掩体）。

### 4) 掩体与遮挡（Obstacles & Cover）
现有矩形障碍物可分为三类：
- 硬遮挡：建筑墙体、集装箱、岩体（完全阻挡）。
- 软遮挡：树林、栅栏、作物（视野遮蔽/命中修正）。
- 半遮挡：矮墙、沙袋、车壳（命中或伤害衰减）。

### 5) 资源与交互（Loot / Resource）
- 资源分层：普通资源（稳定）、稀有资源（热点）、任务资源（定向）。
- 资源密度与风险挂钩：高价值区域更暴露或可预测。
- 可加入“可破坏箱/矿点/作物”形成“短时间停留风险”。

### 6) 撤离体系（Extract）
从单一矩形升级为多点规则系统：
- 主撤离点、临时撤离点、条件撤离点（需钥匙/电源/时间窗）。
- 撤离区可包含“交互触发 + 计时 + 噪音提示”。

### 7) 动态事件（Dynamic)
以“轻量事件”增加局内变化：
- 空投、巡逻车经过、风暴雨/大雾、临时封锁。
- 事件与路径/POI结合，形成战术诱导。

## 地图生成流程设计（Seed 驱动）

### 阶段 0：输入与全局配置
- 输入：`seed`，地图尺寸，玩法参数（玩家数量、撤离规则、资源倍率）。
- 输出：`mapConfig` + 静态世界数据（地形层 + POI + 障碍物 + 生成点）。

### 阶段 1：宏观布局（Region Graph）
在平面上生成“区域图”（节点 + 连线）：
- 节点：核心区、资源区、撤离区、过渡区。
- 连线：主干道、次级路线、隐蔽小径。
- 校验：至少 2 条从出生区到撤离区的可达路径。

### 阶段 2：生物群落与地形
基于 noise 或 Voronoi 进行分区：
- 分配 biomes（林地/湿地/农田/废城等）。
- 生成水体、丘陵、断裂地形（可转化为障碍物带）。
- 产出：`BiomeMap`（低分辨率网格或采样函数）。

### 阶段 3：POI 生成（Stamp + Variant）
在区域图节点附近生成 POI：
- 按权重选择 POI 模板（例如工厂/谷仓/矿洞入口）。
- 每个模板有 2-4 个几何变体（旋转/镜像/缺失模块）。
- 模板输出“障碍物集合 + 交互点 + loot 欺骗点”。

### 阶段 4：障碍物与掩体填充
- 在路径和空旷区域布置掩体带（树阵、石堆、车队残骸）。
- 保留“视野走廊”：确保开阔区与掩体区形成节奏对比。
- 与撤离区保持安全距离（当前已有 padding 逻辑）。

### 阶段 5：生成点与物资分配
- 出生点：远离撤离区、高危 POI 与其他玩家。
- Loot：按“区域风险系数 + POI 类型 + 物品稀有度表”生成。
- 特殊资源：稀有物只出现在特定 POI 或事件中。

### 阶段 6：验证与修复（Validation）
- 连通性：spawn -> extract 必须可达（基于 AABB 障碍物模拟）。
- 密度检测：障碍物/物资过密自动删除或移动。
- 结果保底：确保关键区域至少有 1 个可用 POI。

## 数据结构与协议扩展建议
### MAP_CONFIG 扩展（保持向后兼容）
当前：
- `width/height/seed/extractZone`

建议新增（可选字段）：
- `biomes`: 低分辨率网格或采样函数参数
- `regions`: 生成的区域图与 POI 列表
- `extractZones`: 多撤离点（替代单一 extractZone）
- `spawnRules`: 出生点规则参数（距离、权重）
- `lootRules`: 不同区域的物资倍率表

### WORLD_INIT 扩展（静态世界下发）
当前：
- `mapConfig` + `obstacles`

建议新增：
- `poiProps`: POI 静态物件（作为障碍物或可交互）
- `terrainHints`: 地形绘制提示（客户端可选渲染）
- `coverZones`: 软遮挡区（影响命中/移动，可先作为标记）

## 与现有代码框架的对接点
### 服务端
- `shared/src/content.ts`：扩展 `MAP_CONFIG_SCHEMA` 与默认配置。
- `server/src/room.ts`：
  - 用 `seed` 驱动新的 `MapGen` 模块生成：`obstacles/poi/loot`。
  - `generateWorldItems` 从“区域规则”生成，而非纯随机。
- `shared/src/protocol.ts`：扩展 `S2C_WORLD_INIT_SCHEMA`。

### 客户端
- `client/src/main.ts`：缓存 `WORLD_INIT` 里的新增静态数据。
- `client/src/renderer.ts`：根据 `biomes/poiProps` 绘制差异化场景。
- `client/src/hud.ts`：显示附近 POI/撤离点状态或事件提示。

## 创意设定：示例地图“裂谷农场”
地图叙事：一条被炸断的铁路穿过旧农场与小镇遗迹，矿洞口冒着微光，湿地边缘散布着临时营地。

核心元素（示例）：
- 中央：废弃温室 + 工厂联合体（高价值/高风险）。
- 西侧：农田与谷仓（基础资源 + 低风险）。
- 南侧：矿洞入口与石场（稀有矿物 + 狭窄战斗）。
- 东侧：湿地沼泽与木栈道（视野受限 + 伏击热点）。
- 边缘撤离点：老火车站、河堤哨所、临时救援直升机。

## 分阶段落地方案（建议）
1) 扩展 `MAP_CONFIG_SCHEMA` + `WORLD_INIT`，先落地“多撤离点 + POI 列表”。
2) 新增 `MapGen` 服务端模块，输出：POI 结构 + 障碍物集合 + Loot 规则。
3) 客户端渲染 POI 与 biome（可以先用颜色块/标记）。
4) 验证工具：给定 seed 输出可视化（开发用），支持回放与复现。

# 裂谷农场：详细地图设计（可直接实现）

## 地图定位与节奏
- 核心调性：农垦遗迹 + 断裂铁路线 + 矿洞口微光
- 战斗节奏：中央高压、两翼中压、边缘低压，形成“压缩三明治”
- 资源节奏：稳定补给（农田/谷仓）→ 稀有资源（矿洞/温室）→ 任务资源（铁路残骸/研究站）

## 宏观分区（建议 2K~3K 尺寸）
- 中央：废弃温室 + 工厂联合体（最高价值）
- 西侧：农田与谷仓群（稳定资源）
- 南侧：矿洞入口与石场（狭窄战斗）
- 东侧：湿地与木栈道（视野受限，伏击高频）
- 北侧：断裂铁路与旧车站（路径枢纽，任务资源）

## POI 模板清单（含变体）
1) 温室群
- 几何：长条玻璃房 + 断裂区 + 侧门通道
- 变体：A 单一长条，B 双体并列，C 中部塌陷
- 资源：高阶医疗/植物类任务品

2) 工厂联合体
- 几何：主厂房 + 副仓库 + 装卸平台
- 变体：A 开放大厅，B 中央设备岛，C 多隔断
- 资源：稀有材料/武器配件

3) 谷仓集群
- 几何：2~4 个谷仓 + 围栏 + 草垛掩体
- 变体：A 直线排布，B 围合院落，C 破损屋顶
- 资源：常规补给/食物/基础材料

4) 矿洞入口
- 几何：洞口 + 矿车轨道 + 临时工棚
- 变体：A 单洞口，B 双洞口，C 坍塌遮挡
- 资源：稀有矿物/任务物

5) 铁路残骸区
- 几何：断裂铁轨 + 翻覆车厢 + 残破站台
- 变体：A 车厢横断，B 车厢纵列，C 铁轨桥断
- 资源：任务物/零件

6) 湿地木栈道
- 几何：曲折栈道 + 小亭 + 泥滩区
- 变体：A 单栈道，B 分叉栈道，C 半塌栈道
- 资源：中低价值但高伏击收益

## 路径与战术通道
- 主干道：西(农田) → 中央(温室/工厂) → 北(铁路)
- 次级道：南(矿洞) → 中央 → 东(湿地)
- 隐蔽道：湿地边缘小径、谷仓后墙小道
- 关键交叉点：工厂外装卸区、铁路断桥、矿洞坡道

## 撤离点设计（多点）
- 北侧“旧车站撤离”
  - 条件：持续停留 2s；噪音提示低
- 西侧“谷仓外撤离”
  - 条件：需要携带“农场钥匙”或临时通电
- 东侧“湿地信号撤离”
  - 条件：暴露高；撤离前 1s 触发音效

## 资源与风险配置
- 中央工厂/温室：高风险高回报，稀有权重 +30%
- 南侧矿洞：稀有材料 + 任务资源，风险中高
- 西侧谷仓：稳定补给，低风险
- 北侧铁路：任务物品 + 路线控制点
- 东侧湿地：低资源但伏击点位密集

## 障碍物与掩体分层
- 硬遮挡：厂房墙、石场巨石、车厢
- 半遮挡：谷仓矮墙、矿车、木箱
- 软遮挡：作物带、树林、湿地芦苇

## 生成规则（可直接映射到 MapGen）
- POI 密度：中央 2~3 个，外围每象限 1~2 个
- 障碍物填充：路径边缘 + POI 外圈 30~50px 形成战术带
- Loot 生成：
  - 按区域 riskLevel 选择物品权重
  - 任务物在铁路残骸/矿洞/温室中限定出现
- 出生点：靠近西/东边缘，避免中央 300px 半径

## 事件钩子（可选）
- 空投：落在铁路断桥附近
- 风暴雨：湿地区域移动惩罚 + 视野减弱
- 临时封锁：工厂侧门 1 分钟关闭

# Search/Looting System (Container Reveal, Tarkov-style)

## Goals
- Containers reveal items progressively while searching.
- Search can be interrupted (movement, damage, manual cancel).
- Partial progress persists; other players can continue from remaining reveal.

## Core Concepts
- Container: a world object with a deterministic loot table and a reveal state.
- Reveal state: how many items/slots are already revealed globally.
- Search session: per-player transient progress toward revealing the next item.

## Data Model (Server Authoritative)
- Container instance:
  - cid: string
  - typeId: string (defines loot table + size)
  - x, y: number
  - slots: number (total revealable slots)
  - revealedCount: number (0..slots)
  - items: ItemInstance[] (pre-rolled at spawn OR rolled on reveal)
  - lastSearchTick?: number (optional, for locking or cooldown)

- Search session (per player, per container):
  - playerId
  - cid
  - progressMs: number
  - active: boolean

## Reveal Rules (Tarkov-style)
- Each reveal step exposes 1 slot or 1 item.
- Reveal time per slot depends on container type (e.g. 800ms~1500ms).
- If search is interrupted, progress resets for that slot but revealedCount stays.
- Other players can continue from the current revealedCount.

## Interaction Flow
1) Player starts search on container (within radius).
2) Server creates/updates session, increments progress each tick.
3) When progressMs >= revealTime:
   - revealedCount += 1
   - emit event S2C_CONTAINER_REVEAL (cid, revealedCount, newlyRevealedItem)
   - reset progressMs to 0
4) If player cancels/moves/gets hit -> session.active = false.

## Loot Roll Strategy
Option A: Pre-roll all items at container spawn.
- Pros: deterministic, shared reveal consistent.
- Cons: more initial RNG usage.

Option B: Roll on reveal.
- Pros: less upfront work.
- Cons: requires deterministic RNG per reveal step to avoid divergence.

## Network/Protocol Additions
- C2S_START_SEARCH { cid }
- C2S_CANCEL_SEARCH { cid }
- S2C_CONTAINER_STATE { cid, revealedCount, itemsRevealed[] }
- S2C_CONTAINER_REVEAL { cid, revealedCount, item }

## Client UX
- Show search bar with per-slot progress.
- Display revealed items as they appear.
- If interrupted, bar resets but revealed items persist.

## Edge Cases
- Multiple players searching same container: only one active session per container OR allow multiple but reveal is global.
- Container emptied: revealedCount == items.length; search completes.
- Combat interruption: any damage event cancels active search session.

## Integration Points
- MapGen spawns containers as POI props.
- Room tick updates active search sessions.
- WORLD_INIT includes container list (static positions + typeId).
