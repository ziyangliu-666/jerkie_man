import { z } from 'zod';
import { MAP_CONFIG_SCHEMA } from './content.js';

// C2S (Client to Server) 消息
export const C2S_HELLO_SCHEMA = z.object({
  type: z.literal('C2S_HELLO'),
  room: z.string(),
  accountId: z.string(), // 账号身份：客户端生成 UUID，用于持久化 Profile
});

export const C2S_INPUT_SCHEMA = z.object({
  type: z.literal('C2S_INPUT'),
  seq: z.number().int().positive(),
  tick: z.number().int().nonnegative(),
  keys: z.object({
    up: z.boolean(),
    down: z.boolean(),
    left: z.boolean(),
    right: z.boolean(),
  }),
  aim: z.number(), // 鼠标角度（弧度）
  shoot: z.boolean().optional(), // Day2: 开火标志
  reload: z.boolean().optional(), // 新增: 换弹标志（R键）
  interact: z.boolean().optional(), // Day3: 拾取脉冲事件（E键）
  extract: z.boolean().optional(), // Day3: 撤离脉冲事件（F键，已废弃，保留兼容）
  extractHeld: z.boolean().optional(), // 游戏化增强: 撤离持续状态（按住F）
  shotId: z.number().int().optional(), // 本次发射的唯一ID（用于客户端预测子弹对齐）
});

// Day5: Ping/Pong 消息（用于测量网络延迟）
export const C2S_PING_SCHEMA = z.object({
  type: z.literal('C2S_PING'),
  timestamp: z.number(), // 客户端发送时间戳
});

// 新增: 客户端动作消息
export const C2S_PICKUP_WORLD_ITEM_SCHEMA = z.object({
  type: z.literal('C2S_PICKUP_WORLD_ITEM'),
  wid: z.string(),
});

export const C2S_PICKUP_LOOT_BAG_SCHEMA = z.object({
  type: z.literal('C2S_PICKUP_LOOT_BAG'),
  bid: z.string(),
});

export const C2S_SELL_FROM_STASH_SCHEMA = z.object({
  type: z.literal('C2S_SELL_FROM_STASH'),
  iid: z.string(),
  qty: z.number().int().positive(),
});

// 新增: 设置昵称消息
export const C2S_SET_NAME_SCHEMA = z.object({
  type: z.literal('C2S_SET_NAME'),
  name: z.string().min(1).max(32), // 昵称长度限制 1-32 字符
});

// 新增: 从仓库移动到整备区
export const C2S_MOVE_STASH_TO_PREP_SCHEMA = z.object({
  type: z.literal('C2S_MOVE_STASH_TO_PREP'),
  iid: z.string(),
  qty: z.number().int().positive(),
});

// 新增: 从整备区移动回仓库
export const C2S_MOVE_PREP_TO_STASH_SCHEMA = z.object({
  type: z.literal('C2S_MOVE_PREP_TO_STASH'),
  iid: z.string(),
  qty: z.number().int().positive(),
});

// 新增: 商店购买物品（买到仓库）
export const C2S_BUY_SCHEMA = z.object({
  type: z.literal('C2S_BUY'),
  typeId: z.string(),
  qty: z.number().int().positive(),
});

// 新增: 进入战局
export const C2S_ENTER_RAID_SCHEMA = z.object({
  type: z.literal('C2S_ENTER_RAID'),
});

// 新增: 装备/卸下装备
export const C2S_EQUIP_SCHEMA = z.object({
  type: z.literal('C2S_EQUIP'),
  slot: z.enum(['weapon', 'bag', 'armor']),
  iid: z.string().nullable(), // null 表示卸下
});

// 新增: 通用交互消息（服务端选最近可交互目标，避免客户端指定ID）
export const C2S_INTERACT_SCHEMA = z.object({
  type: z.literal('C2S_INTERACT'),
});

// 管理员命令消息（仅开发环境使用）
export const C2S_ADMIN_SCHEMA = z.object({
  type: z.literal('C2S_ADMIN'),
  command: z.enum(['show_status', 'reset_world']),
});

