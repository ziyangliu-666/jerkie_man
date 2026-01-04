# 重构验收清单（Acceptance Checklist）

生成时间：2026-01-04
项目：jerkie_man 单一数据源重构

---

## 验收前提

### 编译测试
```bash
# 1. 编译shared包
cd shared
npm run build

# 2. 编译server包
cd ../server
npm run build

# 3. 编译client包
cd ../client
npm run build
```

**预期结果**：所有包编译通过，无TypeScript错误。

---

## 已完成的工作（✅）

### 1. 基础设施搭建

#### shared/src/constants.ts（新增）
- ✅ 定义了 `TICK_MS = 50` 常量
- ✅ 提供了 `msToTicks()` 和 `ticksToMs()` 工具函数
- ✅ 集中管理了所有魔法常量（DEFAULT_BAG_CAP, PLAYER_HIT_RADIUS等）

#### shared/src/profileUtils.ts（新增）
- ✅ `findItemByIid()` - 单一数据源的物品查找
- ✅ `getEquippedWeaponDef()` - 获取装备武器定义
- ✅ `getEquippedBagCap()` - 获取装备背包容量
- ✅ `getEquippedArmorReduction()` - 获取装备护甲减伤
- ✅ `validateInvariants()` - 验证profile不变量
- ✅ `getItemDisplayName()` - 物品显示名称（国际化预留）

#### shared/src/equipment.ts（扩展）
- ✅ 添加了 `WeaponKind` 类型（为手雷/火箭筒预留）
- ✅ 添加了 `ProjectileDef` 接口（为爆炸物预留）
- ✅ WeaponDef增加了 `weaponKind?: WeaponKind` 字段

### 2. 类型污染修复

#### server/src/room.ts
- ✅ `spawnBullet()` 签名从 `weaponDef: any` 改为 `weaponDef: WeaponDef`
- ✅ 导入了 `WeaponDef` 类型和 `msToTicks` 函数

### 3. 文档

- ✅ docs/refactor_report.md - 详细的审计报告（50+问题点）
- ✅ docs/acceptance.md - 本验收文档

---

## 核心验收场景（✓ = 可手动验证）

### A. 背包容量系统

#### A1. 装备大背包后容量变化
**步骤**：
1. 启动服务端：`cd server && npm start`
2. 启动客户端：`cd client && npm run dev`
3. 打开浏览器访问 http://localhost:5173
4. 进入 Hideout（初始状态）
5. 打开商店（Shop Tab）
6. 购买"大背包"（bag_expedition，容量20）
7. 在装备栏点击"装备"按钮
8. 观察整备区（Prep）容量显示

**预期结果**：
- ✓ 容量从 `0/4`（默认）变为 `0/20`
- ✓ 可以往整备区放入最多20件物品
- ⚠️ **已知问题**：目前bagCap仍是存储字段，需要改为动态计算（见"剩余工作"）

#### A2. 进局后拾取上限
**步骤**：
1. 装备大背包（容量20）
2. 往整备区放入5件物品
3. 点击"进入战局"
4. 在地图上拾取物品

**预期结果**：
- ✓ 最多可拾取15件物品（20 - 5 = 15）
- ⚠️ **已知问题**：如果服务端未使用 `getEquippedBagCap()`，仍可能回退到默认容量

---

### B. 武器射速系统

#### B1. 不同武器射速明显不同
**步骤**：
1. 购买"手枪"（w_pistol，射速300ms）和"冲锋枪"（w_smg，射速100ms）
2. 分别装备进局，在10秒内连续点击射击

**预期结果**：
- ✓ 手枪：10秒内约30发子弹（服务端LOG显示SPAWN_BULLET数量）
- ✓ 冲锋枪：10秒内约90发子弹
- ✓ 本地预测子弹轨迹数量也跟随射速变化
- ⚠️ **已知问题**：如果客户端仍使用 `?? 150` 回退，所有枪看起来射速一样

#### B2. 霰弹枪多弹丸
**步骤**：
1. 购买"霰弹枪"（w_shotgun，pelletCount=8）
2. 装备进局
3. 对着墙壁射击一次

**预期结果**：
- ✓ 服务端LOG显示 `SPAWN_BULLET_PELLETS`，pelletCount=8
- ✓ 一次射击生成8条子弹轨迹
- ✓ bullets数组长度增加8

---

### C. 护甲系统

#### C1. 装备护甲后减伤
**步骤**：
1. 不装备护甲，进局被手枪击中一次，记录扣血量（假设25HP）
2. 撤离，装备"凯夫拉甲"（armor_kevlar，减伤25%）
3. 再次进局被同一把枪击中

**预期结果**：
- ✓ 无护甲：扣血25 HP
- ✓ 有护甲：扣血19 HP（25 * 0.75 = 18.75 → floor=18，取决于实现）
- ⚠️ **已知问题**：服务端需要使用 `getEquippedArmorReduction(profile)` 而非直接读取字段

---

### D. 装备异常处理

#### D1. equipment.*Iid 指向无效物品
**模拟步骤**（需要手动修改数据库或使用调试工具）：
1. 装备武器A（记录iid）
2. 使用调试工具删除 stash 和 prep 中的该iid
3. 重新加载profile

