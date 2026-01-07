# AI渲染问题修复

## 问题描述
1. 客户端看不到AI实体，只能看到AI射出的子弹
2. AI之间会互相攻击
3. 命中AI时没有子弹碰撞特效

## 根本原因
1. **AI渲染位置错误**：AI的渲染是在`renderer.render()`方法**之后**单独调用的，而不是作为参数传入render方法
2. **缺少视野遮挡逻辑**：AI没有应用烟雾弹/闪光弹的视野遮挡逻辑
3. **AI互相攻击**：
   - `scanForTargets`方法只扫描玩家，但没有明确注释说明AI不互相攻击
   - AI子弹会检测并伤害其他AI
4. **AI碰撞检测缺失**：`BulletTrackManager`的碰撞检测只检查玩家，没有检查AI

## 修复内容

### 1. 修改 `client/src/renderer.ts`
- 在`render()`方法签名中添加`ais`参数
- 在玩家渲染之后、近战挥击特效之前添加AI渲染逻辑
- 应用闪光弹视野遮挡：本地玩家被闪光弹致盲时看不到AI

### 2. 修改 `client/src/main.ts`
- 将`state.ais`作为参数传入`renderer.render()`方法
- 移除render()之后单独调用`drawAI()`的代码

### 3. 修改 `server/src/main.ts`
- 在snapshot广播中添加`ais`字段

### 4. 修改 `server/src/aiBehavior.ts`
- 在`scanForTargets`方法中添加注释，明确说明"只扫描玩家作为目标，AI之间不互相攻击"

### 5. 修改 `server/src/room.ts`
- 修复AI碰撞检测逻辑：只有玩家的子弹才会检测AI碰撞
- AI的子弹不会伤害其他AI，只伤害玩家

### 6. 修改 `client/src/bulletTracks.ts` ⭐ 新增
- 在`BulletTrackManager`类中添加`ais`字段
- 在`onSnapshot`方法中更新AI列表
- 在`update`方法的碰撞检测中添加AI检测逻辑
- 命中AI时生成命中特效并上报服务端

## 视野遮挡逻辑

### 闪光弹效果
- 本地玩家被闪光弹致盲时，看不到任何AI实体
- 这与玩家之间的视野遮挡逻辑保持一致

### 烟雾弹效果（待实现）
- 当前AI没有`inSmoke`字段，烟雾弹视野遮挡暂未实现
- TODO: 服务端需要为AI添加`inSmoke`字段，类似玩家的实现

## AI互相攻击修复

### 目标选择
- AI只会将玩家作为攻击目标
- AI之间不会互相攻击或追击

### 子弹碰撞
- 玩家的子弹可以伤害AI
- AI的子弹只能伤害玩家，不能伤害其他AI

## AI碰撞特效修复

### 客户端碰撞检测
- `BulletTrackManager`现在会检测子弹与AI的碰撞
- 只有本地玩家的子弹才会检测AI碰撞（与服务端逻辑一致）
- 命中AI时会生成红色闪光特效（与命中玩家相同）

### 命中上报
- 命中AI时会通过`C2S_LOCAL_BULLET_HIT`消息上报服务端
- 服务端使用延迟补偿验证命中

## 测试建议
1. 进入战局，确认能看到AI实体（橙色方块）
2. 使用闪光弹，确认致盲期间看不到AI
3. 确认AI的血条、瞄准方向、行为状态标签正常显示
4. 确认AI只攻击玩家，不攻击其他AI
5. 确认AI子弹不会伤害其他AI
6. **确认命中AI时有红色闪光特效** ⭐
7. **确认命中AI时服务端正确扣血** ⭐

## 相关文件
- `client/src/renderer.ts` - 渲染器主文件
- `client/src/main.ts` - 客户端主循环
- `client/src/bulletTracks.ts` - 子弹轨迹管理器（碰撞检测）⭐
- `server/src/main.ts` - 服务端snapshot广播
- `server/src/room.ts` - 服务端快照生成和碰撞检测
- `server/src/ai.ts` - AI实体定义
- `server/src/aiBehavior.ts` - AI行为控制器
