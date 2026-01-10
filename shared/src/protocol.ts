import { z } from 'zod';
import { MAP_CONFIG_SCHEMA } from './content.js';
import type { PlayerBuff } from './types.js';
import { EXTRACT_DURATION_MS } from './constants.js';

// 导入 Room schema 和 OBSTACLE_STATE_SCHEMA
import { ROOM_SCHEMA, OBSTACLE_STATE_SCHEMA, OBSTACLE_TYPE, type ObstacleType } from './mapTemplate.js';

// C2S (Client to Server) 消息
export const C2S_HELLO_SCHEMA = z.object({
  type: z.literal('C2S_HELLO'),
  room: z.string(),
  accountId: z.string(), // 账号身份：客户端生成 UUID，用于持久化 Profile
});

export const C2S_CHAT_SCHEMA = z.object({
  type: z.literal('C2S_CHAT'),
  content: z.string().min(1).max(256),
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
  sprint: z.boolean().optional(), // 新增: 冲刺状态（空格键）
  shotId: z.number().int().optional(), // 本次发射的唯一ID（用于客户端预测子弹对齐）
  shootOriginX: z.number().optional(), // 客户端渲染时的射击原点X
  shootOriginY: z.number().optional(), // 客户端渲染时的射击原点Y
  spreadSeed: z.number().optional(), // 散布随机种子（客户端生成，服务端使用相同种子保证散布一致）
  burstShots: z.array(z.object({
    shotId: z.number().int(),
    originX: z.number(),
    originY: z.number(),
    spreadSeed: z.number(),
  })).optional(), // 新增: 三连发时客户端推送的所有子弹信息
});