**预期结果**：
- ✓ UI显示明确的"装备异常"提示
- ✓ 提供"一键修复"按钮
- ✓ 点击修复后调用 `validateInvariants()` 并清理无效引用
- ❌ **当前行为**：静默回退到默认武器（fists），用户不知道出问题

#### D2. bagCap 与实际装备不符
**模拟步骤**：
1. 装备大背包（容量20）
2. 手动修改数据库 `profile.bagCap = 4`
3. 重新加载

**预期结果**：
- ✓ `validateInvariants()` 返回错误："bagCap=4 与实际装备容量 20 不一致"
- ❌ **当前行为**：UI显示4，但实际能放20个物品（不一致）

---

## 剩余工作（技术债清单）

### P0（必须完成才能称为"彻底清掉问题"）

#### 1. 替换所有魔法常量 `/50`
**位置**：
- server/src/room.ts: 9处 `Math.ceil(x / 50)`
- client/src/renderer.ts: 1处
- client/src/main.ts: 2处

**修复方法**：
```typescript
// ❌ 错误
wr.nextFireTick = this.tick + Math.ceil(weaponDef.fireIntervalMs / 50);

// ✅ 正确
import { msToTicks } from '@jerkie-man/shared';
wr.nextFireTick = this.tick + msToTicks(weaponDef.fireIntervalMs);
```

**影响**：
- 修改 `TICK_INTERVAL_MS` 后需要人工搜索30+处
- 客户端和服务端可能用不同常量导致不同步

---

#### 2. 删除所有 `?? 150 / ?? 800` 默认值回退
**位置**：
- client/src/main.ts:57 - `weaponDef?.fireIntervalMs ?? 150`
- client/src/main.ts:65 - `weaponDef?.bulletSpeed ?? 800`

**修复方法**：
```typescript
// ❌ 错误：静默回退
function getLocalFireCooldownMs(): number {
  const weaponDef = getEquippedWeaponType();
  return weaponDef?.fireIntervalMs ?? 150; // 找不到武器 → 默认150ms
}

// ✅ 正确：明确报错
import { getEquippedWeaponDef } from '@jerkie-man/shared';
function getLocalFireCooldownMs(): number {
  if (!playerProfile) {
    throw new Error('[getLocalFireCooldownMs] playerProfile is null');
  }
  const weaponDef = getEquippedWeaponDef(playerProfile);
  if (!weaponDef) {
    // 显示UI错误提示
    showEquipmentError('武器装备异常，请重新装备');
    return DEFAULT_FIRE_INTERVAL_MS; // 使用常量而非魔法数字
  }
  return weaponDef.fireIntervalMs;
}
```

**影响**：
- 用户流失（所有枪射速一样，以为游戏没内容）
- 数据异常无法被发现

---

#### 3. bagCap 改为完全动态计算
**位置**：
- server/src/profile.ts:8034 - 初始化时设置 `bagCap: this.DEFAULT_BAG_CAP`
- server/src/profile.ts:8083-8084 - 允许 `updates.bagCap` 覆盖

**修复方法**：
1. **删除 profile.bagCap 存储字段**（保持向后兼容，但标记为deprecated）
2. **所有读取bagCap的地方改为调用 `getEquippedBagCap(profile)`**
3. **equipItem/unequipItem 后必须触发 recomputeDerived**

```typescript
// 服务端返回profile时动态计算
function getProfileData(accountId: string) {
  const profile = this.loadFromDB(accountId);
  // 动态计算派生属性
  profile.bagCap = getEquippedBagCap(profile); // 覆盖存储值
  return profile;
}
```

**影响**：
- 装备背包后UI不更新
- 进局容量与Hideout不一致
- 数据损坏（prep超过容量）

---

### P1（应该完成以提升代码质量）

#### 4. ProfileManager 单一入口
**位置**：
- server/src/room.ts:1647-1655 - 直接修改 `profile.equipment.*Iid = null`

**修复方法**：
```typescript
// ❌ 错误：绕过ProfileManager
profile.equipment.weaponIid = null;

// ✅ 正确：通过ProfileManager
this.profileManager.unequip(accountId, 'weapon');
```

在 ProfileManager 中实现 `unequip()` 方法：
```typescript
unequip(accountId: string, slot: 'weapon' | 'bag' | 'armor'): { success: boolean } {
  const profile = this.getProfileData(accountId);
  if (!profile) return { success: false };

  if (slot === 'weapon') profile.equipment.weaponIid = null;
  if (slot === 'bag') profile.equipment.bagIid = null;
  if (slot === 'armor') profile.equipment.armorIid = null;

  this.normalizeEquipment(profile);
  this.recomputeDerived(profile);
  this.saveProfileData(accountId, profile);

  return { success: true };
}
```

---

#### 5. 客户端使用 validateInvariants
**位置**：
- client/src/network.ts:onProfile 回调

