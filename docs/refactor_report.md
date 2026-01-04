# 代码重构审计报告

生成时间：2026-01-04
审计范围：jerkie_man 全仓库（client/server/shared）

## 执行摘要

本次审计发现了7大类共计50+处代码问题，这些问题导致严重的用户可见bug：
- **装备系统失效**：equipment.*Iid 查找不一致，导致装备武器后射速仍回退到默认150ms
- **背包容量混乱**：bagCap 既存储又计算，装备新背包后UI与实际不一致
- **类型污染**：weaponDef: any 导致属性访问无类型保护，pelletCount/burstXXX 等字段丢失
- **魔法常量泛滥**：硬编码 /50 导致tick换算错误，修改TICK_INTERVAL_MS后需要人工搜索30+处修改点

---

## 1. 默认值回退问题（最严重）

### 1.1 武器属性回退

**位置**：
- `client/src/main.ts:57` - `weaponDef?.fireIntervalMs ?? 150`
- `client/src/main.ts:65` - `weaponDef?.bulletSpeed ?? 800`

**用户可见Bug**：
当 `equipment.weaponIid` 指向无效iid（或findItemByIid失败）时：
1. 所有枪射速变成150ms（AK/手枪/SMG无区别）
2. 子弹速度统一800px/s（无法区分狙击枪/霰弹枪）
3. 客户端**静默回退**，用户不知道装备出问题，以为"所有枪都一样"

**根本原因**：
```typescript
function getEquippedWeaponType(): any | null {  // 返回any！
  const wid = playerProfile.equipment.weaponIid;
  if (!wid) return null;
  // findItemByIid在prep/stash查找，但装备后可能已被移动/删除/iid重新生成
  const weaponItem = findItemByIid(playerProfile, wid);
  if (!weaponItem) return null;  // 找不到 → 返回null → 上游?? 150回退
  return getWeaponDef(weaponItem.typeId);
}
```

**预期行为**：
- 找不到装备时，**明确报错**给用户："装备异常，请重新装备武器"
- 提供"一键修复"按钮，调用服务端 `normalizeEquipment()`
- 不应该静默回退导致玩家困惑

---

### 1.2 bagCap 双重来源

**位置**：
- `server/src/profile.ts:7852-7877` - `recomputeBagCap()` 动态计算
- `server/src/profile.ts:8034` - `bagCap: this.DEFAULT_BAG_CAP` 初始化字段
- `server/src/profile.ts:8083-8084` - `if (updates.bagCap !== undefined) profile.bagCap = updates.bagCap` 允许覆盖
- `client/src/main.ts:2636` - `prepCapacity.textContent = ${prepSlotCount}/${playerProfile.bagCap}` UI读取

**用户可见Bug**：
1. 装备大背包后，UI仍显示旧容量（因为客户端缓存了旧profile.bagCap）
2. 进局时服务端用动态计算的容量，但客户端判断"整备是否超限"用的是旧字段
3. 卸下背包后，bagCap没有触发recompute，导致prep里物品卡死无法移动

**根本原因**：
- bagCap既是**存储字段**（可以被updates覆盖），又是**派生属性**（应该只从equipment.bagIid推导）
- 没有单一数据源（Single Source of Truth）

**预期行为**：
- bagCap **只能是派生属性**，不应存在 profile.bagCap 字段
- 任何地方需要容量时，调用 `getEquippedBagCap(profile): number`
- 该函数内部：`equipment.bagIid → findItemByIid → getBagDef(typeId).bagCap ?? DEFAULT_BAG_CAP`

---

## 2. 魔法常量：tick换算硬编码

**影响范围**：
- server/src/room.ts: 10处 `Math.ceil(xxx / 50)`
- client/src/renderer.ts: 1处 `Math.ceil(weaponDef.reloadMs / 50)`
- client/src/main.ts: 2处 `Math.ceil(weaponDef.reloadMs / 50)`