export const C2S_MESSAGE_SCHEMA = z.discriminatedUnion('type', [
  C2S_HELLO_SCHEMA,
  C2S_INPUT_SCHEMA,
  C2S_PING_SCHEMA, // Day5: Ping 消息
  C2S_PICKUP_WORLD_ITEM_SCHEMA, // 保留兼容（deprecated）
  C2S_PICKUP_LOOT_BAG_SCHEMA, // 保留兼容（deprecated）
  C2S_SELL_FROM_STASH_SCHEMA, // 新增: 从仓库卖出
  C2S_INTERACT_SCHEMA, // 新增: 通用交互（服务端选最近目标）
  C2S_ADMIN_SCHEMA, // 管理员命令
  C2S_SET_NAME_SCHEMA, // 新增: 设置昵称
  C2S_MOVE_STASH_TO_PREP_SCHEMA, // 新增: 从仓库移动到整备区
  C2S_MOVE_PREP_TO_STASH_SCHEMA, // 新增: 从整备区移动回仓库
  C2S_BUY_SCHEMA, // 新增: 商店购买物品
  C2S_ENTER_RAID_SCHEMA, // 新增: 进入战局
  C2S_EQUIP_SCHEMA, // 新增: 装备/卸下装备
]);

// S2C (Server to Client) 消息
// 新增: 物品系统类型 schema（必须在 PLAYER_STATE_SCHEMA 之前定义）
export const ITEM_INSTANCE_SCHEMA = z.object({
  iid: z.string(),
  typeId: z.string(),
  qty: z.number().int().positive(),
});

export const PLAYER_INVENTORY_SCHEMA = z.object({
  bagCap: z.number().int().positive(),
  items: z.array(ITEM_INSTANCE_SCHEMA),
});

export const PLAYER_EQUIPMENT_SCHEMA = z.object({
  weaponIid: z.string().nullable(),
  bagIid: z.string().nullable(),
  armorIid: z.string().nullable(),
});

export const WEAPON_RUNTIME_SCHEMA = z.object({
  weaponTypeId: z.string(),
  ammoInMag: z.number().int().nonnegative(),
  reloadingUntilTick: z.number().int().nonnegative(),
  nextFireTick: z.number().int().nonnegative(),
});

export const PLAYER_STATE_SCHEMA = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  hp: z.number().int().min(0).max(100),
  status: z.enum(['ALIVE', 'DEAD', 'EXTRACTED']),
  lastInputSeq: z.number().int(),
  lastInputTick: z.number().int(),
  lootCount: z.number().int().min(0).default(0).optional(), // Day3: 战利品计数（已废弃，保留兼容）
  extractProgress: z.number().int().min(0).max(2000).default(0), // 游戏化增强: 撤离进度（毫秒，0-2000）
  inventory: PLAYER_INVENTORY_SCHEMA.optional(), // 新增: 背包系统
  name: z.string().optional(), // 新增: 玩家昵称（用于显示）
  weaponRuntime: WEAPON_RUNTIME_SCHEMA.optional(), // 新增: 武器运行时状态（局内状态）
  killedBy: z.string().optional(), // 新增: 击杀者名字
  killedByWeaponName: z.string().optional(), // 新增: 击杀使用的武器名称
});

export const BULLET_STATE_SCHEMA = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  vx: z.number(),
  vy: z.number(),
  ownerId: z.string(),
  clientShotId: z.number().int().optional(), // 客户端发射ID（用于预测子弹对齐）
});

export const ITEM_STATE_SCHEMA = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  type: z.string(),
  quantity: z.number().int().positive(),
});

// 新增: 世界物品和掉落包 schema
export const WORLD_ITEM_SCHEMA = z.object({
  wid: z.string(),
  typeId: z.string(),
  qty: z.number().int().positive(),
  x: z.number(),
  y: z.number(),
});

export const LOOT_BAG_SCHEMA = z.object({
  bid: z.string(),
  x: z.number(),
  y: z.number(),
  items: z.array(ITEM_INSTANCE_SCHEMA),
});

// Day4-2: 障碍物状态（矩形 AABB）
export const OBSTACLE_STATE_SCHEMA = z.object({
  x: z.number().nonnegative(), // 矩形左上角 x
  y: z.number().nonnegative(), // 矩形左上角 y
  w: z.number().positive(),    // 宽度
  h: z.number().positive(),    // 高度
});

export const S2C_SNAPSHOT_SCHEMA = z.object({
  type: z.literal('S2C_SNAPSHOT'),
  tick: z.number().int().nonnegative(),
  timestamp: z.number(),
  players: z.array(PLAYER_STATE_SCHEMA),
  bullets: z.array(BULLET_STATE_SCHEMA),
  items: z.array(ITEM_STATE_SCHEMA).optional(), // 保留兼容
  worldItems: z.array(WORLD_ITEM_SCHEMA).optional(), // 新增: 世界物品列表（MVP 全量，未来做 delta）
  lootBags: z.array(LOOT_BAG_SCHEMA).optional(), // 新增: 掉落包列表
  // 修复: obstacles 已移至 S2C_WORLD_INIT，不再在 snapshot 中发送（减少带宽）
});

