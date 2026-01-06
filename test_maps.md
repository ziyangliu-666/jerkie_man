# 地图系统测试指南

## 快速测试步骤

### 1. 测试城市废墟地图

```bash
npm run dev:urban
```

预期输出：
```
[SERVER] Server listening 
  mapTemplate=urban_ruins 
  mapTemplateId=urban_ruins 
  seed=42069
```

### 2. 测试森林哨站地图

```bash
npm run dev:forest
```

预期输出：
```
[SERVER] Server listening 
  mapTemplate=forest_outpost 
  mapTemplateId=forest_outpost 
  seed=13337
```

### 3. 测试随机生成（默认）

```bash
npm run dev:server
```

预期输出：
```
[SERVER] Server listening 
  mapTemplate=random 
  mapTemplateId=N/A 
  seed=<random_number>
```

### 4. 测试运行时切换

启动服务器后，在控制台输入：

```javascript
// 列出可用地图
admin.listMapTemplates()
// 输出: ['example', 'forest_outpost', 'urban_ruins']

// 切换到城市废墟
admin.setMapTemplate('urban_ruins')
// 会重置房间并加载新地图

// 切换回随机生成
admin.setMapTemplate(null)
// 会重置房间并使用随机生成

// 重新加载地图文件
admin.reloadMapTemplates()
// 从磁盘重新读取所有地图文件
```

### 5. 测试地图信息

```javascript
// 显示当前房间信息
admin.showRoom()
// 输出包含: mapTemplateId, seed, players, bullets 等
```

## 验证清单

- [ ] ✅ 城市废墟地图加载成功
- [ ] ✅ 森林哨站地图加载成功
- [ ] ✅ 示例地图加载成功
- [ ] ✅ 随机生成仍然可用
- [ ] ✅ 运行时切换地图功能正常
- [ ] ✅ 地图信息正确显示
- [ ] ✅ 启动脚本工作正常

## 常见问题

### 地图未找到

**症状**: `Map template "xxx" not found`

**解决**:
1. 检查文件是否在 `shared/maps/` 目录
2. 检查文件扩展名是否为 `.map.txt`
3. 检查 `@meta id` 是否与 MAP_TEMPLATE 匹配
4. 运行 `admin.listMapTemplates()` 查看可用地图

### 语法错误

**症状**: 服务器启动失败，显示解析错误

**解决**:
1. 检查所有必需字段是否存在
2. 检查数字格式是否正确
3. 检查引号是否匹配
4. 参考 `shared/maps/README.md` 了解正确格式

### 环境变量不生效

**症状**: 设置了 MAP_TEMPLATE 但仍使用随机生成

**解决**:
1. Windows CMD: `set MAP_TEMPLATE=urban_ruins && npm run dev:server`
2. Windows PowerShell: `$env:MAP_TEMPLATE='urban_ruins'; npm run dev:server`
3. 或使用便捷脚本: `npm run dev:urban`

## 性能测试

### 地图加载时间

正常情况下，地图加载应该在 100ms 内完成。

### 内存使用

- 小地图 (1500x1500): ~5MB
- 中地图 (2000x2000): ~8MB
- 大地图 (2500x2500): ~12MB

### 障碍物数量

建议：
- 小地图: 10-20 个障碍物
- 中地图: 15-30 个障碍物
- 大地图: 20-40 个障碍物

## 下一步

测试通过后，可以：
1. 创建自己的地图
2. 让 LLM 生成地图
3. 调整现有地图
4. 分享地图文件
