# 武器系统代码上下文（给 GPT 的完整参考）

本文档整理了武器系统的核心代码片段，帮助理解**两层架构**：
- **ITEM_CATALOG**（商品表：价格、稀有度）
- **WEAPONS**（战斗参数：射速、伤害、散布）

---

## 核心概念速查

1. **ITEM_CATALOG**：道具目录（商店/仓库展示与经济参数）
2. **WeaponDef / WEAPONS**：战斗参数（射速、散布、伤害、初速……）
3. **wr.weaponTypeId**：当前玩家装备的武器类型
4. **wr.nextFireTick / wr.reloadingUntilTick**：射击冷却 & 换弹锁
5. **tick**：服务端模拟步进（**50ms = 1 tick**）

---

## 1. ITEM_CATALOG（商品表层）

**位置**：`shared/src/item_catalog.ts`

```71:105:shared/src/item_catalog.ts
  w_pistol: {
    id: 'w_pistol',
    name: 'Pistol',
    rarity: 'COMMON',
    value: 200,
    stackMax: 1,
  },
  w_smg: {
    id: 'w_smg',
    name: 'SMG',
    rarity: 'RARE',
    value: 600,
    stackMax: 1,
  },
  w_burst: {
    id: 'w_burst',
    name: 'Burst Rifle',
    rarity: 'RARE',
    value: 800,
    stackMax: 1,
  },
  w_dmr: {
    id: 'w_dmr',
    name: 'DMR',
    rarity: 'RARE',
    value: 1200,
    stackMax: 1,
  },
  w_shotgun: {
    id: 'w_shotgun',
    name: 'Shotgun Slug',
    rarity: 'RARE',
    value: 900,
    stackMax: 1,
  },
```

**字段说明**：
- `id`：武器类型ID（用于关联 WEAPONS）
- `name`：显示名称
- `rarity`：稀有度（影响掉落概率）
- `value`：商店价格/出售价值
- `stackMax`：堆叠上限（武器通常为 1）

**重要**：ITEM_CATALOG **不包含**战斗参数（伤害、射速等），这些在 WEAPONS 中定义。

---

## 2. WEAPONS（战斗参数层）

**位置**：`shared/src/equipment.ts`

### 接口定义

```7:16:shared/src/equipment.ts
export interface WeaponDef {
  typeId: string;
  name: string;
  magSize: number; // 弹匣容量
  reloadMs: number; // 换弹时间（毫秒）
  fireIntervalMs: number; // 开火间隔（毫秒）
  spreadDeg: number; // 散布角度（度）
  bulletSpeed: number; // 子弹初速
  damage: number; // 命中伤害
}
```

### 武器配置表

```33:94:shared/src/equipment.ts
export const WEAPONS: Record<string, WeaponDef> = {
  w_fists: {
    typeId: 'w_fists',
    name: 'FISTS',
    magSize: 0, // 拳头没有弹药
    reloadMs: 0, // 不需要换弹
    fireIntervalMs: 500, // 近战攻击间隔
    spreadDeg: 0, // 无散布
    bulletSpeed: 0, // 不使用子弹
    damage: 15, // 近战伤害
  },
  w_pistol: {
    typeId: 'w_pistol',
    name: 'Pistol',
    magSize: 12,
    reloadMs: 1500,
    fireIntervalMs: 200,
    spreadDeg: 3,
    bulletSpeed: 800,
    damage: 25,
  },
  w_smg: {
    typeId: 'w_smg',
    name: 'SMG',
    magSize: 30,
    reloadMs: 2000,
    fireIntervalMs: 100,
    spreadDeg: 5,
    bulletSpeed: 900,
    damage: 20,
  },
  w_burst: {
    typeId: 'w_burst',
    name: 'Burst Rifle',
    magSize: 20,
    reloadMs: 2500,
    fireIntervalMs: 150,
    spreadDeg: 2,
    bulletSpeed: 1000,
    damage: 30,
  },
  w_dmr: {
    typeId: 'w_dmr',
    name: 'DMR',
    magSize: 10,
    reloadMs: 3000,
    fireIntervalMs: 500,
    spreadDeg: 1,
    bulletSpeed: 1200,
    damage: 50,
  },
  w_shotgun: {
    typeId: 'w_shotgun',
    name: 'Shotgun Slug',
    magSize: 8,
    reloadMs: 3500,
    fireIntervalMs: 800,
    spreadDeg: 8,
    bulletSpeed: 600,
    damage: 60,
  },
};
```

**关键字段说明**：
- `fireIntervalMs`：两次开火最小间隔（射速），**这是冷却时间的来源**
- `damage`：命中伤害值
- `spreadDeg`：散布角度（度），用于 `applySpread()`
- `bulletSpeed`：子弹初速（像素/秒）
- `magSize`：弹匣容量
- `reloadMs`：换弹时间（毫秒）

---

## 3. 服务端 Tick 常量

**位置**：`server/src/main.ts`

```21:21:server/src/main.ts
const TICK_INTERVAL_MS = 50; // 20Hz
```