export const S2C_ERROR_SCHEMA = z.object({
  type: z.literal('S2C_ERROR'),
  code: z.string(),
  message: z.string(),
});

export const S2C_WELCOME_SCHEMA = z.object({
  type: z.literal('S2C_WELCOME'),
  playerId: z.string(),
  accountId: z.string(), // 回传 accountId，便于 debug
  // Day4-1: server 下发世界配置（可选，用于兼容）
  seed: z.number().int().optional(),
  mapConfig: MAP_CONFIG_SCHEMA.optional(),
});

// 静态世界初始化消息（一次性下发，减少 snapshot 带宽）
export const S2C_WORLD_INIT_SCHEMA = z.object({
  type: z.literal('S2C_WORLD_INIT'),
  seed: z.number().int(),
  mapConfig: MAP_CONFIG_SCHEMA,
  obstacles: z.array(OBSTACLE_STATE_SCHEMA),
  items: z.array(ITEM_STATE_SCHEMA).optional(), // 保留兼容
  worldItems: z.array(WORLD_ITEM_SCHEMA).optional(), // 新增: 世界物品列表
});

// 游戏化增强: 服务端事件流 -> HUD Event Log
export const S2C_EVENT_SCHEMA = z.object({
  type: z.literal('S2C_EVENT'),
  tick: z.number().int().nonnegative(),
  timestamp: z.number(),
  message: z.string(),
});

// Day5: Ping/Pong 消息（用于测量网络延迟）
export const S2C_PONG_SCHEMA = z.object({
  type: z.literal('S2C_PONG'),
  clientTimestamp: z.number(), // 客户端原始时间戳（回传）
  serverTimestamp: z.number(), // 服务器接收时间戳
});

// P1-1 新增: Profile 消息（仅发给本人，包含 stash/money/bagCap）
export const S2C_PROFILE_SCHEMA = z.object({
  type: z.literal('S2C_PROFILE'),
  accountId: z.string(), // 确认身份，便于 debug
  displayName: z.string().nullable(), // 新增: 玩家昵称（null 表示未设置）
  phase: z.enum(['NAME', 'HIDEOUT', 'RAID', 'RESULT']).optional(), // 新增: 当前游戏阶段（可选，兼容旧客户端）
  money: z.number().int().nonnegative(),
  stash: z.array(ITEM_INSTANCE_SCHEMA),
  prep: z.array(ITEM_INSTANCE_SCHEMA).optional(), // 新增: 整备区（准备带入局内的物品）
  bagCap: z.number().int().positive(),
  equipment: PLAYER_EQUIPMENT_SCHEMA, // 新增: 装备槽
});

// 新增: 战局结果消息（撤离/死亡后发送）
export const S2C_RAID_RESULT_SCHEMA = z.object({
  type: z.literal('S2C_RAID_RESULT'),
  result: z.enum(['EXTRACTED', 'DIED']), // 结果类型
  loot: z.array(ITEM_INSTANCE_SCHEMA), // 获得的物品（撤离时）
  moneyGained: z.number().int().nonnegative(), // 获得的金钱（撤离时）
  moneyLost: z.number().int().nonnegative(), // 损失的金钱（死亡时，prep 物品的价值）
});

// 新增: 战斗事件消息（干火/命中/受伤反馈）
export const S2C_COMBAT_EVENT_SCHEMA = z.object({
  type: z.literal('S2C_COMBAT_EVENT'),
  kind: z.enum(['DRY_FIRE', 'HIT', 'DAMAGE_TAKEN']), // 事件类型
  direction: z.number().optional(), // 可选：方向（弧度，用于受伤方向指示）
});

// ??: ????????????????
export const S2C_MELEE_SWING_SCHEMA = z.object({
  type: z.literal('S2C_MELEE_SWING'),
  playerId: z.string(),
  x: z.number(),
  y: z.number(),
  aimRad: z.number(),
  range: z.number(),
  arcRad: z.number(),
});

export const S2C_MESSAGE_SCHEMA = z.discriminatedUnion('type', [
  S2C_SNAPSHOT_SCHEMA,
  S2C_ERROR_SCHEMA,
  S2C_WELCOME_SCHEMA,
  S2C_WORLD_INIT_SCHEMA, // 静态世界初始化消息
  S2C_EVENT_SCHEMA, // 游戏化增强: 事件消息
  S2C_PONG_SCHEMA, // Day5: Pong 消息
  S2C_PROFILE_SCHEMA, // P1-1: Profile 消息
  S2C_RAID_RESULT_SCHEMA, // 新增: 战局结果消息
  S2C_COMBAT_EVENT_SCHEMA, // 新增: 战斗事件消息
  S2C_MELEE_SWING_SCHEMA, // ??: ??????
]);

