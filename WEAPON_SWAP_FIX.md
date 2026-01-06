# 武器交换崩溃和射速问题修复

## 问题描述
当玩家快速连续使用交换按钮交换武器时，出现以下问题：

### 1. 游戏崩溃（Zod 验证错误）
```
ZodError: [
  {
    "code": "too_small",
    "minimum": 0,
    "type": "number",
    "inclusive": false,
    "exact": false,
    "message": "Number must be greater than 0",
    "path": ["players", 1, "inventory", "items", 7, "qty"]
  }
]
```

### 2. 武器消失
连续交换武器后，武器会从背包中消失。

### 3. 射速异常
从狙击枪切换到冲锋枪后，冲锋枪只能单发，射速和狙击枪一样慢。

## 根本原因

### 问题 1：Zod 验证错误
在 `removeItem` 方法中，当移除物品的确切数量时，物品的 `qty` 会变为 0，但在某些情况下，物品可能没有立即从数组中移除。当服务器进行快照广播（每 100ms）时，如果时机恰好，快照会包含 `qty: 0` 的物品，这违反了 Zod 验证规则（要求数量大于 0）。

### 问题 2：武器消失
在 `handleRaidEquip` 方法中，代码错误地移除了 `weaponItem.qty` 数量的武器，而不是只移除 1 个。

### 问题 3：射速异常
客户端的 `getLocalFireCooldownMs()` 和 `getLocalBulletSpeed()` 函数使用 `playerProfile.equipment` 来获取武器信息，但在局内交换武器时，`playerProfile` 不会立即更新。应该优先使用 `raidLocalPlayer.weaponRuntime.weaponTypeId` 来获取当前装备的武器。

## 修复内容

### 服务端修复
1. 改进 `removeItem` 方法，使用 `findIndex` 直接获取索引，确保 `qty` 为 0 时立即移除
2. 在 `toState` 方法中添加安全过滤，过滤掉任何 `qty <= 0` 的物品
3. 修复武器/背包/护甲交换逻辑，只移除 1 个物品，装备的物品数量设置为 1

### 客户端修复
1. 修复 `getLocalFireCooldownMs()` 函数，优先使用 `raidLocalPlayer.weaponRuntime.weaponTypeId`
2. 修复 `getLocalBulletSpeed()` 函数，优先使用 `raidLocalPlayer.weaponRuntime.weaponTypeId`

## 修复效果
- ✅ 防止武器交换时出现 Zod 验证错误
- ✅ 防止武器在交换时消失
- ✅ 修复射速异常：切换武器后使用正确的射速
- ✅ 确保背包数据的一致性
- ✅ 游戏不再因为快速武器交换而崩溃

## 测试建议
1. 快速连续点击武器交换按钮
2. 测试从狙击枪切换到冲锋枪，验证射速正确
3. 验证武器不会在交换后消失
4. 验证服务器日志中不再出现 Zod 验证错误