export const C2S_LOCAL_BULLET_HIT_SCHEMA = z.object({
  type: z.literal('C2S_LOCAL_BULLET_HIT'),
  bulletId: z.string(),
  clientShotId: z.number().int().optional(),
  targetId: z.string(),
  targetX: z.number(),
  targetY: z.number(),
  hitX: z.number(),
  hitY: z.number(),
  spawnX: z.number(),
  spawnY: z.number(),
  timestamp: z.number(),
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
  autoAction: z.enum(['none', 'equip', 'prep']).optional().default('none'),
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

// 新增: 局内丢弃物品
export const C2S_DROP_ITEM_SCHEMA = z.object({
  type: z.literal('C2S_DROP_ITEM'),
  iid: z.string(),
  qty: z.number().int().positive(),
});

// 新增: 局内装备切换（使用 typeId）
export const C2S_RAID_EQUIP_SCHEMA = z.object({
  type: z.literal('C2S_RAID_EQUIP'),
  slot: z.enum(['weapon', 'bag', 'armor']),
  iid: z.string().nullable().optional().default(null),
  typeId: z.string().nullable().optional(), // 兼容旧客户端
});

// 新增: 通用交互消息（服务端选最近可交互目标，避免客户端指定ID）
export const C2S_INTERACT_SCHEMA = z.object({
  type: z.literal('C2S_INTERACT'),
});

// 新增: 使用物品消息（快捷栏1-5键）
export const C2S_USE_ITEM_SCHEMA = z.object({
  type: z.literal('C2S_USE_ITEM'),
  slot: z.number().int().min(1).max(5), // 快捷栏槽位1-5
});

// 新增: 投掷物品消息（手雷等）
export const C2S_THROW_SCHEMA = z.object({
  type: z.literal('C2S_THROW'),
  targetX: z.number(),
  targetY: z.number(),
  itemType: z.string(), // 投掷物类型（如 'frag_grenade'）
});

// 管理员命令消息（仅开发环境使用）
export const C2S_ADMIN_SCHEMA = z.object({
  type: z.literal('C2S_ADMIN'),
  command: z.enum(['show_status', 'reset_world']),
});

// 新增: 退出结果页面（从 RESULT 阶段返回 HIDEOUT）
export const C2S_EXIT_RESULT_SCHEMA = z.object({
  type: z.literal('C2S_EXIT_RESULT'),
});

export const C2S_MESSAGE_SCHEMA = z.discriminatedUnion('type', [
  C2S_HELLO_SCHEMA,
  C2S_INPUT_SCHEMA,
  C2S_PING_SCHEMA, // Day5: Ping 消息
  C2S_CHAT_SCHEMA, // 新增: 聊天消息（支持 admin 命令）
  C2S_PICKUP_WORLD_ITEM_SCHEMA, // 保留兼容（deprecated）
  C2S_PICKUP_LOOT_BAG_SCHEMA, // 保留兼容（deprecated）
  C2S_SELL_FROM_STASH_SCHEMA, // 新增: 从仓库卖出
  C2S_INTERACT_SCHEMA, // 新增: 通用交互（服务端选最近目标）
  C2S_USE_ITEM_SCHEMA, // 新增: 使用物品（快捷栏1-5键）
  C2S_THROW_SCHEMA, // 新增: 投掷物品
  C2S_ADMIN_SCHEMA, // 管理员命令
  C2S_SET_NAME_SCHEMA, // 新增: 设置昵称
  C2S_MOVE_STASH_TO_PREP_SCHEMA, // 新增: 从仓库移动到整备区
  C2S_MOVE_PREP_TO_STASH_SCHEMA, // 新增: 从整备区移动回仓库
  C2S_BUY_SCHEMA, // 新增: 商店购买物品
  C2S_ENTER_RAID_SCHEMA, // 新增: 进入战局
  C2S_EQUIP_SCHEMA, // 新增: 装备/卸下装备
  C2S_DROP_ITEM_SCHEMA, // 新增: 局内丢弃物品
  C2S_RAID_EQUIP_SCHEMA, // 新增: 局内装备切换
  C2S_EXIT_RESULT_SCHEMA, // 新增: 退出结果页面
  C2S_LOCAL_BULLET_HIT_SCHEMA,
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

// 新增: 局内装备状态（typeId）
export const PLAYER_RAID_EQUIPMENT_SCHEMA = z.object({
  weaponIid: z.string().nullable(),
  bagIid: z.string().nullable(),
  armorIid: z.string().nullable(),
  bagTypeId: z.string().nullable(),
  armorTypeId: z.string().nullable(),
});

export const WEAPON_RUNTIME_SCHEMA = z.object({
  weaponTypeId: z.string(),
  ammoInMag: z.number().int().nonnegative(),
  reloadingUntilTick: z.number().int().nonnegative(),
  nextFireTick: z.number().int().nonnegative(),
  fireCredit: z.number().int().nonnegative().optional(),
});

// 短效 Buff（局内状态）—— 只包含给客户端展示所需的信息
export const PLAYER_BUFF_SCHEMA = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['speed', 'damage_reduction', 'regeneration', 'disguise']),
  remainingMs: z.number().int().nonnegative(),
  totalMs: z.number().int().positive(),
  speedMultiplier: z.number().positive().optional(),
  damageReductionBonus: z.number().min(0).max(1).optional(),
  hpPerSecond: z.number().positive().optional(),
});

export const PLAYER_STATE_SCHEMA = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  hp: z.number().int().min(0).max(100),
  stamina: z.number().int().min(0).max(100).default(100), // 新增: 当前耐力值
  maxStamina: z.number().int().min(1).max(150).default(100), // 新增: 最大耐力值（可被装备影响）
  isSprinting: z.boolean().default(false), // 新增: 是否正在冲刺
  status: z.enum(['ALIVE', 'DEAD', 'EXTRACTED']),
  lastInputSeq: z.number().int(),
  lastInputTick: z.number().int(),
  lootCount: z.number().int().min(0).default(0).optional(), // Day3: 战利品计数（已废弃，保留兼容）
  extractProgress: z.number().int().min(0).max(EXTRACT_DURATION_MS).default(0), // 游戏化增强: 撤离进度（毫秒，0到EXTRACT_DURATION_MS）
  inventory: PLAYER_INVENTORY_SCHEMA.optional(), // 新增: 背包系统
  name: z.string().optional(), // 新增: 玩家昵称（用于显示）
  weaponRuntime: WEAPON_RUNTIME_SCHEMA.optional(), // 新增: 武器运行时状态（局内状态）
  inBush: z.boolean().optional().default(false), // 新增: 是否在草丛内（用于视野遮挡）
  inBushId: z.string().nullable().optional().default(null), // 新增: 所在的草丛ID
  inSmoke: z.boolean().optional().default(false), // 新增: 是否在烟雾内（用于视野遮挡）
  inSmokeId: z.string().nullable().optional().default(null), // 新增: 所在的烟雾ID
  isFlashed: z.boolean().optional().default(false), // 新增: 是否被闪光弹致盲
  flashEndTime: z.number().optional().default(0), // 新增: 致盲结束时间（毫秒时间戳）
  isStunned: z.boolean().optional().default(false), // 新增: 是否被眩晕
  stunnedEndTime: z.number().optional().default(0), // 新增: 眩晕结束时间（毫秒时间戳）
  raidEquipment: PLAYER_RAID_EQUIPMENT_SCHEMA.optional(), // 新增: 局内装备状态
  killedBy: z.string().optional(), // 新增: 击杀者名字
  killedByWeaponName: z.string().optional(), // 新增: 击杀使用的武器名称
  buffs: z.array(PLAYER_BUFF_SCHEMA).optional(), // 新增: 局内短效 Buff 列表
  // 新增: 正在使用的道具（读条）状态，用于 HUD 提示（例如急救包）
  usingItemTypeId: z.string().nullable().optional(),
  usingItemRemainingMs: z.number().int().nonnegative().optional(),
  usingItemTotalMs: z.number().int().positive().optional(),
  // 伪装相关：当玩家伪装时，模拟AI的行为状态和角色（其他玩家看到伪装玩家时显示为AI）
  disguisedAsAiBehavior: z.enum(['IDLE', 'PATROL', 'SPOTTING', 'CHASE', 'ATTACK', 'SEARCH', 'RETURN']).optional(),
  disguisedAsAiRole: z.enum(['basic', 'sniper', 'heavy_gunner', 'scout']).optional(),
  disguisedAimRad: z.number().optional(), // 新增: 伪装玩家的枪口指向（基于移动方向）
  aimRad: z.number().default(0), // 新增: 同步所有玩家的瞄准方向
});

