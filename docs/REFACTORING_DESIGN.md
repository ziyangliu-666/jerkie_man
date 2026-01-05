# Jerkie Man 重构设计文档

**版本**: 1.0
**日期**: 2026-01-05
**目标**: 为支持 AI NPC、复杂地图、容器系统等高级功能建立可扩展架构

---

## 目录

1. [执行摘要](#执行摘要)
2. [当前架构分析](#当前架构分析)
3. [核心问题识别](#核心问题识别)
4. [目标架构设计](#目标架构设计)
5. [重构实施计划](#重构实施计划)
6. [详细设计方案](#详细设计方案)
7. [风险评估与缓解](#风险评估与缓解)
8. [附录](#附录)

---

## 执行摘要

### 为什么需要重构？

当前代码库已成功实现 MVP 功能（多人射击、物品拾取、撤离系统），但存在严重的**技术债务**阻碍未来扩展：

- **God Class 反模式**: `server/src/room.ts` (2054行) 和 `client/src/main.ts` (2448行) 承担过多职责
- **缺乏统一实体抽象**: 每种实体类型（玩家、子弹、物品、掉落包）独立存储和处理
- **静态物品系统**: 无法支持复杂道具行为（手雷、追踪导弹）
- **简化地图系统**: 无法实现房间、门、多层级结构
- **无容器抽象**: 阻碍箱子、储物柜等功能开发

### 重构收益

完成重构后可轻松实现：
- ✅ AI NPC（只需添加 AIComponent 和 AISystem）
- ✅ 复杂道具（手雷、追踪导弹、投掷物）
- ✅ 容器交互（箱子、储物柜、可破坏容器）
- ✅ 复杂地图（房间、门、多楼层、可破坏障碍物）
- ✅ 更好的可维护性（系统解耦，易于测试）

### 预估时间线

- **阶段 1（基础架构）**: 核心 Entity-Component 系统和系统拆分
- **阶段 2（功能完善）**: 物品行为、地图系统、容器系统
- **阶段 3（客户端重构）**: 客户端架构优化

---

## 当前架构分析

### 2.1 系统架构概览

```
┌─────────────────────────────────────────┐
│          Client (Browser)               │
│  ┌────────────────────────────────────┐ │
│  │  main.ts (2448 行 God Class)      │ │
│  │  - 网络管理 (Network)              │ │
│  │  - 渲染管理 (Renderer)             │ │
│  │  - 输入管理 (InputManager)         │ │
│  │  - UI 管理 (HUD, UIOverlay)        │ │
│  │  - 状态机 (Phase transitions)      │ │
│  │  - 插值逻辑 (Interpolation)        │ │
│  │  - 客户端预测 (BulletTracks)       │ │
│  └────────────────────────────────────┘ │
└─────────────────────────────────────────┘
                    │
              WebSocket (25Hz input, 10Hz snapshot)
                    │
┌─────────────────────────────────────────┐
│          Server (Node.js)               │
│  ┌────────────────────────────────────┐ │
│  │  room.ts (2054 行 God Class)      │ │
│  │  - 玩家管理 (Map<id, Player>)     │ │
│  │  - 子弹系统 (Bullet[])             │ │
│  │  - 物品系统 (WorldItem, LootBag)  │ │
│  │  - 战斗逻辑 (碰撞检测, 伤害计算)  │ │
│  │  - 物品生成 (程序化生成)          │ │
│  │  - 撤离判定                        │ │
│  │  - 输入队列 (防作弊)               │ │
│  │  - 位置历史 (延迟补偿)             │ │
│  └────────────────────────────────────┘ │
│  ┌────────────────────────────────────┐ │
│  │  player.ts (玩家实体)              │ │
│  └────────────────────────────────────┘ │
│  ┌────────────────────────────────────┐ │
│  │  profile.ts (档案持久化)           │ │
│  └────────────────────────────────────┘ │
└─────────────────────────────────────────┘
                    │
              Persistent Storage
                    │
         ┌──────────────────────┐
         │ server/data/         │
         │   profiles.json      │
         └──────────────────────┘
```

### 2.2 当前实体存储结构

**服务端 (room.ts)**:
```typescript
export class Room {
  public players: Map<string, Player>;        // playerId -> Player
  public bullets: Bullet[];                   // 子弹数组
  public worldItems: Map<string, WorldItem>;  // wid -> WorldItem
  public lootBags: Map<string, LootBag>;      // bid -> LootBag
  public obstacles: OBSTACLE_STATE[];         // 障碍物数组

  // ... 2000+ 行逻辑混在一起
}
```

**客户端 (main.ts)**:
```typescript
// 分散的全局变量
let players: Map<string, PLAYER_STATE> = new Map();
let worldItems: Map<string, WorldItem> = new Map();
let lootBags: Map<string, LootBag> = new Map();
let obstacles: OBSTACLE_STATE[] = [];

// ... 2400+ 行逻辑混在一起
```

### 2.3 当前协议结构

**快照消息** (S2C_SNAPSHOT):
```typescript
{
  type: 'S2C_SNAPSHOT',
  tick: number,
  players: PLAYER_STATE[],      // 独立数组
  bullets: BULLET_STATE[],      // 独立数组
  worldItems: WorldItem[],      // 独立数组
  lootBags: LootBag[]           // 独立数组
}
```

问题：每种实体类型需要独立处理序列化/反序列化逻辑。

---

## 核心问题识别

### 3.1 问题 1: God Class 反模式 (🔴 严重性: 极高)

#### 服务端: room.ts (2054 行)

**职责过载**:
1. 玩家管理（加入、离开、复活）
2. 子弹系统（发射、移动、碰撞、TTL）
3. 物品系统（生成、拾取、掉落）
4. 战斗逻辑（碰撞检测、伤害计算、护甲减伤）
5. 地图生成（障碍物、物品刷新点）
6. 撤离判定（区域检测、进度条）
7. 延迟补偿（位置历史、RTT 追踪）
8. 输入队列（防作弊）
9. 事件系统（战斗事件、战局结果）

**具体代码示例**:
```typescript
// room.ts 中混杂的职责
export class Room {
  // 职责1: 玩家管理
  addPlayer(playerId: string, accountId: string, x: number, y: number): Player { ... }

  // 职责2: 子弹系统
  private spawnBullet(playerId: string, startX: number, startY: number, aimRad: number, weaponDef: WeaponDef, clientShotId?: number) { ... }
  private updateBullets() { ... }

  // 职责3: 碰撞检测
  private checkBulletCollisions(bullet: Bullet) { ... }

  // 职责4: 物品生成
  private generateWorldItems(count: number): void { ... }

  // 职责5: 撤离判定
  private handleExtractionProgress(player: Player, input: C2S_INPUT) { ... }

  // 职责6: 延迟补偿
  private recordPlayerPosition(player: Player) { ... }
  private getHistoricalPosition(player: Player, msAgo: number): { x: number; y: number } { ... }

  // ... 20+ 个方法，所有逻辑耦合在一个类中
}
```

**影响**:
- 🔴 添加新实体类型（如 NPC）需要修改 10+ 个方法
- 🔴 单元测试困难（无法独立测试子弹系统或战斗系统）
- 🔴 代码审查困难（单次提交可能修改 500+ 行）
- 🔴 合并冲突频繁（多人协作时）

#### 客户端: main.ts (2448 行)

**职责过载**:
1. 网络管理（连接、重连、消息处理）
2. 游戏循环（渲染、更新、插值）
3. 输入管理（键盘、鼠标、触摸）
4. UI 管理（HUD、商店、整备区、战斗结果）
5. 状态机（NAME → HIDEOUT → RAID → RESULT）
6. 客户端预测（子弹轨迹、延迟隐藏）
7. 音效管理（开火、击中、脚步声）

**代码示例**:
```typescript
// main.ts 中混杂的全局变量和函数
let network: Network | null = null;
let renderer: Renderer | null = null;
let inputManager: InputManager | null = null;
let hud: HUD | null = null;
let currentPhase: 'NAME' | 'HIDEOUT' | 'RAID' | 'RESULT' = 'NAME';
let playerProfile: PlayerProfile | null = null;

// 2400+ 行函数定义全部在文件顶层
function updateGameLoop() { ... }
function handleSnapshot(msg: S2C_SNAPSHOT) { ... }
function renderRaidPhase() { ... }
function showHideoutPhase() { ... }
```

### 3.2 问题 2: 缺乏统一实体抽象 (🔴 严重性: 高)

**当前设计**:
```typescript
// 每种实体类型独立存储
class Room {
  players: Map<string, Player>;
  bullets: Bullet[];
  worldItems: Map<string, WorldItem>;
  lootBags: Map<string, LootBag>;
  obstacles: OBSTACLE_STATE[];
}
```

**添加新实体的成本**:

假设要添加 `NPC` 实体，需要修改的代码：

1. **协议定义** (shared/src/protocol.ts):
```typescript
export const NPC_STATE_SCHEMA = z.object({ ... });
export const S2C_SNAPSHOT_SCHEMA = z.object({
  // 新增字段
  npcs: z.array(NPC_STATE_SCHEMA),
});
```

2. **服务端存储** (server/src/room.ts):
```typescript
export class Room {
  public npcs: Map<string, NPC>; // 新增

  tick() {
    this.updateBullets();    // 现有
    this.updateNPCs();       // 新增 - 需要实现
    this.checkBulletCollisions(); // 修改 - 需要检测子弹 vs NPC
  }

  // 新增 10+ 个方法
  spawnNPC() { ... }
  updateNPCs() { ... }
  checkNPCCollisions() { ... }
  handleNPCDeath() { ... }
}
```

3. **客户端渲染** (client/src/main.ts):
```typescript
// 新增全局变量
let npcs: Map<string, NPC_STATE> = new Map();

function handleSnapshot(msg: S2C_SNAPSHOT) {
  // 新增处理逻辑
  npcs.clear();
  for (const npc of msg.npcs) {
    npcs.set(npc.id, npc);
  }
}

function renderRaidPhase() {
  // 新增渲染逻辑
  for (const npc of npcs.values()) {
    renderer.drawNPC(npc);
  }
}
```

**总计**: 修改 3 个文件，新增 200+ 行代码，修改 5+ 个现有函数。

### 3.3 问题 3: 静态物品系统 (🟡 严重性: 中)

**当前物品定义** (shared/src/equipment.ts, item_catalog.ts):
```typescript
// 物品只是静态配置
export const ITEM_CATALOG: Record<string, ItemMeta> = {
  "pistol": {
    category: "weapons",
    rarity: "common",
    price: 500,
    stackMax: 1,
  },
  "grenade": {
    category: "consumables",
    rarity: "uncommon",
    price: 200,
    stackMax: 5,
  }
};

export const WEAPONS: Record<string, WeaponDef> = {
  "pistol": {
    damage: 20,
    fireIntervalMs: 300,
    magSize: 12,
    // ... 静态属性
  }
};
```

**无法实现的功能**:
1. **手雷倒计时**: 需要独立的 `GrenadeProjectile` 实体
2. **追踪导弹**: 需要 `targetId` 和锁定逻辑
3. **医疗包**: 需要持续治疗效果（Buff 系统）
4. **陷阱**: 需要触发器和区域检测

**当前扩展方式（反模式）**:
```typescript
// room.ts 中硬编码特殊逻辑
spawnBullet(weaponDef: WeaponDef) {
  if (weaponDef.typeId === 'grenade_launcher') {
    // 硬编码手雷逻辑
    this.grenades.push({
      explodeAt: Date.now() + 3000,
      // ...
    });
  } else {
    // 普通子弹逻辑
  }
}
```

问题：每种特殊道具都让 `room.ts` 更臃肿。

### 3.4 问题 4: 简化地图系统 (🟡 严重性: 中)

**当前地图** (shared/src/content.ts):
```typescript
export interface MAP_CONFIG {
  seed: number;
  width: number;          // 2000px
  height: number;         // 2000px
  extractionZone: {       // 固定撤离区
    x: number;
    y: number;
    w: number;
    h: number;
  };
}

// 障碍物只是矩形数组
export interface OBSTACLE_STATE {
  x: number;
  y: number;
  w: number;
  h: number;
}
```

**无法实现的功能**:
1. 房间和门系统（需要 `Room`, `Door`, `Connection` 抽象）
2. 多楼层 / Z 轴（需要 `layer` 或 `z` 属性）
3. 可破坏障碍物（需要 `health` 和破坏逻辑）
4. 特殊区域（商店、安全区、危险区需要 `MapRegion` 类型）

### 3.5 问题 5: 无容器抽象 (🟡 严重性: 中)

**当前 LootBag** (shared/src/protocol.ts):
```typescript
export const LOOT_BAG_SCHEMA = z.object({
  bid: z.string(),
  x: z.number(),
  y: z.number(),
  inventory: z.array(ITEM_INSTANCE_SCHEMA),
});
```

问题：`LootBag` 只是带坐标的物品数组，没有：
- 锁定状态（需要钥匙）
- 容器 UI 交互（拖拽物品）
- 容器嵌套（背包里的箱子）
- 共享访问（队伍箱子）

**需要实现的功能**:
1. 箱子（Chest）：可锁定容器，有血量，可破坏
2. 储物柜（Locker）：固定位置，跨战局持久化
3. 交易窗口（Trade Window）：两个玩家共享的临时容器

---

## 目标架构设计

### 4.1 架构原则

1. **单一职责原则 (SRP)**: 每个类/系统只负责一件事
2. **开闭原则 (OCP)**: 对扩展开放，对修改封闭
3. **依赖倒置原则 (DIP)**: 依赖抽象而非具体实现
4. **组合优于继承**: 使用 Component 组合而非深层继承
5. **数据驱动设计**: 通过配置文件而非代码扩展功能

### 4.2 Entity-Component-System (ECS) 架构

#### 核心概念

```
Entity (实体)        - 唯一 ID 的容器
   ↓
Component (组件)     - 数据和行为的模块化单元
   ↓
System (系统)        - 处理特定 Component 的逻辑
```

#### 架构图

```
┌────────────────────────────────────────────────────┐
│                   World (Room)                     │
│  ┌──────────────────────────────────────────────┐ │
│  │         EntityManager                        │ │
│  │  entities: Map<EntityId, Entity>             │ │
│  │                                               │ │
│  │  Entity {                                     │ │
│  │    id: string                                 │ │
│  │    components: Map<ComponentType, Component>  │ │
│  │  }                                            │ │
│  └──────────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────────┐ │
│  │         System Manager                       │ │
│  │  systems: System[]                           │ │
│  │                                               │ │
│  │  - PhysicsSystem (移动, 碰撞)                │ │
│  │  - CombatSystem  (伤害计算, 击中检测)        │ │
│  │  - AISystem      (NPC 行为)                  │ │
│  │  - LootSystem    (掉落, 拾取)                │ │
│  │  - SpawnSystem   (生成点管理)                │ │
│  └──────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────┘

Game Loop:
  tick() {
    for system in systems:
      system.update(entities, deltaTime)
  }
```

#### Component 示例

```typescript
// 位置组件
interface PositionComponent {
  type: 'Position';
  x: number;
  y: number;
  vx: number;  // 速度
  vy: number;
}

// 碰撞组件
interface CollisionComponent {
  type: 'Collision';
  radius: number;
  layer: CollisionLayer;  // PLAYER, NPC, BULLET, ITEM
}

// 生命值组件
interface HealthComponent {
  type: 'Health';
  current: number;
  max: number;
  armor: number;  // 护甲减伤
}

// AI 组件
interface AIComponent {
  type: 'AI';
  behavior: 'patrol' | 'chase' | 'flee' | 'investigate';
  target?: EntityId;
  patrolPath: Vec2[];
  aggroRange: number;
}

// 物品组件
interface ItemComponent {
  type: 'Item';
  itemTypeId: string;
  quantity: number;
  canPickup: boolean;
}

// 容器组件
interface ContainerComponent {
  type: 'Container';
  inventory: ItemInstance[];
  capacity: number;
  locked: boolean;
  keyRequired?: string;
}

// 武器运行时组件
interface WeaponRuntimeComponent {
  type: 'WeaponRuntime';
  weaponTypeId: string;
  ammo: number;
  magSize: number;
  isReloading: boolean;
  reloadStartTick?: number;
  burstStreamUntil: number;
}
```

#### Entity 组合示例

```typescript
// 玩家 = Position + Collision + Health + WeaponRuntime + Inventory + ...
const player: Entity = {
  id: 'p1',
  components: new Map([
    ['Position', { type: 'Position', x: 100, y: 100, vx: 0, vy: 0 }],
    ['Collision', { type: 'Collision', radius: 12, layer: 'PLAYER' }],
    ['Health', { type: 'Health', current: 100, max: 100, armor: 0.3 }],
    ['WeaponRuntime', { type: 'WeaponRuntime', weaponTypeId: 'pistol', ammo: 12, ... }],
    ['Inventory', { type: 'Inventory', items: [], capacity: 20 }],
  ])
};

// NPC = Position + Collision + Health + AI + WeaponRuntime
const npc: Entity = {
  id: 'npc1',
  components: new Map([
    ['Position', { type: 'Position', x: 500, y: 500, vx: 0, vy: 0 }],
    ['Collision', { type: 'Collision', radius: 12, layer: 'NPC' }],
    ['Health', { type: 'Health', current: 80, max: 80, armor: 0.2 }],
    ['AI', { type: 'AI', behavior: 'patrol', patrolPath: [...] }],
    ['WeaponRuntime', { type: 'WeaponRuntime', weaponTypeId: 'smg', ammo: 30, ... }],
  ])
};

// 箱子 = Position + Collision + Container + Health
const chest: Entity = {
  id: 'chest1',
  components: new Map([
    ['Position', { type: 'Position', x: 800, y: 600, vx: 0, vy: 0 }],
    ['Collision', { type: 'Collision', radius: 20, layer: 'ITEM' }],
    ['Container', { type: 'Container', inventory: [...], locked: true, keyRequired: 'key_red' }],
    ['Health', { type: 'Health', current: 50, max: 50, armor: 0 }],  // 可破坏
  ])
};

// 手雷投掷物 = Position + Collision + Projectile + Explosion
const grenade: Entity = {
  id: 'g1',
  components: new Map([
    ['Position', { type: 'Position', x: 200, y: 200, vx: 100, vy: -50 }],
    ['Collision', { type: 'Collision', radius: 5, layer: 'PROJECTILE' }],
    ['Projectile', { type: 'Projectile', ownerId: 'p1', spawnTick: 1000, lifeTicks: 60 }],
    ['Explosion', { type: 'Explosion', radius: 100, damage: 80, explodeTick: 1060 }],
  ])
};
```

### 4.3 System 设计

#### PhysicsSystem

```typescript
class PhysicsSystem implements System {
  update(entities: EntityManager, deltaTime: number) {
    // 1. 更新所有 Position 组件
    for (const entity of entities.withComponents(['Position'])) {
      const pos = entity.getComponent<PositionComponent>('Position');
      pos.x += pos.vx * deltaTime;
      pos.y += pos.vy * deltaTime;
    }

    // 2. 碰撞检测
    for (const entity of entities.withComponents(['Position', 'Collision'])) {
      const pos = entity.getComponent<PositionComponent>('Position');
      const col = entity.getComponent<CollisionComponent>('Collision');

      // 检测与障碍物碰撞
      if (this.collidesWithObstacles(pos, col)) {
        this.resolveCollision(pos, col);
      }
    }
  }
}
```

#### CombatSystem

```typescript
class CombatSystem implements System {
  update(entities: EntityManager) {
    // 1. 处理子弹碰撞
    for (const bullet of entities.withComponents(['Position', 'Projectile'])) {
      const pos = bullet.getComponent<PositionComponent>('Position');
      const proj = bullet.getComponent<ProjectileComponent>('Projectile');

      // 检测与所有可命中实体的碰撞
      for (const target of entities.withComponents(['Position', 'Health', 'Collision'])) {
        if (this.bulletHitsTarget(bullet, target)) {
          this.applyDamage(target, proj.damage);
          entities.removeEntity(bullet.id);  // 子弹销毁
        }
      }
    }

    // 2. 处理死亡
    for (const entity of entities.withComponents(['Health'])) {
      const health = entity.getComponent<HealthComponent>('Health');
      if (health.current <= 0) {
        this.handleDeath(entity);
      }
    }
  }

  private applyDamage(target: Entity, rawDamage: number) {
    const health = target.getComponent<HealthComponent>('Health');
    const finalDamage = rawDamage * (1 - health.armor);
    health.current -= finalDamage;
  }
}
```

#### AISystem (新功能示例)

```typescript
class AISystem implements System {
  update(entities: EntityManager) {
    for (const npc of entities.withComponents(['AI', 'Position', 'WeaponRuntime'])) {
      const ai = npc.getComponent<AIComponent>('AI');
      const pos = npc.getComponent<PositionComponent>('Position');

      switch (ai.behavior) {
        case 'patrol':
          this.patrol(npc, ai, pos);
          break;
        case 'chase':
          this.chaseTarget(npc, ai, pos, entities);
          break;
        case 'flee':
          this.flee(npc, ai, pos);
          break;
      }

      // 检测附近玩家
      const nearbyPlayer = this.findNearestPlayer(pos, ai.aggroRange, entities);
      if (nearbyPlayer) {
        ai.behavior = 'chase';
        ai.target = nearbyPlayer.id;
      }
    }
  }

  private chaseTarget(npc: Entity, ai: AIComponent, pos: PositionComponent, entities: EntityManager) {
    const target = entities.getEntity(ai.target!);
    if (!target) {
      ai.behavior = 'patrol';
      return;
    }

    const targetPos = target.getComponent<PositionComponent>('Position');
    const dx = targetPos.x - pos.x;
    const dy = targetPos.y - pos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // 移动向目标
    const speed = 2;  // 2 px/tick
    pos.vx = (dx / dist) * speed;
    pos.vy = (dy / dist) * speed;

    // 如果在射程内，开火
    if (dist < 300) {
      const weapon = npc.getComponent<WeaponRuntimeComponent>('WeaponRuntime');
      // 触发射击逻辑
    }
  }
}
```

#### LootSystem

```typescript
class LootSystem implements System {
  update(entities: EntityManager) {
    // 处理拾取请求
    for (const [playerId, pickupRequest] of this.pickupQueue) {
      const player = entities.getEntity(playerId);
      if (!player) continue;

      const playerPos = player.getComponent<PositionComponent>('Position');
      const playerInv = player.getComponent<InventoryComponent>('Inventory');

      const item = entities.getEntity(pickupRequest.itemId);
      if (!item) continue;

      const itemPos = item.getComponent<PositionComponent>('Position');
      const itemComp = item.getComponent<ItemComponent>('Item');

      // 范围检测
      const dist = this.distance(playerPos, itemPos);
      if (dist > PICKUP_RADIUS) continue;

      // 添加到背包
      if (playerInv.addItem(itemComp.itemTypeId, itemComp.quantity)) {
        entities.removeEntity(item.id);  // 从世界移除
      }
    }

    this.pickupQueue.clear();
  }
}
```

### 4.4 物品行为系统

#### Behavior 接口

```typescript
interface ItemBehavior {
  onUse(entity: Entity, world: World): void;
  onUpdate(entity: Entity, world: World): void;
  onCollision(entity: Entity, target: Entity, world: World): void;
}

// 手雷行为
class GrenadeBehavior implements ItemBehavior {
  onUse(entity: Entity, world: World): void {
    // 投掷手雷
    const pos = entity.getComponent<PositionComponent>('Position');
    const throwDir = entity.getComponent<ThrowComponent>('Throw');

    const grenadeEntity = world.createEntity({
      components: [
        { type: 'Position', x: pos.x, y: pos.y, vx: throwDir.vx, vy: throwDir.vy },
        { type: 'Projectile', ownerId: entity.id, spawnTick: world.tick, lifeTicks: 60 },
        { type: 'Explosion', radius: 100, damage: 80, explodeTick: world.tick + 60 },
      ]
    });
  }

  onUpdate(entity: Entity, world: World): void {
    const explosion = entity.getComponent<ExplosionComponent>('Explosion');
    if (world.tick >= explosion.explodeTick) {
      this.explode(entity, world);
    }
  }

  private explode(entity: Entity, world: World) {
    const pos = entity.getComponent<PositionComponent>('Position');
    const explosion = entity.getComponent<ExplosionComponent>('Explosion');

    // 对半径内所有实体造成伤害
    for (const target of world.entities.withComponents(['Position', 'Health'])) {
      const targetPos = target.getComponent<PositionComponent>('Position');
      const dist = this.distance(pos, targetPos);

      if (dist <= explosion.radius) {
        const damageFalloff = 1 - (dist / explosion.radius);
        const finalDamage = explosion.damage * damageFalloff;
        const health = target.getComponent<HealthComponent>('Health');
        health.current -= finalDamage;
      }
    }

    // 销毁手雷实体
    world.entities.removeEntity(entity.id);
  }
}

// 追踪导弹行为
class HomingMissileBehavior implements ItemBehavior {
  onUpdate(entity: Entity, world: World): void {
    const pos = entity.getComponent<PositionComponent>('Position');
    const homing = entity.getComponent<HomingComponent>('Homing');

    const target = world.entities.getEntity(homing.targetId);
    if (!target) return;

    const targetPos = target.getComponent<PositionComponent>('Position');

    // 调整速度向目标
    const dx = targetPos.x - pos.x;
    const dy = targetPos.y - pos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    const turnSpeed = homing.turnRate;  // 每 tick 转向速度
    const currentAngle = Math.atan2(pos.vy, pos.vx);
    const targetAngle = Math.atan2(dy, dx);

    // 平滑转向
    const newAngle = this.lerpAngle(currentAngle, targetAngle, turnSpeed);
    const speed = Math.sqrt(pos.vx * pos.vx + pos.vy * pos.vy);
    pos.vx = Math.cos(newAngle) * speed;
    pos.vy = Math.sin(newAngle) * speed;
  }
}
```

### 4.5 地图系统重构

#### MapRegion 抽象

```typescript
// 地图区域（房间、走廊、开阔区）
interface MapRegion {
  id: string;
  type: 'room' | 'corridor' | 'open' | 'extraction' | 'shop';
  bounds: AABB;  // { x, y, w, h }
  connections: Connection[];  // 连接到其他区域
  spawnPoints: SpawnPoint[];
  obstacles: Obstacle[];
  metadata?: {
    // 房间特定属性
    locked?: boolean;
    keyRequired?: string;
    // 商店特定属性
    shopkeeper?: string;
    shopInventory?: string[];
  };
}

// 连接（门、传送点）
interface Connection {
  id: string;
  type: 'door' | 'teleport' | 'ladder';
  from: string;  // region ID
  to: string;    // region ID
  position: Vec2;
  locked?: boolean;
  keyRequired?: string;
}

// 可破坏障碍物
interface Obstacle {
  id: string;
  bounds: AABB;
  destructible: boolean;
  health?: number;
  maxHealth?: number;
}
```

#### 程序化地图生成

```typescript
class MapGenerator {
  generate(seed: number): Map {
    const rng = createRng(seed);
    const regions: MapRegion[] = [];

    // 1. 生成主要房间
    const mainRoom = this.generateRoom(rng, 'main', { x: 500, y: 500, w: 400, h: 400 });
    regions.push(mainRoom);

    // 2. 生成连接房间
    for (let i = 0; i < 5; i++) {
      const sideRoom = this.generateRoom(rng, `room_${i}`, this.randomBounds(rng));
      regions.push(sideRoom);

      // 创建门连接
      const door = this.createDoor(mainRoom, sideRoom, rng);
      mainRoom.connections.push(door);
      sideRoom.connections.push(door);
    }

    // 3. 生成撤离区
    const extractionZone = this.generateExtractionZone(rng);
    regions.push(extractionZone);

    // 4. 放置障碍物和刷新点
    for (const region of regions) {
      region.obstacles = this.generateObstacles(region, rng);
      region.spawnPoints = this.generateSpawnPoints(region, rng);
    }

    return { seed, regions };
  }
}
```

### 4.6 容器系统

#### Container 接口

```typescript
interface Container {
  inventory: ItemInstance[];
  capacity: number;          // 最大容量（格子数或重量）
  locked: boolean;
  keyRequired?: string;
  shared: boolean;           // 是否多人共享（队伍箱子）
  persistent: boolean;       // 是否跨战局持久化（储物柜）
}

// 容器交互 API
interface ContainerInteraction {
  canAccess(player: Entity, container: Entity): boolean;
  open(player: Entity, container: Entity): void;
  transferItem(from: Container, to: Container, itemId: string, quantity: number): boolean;
  close(player: Entity, container: Entity): void;
}
```

#### 箱子实体示例

```typescript
const lockedChest: Entity = {
  id: 'chest_red',
  components: new Map([
    ['Position', { type: 'Position', x: 800, y: 600, vx: 0, vy: 0 }],
    ['Collision', { type: 'Collision', radius: 20, layer: 'ITEM' }],
    ['Container', {
      type: 'Container',
      inventory: [
        { iid: 'i1', typeId: 'dmr', qty: 1 },
        { iid: 'i2', typeId: 'ammo_556', qty: 60 },
      ],
      capacity: 12,
      locked: true,
      keyRequired: 'key_red',
      shared: false,
      persistent: false,
    }],
    ['Health', { type: 'Health', current: 100, max: 100, armor: 0 }],
    ['Sprite', { type: 'Sprite', texture: 'chest_red', width: 40, height: 40 }],
  ])
};
```

---

## 重构实施计划

### 5.1 总体路线图

```
阶段 1: 基础架构 (Core Infrastructure)
  Week 1-2: Entity-Component 系统
  Week 2-3: 系统拆分 (CombatSystem, PhysicsSystem)
  Week 3-4: 容器系统

阶段 2: 功能完善 (Feature Enhancement)
  Week 5-6: 物品行为系统 (ItemBehavior)
  Week 6-7: 地图系统重构 (MapRegion, Connection)
  Week 7-8: AI 系统基础 (AISystem, Behavior Tree)

阶段 3: 客户端优化 (Client Refactor)
  Week 9-10: 客户端架构拆分 (PhaseManager, UIManager)
  Week 10-11: 渲染优化 (Viewport culling, LOD)

阶段 4: 验证和测试 (Validation)
  Week 12: 集成测试, 性能测试
```

### 5.2 阶段 1: 基础架构 (详细步骤)

#### Step 1.1: Entity 和 Component 核心类 (2-3 天)

**文件**: `shared/src/core/Entity.ts`

```typescript
// Entity 核心抽象
export type EntityId = string;
export type ComponentType = string;

export interface Component {
  type: ComponentType;
}

export class Entity {
  constructor(
    public readonly id: EntityId,
    public components: Map<ComponentType, Component> = new Map()
  ) {}

  getComponent<T extends Component>(type: ComponentType): T | undefined {
    return this.components.get(type) as T | undefined;
  }

  hasComponent(type: ComponentType): boolean {
    return this.components.has(type);
  }

  addComponent(component: Component): void {
    this.components.set(component.type, component);
  }

  removeComponent(type: ComponentType): void {
    this.components.delete(type);
  }
}
```

**文件**: `shared/src/core/EntityManager.ts`

```typescript
export class EntityManager {
  private entities: Map<EntityId, Entity> = new Map();
  private idCounter = 0;

  createEntity(components: Component[] = []): Entity {
    const id = `e${this.idCounter++}`;
    const entity = new Entity(id);
    for (const comp of components) {
      entity.addComponent(comp);
    }
    this.entities.set(id, entity);
    return entity;
  }

  getEntity(id: EntityId): Entity | undefined {
    return this.entities.get(id);
  }

  removeEntity(id: EntityId): void {
    this.entities.delete(id);
  }

  // 查询所有包含指定组件的实体
  withComponents(types: ComponentType[]): Entity[] {
    const result: Entity[] = [];
    for (const entity of this.entities.values()) {
      if (types.every(t => entity.hasComponent(t))) {
        result.push(entity);
      }
    }
    return result;
  }

  getAllEntities(): Entity[] {
    return Array.from(this.entities.values());
  }
}
```

**文件**: `shared/src/components/PositionComponent.ts`

```typescript
import type { Component } from '../core/Entity.js';

export interface PositionComponent extends Component {
  type: 'Position';
  x: number;
  y: number;
  vx: number;
  vy: number;
}
```

**文件**: `shared/src/components/HealthComponent.ts`

```typescript
import type { Component } from '../core/Entity.js';

export interface HealthComponent extends Component {
  type: 'Health';
  current: number;
  max: number;
  armor: number;
}
```

**验证步骤**:
1. 编写单元测试 (`shared/src/core/__tests__/Entity.test.ts`)
2. 测试 EntityManager 查询功能
3. 运行 `npm run build --workspace=shared`

#### Step 1.2: 重构 Player 为 Entity (2 天)

**文件**: `server/src/player.ts`

```typescript
// 旧代码 (保留兼容层)
export class Player {
  public id: string;
  public entity: Entity;  // 新增: 内部使用 Entity

  constructor(id: string, x: number, y: number, accountId: string) {
    this.id = id;

    // 创建 Entity 并添加组件
    this.entity = new Entity(id);
    this.entity.addComponent<PositionComponent>({
      type: 'Position',
      x, y, vx: 0, vy: 0
    });
    this.entity.addComponent<HealthComponent>({
      type: 'Health',
      current: 100,
      max: 100,
      armor: 0
    });
    this.entity.addComponent<PlayerComponent>({
      type: 'Player',
      accountId,
      name: '',
      phase: 'HIDEOUT'
    });
  }

  // 兼容层: 保留旧的 getter/setter
  get x(): number {
    return this.entity.getComponent<PositionComponent>('Position')!.x;
  }

  set x(value: number) {
    this.entity.getComponent<PositionComponent>('Position')!.x = value;
  }

  get health(): number {
    return this.entity.getComponent<HealthComponent>('Health')!.current;
  }

  // ... 其他兼容方法
}
```

**迁移策略**:
1. 保留 `Player` 类作为兼容层（避免破坏现有代码）
2. 内部使用 `Entity` 存储数据
3. 逐步迁移 `room.ts` 中的逻辑使用 Component API

#### Step 1.3: 从 Room 提取 CombatSystem (3 天)

**文件**: `server/src/systems/CombatSystem.ts`

```typescript
import { EntityManager, Entity } from '@jerkie-man/shared';
import type { PositionComponent, HealthComponent, ProjectileComponent } from '@jerkie-man/shared';

export class CombatSystem {
  update(entities: EntityManager, tick: number) {
    // 1. 更新子弹
    this.updateProjectiles(entities, tick);

    // 2. 碰撞检测
    this.checkProjectileCollisions(entities);

    // 3. 处理死亡
    this.handleDeaths(entities);
  }

  private updateProjectiles(entities: EntityManager, tick: number) {
    for (const bullet of entities.withComponents(['Position', 'Projectile'])) {
      const proj = bullet.getComponent<ProjectileComponent>('Projectile');

      // TTL 检查
      if (tick - proj.spawnTick > proj.lifeTicks) {
        entities.removeEntity(bullet.id);
      }
    }
  }

  private checkProjectileCollisions(entities: EntityManager) {
    for (const bullet of entities.withComponents(['Position', 'Projectile'])) {
      const bulletPos = bullet.getComponent<PositionComponent>('Position');
      const proj = bullet.getComponent<ProjectileComponent>('Projectile');

      for (const target of entities.withComponents(['Position', 'Health', 'Collision'])) {
        if (target.id === proj.ownerId) continue;  // 忽略自己

        const targetPos = target.getComponent<PositionComponent>('Position');
        const targetCol = target.getComponent<CollisionComponent>('Collision');

        // 射线 vs 圆形碰撞
        if (this.rayIntersectsCircle(bulletPos, targetPos, targetCol.radius)) {
          this.applyDamage(target, proj.damage);
          entities.removeEntity(bullet.id);
          break;
        }
      }
    }
  }

  private applyDamage(target: Entity, rawDamage: number) {
    const health = target.getComponent<HealthComponent>('Health');
    if (!health) return;

    const finalDamage = rawDamage * (1 - health.armor);
    health.current -= finalDamage;
  }

  private handleDeaths(entities: EntityManager) {
    for (const entity of entities.withComponents(['Health'])) {
      const health = entity.getComponent<HealthComponent>('Health');
      if (health.current <= 0) {
        // 生成掉落包
        this.spawnLootBag(entity, entities);

        // 标记为死亡（不直接删除，等待客户端确认）
        entity.addComponent({ type: 'Dead', deathTick: this.tick });
      }
    }
  }
}
```

**迁移步骤**:
1. 创建 `CombatSystem` 类
2. 从 `room.ts` 复制战斗逻辑到 `CombatSystem`
3. 在 `Room.tick()` 中调用 `this.combatSystem.update()`
4. 删除 `room.ts` 中的旧代码
5. 运行烟雾测试验证功能

#### Step 1.4: 协议层适配 (2 天)

**问题**: 现有协议使用独立数组：
```typescript
{
  players: PLAYER_STATE[],
  bullets: BULLET_STATE[],
  worldItems: WorldItem[]
}
```

**解决方案**: 保持协议兼容，内部使用转换层

**文件**: `server/src/protocol/EntitySerializer.ts`

```typescript
export class EntitySerializer {
  // Entity -> PLAYER_STATE
  serializePlayer(entity: Entity): PLAYER_STATE {
    const pos = entity.getComponent<PositionComponent>('Position')!;
    const health = entity.getComponent<HealthComponent>('Health')!;
    const player = entity.getComponent<PlayerComponent>('Player')!;

    return {
      id: entity.id,
      x: pos.x,
      y: pos.y,
      vx: pos.vx,
      vy: pos.vy,
      health: health.current,
      maxHealth: health.max,
      // ... 其他字段
    };
  }

  // Entity -> BULLET_STATE
  serializeBullet(entity: Entity): BULLET_STATE {
    const pos = entity.getComponent<PositionComponent>('Position')!;
    const proj = entity.getComponent<ProjectileComponent>('Projectile')!;

    return {
      id: entity.id,
      x: pos.x,
      y: pos.y,
      vx: pos.vx,
      vy: pos.vy,
      ownerId: proj.ownerId,
    };
  }

  // 批量序列化
  serializeSnapshot(entities: EntityManager): S2C_SNAPSHOT {
    const players: PLAYER_STATE[] = [];
    const bullets: BULLET_STATE[] = [];

    for (const entity of entities.withComponents(['Player'])) {
      players.push(this.serializePlayer(entity));
    }

    for (const entity of entities.withComponents(['Projectile'])) {
      bullets.push(this.serializeBullet(entity));
    }

    return { type: 'S2C_SNAPSHOT', tick: this.tick, players, bullets, ... };
  }
}
```

**优势**:
- 客户端无需修改（协议不变）
- 服务端内部使用 ECS（架构改进）
- 逐步迁移（降低风险）

#### Step 1.5: 容器系统 (2 天)

**文件**: `shared/src/components/ContainerComponent.ts`

```typescript
export interface ContainerComponent extends Component {
  type: 'Container';
  inventory: ItemInstance[];
  capacity: number;
  locked: boolean;
  keyRequired?: string;
  shared: boolean;
  persistent: boolean;
}
```

**文件**: `server/src/systems/ContainerSystem.ts`

```typescript
export class ContainerSystem {
  private openContainers: Map<EntityId, Set<EntityId>> = new Map();  // containerId -> Set<playerId>

  canAccess(player: Entity, container: Entity): boolean {
    const containerComp = container.getComponent<ContainerComponent>('Container');
    if (!containerComp) return false;

    // 检查锁定状态
    if (containerComp.locked) {
      const playerInv = player.getComponent<InventoryComponent>('Inventory');
      if (!playerInv) return false;

      // 检查是否有钥匙
      const hasKey = playerInv.items.some(item => item.typeId === containerComp.keyRequired);
      if (!hasKey) return false;
    }

    // 检查距离
    const playerPos = player.getComponent<PositionComponent>('Position')!;
    const containerPos = container.getComponent<PositionComponent>('Position')!;
    const dist = this.distance(playerPos, containerPos);

    return dist <= INTERACT_RADIUS;
  }

  open(player: Entity, container: Entity): void {
    if (!this.canAccess(player, container)) return;

    const containerId = container.id;
    if (!this.openContainers.has(containerId)) {
      this.openContainers.set(containerId, new Set());
    }
    this.openContainers.get(containerId)!.add(player.id);

    // 发送容器内容给客户端
    this.sendContainerState(player, container);
  }

  transferItem(from: Entity, to: Entity, itemId: string, quantity: number): boolean {
    const fromContainer = from.getComponent<ContainerComponent>('Container') ||
                          from.getComponent<InventoryComponent>('Inventory');
    const toContainer = to.getComponent<ContainerComponent>('Container') ||
                        to.getComponent<InventoryComponent>('Inventory');

    if (!fromContainer || !toContainer) return false;

    // 查找物品
    const itemIndex = fromContainer.inventory.findIndex(i => i.iid === itemId);
    if (itemIndex === -1) return false;

    const item = fromContainer.inventory[itemIndex];
    if (item.qty < quantity) return false;

    // 检查容量
    if (toContainer.inventory.length >= toContainer.capacity) return false;

    // 转移物品
    item.qty -= quantity;
    if (item.qty === 0) {
      fromContainer.inventory.splice(itemIndex, 1);
    }

    // 添加到目标容器
    const existingItem = toContainer.inventory.find(i => i.typeId === item.typeId);
    if (existingItem) {
      existingItem.qty += quantity;
    } else {
      toContainer.inventory.push({
        iid: this.generateItemId(),
        typeId: item.typeId,
        qty: quantity
      });
    }

    return true;
  }
}
```

**协议扩展** (`shared/src/protocol.ts`):
```typescript
// 新增消息
export const C2S_OPEN_CONTAINER_SCHEMA = z.object({
  type: z.literal('C2S_OPEN_CONTAINER'),
  containerId: z.string(),
});

export const C2S_TRANSFER_ITEM_SCHEMA = z.object({
  type: z.literal('C2S_TRANSFER_ITEM'),
  fromId: z.string(),  // playerId 或 containerId
  toId: z.string(),
  itemId: z.string(),
  quantity: z.number().int().positive(),
});

export const S2C_CONTAINER_STATE_SCHEMA = z.object({
  type: z.literal('S2C_CONTAINER_STATE'),
  containerId: z.string(),
  inventory: z.array(ITEM_INSTANCE_SCHEMA),
  capacity: z.number(),
  locked: z.boolean(),
});
```

### 5.3 阶段 2: 功能完善 (概要)

#### Step 2.1: 物品行为系统

- 创建 `ItemBehavior` 接口
- 实现 `GrenadeBehavior`, `HomingMissileBehavior`
- 添加 `BehaviorComponent`
- 在 `CombatSystem` 中处理行为更新

#### Step 2.2: 地图系统重构

- 定义 `MapRegion`, `Connection`, `Obstacle` 接口
- 实现 `MapGenerator` 程序化生成
- 添加 `DoorComponent`, `TeleportComponent`
- 实现 `MapSystem` 处理门交互和传送

#### Step 2.3: AI 系统

- 定义 `AIComponent` (behavior, target, patrolPath)
- 实现 `AISystem`（patrol, chase, flee 逻辑）
- 添加 NPC 实体类型
- 实现行为树（Behavior Tree）基础架构

#### Step 2.4: 局内装备与背包 UI (2 天)

- HUD 增加装备条（武器/护甲/背包）与状态高亮
- 拾取更好装备时自动替换 + 屏幕 Toast 提示（含撤销）
- 背包内武器可与当前武器快速交换/卸下
- 统一“更好”判定规则（背包容量/护甲减伤/拳头→武器）

### 5.4 阶段 3: 客户端重构 (概要)

#### 目标架构

```typescript
// main.ts 入口文件（< 200 行）
const app = new GameApp();
app.start();

// GameApp 核心管理器
class GameApp {
  private phaseManager: PhaseManager;
  private networkManager: NetworkManager;
  private renderOrchestrator: RenderOrchestrator;
  private inputManager: InputManager;
  private uiManager: UIManager;

  start() {
    this.phaseManager.enterPhase('NAME');
    this.gameLoop();
  }

  private gameLoop() {
    requestAnimationFrame(() => this.gameLoop());

    const phase = this.phaseManager.getCurrentPhase();
    phase.update(this.getDeltaTime());
    phase.render(this.renderOrchestrator);
  }
}

// PhaseManager 状态机
class PhaseManager {
  private phases: Map<PhaseName, Phase>;
  private currentPhase: Phase;

  enterPhase(name: PhaseName) {
    this.currentPhase?.onExit();
    this.currentPhase = this.phases.get(name)!;
    this.currentPhase.onEnter();
  }
}

// Phase 接口
interface Phase {
  onEnter(): void;
  onExit(): void;
  update(deltaTime: number): void;
  render(renderer: RenderOrchestrator): void;
}

// RaidPhase 实现
class RaidPhase implements Phase {
  private entities: ClientEntityManager;
  private interpolation: InterpolationSystem;

  update(deltaTime: number) {
    this.interpolation.update(deltaTime);
  }

  render(renderer: RenderOrchestrator) {
    renderer.clear();
    renderer.renderEntities(this.entities.getAllEntities());
    renderer.renderUI();
  }
}
```

---

## 详细设计方案

### 6.1 ECS 实现细节

#### 性能优化

**问题**: `withComponents()` 查询效率低（遍历所有实体）

**解决方案**: 使用索引加速查询

```typescript
export class EntityManager {
  private entities: Map<EntityId, Entity> = new Map();
  private componentIndex: Map<ComponentType, Set<EntityId>> = new Map();  // 索引

  createEntity(components: Component[]): Entity {
    const entity = new Entity(this.generateId());
    for (const comp of components) {
      entity.addComponent(comp);
      this.indexComponent(entity.id, comp.type);
    }
    this.entities.set(entity.id, entity);
    return entity;
  }

  private indexComponent(entityId: EntityId, type: ComponentType) {
    if (!this.componentIndex.has(type)) {
      this.componentIndex.set(type, new Set());
    }
    this.componentIndex.get(type)!.add(entityId);
  }

  // 优化后的查询（O(n) -> O(k)，k 为组件数量）
  withComponents(types: ComponentType[]): Entity[] {
    if (types.length === 0) return [];

    // 找到最小的集合作为起点
    let minSet: Set<EntityId> | undefined;
    for (const type of types) {
      const set = this.componentIndex.get(type);
      if (!set || set.size === 0) return [];
      if (!minSet || set.size < minSet.size) {
        minSet = set;
      }
    }

    // 过滤出包含所有组件的实体
    const result: Entity[] = [];
    for (const id of minSet!) {
      const entity = this.entities.get(id)!;
      if (types.every(t => entity.hasComponent(t))) {
        result.push(entity);
      }
    }
    return result;
  }
}
```

#### 内存管理

**对象池（Object Pool）** 避免频繁创建/销毁子弹实体：

```typescript
class EntityPool {
  private pool: Entity[] = [];

  acquire(components: Component[]): Entity {
    let entity = this.pool.pop();
    if (!entity) {
      entity = new Entity(this.generateId());
    }

    // 重置并添加组件
    entity.components.clear();
    for (const comp of components) {
      entity.addComponent(comp);
    }
    return entity;
  }

  release(entity: Entity): void {
    entity.components.clear();
    this.pool.push(entity);
  }
}
```

### 6.2 延迟补偿适配

**当前实现** (room.ts):
```typescript
private positionHistory: Map<string, Array<{ tick: number; x: number; y: number; timestamp: number }>> = new Map();

private recordPlayerPosition(player: Player) {
  // ... 记录位置历史
}

private getHistoricalPosition(player: Player, msAgo: number): { x: number; y: number } {
  // ... 回溯历史
}
```

**ECS 适配**:
```typescript
// 新增 PositionHistoryComponent
interface PositionHistoryComponent extends Component {
  type: 'PositionHistory';
  history: Array<{ tick: number; x: number; y: number; timestamp: number }>;
  maxHistory: number;
}

// LagCompensationSystem
class LagCompensationSystem {
  update(entities: EntityManager, tick: number) {
    // 记录所有玩家位置
    for (const entity of entities.withComponents(['Position', 'PositionHistory', 'Player'])) {
      const pos = entity.getComponent<PositionComponent>('Position')!;
      const history = entity.getComponent<PositionHistoryComponent>('PositionHistory')!;

      history.history.push({ tick, x: pos.x, y: pos.y, timestamp: Date.now() });

      // 保留最近 N 个历史
      if (history.history.length > history.maxHistory) {
        history.history.shift();
      }
    }
  }

  getHistoricalPosition(entity: Entity, msAgo: number): { x: number; y: number } {
    const history = entity.getComponent<PositionHistoryComponent>('PositionHistory');
    if (!history) {
      const pos = entity.getComponent<PositionComponent>('Position')!;
      return { x: pos.x, y: pos.y };
    }

    const targetTime = Date.now() - msAgo;

    // 二分查找最接近的历史记录
    let left = 0, right = history.history.length - 1;
    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (history.history[mid].timestamp < targetTime) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }

    return history.history[left];
  }
}
```

### 6.3 协议迁移策略

**渐进式迁移**:

```
阶段 A: 保持现有协议（S2C_SNAPSHOT 包含 players[], bullets[]）
  - 服务端内部使用 ECS
  - 序列化时转换 Entity -> PLAYER_STATE

阶段 B: 引入通用 Entity 协议（可选，用于 MOD 支持）
  - 新增 S2C_ENTITY_SNAPSHOT 消息
  - 客户端同时支持两种协议
  - 服务端可配置使用哪种协议

阶段 C: 废弃旧协议（长期目标）
  - 所有客户端迁移到新协议
  - 删除兼容层代码
```

**通用 Entity 协议示例** (未来扩展):
```typescript
export const ENTITY_STATE_SCHEMA = z.object({
  id: z.string(),
  components: z.record(z.string(), z.any()),  // ComponentType -> Component data
});

export const S2C_ENTITY_SNAPSHOT_SCHEMA = z.object({
  type: z.literal('S2C_ENTITY_SNAPSHOT'),
  tick: z.number(),
  entities: z.array(ENTITY_STATE_SCHEMA),
});
```

优势：
- MOD 可以添加自定义组件（无需修改协议）
- 服务端和客户端完全数据驱动
- 支持热重载和动态内容

### 6.4 局内装备自动替换与友好 UI

**设计目标**:
1. 战斗中尽量不打断操作，自动完成“更好装备”的替换
2. 变化要有明显提示，同时允许短时间撤销
3. 基于现有 HUD/背包列表结构扩展，避免新增复杂面板

**UI 结构**:
1. **装备条（HUD“战斗状态”下方）**
   - 槽位：武器 / 护甲 / 背包
   - 展示：名称 + 核心数值（弹匣/减伤/容量）
   - 装备变化时高亮 1.5s，并在事件日志追加一条简短记录
2. **拾取/替换 Toast（屏幕中心偏下）**
   - 成功示例：`自动装备：战术背包 +4 容量（旧背包已放入背包）`
   - 失败示例：`背包已满，无法替换武器`
   - 交互：`Z` 撤销（`undoWindowMs` 内）
3. **背包面板（`Tab`/`I` 打开）**
   - 顶部固定装备区，物品条目右侧提供 `装备/交换` 按钮
   - 已装备物品显示 `已装备` 标记，便于识别

**自动替换判定**:
```typescript
isUpgrade(item, currentEquip) {
  if (item.type === 'bag') return item.bagCap > currentEquip.bagCap;
  if (item.type === 'armor') return item.damageReduction > currentEquip.damageReduction;
  if (item.type === 'weapon') return currentEquip.weaponTypeId === 'w_fists';
  return false;
}
```

**交互流程**:
1. **拾取**：拾取后立即比较“更好”规则
2. **自动替换**：满足条件且不冲突 → 自动装备
   - 旧装备优先放入背包；背包满则掉落到地面（生成 WorldItem）
   - 装备条高亮 + Toast 提示
3. **撤销**：`undoWindowMs` 内支持撤销，恢复旧装备并回收新装备
4. **手动交换/卸下**：
   - 背包内物品拖拽到装备槽，或点击 `装备/交换`
   - 武器槽提供 `卸下`：切换为 `w_fists`

**边界与提示**:
- 新背包容量小于当前已占用格数 → 提示“容量不足，无法替换”
- 装备数据异常（typeId 不存在）→ 明确提示并回退默认装备
- 服务端权威判定装备结果，客户端仅做 UI 预览与提示

---

## 风险评估与缓解

### 7.1 技术风险

| 风险 | 严重性 | 概率 | 缓解措施 |
|------|--------|------|----------|
| **ECS 性能下降** | 高 | 中 | 1. 使用组件索引优化查询<br>2. 对象池减少 GC<br>3. 性能基准测试对比 |
| **协议不兼容** | 高 | 低 | 1. 保留兼容层<br>2. 版本号控制<br>3. 回归测试套件 |
| **状态同步 bug** | 中 | 中 | 1. 快照对比工具<br>2. 确定性测试<br>3. 客户端服务端双向验证 |
| **AI 性能瓶颈** | 中 | 高 | 1. 限制 NPC 数量<br>2. LOD（远距离 NPC 降低更新频率）<br>3. 异步路径规划 |

### 7.2 项目风险

| 风险 | 严重性 | 概率 | 缓解措施 |
|------|--------|------|----------|
| **重构时间超支** | 高 | 高 | 1. 分阶段实施<br>2. 每阶段可交付<br>3. 保留回退选项 |
| **破坏现有功能** | 高 | 中 | 1. 完整的回归测试<br>2. 烟雾测试自动化<br>3. 金丝雀部署 |
| **团队学习曲线** | 中 | 高 | 1. ECS 培训文档<br>2. Code Review 标准<br>3. Pair Programming |

### 7.3 回退策略

**每阶段保留回退点**:
1. 创建 Git 分支 `refactor/phase-1`
2. 保留旧代码作为 `@deprecated` 标记
3. 使用 Feature Flag 控制新旧系统切换

```typescript
// 功能开关示例
const USE_ECS = process.env.USE_ECS === 'true';

if (USE_ECS) {
  // 新的 ECS 逻辑
  this.combatSystem.update(this.entities, this.tick);
} else {
  // 旧的 Room 逻辑
  this.updateBullets();
  this.checkBulletCollisions();
}
```

---

## 附录

### A. 词汇表

| 术语 | 定义 |
|------|------|
| **ECS** | Entity-Component-System，一种架构模式 |
| **Entity** | 实体，游戏世界中的唯一对象（玩家、子弹、NPC） |
| **Component** | 组件，实体的数据和行为模块 |
| **System** | 系统，处理特定组件组合的逻辑 |
| **God Class** | 上帝类，承担过多职责的反模式 |
| **SSOT** | Single Source of Truth，单一数据源 |
| **Lag Compensation** | 延迟补偿，通过回溯历史补偿网络延迟 |

### B. 参考资源

- [ECS FAQ](https://github.com/SanderMertens/ecs-faq)
- [Overwatch Gameplay Architecture](https://www.youtube.com/watch?v=W3aieHjyNvw)
- [Understanding Component-Entity-Systems](https://www.gamedev.net/tutorials/programming/general-and-gameplay-programming/understanding-component-entity-systems-r3013/)
- [Data-Oriented Design](https://www.dataorienteddesign.com/dodbook/)

### C. 下一步行动

完成本设计文档后，建议：

1. **召集技术评审会议**
   - 评审 ECS 架构设计
   - 确认优先级和时间线
   - 分配开发任务

2. **建立开发环境**
   - 创建 `refactor/phase-1` 分支
   - 配置 Feature Flag 系统
   - 编写基准性能测试

3. **开始 Step 1.1 实施**
   - 实现 `Entity`, `EntityManager` 核心类
   - 编写单元测试
   - 验证基础架构可行性

4. **持续跟踪进度**
   - 每周同步重构进展
   - 更新本文档（记录实际遇到的问题和解决方案）
   - 调整时间线和优先级

---

**文档版本历史**

| 版本 | 日期 | 作者 | 变更说明 |
|------|------|------|----------|
| 1.0 | 2026-01-05 | Claude | 初始版本 |