**修复方法**：
```typescript
import { validateInvariants } from '@jerkie-man/shared';

network.onProfile = (profile) => {
  playerProfile = profile;

  // 验证不变量
  const errors = validateInvariants(profile);
  if (errors.length > 0) {
    showErrorModal({
      title: '装备数据异常',
      message: errors.join('\n'),
      buttons: [
        {
          text: '一键修复',
          onClick: () => {
            network.send({ type: 'C2S_FIX_PROFILE' }); // 需要新增协议
          }
        },
        { text: '忽略', onClick: () => {} }
      ]
    });
  }

  updateUI();
};
```

---

### P2（可选，但能显著改善开发体验）

#### 6. 删除 getEquippedWeaponType 的重复实现
**位置**：
- client/src/main.ts:39 - `function getEquippedWeaponType(): any | null`

**修复方法**：
```typescript
// 删除本地实现，使用shared层
import { getEquippedWeaponDef } from '@jerkie-man/shared';

// 所有调用处改为
const weaponDef = getEquippedWeaponDef(playerProfile);
if (weaponDef) {
  console.log(weaponDef.fireIntervalMs);
}
```

---

#### 7. BulletTrackManager 单一实现
**位置**：
- client/src/bulletTracks.ts - 完整实现
- 检查 renderer.ts 是否有旧版本残留

**修复方法**：
- 删除任何旧版本实现
- 确保所有子弹轨迹统一调用 `BulletTrackManager.addBullet()`

---

## 验证脚本（可选）

### scripts/verify_invariants.ts（建议创建）

```typescript
#!/usr/bin/env ts-node
/**
 * 验证profile不变量的自动化脚本
 * 用法：npm run verify-invariants
 */
import { validateInvariants } from '@jerkie-man/shared';
import { ProfileManager } from '../server/src/profile.js';

const profileManager = new ProfileManager('./server/data/profiles.json');

// 加载所有profile
const allProfiles = profileManager.getAllProfiles(); // 需要新增此方法

let totalErrors = 0;
for (const [accountId, profile] of allProfiles.entries()) {
  const errors = validateInvariants(profile);
  if (errors.length > 0) {
    console.error(`❌ Profile ${accountId} has ${errors.length} errors:`);
    errors.forEach(err => console.error(`  - ${err}`));
    totalErrors += errors.length;
  } else {
    console.log(`✅ Profile ${accountId} is valid`);
  }
}

if (totalErrors > 0) {
  console.error(`\n❌ Total ${totalErrors} errors found`);
  process.exit(1);
} else {
  console.log(`\n✅ All profiles are valid`);
  process.exit(0);
}
```

在 package.json 添加：
```json
{
  "scripts": {
    "verify-invariants": "ts-node scripts/verify_invariants.ts"
  }
}
```

---

## 修复优先级建议

根据用户影响和修复难度，建议按以下顺序完成剩余工作：

| 优先级 | 任务 | 预计时间 | 用户影响 |
|--------|------|---------|---------|
| P0-1 | 替换所有 `/50` 魔法常量 | 30分钟 | 低（技术债） |
| P0-2 | 删除 `?? 150/800` 回退 | 1小时 | 高（玩家流失） |
| P0-3 | bagCap改为动态计算 | 2小时 | 高（数据损坏） |
| P1-4 | ProfileManager单一入口 | 1小时 | 中（偶现bug） |
| P1-5 | 客户端validateInvariants | 1小时 | 中（调试体验） |
| P2-6 | 删除重复实现 | 30分钟 | 低（代码维护） |
| P2-7 | BulletTrackManager清理 | 30分钟 | 低（代码维护） |

**总计：约6.5小时可完成所有P0-P2任务**

---

## 如何运行验收测试

### 1. 手动测试（推荐）
```bash
# 终端1：启动服务端
cd server
npm start

# 终端2：启动客户端
cd client
npm run dev

# 浏览器访问 http://localhost:5173
# 按照上述A/B/C/D场景逐一验证
```

### 2. 自动化测试（未来）
```bash
# 当实现verify_invariants.ts后
npm run verify-invariants
```

---

## 验收通过标准

### 最低标准（MVP）
- ✅ 所有包编译通过
- ✅ 场景A1能正常工作（背包容量变化）
- ✅ 场景B1能正常工作（武器射速不同）
- ⚠️ 已知问题可以通过workaround绕过

### 理想标准（Production-Ready）
- ✅ 所有P0任务完成
- ✅ 所有验收场景通过
- ✅ 无 `any` 类型污染
- ✅ 无魔法常量
- ✅ validateInvariants 无错误

---

## 附录：快速修复命令

### 批量替换魔法常量
```bash
# 查找所有 /50 硬编码
rg "/ 50\b|\* 50\b" server/src client/src --no-heading

# 替换为 msToTicks（需要手动确认每一处）
# 建议使用IDE的"Find and Replace"功能
```

### 查找所有 any 污染
```bash
rg ": any\b| as any\b" server/src client/src --no-heading
```

### 查找所有默认值回退
```bash
rg "\?\? 150|\?\? 800" client/src --no-heading
```

---

**文档版本**：v1.0
**最后更新**：2026-01-04
**维护者**：Claude Code
**状态**：🟡 部分完成（基础设施已搭建，核心修复待完成）