// AI实体状态 schema（用于服务端AI系统）
export const AI_STATE_SCHEMA = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  hp: z.number().int().min(0).max(500), // 修改：支持重甲AI的高HP
  maxHp: z.number().int().positive(),
  status: z.enum(['ALIVE', 'DEAD']),
  weaponRuntime: WEAPON_RUNTIME_SCHEMA.optional(),
  aimRad: z.number(),
  behaviorState: z.enum(['IDLE', 'PATROL', 'SPOTTING', 'CHASE', 'ATTACK', 'SEARCH', 'RETURN']),
  role: z.enum(['basic', 'sniper', 'heavy_gunner', 'scout']).optional().default('basic'), // 新增：AI角色类型
  currentTargetId: z.string().optional(), // 新增：当前目标ID（用于显示"瞄准中"状态）
  // 新增: 闪光弹状态（与玩家字段对齐）
  isFlashed: z.boolean().optional().default(false),
  flashEndTime: z.number().optional().default(0),
  // 新增: 眩晕状态（与玩家字段对齐）
  isStunned: z.boolean().optional().default(false),
  stunnedEndTime: z.number().optional().default(0),
  inBush: z.boolean().optional().default(false),
  inBushId: z.string().nullable().optional().default(null),
  inSmoke: z.boolean().optional().default(false),
  inSmokeId: z.string().nullable().optional().default(null),
});

