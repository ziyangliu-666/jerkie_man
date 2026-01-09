# @roomgroup 快速参考指南

## 基本语法

```
@roomgroup layout=布局类型 x=起点X y=起点Y [其他参数]
  房间1: [尺寸参数] doors=门方向
  房间2: [尺寸参数] doors=门方向
  ...
```

## 三种布局类型

### 1️⃣ horizontal (横向排列)

房间从左到右水平排列。

```
@roomgroup layout=horizontal x=500 y=500 cellH=400
  left: w=300 doors=e
  middle: w=500 doors=we
  right: w=300 doors=w
```

**必需参数:**
- `x`, `y`: 起点坐标
- `cellH`: 统一高度（或每个房间指定 `h=`）

**房间参数:**
- `w=宽度`: 每个房间的宽度（必需）
- `doors=`: 门的方向

---

### 2️⃣ vertical (纵向排列)

房间从上到下垂直排列。

```
@roomgroup layout=vertical x=100 y=600 cellW=300
  top: h=200 doors=s
  middle: h=300 doors=ns
  bottom: h=200 doors=n
```

**必需参数:**
- `x`, `y`: 起点坐标
- `cellW`: 统一宽度（或每个房间指定 `w=`）

**房间参数:**
- `h=高度`: 每个房间的高度（必需）
- `doors=`: 门的方向

---

### 3️⃣ grid (网格布局)

房间以网格形式排列。

```
@roomgroup layout=grid x=1400 y=100 cols=2 rows=2 cellW=250 cellH=200
  room1: doors=se
  room2: doors=sw
  room3: doors=ne
  room4: doors=nw
```

**必需参数:**
- `x`, `y`: 起点坐标
- `cols`: 列数
- `rows`: 行数（可选，根据房间数量自动计算）
- `cellW`, `cellH`: 单元格宽高

**房间排列顺序:** 从左到右，从上到下
```
[room1] [room2]
[room3] [room4]
```

---

## 门的方向参数

`doors=` 参数是 `n`(北) `s`(南) `e`(东) `w`(西) 的组合:

| 示例 | 说明 |
|------|------|
| `doors=` | 无门（封闭房间） |
| `doors=n` | 仅北门 |
| `doors=ns` | 南北各一扇门 |
| `doors=we` | 东西各一扇门 |
| `doors=nse` | 北、南、东各一扇门 |
| `doors=nswe` 或 `wens` | 四个方向都有门 |

---

## 完整参数列表

| 参数 | 必需 | 默认值 | 说明 |
|------|------|--------|------|
| `layout` | ✅ | - | `horizontal` / `vertical` / `grid` |
| `x` | ✅ | - | 房间组起点X坐标 |
| `y` | ✅ | - | 房间组起点Y坐标 |
| `cellW` | ◻️ | 300 | 统一宽度 |
| `cellH` | ◻️ | 300 | 统一高度 |
| `cols` | ◻️ | 2 | 网格列数（仅grid） |
| `rows` | ◻️ | auto | 网格行数（仅grid） |
| `wallThickness` | ◻️ | 20 | 墙体厚度 |
| `doorWidth` | ◻️ | 120 | 门的宽度/高度 |

---

## 实用示例

### T型三房结构（大厅+左右翼）

```
@roomgroup layout=horizontal x=200 y=500 cellH=400
  west_wing: w=300 doors=e
  main_hall: w=500 doors=wens
  east_wing: w=300 doors=w
```

### 井字型九宫格

```
@roomgroup layout=grid x=500 y=500 cols=3 rows=3 cellW=200 cellH=200
  nw: doors=se
  n: doors=swe
  ne: doors=sw
  w: doors=nse
  center: doors=nswe
  e: doors=nsw
  sw: doors=ne
  s: doors=nwe
  se: doors=nw
```

### 走廊+房间

```
@roomgroup layout=horizontal x=100 y=800 cellH=150
  corridor: w=800 doors=e
  room: w=300 doors=w
```

### 多层办公楼（垂直）

```
@roomgroup layout=vertical x=1000 y=100 cellW=400
  floor3: h=250 doors=s
  floor2: h=250 doors=ns
  floor1: h=250 doors=n
```

---

## 与旧语法对比

### ❌ 旧方式（有墙角缝隙）

```
# 需要手动计算坐标，容易出错
@room x=500 y=500 w=500 h=400 door=ns walls=ns
@room x=1000 y=550 w=300 h=300 door=w  # 坐标不对齐!
@room x=200 y=550 w=300 h=300 door=e   # 坐标不对齐!
```

### ✅ 新方式（完全无缝）

```
# 自动对齐，零缝隙
@roomgroup layout=horizontal x=200 y=500 cellH=400
  west: w=300 doors=e
  center: w=500 doors=wens
  east: w=300 doors=w
```

---

## 常见问题

### Q: 能否混合使用 @room 和 @roomgroup？
**A:** 可以！在同一地图中可以混用两种语法。简单的独立房间用 `@room`，复杂的多房间结构用 `@roomgroup`。

### Q: 房间数量有限制吗？
**A:** 没有硬性限制，但建议单个 `@roomgroup` 不超过10个房间以保持可读性。

### Q: 能否自定义单个房间的墙体厚度？
**A:** 当前版本不支持。所有房间共享相同的 `wallThickness` 参数。

### Q: grid布局的房间数量必须等于 cols×rows 吗？
**A:** 不需要。可以少于 cols×rows，未定义的位置将保持空白。

### Q: 能否在 @roomgroup 内部添加障碍物？
**A:** 可以！在 `@roomgroup` 之后使用普通的 `@obstacle` 指令即可：
```
@roomgroup layout=horizontal x=500 y=500 cellH=400
  room1: w=300 doors=e
  room2: w=300 doors=w

@obstacle x=600 y=650 w=40 h=40 type=crate
```

---

## 测试验证

1. **启动服务器**
   ```bash
   npm run dev:all
   ```

2. **选择地图**
   - `roomgroup_showcase`: 完整示例地图
   - `feature_showcase_v1`: 修复后的example3

3. **检查要点**
   - ✅ 墙角完全闭合
   - ✅ 门可以正常交互
   - ✅ 共享墙不重叠

---

## 贡献示例

如果您创建了有趣的房间布局，欢迎分享到 `shared/maps/` 目录！
