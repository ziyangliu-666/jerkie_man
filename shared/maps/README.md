# Map Template Format Guide (地图模板格式指南)

## Overview (概述)

This directory contains map templates in a simple text format designed to be easy for both humans and LLMs to read and write.

本目录包含地图模板文件，使用简单的文本格式，便于人类和 AI 阅读和编写。

## File Format (文件格式)

Map files use the `.map.txt` extension and follow the MAPTEXT v1 format.

地图文件使用 `.map.txt` 扩展名，遵循 MAPTEXT v1 格式。

## Basic Syntax (基础语法)

- **Comments (注释)**: Lines starting with `#` are comments and will be ignored
  - 以 `#` 开头的行是注释，会被忽略
- **Directives (指令)**: Lines starting with `@` are directives that define map elements
  - 以 `@` 开头的行是指令，用于定义地图元素
- **Parameters (参数)**: Can be positional or key-value pairs
  - 参数可以是位置参数或键值对
  - Positional: `@spawn 200 200`
  - Key-value: `@spawn x=200 y=200`
- **Quoted Strings (引号字符串)**: Use double quotes for strings with spaces
  - 包含空格的字符串需要使用双引号
  - Example: `name="My Map Name"`

## Directives (指令详解)

### @meta - Map Metadata (地图元数据)

Defines the map's identity and description.

定义地图的标识和描述信息。

**Syntax (语法):**
```
@meta id=map_id name="Display Name" desc="Map description"
```

**Parameters (参数):**
- `id` (required 必需): Unique identifier for the map (地图唯一标识符)
- `name` (optional 可选): Human-readable display name (人类可读的显示名称)
- `desc` or `description` (optional 可选): Brief description of the map (地图简要描述)

**Example (示例):**
```
@meta id=strategic_mansion name="战略豪宅" desc="中心对称大地图：豪宅建筑群 + 外围战术区域"
```

### @map - Map Configuration (地图配置)

Defines the map dimensions and seed.

定义地图尺寸和随机种子。

**Syntax (语法):**
```
@map width=2000 height=2000 seed=12345
# or positional (或使用位置参数):
@map 2000 2000 12345
```

**Parameters (参数):**
- `width` (required 必需): Map width in pixels (地图宽度，单位像素)
- `height` (required 必需): Map height in pixels (地图高度，单位像素)
- `seed` (optional 可选): Random seed for reproducibility (随机种子，用于可重现性)

**Example (示例):**
```
@map width=2500 height=2500 seed=20250109
```

### @extract - Extraction Zone (撤离区)

Defines the safe extraction area (rectangular).

定义安全撤离区域（矩形）。

**Syntax (语法):**
```
@extract x=1800 y=1800 w=200 h=200
# or positional (或使用位置参数):
@extract 1800 1800 200 200
```

**Parameters (参数):**
- `x` (required 必需): X coordinate of top-left corner (左上角 X 坐标)
- `y` (required 必需): Y coordinate of top-left corner (左上角 Y 坐标)
- `w` (required 必需): Width of the zone (区域宽度)
- `h` (required 必需): Height of the zone (区域高度)

**Example (示例):**
```
@extract x=1150 y=1150 w=200 h=200
```

### @obstacle - Obstacle/Building (障碍物/建筑)

Defines a solid obstacle (wall, crate, chest, etc.).

定义固体障碍物（墙壁、箱子、宝箱等）。

**Syntax (语法):**
```
@obstacle x=300 y=300 w=200 h=150 type=wall
# or positional (或使用位置参数):
@obstacle 300 300 200 150 type=wall
```

**Parameters (参数):**
- `x` (required 必需): X coordinate of top-left corner (左上角 X 坐标)
- `y` (required 必需): Y coordinate of top-left corner (左上角 Y 坐标)
- `w` (required 必需): Width of the obstacle (障碍物宽度)
- `h` (required 必需): Height of the obstacle (障碍物高度)
- `type` (optional 可选): Obstacle type (default: `wall`) (障碍物类型，默认：`wall`)
- `id` (optional 可选): Unique identifier (唯一标识符)
- `hp` (optional 可选): Hit points for destructible objects (可破坏物体的生命值)
- `maxHp` (optional 可选): Maximum hit points (最大生命值)