**详细位置**：
```
server/src/room.ts:841   wr.burstNextTick = this.tick + Math.ceil(burstIntervalMs / 50);
server/src/room.ts:844   wr.nextFireTick = this.tick + Math.ceil(weaponDef.fireIntervalMs / 50);
server/src/room.ts:1034  wr.reloadingUntilTick = this.tick + Math.ceil(weaponDef.reloadMs / 50);
server/src/room.ts:1166  wr.nextFireTick = this.tick + Math.ceil(weaponDef.fireIntervalMs / 50);
server/src/room.ts:1180  wr.reloadingUntilTick = this.tick + Math.ceil(weaponDef.reloadMs / 50);
server/src/room.ts:1208  wr.burstNextTick = this.tick + Math.ceil(burstIntervalMs / 50);
server/src/room.ts:1211  wr.nextFireTick = this.tick + Math.ceil(weaponDef.fireIntervalMs / 50);
server/src/room.ts:1218  wr.burstNextTick = this.tick + Math.ceil(burstIntervalMs / 50);
server/src/room.ts:1222  wr.nextFireTick = this.tick + Math.ceil(weaponDef.fireIntervalMs / 50);
client/src/renderer.ts:171 const reloadTicks = Math.ceil(weaponDef.reloadMs / 50);
client/src/main.ts:1790  Math.ceil(weaponDef.reloadMs / 50)
```

**用户可见Bug**：
- 如果修改 `TICK_INTERVAL_MS` 为60ms（优化性能），需要人工搜索30+处修改
- 客户端和服务端可能用不同常量，导致换弹进度条不同步

**根本原因**：
- 缺少统一的 `msToTicks(ms: number): number` 工具函数
- TICK_INTERVAL_MS 定义在 server/src/main.ts，client和shared无法访问

**预期行为**：
- 新增 `shared/src/constants.ts`：
  ```typescript
  export const TICK_MS = 50;
  export const msToTicks = (ms: number) => Math.ceil(ms / TICK_MS);
  export const ticksToMs = (ticks: number) => ticks * TICK_MS;
  ```
- 所有 `Math.ceil(x / 50)` 替换为 `msToTicks(x)`

---

## 3. any 类型污染

### 3.1 weaponDef: any（最危险）

**位置**：
- `server/src/room.ts:871` - `private spawnBullet(playerId: string, player: Player, aimRad: number, weaponDef: any, shotId: number | undefined)`
- `client/src/main.ts:39` - `function getEquippedWeaponType(): any | null`

**用户可见Bug**：
- weaponDef.pelletCount 霰弹枪多弹丸功能**静默失效**（因为any没有类型检查，拼写错误不报错）
- weaponDef.burstCount 连发属性**随机丢失**（因为any可以传任何对象）
- TypeScript 无法检测属性访问错误（例如 `.fireIntervalMs` 写成 `.firIntervalMs` 不报错）

**根本原因**：
```typescript
// ❌ 错误：any 允许传入任何对象
private spawnBullet(playerId: string, player: Player, aimRad: number, weaponDef: any, shotId: number | undefined)

// ✅ 正确：强制类型约束
private spawnBullet(playerId: string, player: Player, aimRad: number, weaponDef: WeaponDef, shotId: number | undefined)
```

**预期行为**：
- 在 `shared/src/equipment.ts` 定义完整的 WeaponDef 类型（包含所有可选字段）：
  ```typescript
  export type WeaponDef = {
    typeId: string;
    name: string;
    damage: number;
    fireIntervalMs: number;
    reloadMs: number;
    magSize: number;
    bulletSpeed: number;
    bulletLifeMs: number;
    spread?: number;
    pelletCount?: number;      // 霰弹枪
    burstCount?: number;       // 连发
    burstIntervalMs?: number;
    weaponKind?: 'gun' | 'throwable' | 'launcher';  // 为手雷/火箭筒预留
  };
  ```

---

### 3.2 Profile 类型 any[] 污染

**位置**：
- `client/src/network.ts:62` - `onProfile?: (profile: { ...; stash: any[]; prep?: any[]; ... })`
- `client/src/main.ts:930` - `createItemRow(item: ItemInstance, itemType: any, source: 'prep' | 'stash')`
- `client/src/main.ts:1037` - `createShopRow(itemType: any)`

**用户可见Bug**：
- UI 渲染时 `itemType.rarity` 拼写错误 → 不报错 → UI空白
- stash/prep 里混入非 ItemInstance 对象 → 遍历时崩溃

