## MAPTEXT 语法总览（含高级物资刷新）

本文档总结当前地图文本格式（MAPTEXT v1）支持的所有指令和字段，方便手写/编辑地图。

---

### 基础结构

- **文件头**
  - 必须以注释开头（推荐）：
    - `# MAPTEXT v1`
    - 后续行可以是任意注释或指令。

---

### `@meta` 元信息

- **作用**: 定义地图 ID、名字、描述。
- **语法**
  - 关键字参数形式：
    - `@meta id=map_id name="Display Name" desc="描述文本"`
- **字段**
  - `id` (必填): 地图唯一 ID（字符串）。
  - `name` (可选): 地图显示名。
  - `desc` / `description` (可选): 地图描述。

---

### `@map` 地图尺寸 & 随机种子

- **作用**: 设置地图宽高与随机种子。
- **语法**
  - 关键字参数：
    - `@map width=2000 height=2000 seed=12345`
  - 位置参数（宽 高 [种子]）：
    - `@map 2000 2000 12345`
- **字段**
  - `width` (必填): 地图宽度。
  - `height` (必填): 地图高度。
  - `seed` (必填/可选): 随机种子（不写则用默认）。

---

### `@extract` 撤离区

- **作用**: 定义撤离矩形区域。
- **语法**
  - 关键字参数：
    - `@extract x=1800 y=1800 w=200 h=200`
  - 位置参数：
    - `@extract 1800 1800 200 200`
- **字段**
  - `x`, `y`: 左上角坐标。
  - `w`, `h`: 宽高。

---

### `@obstacle` 障碍物

- **作用**: 放置墙体、木箱、草丛、水域等障碍物。
- **语法**
  - `@obstacle x=850 y=850 w=300 h=300 type=wall`
  - 支持位置参数或 key=value：
    - `@obstacle 850 850 300 300 type=wall`
- **字段**
  - `x`, `y`, `w`, `h` (必填): 矩形区域。
  - `type` (可选, 默认 `wall`):
    - 常用类型：`wall`, `crate`, `bush`, `water` 等。
    - `crate` 会自动补齐 `hp/maxHp`，可被子弹摧毁。

---

### `@spawn` 玩家出生点

- **作用**: 定义玩家可能的出生位置。
- **语法**
  - `@spawn x=100 y=100`
  - 或 `@spawn 100 100`
- **字段**
  - `x`, `y`: 位置。

---

### `@poi` 兴趣点（Point of Interest）

- **作用**: 给 AI 和关卡设计用的标记点（资源点、地标等）。
- **语法**
  - `@poi x=400 y=400 id=center type=landmark name="Center Point" desc="地图中心点"`
  - 也支持前两个位置参数当作 `x y`：
    - `@poi 400 400 id=center type=resource`
- **字段**
  - `id` (可选, 默认自动生成 `poi_1` 等): 唯一标识。
  - `x`, `y` (必填): 位置。
  - `type` (可选, 默认 `generic`): 如 `landmark`, `resource` 等。
  - `name` (可选): 显示名称。
  - `desc` / `description` (可选): 描述。

---

### `@zone` 区域（Zones）

- **作用**: 标记不同功能区域（安全区、危险区、战利品区等），并支持物资重刷限制到某个区域。
- **语法**
  - `@zone x=0 y=0 w=1000 h=1000 id=northwest_zone type=loot name="Northwest Zone" desc="西北资源区"`
  - 支持位置参数：
    - `@zone 0 0 1000 1000 id=northwest_zone type=loot`
- **字段**
  - `id` (可选, 默认自动生成 `zone_1` 等): 唯一标识。
  - `x`, `y`, `w`, `h` (必填): 区域矩形。
  - `type` (可选, 默认 `generic`):
    - 约定类型：`safe`, `danger`, `loot`, `pvp` 等。
    - 当前逻辑里，`type` 主要是语义标签；与物资实际掉落的权重无直接绑定，但 `id` 可被 `@itemrespawn zoneId=...` 引用来限制刷新区域。
  - `name`, `desc` (可选): 区域名称和描述。

