/**
 * Dynamic Field Name Compression
 * 动态字段名压缩 - 服务端生成映射表，客户端动态接收
 * 
 * 设计原则：
 * 1. 零维护 - 无需手动维护字段列表
 * 2. 动态学习 - 服务端遇到新字段自动分配短名
 * 3. 协议同步 - 映射表随 WELCOME 消息发送给客户端
 */

// 全局字段名映射表
const fieldToShort = new Map<string, string>();
const shortToField = new Map<string, string>();

// 短名计数器
let shortNameCounter = 0;

// 用于生成短名的字符集
const CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

function generateShortName(): string {
  const index = shortNameCounter++;
  if (index < CHARS.length) {
    return CHARS[index];
  }
  const first = Math.floor(index / CHARS.length);
  const second = index % CHARS.length;
  return CHARS[first - 1] + CHARS[second];
}

/**
 * 获取或创建字段的短名（服务端使用）
 * 遇到新字段自动分配短名
 */
function getOrCreateShortName(fieldName: string): string {
  let short = fieldToShort.get(fieldName);
  if (!short) {
    short = generateShortName();
    fieldToShort.set(fieldName, short);
    shortToField.set(short, fieldName);
  }
  return short;
}

// 不压缩的字段（用于协议解析）
const RESERVED_FIELDS = new Set(['type', 'v', 'd']);

/**
 * 递归压缩对象的字段名（服务端使用）
 * 注意：'type' 字段不压缩，因为 zod 需要它来区分消息类型
 */
export function compressFields<T>(obj: T): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => compressFields(item));
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      // 保留字段不压缩
      const shortKey = RESERVED_FIELDS.has(key) ? key : getOrCreateShortName(key);
      result[shortKey] = compressFields(value);
    }
    return result;
  }

  return obj;
}

/**
 * 递归解压对象的字段名（客户端使用）
 */
export function expandFields<T>(obj: unknown): T {
  if (obj === null || obj === undefined) {
    return obj as T;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => expandFields(item)) as T;
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [shortKey, value] of Object.entries(obj as Record<string, unknown>)) {
      const fullKey = shortToField.get(shortKey) ?? shortKey;
      result[fullKey] = expandFields(value);
    }
    return result as T;
  }

  return obj as T;
}

/**
 * 导出当前映射表（服务端使用，发送给客户端）
 * @returns 短名到完整名的映射对象
 */
export function exportFieldMapping(): Record<string, string> {
  return Object.fromEntries(shortToField);
}

/**
 * 导入映射表（客户端使用，从服务端接收）
 * @param mapping 短名到完整名的映射对象
 */
export function importFieldMapping(mapping: Record<string, string>): void {
  shortToField.clear();
  fieldToShort.clear();
  for (const [short, full] of Object.entries(mapping)) {
    shortToField.set(short, full);
    fieldToShort.set(full, short);
  }
  // 更新计数器到最大值，避免冲突
  shortNameCounter = Object.keys(mapping).length;
}

/**
 * 获取当前映射表（用于调试）
 */
export function getFieldMappings(): { fieldToShort: Record<string, string>; shortToField: Record<string, string> } {
  return {
    fieldToShort: Object.fromEntries(fieldToShort),
    shortToField: Object.fromEntries(shortToField),
  };
}

/**
 * 获取映射表大小（用于调试）
 */
export function getMappingCount(): number {
  return fieldToShort.size;
}

/**
 * 预热所有协议字段（服务端启动时调用）
 * 确保所有字段在发送 WELCOME 之前已有映射
 */
export function warmupAllFields(): void {
  const allFields = [
    // 顶层消息字段
    'tick', 'timestamp', 'players', 'bullets', 'items',
    'worldItems', 'lootBags', 'obstacles', 'ais', 'decoys', 'turrets',
    
    // 通用实体字段
    'id', 'x', 'y', 'vx', 'vy', 'hp', 'maxHp', 'status', 'name', 'ownerId', 'aimRad',
    
    // 玩家字段
    'stamina', 'maxStamina', 'isSprinting', 
    'lastInputSeq', 'lastInputTick', 'extractProgress',
    'inventory', 'bagCap',
    'inBush', 'inBushId', 'inSmoke', 'inSmokeId',
    'isFlashed', 'flashEndTime', 'isStunned', 'stunnedEndTime',
    'killedBy', 'killedByWeapon',
    'usingItemTypeId', 'usingItemRemainingMs', 'usingItemTotalMs',
    'disguisedAsAiBehavior', 'disguisedAsAiRole', 'disguisedAimRad',
    
    // 武器运行时
    'weaponRuntime', 'weaponTypeId', 'ammoInMag', 
    'reloadingUntilTick', 'nextFireTick', 'fireCredit',
    
    // 装备系统
    'raidEquipment', 'equipment',
    'weaponIid', 'bagIid', 'armorIid', 
    'bagTypeId', 'armorTypeId',
    
    // 物品系统（inventory.items 需要的字段）
    'iid', 'typeId', 'qty', 'slot',
    
    // AI 字段
    'behaviorState', 'role', 'currentTargetId',
    
    // 子弹字段
    'clientShotId', 'bulletLifeMs', 
    'targetX', 'targetY', 'spawnX', 'spawnY', 'spreadSeed',
    
    // Buff 系统
    'buffs', 'kind', 'remainingMs', 'totalMs',
    'speedMultiplier', 'damageReductionBonus', 'hpPerSecond',
    
    // Decoy/Turret
    'state', 'targetId', 'isArmored', 'range',
    
    // 世界物品/掉落包
    'wid', 'bid', 'contents', 'action', 'removed',
    
    // 其他消息字段
    'playerId', 'accountId', 'room', 'seed', 'mapConfig',
    'displayName', 'phase', 'money', 'stash', 'prep',
    'result', 'loot', 'moneyGained', 'moneyLost',
    'message', 'direction', 'damage', 'isHeadshot',
    
    // 世界初始化
    'staticObstacles', 'extractZones', 'bushZones', 'spawnPoints',
    'width', 'height', 'tileSize', 'tiles',

    // ⚠️ 只能往下追加，绝不能在上面插入或删除（短名按索引分配）。
    // 结构化击杀归因（killedBy / killedByWeapon 的内层字段）
    'enemyKind', 'ownerName', 'itemTypeId', 'specialId',
  ];
  
  for (const field of allFields) {
    getOrCreateShortName(field);
  }
}

// 模块加载时自动预热所有字段
warmupAllFields();