// TypeScript 类型推导
export type C2S_HELLO = z.infer<typeof C2S_HELLO_SCHEMA>;
export type C2S_INPUT = z.infer<typeof C2S_INPUT_SCHEMA>;
export type C2S_PING = z.infer<typeof C2S_PING_SCHEMA>; // Day5: Ping 类型
export type C2S_MESSAGE = z.infer<typeof C2S_MESSAGE_SCHEMA>;

export type PLAYER_STATE = z.infer<typeof PLAYER_STATE_SCHEMA>;
export type BULLET_STATE = z.infer<typeof BULLET_STATE_SCHEMA>;
export type ITEM_STATE = z.infer<typeof ITEM_STATE_SCHEMA>;
export type OBSTACLE_STATE = z.infer<typeof OBSTACLE_STATE_SCHEMA>; // Day4-2: 障碍物类型
export type S2C_SNAPSHOT = z.infer<typeof S2C_SNAPSHOT_SCHEMA>;
export type S2C_ERROR = z.infer<typeof S2C_ERROR_SCHEMA>;
export type S2C_WELCOME = z.infer<typeof S2C_WELCOME_SCHEMA>;
export type S2C_WORLD_INIT = z.infer<typeof S2C_WORLD_INIT_SCHEMA>; // 静态世界初始化类型
export type S2C_EVENT = z.infer<typeof S2C_EVENT_SCHEMA>; // 游戏化增强: 事件类型
export type S2C_PONG = z.infer<typeof S2C_PONG_SCHEMA>; // Day5: Pong 类型
export type S2C_PROFILE = z.infer<typeof S2C_PROFILE_SCHEMA>;
export type S2C_RAID_RESULT = z.infer<typeof S2C_RAID_RESULT_SCHEMA>; // P1-1: Profile 类型
export type S2C_COMBAT_EVENT = z.infer<typeof S2C_COMBAT_EVENT_SCHEMA>; // 新增: 战斗事件类型
export type S2C_MELEE_SWING = z.infer<typeof S2C_MELEE_SWING_SCHEMA>; // ??: ????????
export type S2C_MESSAGE = z.infer<typeof S2C_MESSAGE_SCHEMA>;

// 新增: 物品系统类型导出
export type ITEM_INSTANCE = z.infer<typeof ITEM_INSTANCE_SCHEMA>;
export type WORLD_ITEM = z.infer<typeof WORLD_ITEM_SCHEMA>;
export type LOOT_BAG = z.infer<typeof LOOT_BAG_SCHEMA>;
export type PLAYER_INVENTORY = z.infer<typeof PLAYER_INVENTORY_SCHEMA>;
export type PLAYER_EQUIPMENT = z.infer<typeof PLAYER_EQUIPMENT_SCHEMA>;
export type WEAPON_RUNTIME = z.infer<typeof WEAPON_RUNTIME_SCHEMA>;

// 新增: 客户端动作消息类型
export type C2S_PICKUP_WORLD_ITEM = z.infer<typeof C2S_PICKUP_WORLD_ITEM_SCHEMA>;
export type C2S_PICKUP_LOOT_BAG = z.infer<typeof C2S_PICKUP_LOOT_BAG_SCHEMA>;
export type C2S_SELL_FROM_STASH = z.infer<typeof C2S_SELL_FROM_STASH_SCHEMA>;
export type C2S_INTERACT = z.infer<typeof C2S_INTERACT_SCHEMA>;
export type C2S_ADMIN = z.infer<typeof C2S_ADMIN_SCHEMA>;
export type C2S_SET_NAME = z.infer<typeof C2S_SET_NAME_SCHEMA>;
export type C2S_MOVE_STASH_TO_PREP = z.infer<typeof C2S_MOVE_STASH_TO_PREP_SCHEMA>;
export type C2S_MOVE_PREP_TO_STASH = z.infer<typeof C2S_MOVE_PREP_TO_STASH_SCHEMA>;
export type C2S_BUY = z.infer<typeof C2S_BUY_SCHEMA>;
export type C2S_ENTER_RAID = z.infer<typeof C2S_ENTER_RAID_SCHEMA>;
export type C2S_EQUIP = z.infer<typeof C2S_EQUIP_SCHEMA>;