**Obstacle Types (障碍物类型):**

#### Basic Types (基础类型)
- `wall`: Stone wall - indestructible, blocks everything (石墙：不可破坏，阻挡一切)
- `bush`: Bush - passable, provides concealment (草丛：可穿过，提供视野遮挡)
- `water`: Water - impassable, bullets pass through (水域：不可穿过，子弹可穿过)

#### Destructible Containers (可破坏容器)
- `crate`: Wooden crate - destructible (HP: 100), drops random items (木箱：可破坏，掉落随机物品)
- `weapon_crate`: Weapon crate - drops weapons (武器箱：掉落武器)
- `throwable_crate`: Throwable crate - drops grenades/smoke bombs (投掷物箱：掉落手雷/烟雾弹)
- `medical_crate`: Medical crate - drops medical supplies (医疗箱：掉落医疗用品)
- `equipment_crate`: Equipment crate - drops armor/backpacks (装备箱：掉落护甲/背包)
- `chest_closed`: Treasure chest - can be opened/destroyed (宝箱：可打开/破坏)
- `chest_open`: Opened chest - already looted (已打开的宝箱：已搜刮)

#### Outdoor Resources (户外资源点)
- `vehicle`: Abandoned vehicle - drops random items (HP: 150) (废弃车辆：掉落随机物品)
- `supply_stack`: Supply stack - mixed supplies (HP: 100) (物资堆：混合物资)

#### Outdoor Structures (户外建筑)
- `fence_wood`: Wooden fence - low cover (HP: 50) (木栅栏：低矮掩体)
- `fence_metal`: Metal fence - medium cover (HP: 100) (金属栅栏：中等掩体)
- `shrub`: Shrub - low obstruction (灌木丛：低矮遮挡)
- `rock_large`: Large rock - solid cover (大岩石：坚固掩体)

#### Interactive Objects (交互物体)
- `door_closed`: Closed door - blocks passage and vision, destructible (HP: 100) (关闭的门：阻挡通行和视野，可破坏)
- `door_open`: Open door - passable, doesn't block vision (打开的门：可穿过，不阻挡视野)
- `glass`: Glass - blocks passage, bullets pass through, destructible (HP: 30) (玻璃：阻挡通行，子弹可穿过，可破坏)
- `broken`: Broken debris - passable, doesn't block vision (损坏的残骸：可穿过，不阻挡视野)

**Chest-specific Parameters (宝箱专用参数):**
- `chestItems`: Comma-separated list of item IDs (物品ID列表，逗号分隔)
- `chestCapacity`: Maximum number of items (最大物品数量)
- `chestRespawnDelay`: Respawn delay in ticks (重刷延迟，单位tick)
- `chestRespawnCount`: Number of items to respawn (重刷物品数量)
- `chestLootTable`: Loot table ID (掉落表ID)
- `chestRarityWeights`: Rarity weights (稀有度权重)

**Door-specific Parameters (门专用参数):**
- `doorOpen`: Whether door is initially open (true/false) (门初始是否打开)
- `doorLocked`: Whether door is locked (true/false) (门是否锁定)
- `doorKeyId`: Key item ID required to unlock (解锁所需钥匙物品ID)
- `doorAutoClose`: Whether door auto-closes (true/false) (门是否自动关闭)
- `doorAutoCloseDelay`: Auto-close delay in ticks (自动关闭延迟，单位tick)

**Examples (示例):**
```
# Basic wall (基础墙壁)
@obstacle x=300 y=300 w=200 h=150 type=wall

# Destructible crate (可破坏箱子)
@obstacle x=500 y=500 w=30 h=30 type=crate

# Weapon crate (武器箱)
@obstacle x=1050 y=1080 w=40 h=40 type=weapon_crate

# Bush for concealment (用于隐蔽的草丛)
@obstacle x=880 y=880 w=45 h=45 type=bush

# Water area (水域)
@obstacle x=120 y=860 w=120 h=280 type=water
```