**换算关系**：
- `1 tick = 50ms`
- `fireIntervalMs / 50` = 需要的 tick 数

**建议改进**：将硬编码的 `50` 抽成常量 `TICK_MS`，避免全局搜索替换：

```typescript
const TICK_MS = 50;
const msToTicks = (ms: number) => Math.ceil(ms / TICK_MS);
```

---

## 4. 武器初始化（weaponTypeId 赋值）

**位置**：`server/src/room.ts` - `addPlayer()` 方法

### 从 Profile 加载武器

```485:547:server/src/room.ts
    // 新增: 初始化武器运行时状态
    let weaponRuntime: WeaponRuntime | undefined = undefined;
    if (profile && profile.equipment.weaponIid) {
      const weaponItem = profile.stash.find(item => item.iid === profile.equipment.weaponIid);
      if (weaponItem) {
        try {
          const weaponDef = getWeaponDef(weaponItem.typeId);
          weaponRuntime = {
            weaponTypeId: weaponItem.typeId,
            ammoInMag: weaponDef.magSize,
            reloadingUntilTick: 0,
            nextFireTick: this.tick,
          };
          log('WEAPON_INIT', {
            room: this.id,
            player: playerId,
            weaponIid: profile.equipment.weaponIid,
            weaponTypeId: weaponItem.typeId,
            ammoInMag: weaponDef.magSize,
            tick: this.tick,
          });
        } catch (err) {
          // 无效的武器类型，使用默认FISTS
          log('WEAPON_INIT_ERROR', {
            room: this.id,
            player: playerId,
            weaponIid: profile.equipment.weaponIid,
            weaponTypeId: weaponItem.typeId,
            error: err instanceof Error ? err.message : String(err),
            tick: this.tick,
          });
        }
      } else {
        // 武器不在 stash 中（不应该发生，但为了安全）
        log('WEAPON_NOT_FOUND_IN_STASH', {
          room: this.id,
          player: playerId,
          weaponIid: profile.equipment.weaponIid,
          stashCount: profile.stash.length,
          tick: this.tick,
        });
      }
    }
    // 如果没有装备武器，使用默认FISTS（空装可玩）
    if (!weaponRuntime) {
      try {
        const defaultWeaponDef = getWeaponDef('w_fists');
        weaponRuntime = {
          weaponTypeId: 'w_fists',
          ammoInMag: 0, // FISTS 没有弹药
          reloadingUntilTick: 0,
          nextFireTick: this.tick,
        };
        log('WEAPON_INIT_DEFAULT_FISTS', {
          room: this.id,
          player: playerId,
          hasWeaponIid: profile?.equipment.weaponIid ? 'yes' : 'no',
          tick: this.tick,
        });
      } catch {
        // 如果连FISTS都没有，weaponRuntime保持undefined（不应该发生）
      }
    }
```

**关键逻辑**：
1. 从 `profile.equipment.weaponIid` 查找装备的武器实例
2. 通过 `weaponItem.typeId` 获取武器类型ID
3. 用 `getWeaponDef(weaponItem.typeId)` 获取战斗参数
4. 初始化 `weaponRuntime.weaponTypeId = weaponItem.typeId`
5. 如果未装备武器，默认使用 `w_fists`

---

## 5. 子弹生成与冷却逻辑

**位置**：`server/src/room.ts` - `processInput()` 方法中的射击处理

### 冷却检查

```780:792:server/src/room.ts
      // 检查是否可以开火
      if (this.tick < wr.reloadingUntilTick) {
        // 正在换弹，不能开火（发送干火事件）
        if (!this.combatEvents.has(playerId)) {
          this.combatEvents.set(playerId, []);
        }
        this.combatEvents.get(playerId)!.push({ kind: 'DRY_FIRE' });
        return;
      }
      if (this.tick < wr.nextFireTick) {
        // 射速冷却未完成，不能开火
        return;
      }
```

### 武器选择与子弹生成

