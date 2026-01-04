/**
 * 物品系统类型定义
 * 用于替换 lootCount，实现完整的背包/仓库/经济系统
 */

export type Rarity = "COMMON" | "RARE" | "QUEST";

export type ItemType = {
  id: string;        // "scrap_metal"
  name: string;      // "Scrap Metal"
  rarity: Rarity;
  value: number;     // sell price for 1 qty
  stackMax: number;  // e.g. 20
  weight?: number;   // optional future use
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

export type WeaponRuntime = {
  weaponTypeId: string;   // 装备的武器 typeId（不是 iid，方便客户端查 def）
  ammoInMag: number;
  reloadingUntilTick: number; // 0 表示未换弹；否则 tick <= reloadingUntilTick 期间禁止开火
  nextFireTick: number;        // tick < nextFireTick 禁止开火
  burstRemaining?: number;     // 连发剩余次数（0表示不在连发中）
  burstNextTick?: number;      // 连发下一发的时间（tick）
};

export type PlayerProfile = {
  displayName: string | null; // 玩家昵称（null 表示未设置）
  money: number;
  stash: ItemInstance[];   // out-of-raid storage
  prep: ItemInstance[];    // 整备区（准备带入局内的物品）
  bagCap: number;          // 背包容量（从 profile 读取，用于初始化 Player，现在是动态计算的）
  equipment: PlayerEquipment; // 装备槽（weapon/bag/armor）
};