### @spawn - Spawn Point (出生点)

Defines a player spawn location.

定义玩家出生位置。

**Syntax (语法):**
```
@spawn x=200 y=200
# or positional (或使用位置参数):
@spawn 200 200
```

**Parameters (参数):**
- `x` (required 必需): X coordinate (X 坐标)
- `y` (required 必需): Y coordinate (Y 坐标)

**Example (示例):**
```
# Four corner spawns (四个角落出生点)
@spawn x=200 y=200
@spawn x=2300 y=200
@spawn x=200 y=2300
@spawn x=2300 y=2300
```

### @poi - Point of Interest (兴趣点)

Defines a notable location (building, landmark, etc.).

定义显著位置（建筑、地标等）。

**Syntax (语法):**
```
@poi x=450 y=275 id=warehouse type=building name="Warehouse" desc="Large storage building"
# or positional (或使用位置参数):
@poi 450 275 id=warehouse type=building name="Warehouse"
```

**Parameters (参数):**
- `x` (required 必需): X coordinate (X 坐标)
- `y` (required 必需): Y coordinate (Y 坐标)
- `id` (required 必需): Unique identifier (唯一标识符)
- `type` (required 必需): POI type (POI 类型)
- `name` (optional 可选): Display name (显示名称)
- `desc` or `description` (optional 可选): Description (描述)

**POI Types (POI 类型):**
- `building`: Structure or building (建筑或结构)
- `landmark`: Notable location (显著地标)
- `resource`: Resource gathering point (资源采集点)
- `generic`: Unspecified POI type (未指定类型)

**Example (示例):**
```
@poi x=1250 y=1250 id=mansion_center type=landmark name="豪宅中心" desc="中央大厅，撤离点所在"
@poi x=400 y=400 id=nw_resource type=resource name="西北资源点" desc="外围资源区"
```

### @zone - Functional Zone (功能区域)

Defines a rectangular area with specific properties.

定义具有特定属性的矩形区域。

**Syntax (语法):**
```
@zone x=150 y=150 w=650 h=400 id=north_district type=loot name="North District" desc="High loot area"
# or positional (或使用位置参数):
@zone 150 150 650 400 id=north_district type=loot
```

**Parameters (参数):**
- `x` (required 必需): X coordinate of top-left corner (左上角 X 坐标)
- `y` (required 必需): Y coordinate of top-left corner (左上角 Y 坐标)
- `w` (required 必需): Width of the zone (区域宽度)
- `h` (required 必需): Height of the zone (区域高度)
- `id` (required 必需): Unique identifier (唯一标识符)
- `type` (required 必需): Zone type (区域类型)
- `name` (optional 可选): Display name (显示名称)
- `desc` or `description` (optional 可选): Description (描述)

**Zone Types (区域类型):**
- `safe`: Low-risk area (低风险区域)
- `danger`: High-risk area (高风险区域)
- `loot`: Area with resources (资源区域)
- `pvp`: High-traffic combat zone (高流量战斗区域)
- `generic`: Unspecified zone type (未指定类型)

**Example (示例):**
```
@zone x=900 y=900 w=700 h=700 id=mansion_zone type=danger name="豪宅区" desc="中央建筑群，AI密集"
@zone x=0 y=0 w=1250 h=1250 id=northwest_zone type=loot name="西北区" desc="外围资源区"
```

### @aispawn / @ai - AI Spawn Point (AI 生成点)

Defines an AI spawn location with behavior and role.

定义 AI 生成位置及其行为和角色。

**Syntax (语法):**
```
@aispawn x=1000 y=1000 type=guard role=heavy_gunner count=1 radius=150
# or positional (或使用位置参数):
@aispawn 1000 1000 type=patrol role=scout patrol=point1,point2
```

**Parameters (参数):**
- `x` (required 必需): X coordinate (X 坐标)
- `y` (required 必需): Y coordinate (Y 坐标)
- `type` (required 必需): AI behavior type (AI 行为类型)
  - `guard`: Stationary guard (守卫，固定位置)
  - `patrol`: Patrol between points (巡逻，在点之间移动)
