/**
 * 物品系统类型定义
 * 用于替换 lootCount，实现完整的背包/仓库/经济系统
 */

export type Rarity = "COMMON" | "RARE" | "EPIC" | "LEGENDARY";
export type ItemCategory = "weapon" | "armor" | "bag" | "consumable" | "material";

export type ItemType = {
  // 显示文案（name/desc/short）不在这里，走 i18n：item.<id>.name / .desc / .short
  id: string;        // "scrap_metal"，同时也是翻译 key
  rarity: Rarity;
  category: ItemCategory; // 物品分类（用于商店分类）
  value: number;     // sell price for 1 qty
  stackMax: number;  // e.g. 20
  weight?: number;   // optional future use
  // 消耗品属性（可选）
  consumableProps?: {
    // 投掷标记。有实际爆炸/烟雾/致盲/燃烧半径的道具会被自动识别为可投掷；
    // 像全息诱饵这种「靠投掷部署但没有任何半径」的，用这个字段显式声明。
    throwable?: boolean;
    // 医疗包属性
    healAmount?: number;  // 回复的生命值
    // Buff 属性
    buffDurationMs?: number;  // Buff 持续时间（毫秒）
    speedMultiplier?: number;  // 速度倍数（例如 2.0 表示 +100% 速度）
    hpPerSecond?: number;  // 每秒回复生命值
    // 手雷属性
    explosionRadius?: number;  // 爆炸半径（像素）
    damage?: number;  // 伤害值
    // 烟雾弹属性
    smokeRadius?: number;  // 烟雾半径（像素）
    smokeDurationMs?: number;  // 烟雾持续时间（毫秒）
    // 闪光弹属性
    flashRadius?: number;  // 致盲范围（像素）
    flashDurationMs?: number;  // 致盲持续时间（毫秒）
    // 燃烧弹属性
    fireRadius?: number; // 燃烧半径（像素）
    fireDurationMs?: number; // 持续时间（毫秒）
    fireDamagePerSecond?: number; // 每秒伤害
    // 伪装属性
    disguiseDurationMs?: number; // 伪装持续时间（毫秒）
    // 通用持续时间（如炮台）
    durationMs?: number;
  };
};

export type ItemInstance = {
  iid: string;       // instance id (uuid-like)
  typeId: string;    // references ItemType.id
  qty: number;
};

export type WorldItem = {
  wid: string;       // world item id
  typeId: string;
  qty: number;
  x: number;
  y: number;
  // optional future: spawnTime, ttl
};

export type LootBag = {
  bid: string;       // bag id
  x: number;
  y: number;
  items: ItemInstance[]; // dropped inventory
};

export type PlayerInventory = {
  bagCap: number;          // max slots by count (MVP)
  items: ItemInstance[];
};

export type PlayerEquipment = {
  weaponIid: string | null;
  bagIid: string | null;
  armorIid: string | null;
};

/**
 * 短效 Buff 类型（用于局内战斗状态）
 * 只描述对客户端 UI 有用的公开信息，真正的过期/数值计算由服务端权威处理
 */
export type BuffKind = 'speed' | 'damage_reduction' | 'regeneration' | 'disguise';

export type PlayerBuff = {
  /** Buff 唯一 ID，比如 'combat_stim'；显示名由客户端查 `buff.<id>` 得到 */
  id: string;
  /** 效果大类：移动速度、减伤等 */
  kind: BuffKind;
  /**
   * 剩余持续时间（毫秒）
   * 用于 HUD 显示倒计时，不参与服务端数值判定
   */
  remainingMs: number;
  /**
   * 总持续时间（毫秒）
   * 方便在 HUD 中显示进度百分比
   */
  totalMs: number;
  /**
   * 可选：对移动速度的倍数提示（例如 2 表示 +100% 速度）
   * 仅用于客户端展示，服务端有自己的数值计算
   */
  speedMultiplier?: number;
  /**
   * 可选：额外减伤比例提示（0-1，例如 0.3 表示额外减少 30% 伤害）
   * 仅用于客户端展示
   */
  damageReductionBonus?: number;
  /**
   * 可选：每秒回复生命值提示（例如 5 表示每秒回复 5 点 HP）
   * 仅用于客户端展示
   */
  hpPerSecond?: number;
};

