# 投掷物系统修复报告

## 🐛 问题描述

在测试投掷物系统时，发现使用手雷后服务器出现Zod验证错误：

```
ZodError: Number must be greater than 0
path: [ 'players', 0, 'inventory', 'items', 2, 'qty' ]
```

## 🔍 问题分析

1. **协议验证**: `ITEM_INSTANCE_SCHEMA`中的`qty`字段定义为`z.number().int().positive()`，要求数量必须大于0
2. **物品消耗**: 使用手雷时，从背包中移除物品可能导致数量为0的物品残留
3. **ID冲突**: 装备手雷时重用了原物品的ID，可能导致数据不一致

## 🔧 修复方案

### 1. 改进removeItem方法
```typescript
removeItem(iid: string, qty: number): boolean {
  const item = this.inventory.items.find(i => i.iid === iid);
  if (!item || item.qty < qty) {
    return false;
  }
  
  item.qty -= qty;
  if (item.qty <= 0) {
    // 确保完全移除数量为0或负数的物品
    const index = this.inventory.items.indexOf(item);
    if (index !== -1) {
      this.inventory.items.splice(index, 1);
    }
  }
  return true;
}
```

### 2. 添加背包清理方法
```typescript
cleanupInventory(): void {
  this.inventory.items = this.inventory.items.filter(item => item.qty > 0);
}
```

### 3. 修复手雷装备逻辑
```typescript
// 创建新的装备物品实例（不使用原来的iid，避免冲突）
player.equippedWeaponItem = player.createItemInstance(item.typeId, 1);

// 清理背包中可能的无效物品
player.cleanupInventory();
```

## ✅ 修复效果

1. **数据一致性**: 确保背包中不会有数量为0的物品
2. **ID唯一性**: 装备物品使用新生成的ID，避免冲突
3. **协议兼容**: 所有物品实例都符合Zod验证要求
4. **系统稳定**: 防止因数据异常导致的服务器崩溃

## 🎯 测试验证

修复后的系统应该能够：
1. 正常使用手雷（按数字键1-5）
2. 正确装备手雷并显示投掷轨迹
3. 成功投掷手雷并产生爆炸效果
4. 不再出现Zod验证错误

## 📝 技术要点

- **防御性编程**: 在关键操作后添加数据清理
- **ID管理**: 避免重用可能导致冲突的物品ID
- **协议遵循**: 确保所有数据都符合定义的schema
- **错误处理**: 优雅处理边界情况和异常状态

修复完成！投掷物系统现在应该可以稳定运行。🎉