- `role` (optional 可选): AI role preset (default: `basic`) (AI 角色预设，默认：`basic`)
- `count` (optional 可选): Number of AIs to spawn (default: 1) (生成 AI 数量，默认：1)
- `weapon` or `weaponTypeId` (optional 可选): Weapon type ID (武器类型 ID，覆盖角色预设)
- `radius` or `guardRadius` (optional 可选): Guard patrol radius (守卫巡逻半径)
- `patrol` or `patrolPointIds` (optional 可选): Comma-separated patrol point IDs (巡逻点 ID 列表，逗号分隔)
- `vision` or `visionRange` (optional 可选): Vision range in pixels (视野范围，单位像素)
- `visionAngle` (optional 可选): Vision angle in degrees (视野角度，单位度)
- `hp` (optional 可选): Custom hit points (自定义生命值)
- `armor` or `armorReduction` (optional 可选): Armor damage reduction (0-1) (护甲减伤，0-1)
- `speed` or `moveSpeed` (optional 可选): Movement speed multiplier (移动速度倍率)

**AI Roles (AI 角色):**

#### basic - Basic AI (基础 AI)
- **Weapon (武器)**: Pistol (手枪)
- **HP (生命值)**: 100
- **Armor (护甲)**: 0%
- **Vision (视野)**: 300px, 360°
- **Speed (速度)**: 1.0x (normal 正常)
- **Aim Error (瞄准误差)**: ±5°
- **Fire Rate (射速)**: 1.0x
- **Color (颜色)**: Orange (橙色), 20px
- **Description (描述)**: Balanced all-around AI (平衡型全能 AI)

#### sniper - Sniper (狙击手)
- **Weapon (武器)**: Sniper Rifle (狙击步枪)
- **HP (生命值)**: 80
- **Armor (护甲)**: 0%
- **Vision (视野)**: 600px, 90° (focused 聚焦)
- **Speed (速度)**: 0.8x (slow 慢)
- **Aim Error (瞄准误差)**: ±1° (precise 精准)
- **Fire Rate (射速)**: 0.8x (slow 慢)
- **Aggro Range (攻击距离)**: 500px
- **Color (颜色)**: Purple (紫色), 18px
- **Description (描述)**: Long-range precision shooter (远程精准射手)

#### heavy_gunner - Heavy Gunner (重机枪手)
- **Weapon (武器)**: SMG (冲锋枪，模拟加特林)
- **HP (生命值)**: 400
- **Armor (护甲)**: 30% damage reduction (30% 减伤)
- **Vision (视野)**: 350px, 120°
- **Speed (速度)**: 0.6x (very slow 很慢)
- **Aim Error (瞄准误差)**: ±8° (low accuracy 低精度)
- **Fire Rate (射速)**: 2.0x (rapid fire 疯狂射击)
- **Color (颜色)**: Red (红色), 26px
- **Description (描述)**: High firepower, high defense tank (高火力高防御坦克)

#### scout - Scout (侦察兵)
- **Weapon (武器)**: Pistol (手枪)
- **HP (生命值)**: 60
- **Armor (护甲)**: 0%
- **Vision (视野)**: 400px, 360°
- **Speed (速度)**: 1.5x (fast 快速)
- **Aim Error (瞄准误差)**: ±7°
- **Fire Rate (射速)**: 1.2x
- **Color (颜色)**: Cyan (青色), 16px
- **Description (描述)**: Fast-moving reconnaissance unit (快速移动侦察单位)

**Examples (示例):**
```
# Heavy gunner guard at center (中心重机枪手守卫)
@aispawn x=1050 y=1050 type=guard role=heavy_gunner count=1 radius=150

# Scout patrol between points (侦察兵巡逻)
@aispawn x=1000 y=580 type=patrol role=scout count=1 patrol=north_resource,center_extract

# Sniper guard at resource point (资源点狙击手守卫)
@aispawn x=470 y=470 type=guard role=sniper count=1 radius=160

# Basic AI with custom weapon (自定义武器的基础 AI)
@aispawn x=500 y=500 type=guard role=basic weapon=w_rifle count=1 radius=200
```