```794:924:server/src/room.ts
      try {
        const weaponDef = getWeaponDef(wr.weaponTypeId);
        
        // 检查是否是 FISTS（近战武器）
        if (wr.weaponTypeId === 'w_fists') {
          // ... 近战攻击逻辑 ...
          
          // 更新冷却
          wr.nextFireTick = this.tick + Math.ceil(weaponDef.fireIntervalMs / 50);
          return;
        }
        
        // 远程武器：检查弹药
        if (wr.ammoInMag <= 0) {
          // 弹匣空了，触发自动换弹（兜底）
          if (weaponDef.reloadMs > 0) {
            wr.reloadingUntilTick = this.tick + Math.ceil(weaponDef.reloadMs / 50);
            // ammoInMag保持0，换弹完成后再回满
          }
          // 发送干火事件
          if (!this.combatEvents.has(playerId)) {
            this.combatEvents.set(playerId, []);
          }
          this.combatEvents.get(playerId)!.push({ kind: 'DRY_FIRE' });
          return;
        }
        
        // 可以开火
        // 扣弹匣
        wr.ammoInMag -= 1;
        wr.nextFireTick = this.tick + Math.ceil(weaponDef.fireIntervalMs / 50);
        
        // 应用散布
        const bulletRng = createRng(this.seed + this.tick + this.bulletIdCounter);
        const actualAimRad = applySpread(input.aim, weaponDef.spreadDeg, bulletRng);
        
        // 生成子弹
        const vx = Math.cos(actualAimRad) * weaponDef.bulletSpeed;
        const vy = Math.sin(actualAimRad) * weaponDef.bulletSpeed;
        
        const bulletId = `b${this.bulletIdCounter++}_${Math.floor(bulletRng() * 1000000).toString(36)}`;
        const now = Date.now();
        this.bullets.push({
          id: bulletId,
          x: player.x,
          y: player.y,
          vx,
          vy,
          ownerId: playerId,
          clientShotId: input.shotId, // 客户端发射ID（用于预测子弹对齐）
          spawnAt: now, // 记录生成时间，用于TTL检查
          damage: weaponDef.damage, // 记录伤害值，用于命中扣血
        });
        
        log('SPAWN_BULLET', {
          room: this.id,
          player: playerId,
          tick: this.tick,
          bullet: bulletId,
          weapon: wr.weaponTypeId,
          ammo: wr.ammoInMag,
          pos: `(${player.x.toFixed(1)},${player.y.toFixed(1)})`,
          aim: input.aim.toFixed(2),
        });
      } catch {
        // 无效武器类型，不能开火
      }
```

**关键流程**：
1. **武器选择**：`getWeaponDef(wr.weaponTypeId)` 获取当前武器的战斗参数
2. **冷却检查**：`this.tick < wr.nextFireTick` 判断是否在冷却中
3. **冷却设置**：`wr.nextFireTick = this.tick + Math.ceil(weaponDef.fireIntervalMs / 50)`
4. **子弹生成**：
   - 使用 `weaponDef.bulletSpeed` 计算速度
   - 使用 `weaponDef.spreadDeg` 应用散布
   - 使用 `weaponDef.damage` 设置伤害值

---

## 6. 换弹逻辑

**位置**：`server/src/room.ts` - `updateWeaponRuntime()` 方法

```615:630:server/src/room.ts
  public updateWeaponRuntime(playerId: string): void {
    const player = this.players.get(playerId);
    if (!player || !player.weaponRuntime) return;
    
    const wr = player.weaponRuntime;
    if (wr.reloadingUntilTick > 0 && this.tick >= wr.reloadingUntilTick) {
      // 换弹完成
      try {
        const weaponDef = getWeaponDef(wr.weaponTypeId);
        wr.ammoInMag = weaponDef.magSize;
        wr.reloadingUntilTick = 0;
      } catch {
        // 无效武器类型，忽略
      }
    }
  }
```

---

## 关键要点总结

### 两层架构
- **ITEM_CATALOG**：商品表（价格、稀有度、名称）
- **WEAPONS**：战斗参数（射速、伤害、散布、初速）

### 冷却机制
- **不是 FIRE_COOLDOWN_MS**，而是每个武器的 `fireIntervalMs`
- 冷却计算：`nextFireTick = this.tick + ceil(fireIntervalMs / 50)`
- 50ms 是硬编码的 tick 间隔，建议抽成常量

### 武器选择
- 通过 `wr.weaponTypeId` 标识当前武器
- 用 `getWeaponDef(wr.weaponTypeId)` 获取战斗参数
- 初始化时从 `profile.equipment.weaponIid` 加载

### 子弹生成
- 速度：`vx/vy = cos/sin(aim) * weaponDef.bulletSpeed`
- 散布：`applySpread(input.aim, weaponDef.spreadDeg, rng)`
- 伤害：直接使用 `weaponDef.damage`

---

## 常见陷阱

1. **不要改 ITEM_CATALOG 来改伤害/射速**：这些字段在 WEAPONS 中
2. **硬编码 50ms**：建议抽成 `TICK_MS` 常量
3. **散布角度单位**：`spreadDeg` 是度，`applySpread()` 内部会转换为弧度
4. **时间戳混用**：`spawnAt` 用 `Date.now()`（毫秒），但冷却用 tick，注意一致性
5. **客户端子弹速度不一致**：客户端预测子弹时，必须从 `localPlayer.weaponRuntime.weaponTypeId` 获取武器定义，而不是从 `playerProfile.equipment.weaponIid` 获取。`playerProfile` 可能为 null 或状态过时，导致使用默认值 `DEFAULT_BULLET_SPEED = 800` 而不是实际的武器速度（如狙击步枪的 1600）

---

## 搜索关键词（用于进一步定位代码）

- 武器切换：`rg "weaponTypeId\s*=" server/src -n`
- 装备系统：`rg "equip|switch|loadout" server/src -n`
- 物品目录：`rg "ITEM_CATALOG" shared/src -n`
- 武器定义：`rg "WEAPONS|getWeaponDef" shared/src -n`










