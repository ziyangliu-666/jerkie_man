# 障碍物系统更新总结

## 完成的改动

### 1. 裂痕系统
- ✅ 木箱被打时显示裂痕而不是变暗
- ✅ 根据HP显示不同数量的裂痕（1/3/5条）
- ✅ 裂痕位置固定（基于障碍物ID生成伪随机种子）

### 2. 简化障碍物类型
- ✅ 移除木墙（wooden_wall）
- ✅ 移除半身掩体（cover）
- ✅ 保留4种类型：石墙、木箱、草丛、水域

### 3. 木箱掉落移除
- ✅ 木箱被破坏后不再掉落物品
- ✅ 直接消失，不生成 lootBag

### 4. 草丛隐蔽提示
- ✅ 玩家进入草丛时显示"🌿 隐蔽"提示
- ✅ 提示显示在玩家下方
- ✅ 客户端本地检测，实时响应

### 5. 障碍物实时同步
- ✅ 障碍物现在在 snapshot 中发送（而不仅在 WORLD_INIT）
- ✅ 木箱被打烂后会立即在客户端消失
- ✅ 向后兼容：如果 snapshot 中没有 obstacles，使用缓存的

## 技术实现

### 障碍物同步
```typescript
// 服务器端 (room.ts)
getSnapshot(): {
  // ...
  obstacles: OBSTACLE_STATE[]; // 每帧发送最新障碍物列表
}

// 客户端 (snapshot.ts)
getInterpolatedState(): {
  // ...
  obstacles?: OBSTACLE_STATE[]; // 使用最新帧的障碍物
}

// 客户端渲染 (main.ts)
const obstaclesForRender = state.obstacles ?? cachedObstacles;
```

### 裂痕绘制
```typescript
// 根据HP比例决定裂痕数量
const hpRatio = hp / maxHp;
let crackCount = 0;
if (hpRatio < 0.3) crackCount = 5;
else if (hpRatio < 0.6) crackCount = 3;
else if (hpRatio < 0.9) crackCount = 1;

// 使用伪随机种子确保裂痕位置固定
const seedStr = obstacle.id || `${obstacle.x}_${obstacle.y}`;
const seed = seedStr.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
```

### 草丛隐蔽检测
```typescript
// 客户端本地检测（每帧）
let isLocalPlayerInBush = false;
for (const obstacle of obstaclesForRender) {
  const obsType = (obstacle as any).type || 'wall';
  if (obsType === 'bush') {
    // 圆形与AABB碰撞检测
    if (circleVsAABB(...)) {
      isLocalPlayerInBush = true;
      break;
    }
  }
}
```

## 文件修改列表

### 服务器端
- `server/src/room.ts` - 移除掉落逻辑，更新生成权重，添加 obstacles 到 snapshot

### 客户端
- `client/src/renderer.ts` - 裂痕绘制，隐蔽提示，使用本地 inBush 状态
- `client/src/main.ts` - 本地草丛检测，使用 snapshot 中的 obstacles
- `client/src/snapshot.ts` - 添加 obstacles 字段

### 共享
- `shared/src/protocol.ts` - 移除 WOODEN_WALL 和 COVER，添加 obstacles 到 snapshot schema
- `shared/src/obstacleConfig.ts` - 移除木墙和半身掩体配置，静默处理未知类型

### 文档
- `docs/MAP_ELEMENTS.md` - 更新障碍物类型和生成权重

## 当前障碍物配置

| 类型 | 生成权重 | 可破坏 | HP | 特性 |
|------|---------|--------|-----|------|
| 石墙 | 20% | ❌ | ∞ | 完全阻挡 |
| 木箱 | 30% | ✅ | 100 | 完全阻挡，有裂痕 |
| 草丛 | 35% | ❌ | ∞ | 可穿过，提供隐蔽 |
| 水域 | 10% | ❌ | ∞ | 不可穿过，子弹穿透 |

## 测试建议

1. 进入游戏，打木箱观察裂痕变化
2. 打烂木箱，确认立即消失
3. 走进草丛，确认显示"🌿 隐蔽"提示
4. 在草丛内外观察其他玩家的可见性
