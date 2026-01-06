# Map Editor System Implementation

## Date: 2026-01-06

## Overview

实现了基于文本的地图编辑器系统，专为 LLM 友好设计，支持快速创建和修改游戏地图。

## Changes

### 1. 扩展地图模板格式

**文件**: `shared/src/mapTemplate.ts`

新增支持的元素：
- **POI (Points of Interest)**: 标记重要位置（建筑、地标等）
- **Zone**: 功能区域（战利品区、PvP区、安全区等）
- **Description**: 地图和元素的描述信息

新增类型定义：
```typescript
export type POI = {
  id: string;
  name?: string;
  x: number;
  y: number;
  type: string; // building, landmark, resource, generic
  description?: string;
};

export type Zone = {
  id: string;
  name?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  type: string; // safe, danger, loot, pvp, generic
  description?: string;
};
```

### 2. 新增地图指令

**@poi** - 定义兴趣点
```
@poi x=450 y=275 id=warehouse type=building name="Warehouse" desc="High loot building"
```

**@zone** - 定义功能区域
```
@zone x=150 y=150 w=650 h=400 id=north type=loot name="North District"
```

**@meta** - 扩展支持描述
```
@meta id=map_id name="Display Name" desc="Map description"
```

### 3. 创建示例地图

**文件**: `shared/maps/urban_ruins.map.txt`
- 2500x2500 城市废墟主题地图
- 25+ 障碍物（建筑、掩体）
- 6 个出生点（均匀分布）
- 5 个 POI（仓库、公寓、工厂等）
- 6 个功能区域（战利品区、PvP区、撤离区）

**文件**: `shared/maps/forest_outpost.map.txt`
- 2000x2000 森林哨站主题地图
- 军事基地布局
- 围墙、塔楼、主建筑
- 森林掩体

### 4. 服务端改进

**文件**: `server/src/main.ts`

改进：
- 环境变量 trim 处理（避免空格问题）
- 启动日志显示地图信息
- 地图未找到时显示可用地图列表

```typescript
let activeMapTemplateId = process.env.MAP_TEMPLATE?.trim() ?? null;

// 启动日志
log('Server listening', {
  mapTemplate: activeMapTemplateId ?? 'random',
  mapTemplateId: room.mapTemplateId ?? 'N/A',
  seed: room.seed.toString(),
});
```

### 5. 便捷启动脚本

**文件**: `package.json`

新增脚本：
```json
{
  "dev:urban": "MAP_TEMPLATE=urban_ruins npm run dev:server",
  "dev:forest": "MAP_TEMPLATE=forest_outpost npm run dev:server",
  "dev:example": "MAP_TEMPLATE=example npm run dev:server"
}
```

使用方法：
```bash
npm run dev:urban    # 城市废墟地图
npm run dev:forest   # 森林哨站地图
npm run dev:example  # 示例地图
npm run dev:server   # 随机生成（默认）
```

### 6. 文档

**文件**: `shared/maps/README.md`
- 完整的地图格式说明
- 所有指令的参数文档
- 示例和最佳实践
- LLM 生成地图的提示

**文件**: `docs/MAP_EDITOR_GUIDE.md`
- 快速开始指南
- 地图设计指南
- 运行时管理命令
- 故障排查

**文件**: `README.md`
- 更新快速开始部分
- 添加地图系统说明
- 添加运行时管理命令

## Features

### LLM 友好设计

1. **简单语法**: 键值对格式，易于理解和生成
2. **自文档化**: 注释和描述字段
3. **灵活参数**: 支持位置参数和命名参数
4. **可扩展**: 易于添加新指令类型

### 地图元素

- ✅ 障碍物（建筑、墙体）
- ✅ 出生点
- ✅ 撤离区
- ✅ POI（兴趣点）
- ✅ 功能区域
- ✅ 地图元数据

### 运行时管理

服务端控制台命令：
```javascript
admin.listMapTemplates()           // 列出可用地图
admin.setMapTemplate('urban_ruins') // 切换地图
admin.setMapTemplate(null)         // 切换回随机生成
admin.reloadMapTemplates()         // 重新加载地图文件
admin.showRoom()                   // 显示当前房间信息
```

## Usage Examples

### 创建新地图

```
# MAPTEXT v1
@meta id=my_map name="My Custom Map" desc="A tactical PvP map"

@map width=2000 height=2000 seed=12345

@extract x=1800 y=1800 w=200 h=200

# Buildings
@obstacle x=300 y=300 w=200 h=150
@obstacle x=800 y=400 w=180 h=120

# Spawns
@spawn x=200 y=200
@spawn x=1800 y=200

# POIs
@poi x=400 y=375 id=building1 type=building name="Main Building"

# Zones
@zone x=250 y=250 w=400 h=400 id=loot1 type=loot name="Loot Zone"
```

### 加载地图

```bash
# 方式1: 环境变量
MAP_TEMPLATE=my_map npm run dev:server

# 方式2: 运行时切换
admin.setMapTemplate('my_map')
```

## Benefits

1. **快速迭代**: 文本格式易于编辑和版本控制
2. **LLM 生成**: 可以让 LLM 快速生成地图
3. **可读性**: 人类和机器都易于理解
4. **灵活性**: 支持多种地图风格和大小
5. **保持随机**: 不影响原有的随机地图生成功能

## Testing

测试步骤：
1. ✅ 编译 shared 包
2. ✅ 启动服务器加载 urban_ruins 地图
3. ✅ 验证地图信息正确显示
4. ✅ 验证随机生成仍然可用

测试结果：
```
[2026-01-06T04:56:42.123Z] [tick=0] [room=local] Server listening 
  host=0.0.0.0 
  port=18723 
  mapTemplate=urban_ruins 
  mapTemplateId=urban_ruins 
  seed=42069
```

## Backward Compatibility

- ✅ 保持随机地图生成功能
- ✅ 不指定 MAP_TEMPLATE 时使用随机生成
- ✅ 现有地图文件格式兼容
- ✅ 新增字段都是可选的

## Future Enhancements

可能的扩展：
- [ ] 可视化地图编辑器（Web UI）
- [ ] 战利品生成点
- [ ] 动态事件标记
- [ ] 生物群落系统
- [ ] 多层结构支持
- [ ] 可交互对象

## Notes

- 地图文件使用 `.map.txt` 扩展名
- 地图 ID 必须与文件名或 @meta id 匹配
- 坐标系统：原点 (0,0) 在左上角
- 所有坐标和尺寸单位为像素
- 支持注释（# 开头的行）