### @itemrespawn - Item Respawn Configuration (物品重刷配置)

Defines item respawn rules for the map.

定义地图的物品重刷规则。

**Syntax (语法):**
```
@itemrespawn id=global_common mode=both intervalTicks=900 count=2 maxItems=80 rarityWeights=COMMON:85,RARE:14,EPIC:1
```

**Parameters (参数):**
- `id` (optional 可选): Rule identifier for debugging (规则标识符，用于调试)
- `mode` (optional 可选): When the rule applies (default: `both`) (规则生效时机，默认：`both`)
  - `initial` or `init`: Only during initial spawn (仅初始生成)
  - `respawn` or `re`: Only during respawn (仅重刷)
  - `both`: Both initial and respawn (初始和重刷都生效)
- `interval` or `intervalTicks` (required 必需): Respawn interval in ticks (重刷间隔，单位 tick)
  - 1 tick = 50ms, so 600 ticks = 30 seconds (1 tick = 50毫秒，600 tick = 30秒)
- `count` (optional 可选): Number of items to spawn each time (default: 1) (每次生成物品数量，默认：1)
- `max` or `maxItems` (optional 可选): Maximum items on map (地图上最大物品数量)
- `zone` or `zoneId` (optional 可选): Restrict spawning to a specific zone (限制在特定区域内生成)
- `items` or `itemIds` (optional 可选): Comma-separated whitelist of item IDs (物品 ID 白名单，逗号分隔)
- `rarityWeights` or `rarity` or `lootWeights` (optional 可选): Custom rarity weights (自定义稀有度权重)
  - Format: `COMMON:85,RARE:14,EPIC:1` (格式：`COMMON:85,RARE:14,EPIC:1`)

**Examples (示例):**
```
# Global common items (全图公共物资)
@itemrespawn id=global_common mode=both intervalTicks=900 count=2 maxItems=80 rarityWeights=COMMON:85,RARE:14,EPIC:1

# Zone-specific items (区域特定物资)
@itemrespawn id=nw_common mode=both intervalTicks=900 count=1 maxItems=10 zoneId=northwest_zone rarityWeights=COMMON:85,RARE:14,EPIC:1

# High-value items in danger zone (危险区高价值物资)
@itemrespawn id=center_high mode=both intervalTicks=900 count=1 maxItems=8 zoneId=center_zone items=w_minigun,w_grenade_launcher,w_sniper,armor_heavy,bag_military rarityWeights=COMMON:10,RARE:40,EPIC:70
```

### @airespawn - AI Respawn Configuration (AI 重刷配置)

Defines AI respawn rules for the map.

定义地图的 AI 重刷规则。

**Syntax (语法):**
```
@airespawn intervalTicks=1800 maxAIs=12
```

**Parameters (参数):**
- `interval` or `intervalTicks` (required 必需): Respawn interval in ticks (重刷间隔，单位 tick)
  - 1 tick = 50ms, so 1800 ticks = 90 seconds (1 tick = 50毫秒，1800 tick = 90秒)
- `spawn` or `spawnId` (optional 可选): Specific AI spawn point ID to respawn (特定 AI 生成点 ID)
- `max` or `maxAIs` (optional 可选): Maximum AIs on map (地图上最大 AI 数量)

**Example (示例):**
```
# Respawn AI every 90 seconds, max 12 AIs (每 90 秒重刷 AI，最多 12 个)
@airespawn intervalTicks=1800 maxAIs=12
```

### @note / @comment - Comments (注释)

Add notes or comments to the map file (ignored by parser).

向地图文件添加注释（解析器会忽略）。

**Syntax (语法):**
```
@note "This is a note"
@comment "This is a comment"
```

**Example (示例):**
```
@note "战术建议：接近中心前先清理外围狙击手"
@comment "v4 AI角色系统升级"
```

### @roomgroup - Room Group (Advanced) (房间组 - 高级)

Defines a group of connected rooms with automatic wall and door generation.

