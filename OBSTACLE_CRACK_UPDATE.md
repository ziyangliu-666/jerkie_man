# 障碍物破损视觉更新

## 更新内容

### 1. 裂痕系统
替换了原来的颜色变暗效果，现在使用**裂痕**来表示破损程度：

- **HP > 90%**: 无裂痕（完好）
- **60% < HP ≤ 90%**: 1条裂痕（轻微损坏）
- **30% < HP ≤ 60%**: 3条裂痕（中度损坏）
- **HP ≤ 30%**: 5条裂痕（严重损坏）

**特点**：
- 裂痕位置固定（基于障碍物ID/位置生成伪随机种子）
- 裂痕带有曲折效果，更自然
- 适用于所有可破坏障碍物（目前只有木箱）

### 2. 简化障碍物类型
移除了以下障碍物类型：
- ❌ **半身掩体 (cover)** - 已移除
- ❌ **木墙 (wooden_wall)** - 已移除

**当前保留的障碍物类型**（共4种）：
- ✅ **石墙 (wall)** - 不可破坏，完全阻挡
- ✅ **木箱 (crate)** - 可破坏（HP: 100），完全阻挡
- ✅ **草丛 (bush)** - 不可破坏，可穿过，提供隐蔽
- ✅ **水域 (water)** - 不可破坏，不可穿过，子弹可穿透

### 3. 调整生成权重
移除木墙和半身掩体后，重新平衡了障碍物生成概率：
- 草丛：35%（最常见）
- 木箱：30%（常见）
- 石墙：20%（适中）
- 水域：10%（少量）

## 技术实现

### 裂痕绘制算法
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

// 绘制带曲折的裂痕线条
```

## 视觉效果

玩家现在可以通过裂痕数量直观判断木箱的剩余耐久度，增强了游戏的视觉反馈。

## 文件修改

- `client/src/renderer.ts` - 裂痕绘制逻辑，移除木墙渲染
- `shared/src/protocol.ts` - 移除 WOODEN_WALL 和 COVER 类型
- `shared/src/obstacleConfig.ts` - 移除木墙和半身掩体配置
- `server/src/room.ts` - 移除木墙和半身掩体生成逻辑，调整权重
- `docs/MAP_ELEMENTS.md` - 更新文档