// Decoy 实体状态
export const DECOY_STATE_SCHEMA = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  vx: z.number(), // Decoys might move
  vy: z.number(),
  ownerId: z.string(),
  name: z.string().optional(),
  weaponTypeId: z.string().optional(),
  armorTypeId: z.string().optional(),
  hp: z.number(),
  maxHp: z.number(),
  aimRad: z.number().optional().default(0), // 新增: 瞄准角度（用于眼睛渲染）
  // 新增: 草丛/烟雾可见性字段（与玩家/AI保持一致）
  inBush: z.boolean().optional().default(false),
  inBushId: z.string().nullable().optional().default(null),
  inSmoke: z.boolean().optional().default(false),
  inSmokeId: z.string().nullable().optional().default(null),
});

// Turret 实体状态
export const TURRET_STATE_SCHEMA = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  ownerId: z.string(),
  hp: z.number(),
  maxHp: z.number(),
  aimRad: z.number(),
  state: z.enum(['IDLE', 'SPOOLING', 'FIRING', 'RELOADING']),
  targetId: z.string().optional(),
  remainingTimeMs: z.number(),
  isArmored: z.boolean(),
  range: z.number(),
});

export const BULLET_STATE_SCHEMA = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  vx: z.number(),
  vy: z.number(),
  ownerId: z.string(),
  clientShotId: z.number().int().optional(), // 客户端发射ID（用于预测子弹对齐）
  weaponTypeId: z.string().optional(), // 武器类型ID（用于区分手雷、子弹等视觉样式）
  bulletLifeMs: z.number().optional(), // 子弹生命周期（毫秒，用于客户端TTL判断）
  spawnTimeMs: z.number().optional(), // 新增: 生成时间戳（用于视觉效果计算，如轨迹消隐）
  targetX: z.number().optional(),
  targetY: z.number().optional(),
  spawnX: z.number().optional(), // 新增: 起始位置X（用于抛物线计算）
  spawnY: z.number().optional(), // 新增: 起始位置Y
  spreadSeed: z.number().optional(), // 新增: 散布种子（用于客户端重现散布，特别是炮台子弹）
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

export const S2C_SNAPSHOT_SCHEMA = z.object({
  type: z.literal('S2C_SNAPSHOT'),
  tick: z.number().int().nonnegative(),
  timestamp: z.number(),
  players: z.array(PLAYER_STATE_SCHEMA),
  bullets: z.array(BULLET_STATE_SCHEMA),
  items: z.array(ITEM_STATE_SCHEMA).optional(), // 保留兼容
  worldItems: z.array(WORLD_ITEM_SCHEMA).optional(), // 新增: 世界物品列表（MVP 全量，未来做 delta）
  lootBags: z.array(LOOT_BAG_SCHEMA).optional(), // 新增: 掉落包列表
  obstacles: z.array(OBSTACLE_STATE_SCHEMA).optional(), // 新增: 障碍物列表（可破坏，需要同步）
  ais: z.array(AI_STATE_SCHEMA).default([]), // 新增: AI实体列表
  decoys: z.array(DECOY_STATE_SCHEMA).optional(), // 新增: 诱饵列表
  turrets: z.array(TURRET_STATE_SCHEMA).optional(), // 新增: 炮台列表
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
  rooms: z.array(ROOM_SCHEMA).optional(), // 新增: 房间列表（用于地板渲染）
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
  phase: z.enum(['NAME', 'HIDEOUT', 'RAID', 'RESULT']), // ✅ 关键：phase 现在是必需的（服务端持久化状态）
  money: z.number().int().nonnegative(),
  stash: z.array(ITEM_INSTANCE_SCHEMA),
  prep: z.array(ITEM_INSTANCE_SCHEMA).optional(), // 新增: 整备区（准备带入局内的物品）
  bagCap: z.number().int().positive(),
  equipment: PLAYER_EQUIPMENT_SCHEMA, // 新增: 装备槽
  isAdmin: z.boolean().optional(),     // 新增: 是否为管理员
});