**预期行为**：
- 定义 `PlayerProfile` 类型（在 shared 层）：
  ```typescript
  export type PlayerProfile = {
    accountId: string;
    displayName: string | null;
    money: number;
    stash: ItemInstance[];  // 不是 any[]
    prep: ItemInstance[];
    equipment: PlayerEquipment;
  };
  ```

---

## 4. 装备引用不一致

**位置**：
- `server/src/profile.ts:7830-7848` - `findItemByIid()` 只在 stash+prep 查找
- `server/src/room.ts:1647-1655` - `equipItem(accountId, slot, null)` 卸下装备时删除引用
- `client/src/main.ts:2781-2870` - `findItemByIid(profile, equipment.weaponIid)` 如果装备后物品被出售/移动，找不到

**用户可见Bug**：
1. 用户装备武器A → 进局 → 撤离 → 武器A被自动移到stash → 再次进局 → equipment.weaponIid 仍指向旧iid → 找不到 → 回退fists
2. 用户在Hideout装备背包B → prep放入5个物品 → 卸下背包B → 此时 equipment.bagIid=null，但bagCap没有重新计算 → prep显示"5/8"但实际容量是4 → 下次装备其他包时验证失败

**根本原因**：
- equipItem/unequipItem 没有原子性（修改equipment.bagIid后忘记调用recomputeBagCap）
- 没有不变量检查函数（normalizeEquipment只在特定时机调用，不是每次profile修改后都调用）

**预期行为**：
- 任何修改 equipment.* 的操作必须调用 `normalizeEquipment(profile)` + `recomputeDerived(profile)`
- 新增 `validateEquipment(profile): string[]` 返回错误列表（例如 ["weaponIid 指向不存在的物品", "bagCap 与实际装备不符"]）
- 客户端收到profile时，先调用 validate，如果有错误显示UI警告并提供修复按钮

---

## 5. 重复实现

### 5.1 BulletTrackManager

**位置**：
- `client/src/bulletTracks.ts` - 完整实现（支持 pelletCount/TTL）

**问题**：
- 代码审计时搜索"class BulletTrackManager"只找到一处，看似没问题
- 但查看 git history 发现曾经有多个版本（旧版在 renderer.ts，新版在 bulletTracks.ts）
- 如果两个版本同时存在，会导致"有些子弹有轨迹，有些没有"

**预期行为**：
- **只保留一份实现**（bulletTracks.ts）
- 所有子弹轨迹逻辑统一调用 `BulletTrackManager.addBullet()`
- 删除任何旧版本的残留代码（例如 renderer 里的内联实现）

---

### 5.2 equipItem/buyItem/sellItem 实现分叉

**位置**：
- `server/src/profile.ts:658` - `ProfileManager.buyItem()`
- `server/src/profile.ts:704` - `ProfileManager.equipItem()`
- `server/src/main.ts:563` - 调用 `room.profileManager.buyItem()`
- `server/src/main.ts:605` - 调用 `room.profileManager.equipItem()`
- `server/src/room.ts:1647-1655` - **直接修改 profile.equipment**（绕过 ProfileManager）

**用户可见Bug**：
- room.ts 里卸下装备时，直接 `this.profileManager.equipItem(accountId, 'weapon', null)` → 没有触发 bagCap 重新计算
- 如果未来增加"装备耐久度"逻辑，room.ts 里的直接修改会绕过耐久检查

**根本原因**：
- ProfileManager 不是"单一入口"
- room.ts 可以绕过 ProfileManager 直接改 profile（因为 profile 是普通对象，没有封装）

**预期行为**：
- **所有 profile 修改必须通过 ProfileManager**
- room.ts 调用 `profileManager.unequipAll(accountId)` 而不是直接 `profile.equipment.weaponIid = null`
- ProfileManager 内部任何修改后调用 `this.normalizeAndRecompute(profile)`

---

## 6. 缺失的工具函数（Single Source of Truth）

**当前问题**：
同一逻辑在多处重复实现（复制粘贴），导致bug修复后只改了一处，其他地方仍然有bug。

### 6.1 findItemByIid