定义一组相连的房间，自动生成墙壁和门。

**Basic Syntax (Absolute Position) (基础语法 - 绝对定位):**
```
@roomgroup layout=horizontal x=500 y=500 cellW=300 cellH=300 wallThickness=20 doorWidth=120
  room1: w=300 doors=e floor=wood
  room2: w=400 doors=we floor=tile
  room3: w=300 doors=w floor=tile
```

**Anchor Syntax (Relative Position) (锚点语法 - 相对定位):**
```
@roomgroup layout=horizontal anchor=center margin=60 cellW=300 cellH=300
  lobby: w=400 doors=se floor=tile
  hallway: w=200 doors=we floor=pave
  office: w=300 doors=w floor=wood
```

**Parameters (参数):**
- `layout` (required 必需): Room arrangement (房间排列方式)
  - `horizontal`: Rooms arranged left to right (水平排列，从左到右)
  - `vertical`: Rooms arranged top to bottom (垂直排列，从上到下)
  - `grid`: Rooms arranged in a grid (网格排列)
  - `corridor`: Rooms along a corridor (走廊布局，房间沿走廊排列)
- `x`, `y` (optional 可选): Absolute position (top-left corner) (绝对位置，左上角坐标)
- `anchor` (optional 可选): Relative position anchor point (相对定位锚点)
- `margin` (optional 可选): Clearance around the room group for doors/passages (default: 0) (房间组外边距，为门口留通道，默认：0)
- `cellW` (optional 可选): Default room width (default: 300) (默认房间宽度，默认：300)
- `cellH` (optional 可选): Default room height (default: 300) (默认房间高度，默认：300)
- `cols` (optional 可选): Number of columns for grid layout (default: 2) (网格布局列数，默认：2)
- `rows` (optional 可选): Number of rows for grid layout (网格布局行数)
- `wallThickness` (optional 可选): Wall thickness in pixels (default: 20) (墙壁厚度，单位像素，默认：20)
- `doorWidth` (optional 可选): Door width in pixels (default: 120) (门宽度，单位像素，默认：120)
- `id` (optional 可选): Unique identifier for the room group (房间组唯一标识符)
- `floorType` (optional 可选): Default floor type for rooms (default: tile) (默认地板类型，默认：tile)

**Corridor Layout Parameters (走廊布局参数):**
- `corridorWidth` (optional 可选): Corridor width (default: 100) (走廊宽度，默认：100)
- `corridorSide` (optional 可选): Which side rooms are on (房间在走廊的哪一侧)
  - `north`: Rooms on north side (房间在北侧)
  - `south`: Rooms on south side (房间在南侧)
  - `both`: Rooms on both sides (default) (房间在两侧，默认)

**Room Definition (indented lines) (房间定义 - 缩进行):**
```
  roomId: w=300 h=200 doors=nsew floor=wood
```
- `roomId` (required 必需): Unique room identifier (房间唯一标识符)
- `w` (optional 可选): Room width (overrides cellW) (房间宽度，覆盖 cellW)
- `h` (optional 可选): Room height (overrides cellH) (房间高度，覆盖 cellH)
- `doors` (optional 可选): Door directions - combination of `n`, `s`, `e`, `w` (门的方向 - n/s/e/w 的组合)
  - `n`: North door (北门)
  - `s`: South door (南门)
  - `e`: East door (东门)
  - `w`: West door (西门)
  - Example: `doors=nsew` (all sides), `doors=ew` (east and west only)
- `floor` (optional 可选): Floor type (地板类型)
  - `wood`: Wooden floor (木地板)
  - `tile`: Tile floor (瓷砖地板)
  - `pave`: Paved floor (铺装地板)
  - `concrete`: Concrete floor (混凝土地板)
  - `grass`: Grass floor (草地)

**Anchor Types (锚点类型):**
- `center`: Center of the map (地图中心)
- `nw`: Northwest corner (top-left) (西北角，左上)
- `n`: North edge (top-center) (北边，上中)
- `ne`: Northeast corner (top-right) (东北角，右上)
- `w`: West edge (center-left) (西边，左中)
- `e`: East edge (center-right) (东边，右中)
- `sw`: Southwest corner (bottom-left) (西南角，左下)
- `s`: South edge (bottom-center) (南边，下中)
- `se`: Southeast corner (bottom-right) (东南角，右下)