// 新增: 战局结果消息（撤离/死亡后发送）
export const S2C_RAID_RESULT_SCHEMA = z.object({
  type: z.literal('S2C_RAID_RESULT'),
  result: z.enum(['EXTRACTED', 'DIED']), // 结果类型
  loot: z.array(ITEM_INSTANCE_SCHEMA), // 获得的物品（撤离时）
  moneyGained: z.number().int().nonnegative(), // 获得的金钱（撤离时）
  moneyLost: z.number().int().nonnegative(), // 损失的金钱（死亡时，prep 物品的价值）
  killedBy: z.string().optional(), // 死亡时：击杀者名字
  killedByWeaponName: z.string().optional(), // 死亡时：击杀使用的武器名称
});

// 新增: 战斗事件消息（干火/命中/受伤反馈）
export const S2C_COMBAT_EVENT_SCHEMA = z.object({
  type: z.literal('S2C_COMBAT_EVENT'),
  kind: z.enum(['DRY_FIRE', 'HIT', 'DAMAGE_TAKEN']), // 事件类型
  direction: z.number().optional(), // 可选：方向（弧度，用于受伤方向指示）
});

export const S2C_MELEE_SWING_SCHEMA = z.object({
  type: z.literal('S2C_MELEE_SWING'),
  playerId: z.string(),
  x: z.number(),
  y: z.number(),
  aimRad: z.number(),
  range: z.number(),
  arcRad: z.number(),
  side: z.number().int().optional(), // 新增: 挥砍方向 (1 或 -1)
  weaponTypeId: z.string().optional(), // 新增: 武器类型ID，用于不同的视觉效果
});

export const S2C_EXPLOSION_SCHEMA = z.object({
  type: z.literal('S2C_EXPLOSION'),
  x: z.number(),
  y: z.number(),
  radius: z.number().positive(),
});

// 新增: 烟雾事件（用于生成持续一段时间的烟雾区域）
export const S2C_SMOKE_SCHEMA = z.object({
  type: z.literal('S2C_SMOKE'),
  x: z.number(),
  y: z.number(),
  radius: z.number().positive(),
  durationMs: z.number().int().positive(),
});

// 新增: 燃烧事件（用于生成持续一段时间的燃烧区域）
export const S2C_FIRE_SCHEMA = z.object({
  type: z.literal('S2C_FIRE'),
  x: z.number(),
  y: z.number(),
  radius: z.number().positive(),
  durationMs: z.number().int().positive(),
});

// 新增: 击杀播报消息
export const S2C_KILL_FEED_SCHEMA = z.object({
  type: z.literal('S2C_KILL_FEED'),
  killer: z.string(),
  victim: z.string(),
  weapon: z.string(),
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
  S2C_MELEE_SWING_SCHEMA, // 新增: 近战挥击事件
  S2C_EXPLOSION_SCHEMA, // 新增: 爆炸事件
  S2C_SMOKE_SCHEMA, // 新增: 烟雾事件
  S2C_FIRE_SCHEMA, // 新增: 燃烧事件
  S2C_KILL_FEED_SCHEMA, // 新增: 击杀播报
]);

// TypeScript 类型推导
export type C2S_HELLO = z.infer<typeof C2S_HELLO_SCHEMA>;
export type C2S_CHAT = z.infer<typeof C2S_CHAT_SCHEMA>;
export type C2S_INPUT = z.infer<typeof C2S_INPUT_SCHEMA>;
export type C2S_PING = z.infer<typeof C2S_PING_SCHEMA>; // Day5: Ping 类型
export type C2S_MESSAGE = z.infer<typeof C2S_MESSAGE_SCHEMA>;
export type C2S_LOCAL_BULLET_HIT = z.infer<typeof C2S_LOCAL_BULLET_HIT_SCHEMA>;