---

### `@ai` / `@aispawn` AI 生成点

- **作用**: 在地图上布置 AI 巡逻/守卫单位。
- **语法（两种写法等价）**
  - `@aispawn x=250 y=250 type=patrol role=scout count=2 patrol=poi1,poi2 vision=300`
  - `@ai 550 550 type=guard role=sniper count=1 radius=120 vision=400`
- **通用字段**
  - 位置：
    - `x`, `y` 或前两个位置参数。
  - `type`:
    - `patrol`（巡逻）或 `guard`（守点），默认 `patrol`。
  - `role`:
    - `'basic' | 'sniper' | 'heavy_gunner' | 'scout'`，默认 `basic`。
    - 每个角色有预设的武器、HP、护甲、视野、移动速度等。
  - `weapon` (可选):
    - 指定武器 typeId（来自 `ITEM_CATALOG`，如 `w_pistol`, `w_sniper`），不写则用角色预设。
  - `count` (可选, 默认 `1`): 一次生成几个 AI。
  - `vision` (可选): 视野半径，覆盖预设。
  - `visionAngle` / `visionangle` (可选): 视野角度（度数），覆盖预设。
  - `radius` (guard 时可选): 守卫半径。
  - `patrol` (patrol 时可选):
    - 逗号分隔的 POI ID 列表，如 `patrol=west_poi,center_extract`。
  - 高级属性（可选）：
    - `hp`: 自定义 HP。
    - `armor`: 自定义护甲减伤（0~1）。
    - `speed`: 自定义移动速度倍率。

---

### `@itemrespawn` 物资重刷（支持高级配置）

- **作用**: 控制地图内自动刷新的物资，包括：
  - 刷新间隔
  - 每次生成数量
  - 最大物资数量上限
  - 刷新区域
  - **指定物品白名单**
  - **自定义稀有度权重（让某区更“富”）**

- **基础语法**
  - 最简单写法：
    - `@itemrespawn intervalTicks=600 count=2 maxItems=40`
  - 只在某个区域内刷新：
    - `@itemrespawn intervalTicks=600 count=2 maxItems=40 zoneId=northwest_zone`

- **高级语法：指定物品 & 稀有度权重**
  - 只刷新某些高价值物品：
    - `items` / `itemIds` 字段，逗号分隔：
    - 例：
      - `items=w_sniper,w_grenade_launcher,armor_heavy`
  - 调整稀有度权重（覆盖默认 60/30/10）：
    - `rarityWeights=COMMON:10,RARE:40,EPIC:100`
    - 也可使用 `rarity=` 或 `lootWeights=`（别名），解析逻辑会兼容。

- **完整字段列表**
  - `intervalTicks` (必填):
    - 重刷间隔（tick 数，1 秒约 20 tick）。
  - `count` (可选, 默认 `1`):
    - 每次重刷生成多少个物品。
  - `maxItems` (可选):
    - 地图上最多允许存在的物品数量，超过则不再生成。
  - `zoneId` / `zone` (可选):
    - 如果设置，则只在该 `@zone` 所定义的区域内随机刷物。
  - `items` / `itemIds` (可选):
    - 物品 ID 白名单，逗号分隔。
    - ID 必须存在于共享 `ITEM_CATALOG`（例如 `ammo`, `medkit`, `w_sniper`, `armor_heavy` 等）。
  - `rarityWeights` / `rarity` / `lootWeights` (可选):
    - 形式：`COMMON:x,RARE:y,EPIC:z`。
    - 任意省略项会保留为 0；权重总和大于 0 即可。
    - 若权重非法或全为 0，会回退到**池子内均匀随机**。

- **示例：基础重刷**
  - 全图随机刷，默认 60/30/10：
    - `@itemrespawn intervalTicks=600 count=2 maxItems=40`