export type WeaponRuntime = {
  weaponTypeId: string;   // 装备的武器 typeId（不是 iid，方便客户端查 def）
  ammoInMag: number;
  reloadingUntilTick: number; // 0 表示未换弹；否则 tick <= reloadingUntilTick 期间禁止开火
  nextFireTick: number;        // tick < nextFireTick 禁止开火
  fireCredit?: number;         // 射击信用（用于客户端预测）
};

export type Phase = 'NAME' | 'HIDEOUT' | 'RAID' | 'RESULT';

export type PlayerProfile = {
  displayName: string | null; // 玩家昵称（null 表示未设置）
  phase: Phase;            // 玩家当前阶段（持久化状态，确保刷新后状态一致）
  money: number;
  stash: ItemInstance[];   // out-of-raid storage
  prep: ItemInstance[];    // 整备区（准备带入局内的物品）
  bagCap: number;          // 背包容量（从 profile 读取，用于初始化 Player，现在是动态计算的）
  equipment: PlayerEquipment; // 装备槽（weapon/bag/armor）
  isAdmin?: boolean;       // 是否为管理员（可选，默认 false）
};

/**
 * 延迟补偿系统（Lag Compensation）
 * 用于记录玩家位置历史，实现服务端倒带（Server Rewind）机制
 */

/**
 * 单个玩家位置快照
 */
export type PositionSnapshot = {
  tick: number;        // 服务端 tick 编号
  timestamp: number;   // 绝对时间戳（Date.now()）
  x: number;
  y: number;
};

/**
 * 玩家位置历史缓冲区（环形缓冲区）
 * 用于延迟补偿，记录玩家最近的位置历史
 */
export class PositionHistory {
  private buffer: PositionSnapshot[];
  private head: number;              // 写入头指针
  private size: number;              // 当前已存储的快照数量
  private readonly capacity: number; // 缓冲区容量

  constructor(capacity: number = 50) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
    this.head = 0;
    this.size = 0;
  }

  /**
   * 添加新的位置快照
   */
  add(tick: number, timestamp: number, x: number, y: number): void {
    this.buffer[this.head] = { tick, timestamp, x, y };
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) {
      this.size++;
    }
  }

  /**
   * 根据时间戳获取历史位置（线性插值）
   * @param targetTimestamp 目标时间戳（射击者的"过去时间"）
   * @returns 插值后的位置，如果历史不足则返回 null
   */
  getPositionAt(targetTimestamp: number): { x: number; y: number } | null {
    if (this.size === 0) return null;

    // 找到 t0 <= targetTimestamp < t1 的两个快照
    let t0: PositionSnapshot | null = null;
    let t1: PositionSnapshot | null = null;

    for (let i = 0; i < this.size; i++) {
      const idx = (this.head - 1 - i + this.capacity) % this.capacity;
      const snapshot = this.buffer[idx];

      if (snapshot.timestamp <= targetTimestamp) {
        t0 = snapshot;
        // 找下一个快照作为 t1
        if (i > 0) {
          const nextIdx = (this.head - i + this.capacity) % this.capacity;
          t1 = this.buffer[nextIdx];
        }
        break;
      }
    }

    // 情况1：没有足够旧的历史（targetTimestamp 比最老的记录还早）
    if (!t0) {
      const oldestIdx = (this.head - this.size + this.capacity) % this.capacity;
      return { x: this.buffer[oldestIdx].x, y: this.buffer[oldestIdx].y };
    }

    // 情况2：只有 t0，没有 t1（targetTimestamp 在最新快照之后或刚好是最新）
    if (!t1) {
      return { x: t0.x, y: t0.y };
    }

    // 情况3：有 t0 和 t1，进行线性插值
    const alpha = (targetTimestamp - t0.timestamp) / (t1.timestamp - t0.timestamp);
    const clampedAlpha = Math.max(0, Math.min(1, alpha));
    return {
      x: t0.x + (t1.x - t0.x) * clampedAlpha,
      y: t0.y + (t1.y - t0.y) * clampedAlpha,
    };
  }

  /**
   * 清空历史记录（玩家断线时调用）
   */
  clear(): void {
    this.head = 0;
    this.size = 0;
  }
}