export type PLAYER_STATE = z.infer<typeof PLAYER_STATE_SCHEMA>;
export type PLAYER_BUFF = PlayerBuff;
export type AI_STATE = z.infer<typeof AI_STATE_SCHEMA>;
export type BULLET_STATE = z.infer<typeof BULLET_STATE_SCHEMA>;
export type ITEM_STATE = z.infer<typeof ITEM_STATE_SCHEMA>;
export type OBSTACLE_STATE = z.infer<typeof OBSTACLE_STATE_SCHEMA>; // Day4-2: 障碍物类型
export type DECOY_STATE = z.infer<typeof DECOY_STATE_SCHEMA>; // 新增: 诱饵类型
export type TURRET_STATE = z.infer<typeof TURRET_STATE_SCHEMA>; // 新增: 炮台类型
export type S2C_SNAPSHOT = z.infer<typeof S2C_SNAPSHOT_SCHEMA>;
export type S2C_ERROR = z.infer<typeof S2C_ERROR_SCHEMA>;
export type S2C_WELCOME = z.infer<typeof S2C_WELCOME_SCHEMA>;
export type S2C_WORLD_INIT = z.infer<typeof S2C_WORLD_INIT_SCHEMA>; // 静态世界初始化类型
export type S2C_EVENT = z.infer<typeof S2C_EVENT_SCHEMA>; // 游戏化增强: 事件类型
export type S2C_PONG = z.infer<typeof S2C_PONG_SCHEMA>; // Day5: Pong 类型
export type S2C_PROFILE = z.infer<typeof S2C_PROFILE_SCHEMA>;
export type S2C_RAID_RESULT = z.infer<typeof S2C_RAID_RESULT_SCHEMA>; // P1-1: Profile 类型
export type S2C_COMBAT_EVENT = z.infer<typeof S2C_COMBAT_EVENT_SCHEMA>; // 新增: 战斗事件类型
export type S2C_MELEE_SWING = z.infer<typeof S2C_MELEE_SWING_SCHEMA>; // 新增: 近战挥击事件类型
export type S2C_EXPLOSION = z.infer<typeof S2C_EXPLOSION_SCHEMA>; // 新增: 爆炸事件类型
export type S2C_SMOKE = z.infer<typeof S2C_SMOKE_SCHEMA>; // 新增: 烟雾事件类型
export type S2C_FIRE = z.infer<typeof S2C_FIRE_SCHEMA>; // 新增: 燃烧事件类型
export type S2C_KILL_FEED = z.infer<typeof S2C_KILL_FEED_SCHEMA>; // 新增: 击杀播报类型
export type S2C_MESSAGE = z.infer<typeof S2C_MESSAGE_SCHEMA>;

// 新增: 物品系统类型导出
export type ITEM_INSTANCE = z.infer<typeof ITEM_INSTANCE_SCHEMA>;
export type WORLD_ITEM = z.infer<typeof WORLD_ITEM_SCHEMA>;
export type LOOT_BAG = z.infer<typeof LOOT_BAG_SCHEMA>;
export type PLAYER_INVENTORY = z.infer<typeof PLAYER_INVENTORY_SCHEMA>;
export type PLAYER_EQUIPMENT = z.infer<typeof PLAYER_EQUIPMENT_SCHEMA>;
export type PLAYER_RAID_EQUIPMENT = z.infer<typeof PLAYER_RAID_EQUIPMENT_SCHEMA>;
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
export type C2S_DROP_ITEM = z.infer<typeof C2S_DROP_ITEM_SCHEMA>;
export type C2S_RAID_EQUIP = z.infer<typeof C2S_RAID_EQUIP_SCHEMA>;
export type C2S_THROW = z.infer<typeof C2S_THROW_SCHEMA>;