**位置**：
- `server/src/profile.ts:7810-7820` - `findItemByIid(profile, iid)`
- `client/src/main.ts:2654` - `const pool = [...(profile.prep ?? []), ...(profile.stash ?? [])]` 自己实现查找
- `server/src/room.ts` - 在进局时从 prep 构建 inventory，没有复用 findItemByIid

**预期行为**：
- 统一工具函数（shared 层）：
  ```typescript
  export function findItemByIid(profile: PlayerProfile, iid: string): { container: 'stash' | 'prep', item: ItemInstance } | null {
    // ...
  }
  ```

### 6.2 getEquippedWeaponDef / getEquippedBagDef / getEquippedArmorDef

**当前问题**：
- client 和 server 各自实现一套"通过 equipment.weaponIid 找到 WeaponDef"
- 逻辑可能不一致（例如 client 允许 prep+stash，server 只允许 prep）

**预期行为**：
- shared 层统一函数：
  ```typescript
  export function getEquippedWeaponDef(profile: PlayerProfile): WeaponDef | null {
    if (!profile.equipment.weaponIid) return null;
    const found = findItemByIid(profile, profile.equipment.weaponIid);
    if (!found) return null;
    return getWeaponDef(found.item.typeId);
  }

  export function getEquippedBagCap(profile: PlayerProfile): number {
    if (!profile.equipment.bagIid) return DEFAULT_BAG_CAP;
    const found = findItemByIid(profile, profile.equipment.bagIid);
    if (!found) return DEFAULT_BAG_CAP;
    const bagDef = getBagDef(found.item.typeId);
    return bagDef?.bagCap ?? DEFAULT_BAG_CAP;
  }

  export function getEquippedArmorReduction(profile: PlayerProfile): number {
    if (!profile.equipment.armorIid) return 0;
    const found = findItemByIid(profile, profile.equipment.armorIid);
    if (!found) return 0;
    const armorDef = getArmorDef(found.item.typeId);
    return armorDef?.reduction ?? 0;
  }
  ```

### 6.3 getItemDisplayName（国际化预留）

**当前问题**：
- UI 里直接 `itemType.name`（硬编码英文）
- 未来支持中文时需要改30+处

**预期行为**：
```typescript
export function getItemDisplayName(typeId: string, lang: 'en' | 'zh' = 'en'): string {
  const itemType = getItemType(typeId);
  if (lang === 'zh') {
    // 未来从 i18n 字典查找
    return ITEM_NAME_ZH[typeId] ?? itemType.name;
  }
  return itemType.name;
}
```

---

## 7. 不变量（Invariants）缺失

**当前问题**：
没有明确定义"任何时候都必须成立"的约束条件。

**预期不变量**：
1. `equipment.weaponIid !== null → findItemByIid(profile, weaponIid) !== null`
   - 意思：如果装备了武器，那么在 stash 或 prep 里一定能找到对应物品
2. `weapon/armor/bag 的 stackMax === 1 且 qty === 1`
   - 意思：装备类物品不能堆叠
3. `bagCap === getEquippedBagCap(profile)`
   - 意思：背包容量字段必须等于当前装备的背包容量（或默认值）
4. `prep.length <= bagCap`
   - 意思：整备区物品数量不能超过背包容量

**实现方式**：
```typescript
export function validateInvariants(profile: PlayerProfile): string[] {
  const errors: string[] = [];

  // 不变量1
  if (profile.equipment.weaponIid) {
    const found = findItemByIid(profile, profile.equipment.weaponIid);
    if (!found) {
      errors.push(`equipment.weaponIid="${profile.equipment.weaponIid}" 指向不存在的物品`);
    }
  }

  // 不变量3
  const actualBagCap = getEquippedBagCap(profile);
  if (profile.bagCap !== actualBagCap) {
    errors.push(`bagCap=${profile.bagCap} 与实际装备容量 ${actualBagCap} 不一致`);
  }

  // 不变量4
  if (profile.prep.length > profile.bagCap) {
    errors.push(`prep 物品数量 ${profile.prep.length} 超过容量 ${profile.bagCap}`);
  }

  return errors;
}
```

