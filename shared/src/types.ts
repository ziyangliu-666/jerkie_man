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

export type PlayerProfile = {
  money: number;
  stash: ItemInstance[];   // out-of-raid storage
  bagCap: number;          // 背包容量（从 profile 读取，用于初始化 Player）
  // optional: loadout later
};