- **示例：区域高价值物资点**
  - 在 `northwest` 区域内刷高等级物资：
    - 定义 zone：
      - `@zone x=0 y=0 w=400 h=400 id=northwest type=loot name="Northwest High Loot" desc="高价值物资区"`
    - 高级重刷配置：
      - `@itemrespawn intervalTicks=900 count=1 maxItems=10 zoneId=northwest items=w_sniper,w_grenade_launcher,armor_heavy rarityWeights=COMMON:10,RARE:40,EPIC:100`
  - 效果：
    - 刷新位置：只在 `northwest` 区域。
    - 掉落物：仅 `w_sniper`, `w_grenade_launcher`, `armor_heavy`。
    - 稀有度分布：COMMON 稍微有一点，RARE/EPIC 权重大幅提高，实现“高级物资点”。

> 注意：现在支持**多条** `@itemrespawn` 规则，每条规则都有自己的 interval / count / maxItems / zoneId / items / rarityWeights / mode。
> - 你可以用一条规则做“全图少量公共物资”，另一条规则做“某个小区域的高级物资点”；
> - 通过 `mode=initial/respawn/both` 区分“只用于开局散落”还是“只用于对局中持续刷新”。

---

### `@airespawn` AI 重刷

- **作用**: 周期性重新生成 AI。
- **语法**
  - `@airespawn intervalTicks=1200 maxAIs=5`
  - 也可绑定到特定 spawnId：
    - `@airespawn intervalTicks=1200 maxAIs=10 spawnId=center_guard`
- **字段**
  - `intervalTicks` (必填):
    - 重刷间隔（tick 数）。
  - `spawnId` / `spawn` (可选):
    - 关联到某个 `@aispawn` 的 ID（目前 spawn 行未显式定义 ID，通常全局随机选）。
  - `maxAIs` / `maxAIs` (可选):
    - 地图上最多允许存在的 AI 数量。

---

### 注释/说明指令：`@note` / `@comment`

- **作用**: 在地图文件中写说明文字，不影响逻辑。
- **语法**
  - `@note "这是一个测试地图，展示了所有支持的语法功能"`
  - `@comment "包括：元数据、地图配置、撤离点、出生点、障碍物、POI、区域、AI生成、重刷配置等"`
- **解析行为**
  - 这两个指令会被解析器忽略（只作为人类可读注释）。

---

### 语法细节与容错

- **空行 & `#` 注释**
  - 空行或以 `#` 开头的行会被忽略。
- **大小写**
  - 指令名（`@meta`, `@map`, `@obstacle` 等）大小写不敏感，内部统一为小写。
  - `rarityWeights` 中的稀有度键会被转成大写（`common` 也可以写，会被解析为 `COMMON`）。
- **参数形式**
  - 大部分位置都支持：
    - 纯位置参数（`@spawn 100 100`）
    - 或 `key=value` 形式（`@spawn x=100 y=100`）
  - 同时存在时，优先使用位置参数填充 `x/y/w/h`，其余用 `key=value`。

---

### 小结：如何快速做一个“高级物资点”

1. **划一个小区域 zone**：
   - `@zone x=500 y=500 w=300 h=300 id=high_loot_area type=loot name="High Loot Area"`
2. **写一个高级 `@itemrespawn` 配置**：
   - 例如：
     - `@itemrespawn intervalTicks=900 count=1 maxItems=8 zoneId=high_loot_area items=w_sniper,w_grenade_launcher,armor_heavy,bag_military rarityWeights=COMMON:5,RARE:40,EPIC:80`
3. （可选）在说明里标注：
   - `@note "high_loot_area: 高价值物资点，风险较高，适合后期冲点"`

这样玩家就会明显感觉到：那一小块区域既更危险（你可以配合 `@aispawn` 放重机枪手/狙击手），又明显更肥，实现你想要的“高级物资点 + 区域稀有度更高”的设计。 