**Layout Solver (布局求解器):**

When using `anchor` positioning, the layout solver automatically:

使用 `anchor` 定位时，布局求解器会自动：

1. Calculates the room group's total size (计算房间组的总尺寸)
2. Positions it based on the anchor point (根据锚点定位)
3. Avoids overlapping with previously placed room groups (避免与之前放置的房间组重叠)
4. Avoids overlapping with the extraction zone (避免与撤离区重叠)
5. Falls back to offset positions if collision is detected (如果检测到碰撞，回退到偏移位置)

**Examples (示例):**

```
# Horizontal layout - 3 rooms in a row (水平布局 - 3 个房间一排)
@roomgroup layout=horizontal x=500 y=500 cellW=300 cellH=300
  room1: w=300 doors=e floor=wood
  room2: w=400 doors=we floor=tile
  room3: w=300 doors=w floor=tile

# Grid layout - 2x3 rooms (网格布局 - 2x3 房间)
@roomgroup layout=grid anchor=center cols=2 cellW=280 cellH=280
  master:    w=350 h=300 doors=sew floor=wood
  bedroom2:  w=280 h=300 doors=sw floor=wood
  bedroom3:  w=280 h=300 doors=sw floor=wood
  bathroom1: w=200 h=250 doors=ne floor=tile
  closet:    w=200 h=250 doors=n floor=pave
  bathroom2: w=200 h=250 doors=nw floor=tile

# Corridor layout - rooms along a hallway (走廊布局 - 房间沿走廊排列)
@roomgroup layout=corridor anchor=s margin=100 cellW=250 cellH=250 corridorWidth=120 corridorSide=north
  kitchen: w=300 doors=ns floor=tile
  pantry:  w=200 doors=s floor=concrete
  dining:  w=350 doors=ns floor=wood
  storage: w=250 doors=s floor=concrete

# Centered mansion with anchor (使用锚点的中心豪宅)
@roomgroup layout=horizontal anchor=center margin=120
  west_lounge: w=350 h=500 doors=esw floor=wood
  grand_hall:  w=500 h=500 doors=nsew floor=tile
  east_lounge: w=350 h=500 doors=esw floor=wood
```

## Coordinate System (坐标系统)

- Origin (0, 0) is at the top-left corner (原点 (0, 0) 在左上角)
- X increases to the right (X 向右递增)
- Y increases downward (Y 向下递增)
- All coordinates are in pixels (所有坐标单位为像素)

## Complete Example (完整示例)

See `strategic_mansion.map.txt` for a complete example of a complex map with:
- Multiple room groups with different layouts (多个不同布局的房间组)
- AI spawn points with different roles (不同角色的 AI 生成点)
- Item respawn configurations (物品重刷配置)
- Zones and POIs (区域和兴趣点)

查看 `strategic_mansion.map.txt` 获取完整的复杂地图示例。

## Usage (使用方法)

### Loading a Map (加载地图)

Set the `MAP_TEMPLATE` environment variable when starting the server:

启动服务器时设置 `MAP_TEMPLATE` 环境变量：

```bash
# Use a specific map (使用特定地图)
MAP_TEMPLATE=strategic_mansion npm run server

# Use random generation (default) (使用随机生成，默认)
npm run server
```

### Creating a New Map (创建新地图)

1. Create a new `.map.txt` file in this directory (在此目录创建新的 `.map.txt` 文件)
2. Start with the required directives: `@meta`, `@map`, `@extract` (从必需指令开始)
3. Add obstacles, spawns, POIs, and zones as needed (根据需要添加障碍物、出生点、POI 和区域)
4. Test by loading with `MAP_TEMPLATE=your_map_id` (使用 `MAP_TEMPLATE=your_map_id` 测试)

### Map Validation (地图验证)

Use the map linter tool to check for errors:

使用地图检测工具检查错误：

```bash
# Check a single map (检查单个地图)
npm run map:lint shared/maps/your_map.map.txt

# Check all maps (检查所有地图)
npm run map:lint --all

# Output JSON format (输出 JSON 格式)
npm run map:lint --json shared/maps/your_map.map.txt
```

The linter checks for:
- Obstacles out of bounds (障碍物越界)
- Spawn points blocked by obstacles (出生点被障碍物覆盖)
- Extraction zone blocked (撤离区被覆盖)
- Obstacle overlaps (障碍物重叠)
- Room groups without external doors (房间组无外部入口)

检测器会检查：
- 障碍物越界
- 出生点被障碍物覆盖
- 撤离区被覆盖
- 障碍物重叠
- 房间组无外部入口

## Tips for Map Design (地图设计技巧)

### Balance (平衡性)
- Distribute spawns evenly around the perimeter (在周边均匀分布出生点)
- Place high-value loot in dangerous areas (将高价值物资放在危险区域)
- Mix open spaces with cover (混合开放空间和掩体)

### Cover and Concealment (掩体和隐蔽)
- Use `wall` for hard cover (使用 `wall` 作为硬掩体)
- Use `bush` for concealment (使用 `bush` 作为隐蔽)
- Use `crate` for destructible cover (使用 `crate` 作为可破坏掩体)

### Flow and Chokepoints (流动和咽喉点)
- Create corridors and chokepoints for tactical gameplay (创建走廊和咽喉点以实现战术玩法)
- Leave open spaces for movement (留出开放空间供移动)
- Use room groups for complex indoor areas (使用房间组创建复杂室内区域)

### AI Placement (AI 放置)
- Place heavy gunners in defensive positions (将重机枪手放在防御位置)
- Use snipers to cover open areas (使用狙击手覆盖开放区域)
- Place scouts on patrol routes (将侦察兵放在巡逻路线上)
- Guard high-value loot with stronger AI (用更强的 AI 守卫高价值物资)

### Scale and Density (规模和密度)
- Keep dimensions reasonable (1500-3000 pixels) (保持合理尺寸，1500-3000 像素)
- Don't overcrowd - leave open spaces (不要过度拥挤 - 留出开放空间)
- Balance indoor and outdoor areas (平衡室内和室外区域)

## Validation (验证)

The parser will validate:

解析器会验证：

- Required fields are present (必需字段存在)
- Numbers are valid and non-negative (数字有效且非负)
- Dimensions are positive (尺寸为正数)
- IDs are unique within their category (ID 在其类别内唯一)

## Quick Reference (快速参考)

### Common Item IDs (常见物品 ID)
- Weapons: `w_pistol`, `w_rifle`, `w_shotgun`, `w_smg`, `w_sniper`, `w_minigun`, `w_grenade_launcher`
- Armor: `armor_light`, `armor_medium`, `armor_heavy`
- Backpacks: `bag_small`, `bag_medium`, `bag_large`, `bag_military`
- Medical: `medkit`, `bandage`, `painkiller`
- Throwables: `grenade`, `smoke_grenade`, `flashbang`

### Tick Timing (Tick 时间)
- 1 tick = 50ms (1 tick = 50 毫秒)
- 20 ticks = 1 second (20 tick = 1 秒)
- 600 ticks = 30 seconds (600 tick = 30 秒)
- 1200 ticks = 60 seconds (1200 tick = 60 秒)
- 1800 ticks = 90 seconds (1800 tick = 90 秒)

### Recommended Map Sizes (推荐地图尺寸)
- Small: 1500x1500 (小型：1500x1500)
- Medium: 2000x2000 (中型：2000x2000)
- Large: 2500x2500 (大型：2500x2500)
- Extra Large: 3000x3000 (超大型：3000x3000)

---

For more examples, see the existing map files in this directory:
- `example2.map.txt` - Strategic center with AI roles
- `strategic_mansion.map.txt` - Complex mansion with room groups
- `complex_mansion.map.txt` - Advanced room group layouts

更多示例请查看此目录中的现有地图文件。