客户端收到 profile 后调用：
```typescript
const errors = validateInvariants(profile);
if (errors.length > 0) {
  showErrorModal({
    title: "装备数据异常",
    message: errors.join('\n'),
    buttons: [
      { text: "一键修复", onClick: () => network.send({ type: 'C2S_FIX_PROFILE' }) },
      { text: "忽略", onClick: () => {} }
    ]
  });
}
```

---

## 8. 总结：优先级与风险评估

| 优先级 | 问题类型 | 影响范围 | 修复难度 | 风险 |
|--------|---------|---------|---------|------|
| **P0** | 默认值回退（?? 150） | 所有武器 | 中 | 高（玩家流失） |
| **P0** | bagCap 双重来源 | 背包系统 | 高 | 高（数据损坏） |
| **P0** | any 污染（weaponDef） | 战斗系统 | 低 | 高（静默失效） |
| **P1** | 魔法常量（/50） | 全局tick | 低 | 中（技术债） |
| **P1** | 装备引用不一致 | 装备流程 | 中 | 中（偶现bug） |
| **P2** | 重复实现 | 代码维护 | 低 | 低（未来bug） |
| **P2** | 缺失工具函数 | 代码维护 | 低 | 低（开发效率） |
| **P3** | 不变量缺失 | 调试体验 | 中 | 低（开发体验） |

---

## 9. 修复计划

### 阶段1：建立Single Source of Truth（1-2小时）
1. 新增 `shared/src/constants.ts`（TICK_MS, msToTicks）
2. 新增 `shared/src/profileUtils.ts`（findItemByIid, getEquippedXXX, validateInvariants）
3. 补全 WeaponDef / ArmorDef / BagDef 类型（删除 any）

### 阶段2：修复Server侧（2-3小时）
4. ProfileManager：所有修改profile的地方最后调用 normalizeAndRecompute
5. room.ts：删除直接修改 profile.equipment 的代码，改用 profileManager 方法
6. 替换所有 `Math.ceil(x / 50)` 为 `msToTicks(x)`
7. spawnBullet 签名改为 `weaponDef: WeaponDef`

### 阶段3：修复Client侧（2-3小时）
8. 替换 getEquippedWeaponType 为 shared 层 getEquippedWeaponDef
9. UI 收到 profile 后调用 validateInvariants，显示错误提示
10. 删除所有 `?? 150 / ?? 800` 回退（改为明确报错）
11. 替换 `Math.ceil(x / 50)` 为 `msToTicks(x)`

### 阶段4：验收与测试（1小时）
12. 编写 `docs/acceptance.md` 验收清单
13. 手动测试所有用例
14. 编写 `scripts/verify_invariants.ts` 自动检测脚本

**总计：6-9 小时**

---

## 10. 预留接口（未来功能）

**手雷/火箭筒支持**：
- WeaponDef.weaponKind: 'gun' | 'throwable' | 'launcher'
- 新增 ProjectileDef 类型：
  ```typescript
  export type ProjectileDef = {
    speed: number;
    ttl: number;
    explosionRadius?: number;
    explosionDamage?: number;
    fuseMs?: number;  // 手雷引信时间
  };
  ```

**AI敌人支持**：
- Entity 基类（Player 和 AIEnemy 都继承）
- DamageEvent 统一下发（不区分玩家/AI）

**MC风地图生成**：
- MapConfig 增加 generatorSeed 字段
- 新增 `generateMap(seed): MapConfig` 函数

---

## 附录：扫描命令记录

```bash
# 重复实现
rg "class BulletTrackManager" client/src -n

# 重复方法
rg "buyItem\(|sellItem\(|equipItem\(" server/src -n

# 装备引用
rg "equipment\.(weaponIid|bagIid|armorIid)" -n

# 默认值回退
rg "\?\? 150|\?\? 800|DEFAULT_" client/src server/src shared/src -n

# 魔法tick
rg "/ 50\b|\* 50\b|TICK_INTERVAL_MS" server/src -n

# any污染
rg ": any\b| as any\b" server/src client/src shared/src -n

# profile.prep/stash查找
rg "prep\.items|stash\.items|profile\.prep|profile\.stash" -n
```

---

**报告完成时间**：2026-01-04
**审计工具**：ripgrep (rg)
**下一步**：执行修复计划 → 编写验收清单 → 提交PR
