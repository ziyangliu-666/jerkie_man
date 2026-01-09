import { z } from 'zod';
import { DEFAULT_MAP_CONFIG, MAP_CONFIG_SCHEMA, Zone } from './content.js';

// Day4-2: 障碍物类型定义（移到这里避免循环依赖）
export const OBSTACLE_TYPE = {
  WALL: 'wall',           // 石墙：不可穿过，子弹不可穿过，不可破坏
  CRATE: 'crate',         // 木箱：不可穿过，子弹不可穿过，可破坏（掉落随机传奇物品）
  WEAPON_CRATE: 'weapon_crate',       // 武器箱：掉落武器
  THROWABLE_CRATE: 'throwable_crate', // 投掷物箱：掉落手雷/烟雾弹等
  MEDICAL_CRATE: 'medical_crate',     // 医疗箱：掉落医疗用品
  EQUIPMENT_CRATE: 'equipment_crate', // 装备箱：掉落护甲/背包
  
  // 户外资源点类（可破坏，掉落物品）
  VEHICLE: 'vehicle',               // 废弃车辆：随机物品
  SUPPLY_STACK: 'supply_stack',     // 物资堆：混合物资
  
  // 户外景观建筑类（掩体/装饰）
  FENCE_WOOD: 'fence_wood',         // 木栅栏：低矮掩体
  FENCE_METAL: 'fence_metal',       // 金属栅栏：中等掩体
  SHRUB: 'shrub',                   // 灌木丛：低矮遮挡
  ROCK_LARGE: 'rock_large',         // 大岩石：坚固掩体
  
  BUSH: 'bush',           // 草丛：可穿过，子弹可穿过，提供视野遮挡
  WATER: 'water',         // 水域：不可穿过，子弹可穿过
  DOOR_CLOSED: 'door_closed', // 门（关）：不可穿过，阻挡视野，可破坏
  DOOR_OPEN: 'door_open',     // 门（开）：可穿过，不阻挡视野
  GLASS: 'glass',             // 玻璃：不可穿过，子弹可穿过，不阻挡视野，可破坏
  CHEST_CLOSED: 'chest_closed', // 宝箱（关）：不可穿过，可破坏（掉落），可交互（打开）
  CHEST_OPEN: 'chest_open',     // 宝箱（开）：不可穿过（或可穿过？），已搜刮
  BROKEN: 'broken',           // 损坏的残骸：可穿过，不阻挡视野
} as const;

export type ObstacleType = typeof OBSTACLE_TYPE[keyof typeof OBSTACLE_TYPE];

// 障碍物状态（矩形 AABB + 类型 + 属性）
export const OBSTACLE_STATE_SCHEMA = z.object({
  id: z.string().optional(),   // 唯一标识（用于可破坏物体）
  x: z.number().nonnegative(), // 矩形左上角 x
  y: z.number().nonnegative(), // 矩形左上角 y
  w: z.number().positive(),    // 宽度
  h: z.number().positive(),    // 高度
  type: z.string().default(OBSTACLE_TYPE.WALL), // 障碍物类型
  hp: z.number().optional(),   // 生命值（可破坏物体）
  maxHp: z.number().optional(), // 最大生命值
  data: z.record(z.any()).optional(), // 额外数据（扩展用）
});

export const SPAWN_POINT_SCHEMA = z.object({
  x: z.number().nonnegative(),
  y: z.number().nonnegative(),
});

// 新增: POI (Point of Interest) 定义
export const POI_SCHEMA = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  x: z.number().nonnegative(),
  y: z.number().nonnegative(),
  type: z.string().default('generic'), // 类型：building, resource, landmark 等
  description: z.string().optional(),
});

// 新增: 区域定义（用于标记不同功能区域）
export const ZONE_SCHEMA = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  x: z.number().nonnegative(),
  y: z.number().nonnegative(),
  w: z.number().positive(),
  h: z.number().positive(),
  type: z.string().default('generic'), // 类型：safe, danger, loot, pvp 等
  description: z.string().optional(),
});

// AI角色类型定义
export type AIRole = 'basic' | 'sniper' | 'heavy_gunner' | 'scout';

// AI角色预设配置
export interface AIRolePreset {
  role: AIRole;
  weaponTypeId: string;
  hp: number;
  maxHp: number;
  armorReduction: number;
  visionRange: number;
  visionAngleDeg: number;
  moveSpeed: number; // 移动速度倍率 (0.5 = 慢, 1.0 = 正常, 1.5 = 快)
  aimErrorDeg: number; // 瞄准误差（度）
  fireRateMultiplier: number; // 射速倍率
  aggroRange: number; // 攻击距离
  chaseRange: number; // 追击距离
}

// AI角色预设表
export const AI_ROLE_PRESETS: Record<AIRole, AIRolePreset> = {
  // 基础AI - 默认平衡型
  basic: {
    role: 'basic',
    weaponTypeId: 'w_pistol',
    hp: 100,
    maxHp: 100,
    armorReduction: 0,
    visionRange: 300,
    visionAngleDeg: 360,
    moveSpeed: 1.0,
    aimErrorDeg: 5,
    fireRateMultiplier: 1.0,
    aggroRange: 250,
    chaseRange: 300,
  },
  // 狙击手 - 远程高精度
  sniper: {
    role: 'sniper',
    weaponTypeId: 'w_sniper',
    hp: 80,
    maxHp: 80,
    armorReduction: 0,
    visionRange: 600, // 视野远
    visionAngleDeg: 90, // 视野窄（聚焦）
    moveSpeed: 0.8, // 移动慢
    aimErrorDeg: 1, // 精准射击
    fireRateMultiplier: 0.8, // 射速慢
    aggroRange: 500, // 远距离攻击
    chaseRange: 600,
  },
  // 重机枪手 - 高火力高防御
  heavy_gunner: {
    role: 'heavy_gunner',
    weaponTypeId: 'w_smg', // 使用SMG模拟加特林高射速
    hp: 400,
    maxHp: 400,
    armorReduction: 0.3, // 30%护甲减伤
    visionRange: 350,
    visionAngleDeg: 120,
    moveSpeed: 0.6, // 移动很慢
    aimErrorDeg: 8, // 精度低
    fireRateMultiplier: 2.0, // 射速极快（疯狂射击）
    aggroRange: 300,
    chaseRange: 350,
  },
  // 侦察兵 - 高速低血
  scout: {
    role: 'scout',
    weaponTypeId: 'w_pistol',
    hp: 60,
    maxHp: 60,
    armorReduction: 0,
    visionRange: 400,
    visionAngleDeg: 360,
    moveSpeed: 1.5, // 移动快
    aimErrorDeg: 7,
    fireRateMultiplier: 1.2,
    aggroRange: 200,
    chaseRange: 400,
  },
};

// 新增: AI spawn点定义
export const AI_SPAWN_SCHEMA = z.object({
  x: z.number().nonnegative(),
  y: z.number().nonnegative(),
  type: z.enum(['patrol', 'guard']),
  role: z.enum(['basic', 'sniper', 'heavy_gunner', 'scout']).default('basic'), // 新增：AI角色类型
  weaponTypeId: z.string().optional(), // 改为可选，如果未指定则使用角色预设
  count: z.number().int().positive().default(1),
  patrolPointIds: z.array(z.string()).optional(),
  guardRadius: z.number().positive().optional(),
  visionRange: z.number().positive().optional(), // 改为可选，未指定则使用角色预设
  visionAngleDeg: z.number().min(0).max(360).optional(), // 改为可选
  hp: z.number().int().positive().optional(), // 新增：自定义HP
  armorReduction: z.number().min(0).max(1).optional(), // 新增：自定义护甲
  moveSpeed: z.number().positive().optional(), // 新增：自定义移动速度
});

// 新增: 物品重刷配置
// 说明：
// - 支持按区域(zoneId)限制刷新范围
// - 支持指定可刷新物品ID白名单 itemIds（逗号分隔）
// - 支持自定义稀有度权重 rarityWeights，形如 "COMMON:60,RARE:30,EPIC:10"
// - 支持 mode 字段区分作用阶段：initial / respawn / both
export const ITEM_RESPAWN_SCHEMA = z.object({
  // 可选规则ID（仅用于日志/调试，无逻辑含义）
  id: z.string().optional(),
  // 规则生效模式：仅初始生成(initial)、仅重刷(respawn)、或两者都生效(both)
  mode: z.enum(['initial', 'respawn', 'both']).default('both'),
  intervalTicks: z.number().int().positive(), // 重刷间隔（tick数）
  count: z.number().int().nonnegative().default(1), // 每次重刷的物品数量
  maxItems: z.number().int().positive().optional(), // 地图上最大物品数量（可选，用于限制）
  zoneId: z.string().optional(), // 可选：只在指定区域内重刷
  // 物品白名单（可选），如果存在则只会从这里列出的物品里随机
  itemIds: z.array(z.string()).optional(),
  // 稀有度权重（可选），如果存在则覆盖默认 60/30/10
  rarityWeights: z
    .object({
      COMMON: z.number().nonnegative().optional(),
      RARE: z.number().nonnegative().optional(),
      EPIC: z.number().nonnegative().optional(),
      LEGENDARY: z.number().nonnegative().optional(),
    })
    .optional(),
});

// 新增: AI重刷配置
export const AI_RESPAWN_SCHEMA = z.object({
  intervalTicks: z.number().int().positive(), // 重刷间隔（tick数）
  spawnId: z.string().optional(), // 可选：关联到特定的AI spawn点ID
  maxAIs: z.number().int().positive().optional(), // 地图上最大AI数量（可选）
});

// ============================================================
// Room 一等公民：房间不再只是"墙的集合"
// 必须在 MAP_TEMPLATE_SCHEMA 之前定义
// ============================================================
export const ROOM_SCHEMA = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
  floorType: z.enum(['wood', 'tile', 'pave', 'concrete', 'grass']).default('tile'),
  groupId: z.string().optional(), // 所属 roomgroup 的标识
  doors: z.array(z.object({
    side: z.enum(['n', 's', 'e', 'w']),
    position: z.number(), // 门在该边的位置（0-1 比例，0.5=中间）
    isExternal: z.boolean(), // 是否为外部门（通向室外）
  })).default([]),
});

export const MAP_TEMPLATE_SCHEMA = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  description: z.string().optional(), // 新增: 地图描述
  mapConfig: MAP_CONFIG_SCHEMA,
  obstacles: z.array(OBSTACLE_STATE_SCHEMA),
  spawns: z.array(SPAWN_POINT_SCHEMA).default([]),
  pois: z.array(POI_SCHEMA).default([]), // 新增: POI 列表
  zones: z.array(ZONE_SCHEMA).default([]), // 新增: 区域列表
  rooms: z.array(ROOM_SCHEMA).default([]), // 新增: 房间列表（由 @roomgroup 生成）
  aiSpawns: z.array(AI_SPAWN_SCHEMA).default([]), // 新增: AI spawn点列表
  // 支持多条 itemRespawn 规则
  itemRespawns: z.array(ITEM_RESPAWN_SCHEMA).default([]), // 新增: 物品重刷配置列表
  aiRespawn: AI_RESPAWN_SCHEMA.optional(), // 新增: AI重刷配置
});

export type MapTemplate = z.infer<typeof MAP_TEMPLATE_SCHEMA>;
export type SpawnPoint = z.infer<typeof SPAWN_POINT_SCHEMA>;
export type POI = z.infer<typeof POI_SCHEMA>;
// export type Zone = z.infer<typeof ZONE_SCHEMA>; // Removed to avoid duplicate export with content.ts
export type AISpawn = z.infer<typeof AI_SPAWN_SCHEMA>;
export type ItemRespawn = z.infer<typeof ITEM_RESPAWN_SCHEMA>;
export type AIRespawn = z.infer<typeof AI_RESPAWN_SCHEMA>;

// 新增: RoomGroup 房间组定义 (高级语法)
export const ROOM_DEF_SCHEMA = z.object({
  id: z.string(),
  w: z.number().positive().optional(),
  h: z.number().positive().optional(),
  doors: z.string().default(''), // nsew组合
  floorType: z.enum(['wood', 'tile', 'pave', 'concrete', 'grass']).optional(), // 房间地板类型
});

// 锚点类型：用于相对定位
export type AnchorType = 'center' | 'nw' | 'n' | 'ne' | 'w' | 'e' | 'sw' | 's' | 'se';

export const ROOM_GROUP_SCHEMA = z.object({
  // 基础布局
  layout: z.enum(['horizontal', 'vertical', 'grid', 'corridor']),
  
  // 位置：支持绝对坐标或相对定位
  x: z.number().optional(),  // 改为可选，可以用 anchor 代替
  y: z.number().optional(),
  anchor: z.enum(['center', 'nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se']).optional(), // 相对定位锚点
  
  // 布局参数
  cellW: z.number().positive().optional(),
  cellH: z.number().positive().optional(),
  cols: z.number().int().positive().optional(),
  rows: z.number().int().positive().optional(),
  
  // 走廊布局专用参数
  corridorWidth: z.number().positive().optional(), // 走廊宽度（默认 100）
  corridorSide: z.enum(['north', 'south', 'both']).optional(), // 房间在走廊的哪一侧
  
  // 墙体参数
  wallThickness: z.number().positive().default(20),
  doorWidth: z.number().positive().default(120),
  
  // 布局器参数
  id: z.string().optional(),           // 房间组 ID（用于引用）
  margin: z.number().nonnegative().default(0), // 外边距，给门口留通道
  floorType: z.enum(['wood', 'tile', 'pave', 'concrete', 'grass']).default('tile'), // 默认地板类型
  
  // 房间列表
  rooms: z.array(ROOM_DEF_SCHEMA),
});

export type RoomDef = z.infer<typeof ROOM_DEF_SCHEMA>;
export type RoomGroup = z.infer<typeof ROOM_GROUP_SCHEMA>;
export type RoomGroupLayout = 'horizontal' | 'vertical' | 'grid' | 'corridor';
export type Room = z.infer<typeof ROOM_SCHEMA>;

// ============================================================
// Map Linter：结构化的检测结果
// ============================================================
export type LintSeverity = 'error' | 'warning';
export type LintIssueType = 
  | 'obstacle_overlap'      // 障碍物重叠
  | 'extract_blocked'       // 撤离点被覆盖
  | 'spawn_blocked'         // 出生点被覆盖
  | 'out_of_bounds'         // 越界
  | 'door_blocked'          // 门口被堵
  | 'bush_indoor'           // 草丛在室内
  | 'chest_wall_overlap'    // 宝箱与墙重叠
  | 'roomgroup_sealed'      // 房间组封闭无入口
  | 'spawn_unreachable';    // 出生点不可达（预留）

export interface LintIssue {
  type: LintIssueType;
  severity: LintSeverity;
  message: string;
  entities: string[];        // 涉及的实体 ID
  location?: { x: number; y: number; w?: number; h?: number };
  details?: Record<string, any>; // 额外信息
}

export interface LintResult {
  mapId: string;
  mapName?: string;
  errors: LintIssue[];
  warnings: LintIssue[];
  summary: {
    totalIssues: number;
    errorCount: number;
    warningCount: number;
  };
}

type TokenizedLine = {
  directive: string;
  tokens: string[];
  lineNumber: number;
  raw: string;
};

function splitTokens(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
      continue;
    }
    if (!inQuotes && /\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }

  if (current.length > 0) {
    tokens.push(current);
  }
  return tokens;
}

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"');
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/\\'/g, "'");
  }
  return value;
}

function parseTokens(line: string, lineNumber: number): TokenizedLine | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }
  const tokens = splitTokens(trimmed);
  if (tokens.length === 0) {
    return null;
  }
  return {
    directive: tokens[0].toLowerCase(),
    tokens: tokens.slice(1),
    lineNumber,
    raw: line,
  };
}

function parseKeyValues(tokens: string[]): { kv: Record<string, string>; positionals: string[] } {
  const kv: Record<string, string> = {};
  const positionals: string[] = [];
  for (const token of tokens) {
    const idx = token.indexOf('=');
    if (idx > 0) {
      const key = token.slice(0, idx).trim().toLowerCase();
      const value = token.slice(idx + 1).trim();
      kv[key] = unquote(value);
    } else {
      positionals.push(token);
    }
  }
  return { kv, positionals };
}

function parseNumber(value: string, lineNumber: number, label: string): number {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Line ${lineNumber}: Invalid number for ${label}: "${value}"`);
  }
  return num;
}

function parseRect(
  tokens: string[],
  lineNumber: number,
  labels: { x: string; y: string; w: string; h: string }
): { x: number; y: number; w: number; h: number } {
  const { kv, positionals } = parseKeyValues(tokens);
  if (positionals.length >= 4) {
    return {
      x: parseNumber(positionals[0], lineNumber, labels.x),
      y: parseNumber(positionals[1], lineNumber, labels.y),
      w: parseNumber(positionals[2], lineNumber, labels.w),
      h: parseNumber(positionals[3], lineNumber, labels.h),
    };
  }
  return {
    x: parseNumber(kv.x ?? '', lineNumber, labels.x),
    y: parseNumber(kv.y ?? '', lineNumber, labels.y),
    w: parseNumber(kv.w ?? '', lineNumber, labels.w),
    h: parseNumber(kv.h ?? '', lineNumber, labels.h),
  };
}

function parsePoint(tokens: string[], lineNumber: number): { x: number; y: number } {
  const { kv, positionals } = parseKeyValues(tokens);
  if (positionals.length >= 2) {
    return {
      x: parseNumber(positionals[0], lineNumber, 'x'),
      y: parseNumber(positionals[1], lineNumber, 'y'),
    };
  }
  return {
    x: parseNumber(kv.x ?? '', lineNumber, 'x'),
    y: parseNumber(kv.y ?? '', lineNumber, 'y'),
  };
}

// ============================================================
// 布局器 (Layout Solver)：自动计算 RoomGroup 位置
// ============================================================

/**
 * 布局上下文：跟踪已放置的大块，用于避让
 */
interface LayoutContext {
  mapWidth: number;
  mapHeight: number;
  placedBlocks: Array<{ x: number; y: number; w: number; h: number; id?: string }>;
  extractZone?: { x: number; y: number; w: number; h: number };
}

/**
 * 计算 RoomGroup 的总尺寸（不含 margin）
 */
function calculateRoomGroupSize(group: RoomGroup): { w: number; h: number } {
  const { layout, cellW, cellH, cols, rows, rooms } = group;
  const cw = cellW ?? 300;
  const ch = cellH ?? 300;
  
  if (layout === 'horizontal') {
    let totalW = 0;
    for (const room of rooms) {
      totalW += room.w ?? cw;
    }
    return { w: totalW, h: ch };
  } else if (layout === 'vertical') {
    let totalH = 0;
    for (const room of rooms) {
      totalH += room.h ?? ch;
    }
    return { w: cw, h: totalH };
  } else if (layout === 'corridor') {
    // 走廊布局：走廊 + 两侧房间
    const corridorWidth = group.corridorWidth ?? 100;
    const side = group.corridorSide ?? 'both';
    
    // 计算走廊长度（所有房间宽度之和）
    let corridorLength = 0;
    for (const room of rooms) {
      corridorLength += room.w ?? cw;
    }
    
    // 计算总高度
    let totalH = corridorWidth;
    if (side === 'north' || side === 'both') totalH += ch;
    if (side === 'south' || side === 'both') totalH += ch;
    
    return { w: corridorLength, h: totalH };
  } else { // grid
    const c = cols ?? 2;
    const r = rows ?? Math.ceil(rooms.length / c);
    return { w: c * cw, h: r * ch };
  }
}

/**
 * 根据锚点计算 RoomGroup 的实际位置
 */
function resolveAnchorPosition(
  anchor: AnchorType,
  size: { w: number; h: number },
  margin: number,
  ctx: LayoutContext
): { x: number; y: number } {
  const { mapWidth, mapHeight } = ctx;
  const totalW = size.w + margin * 2;
  const totalH = size.h + margin * 2;
  
  // 计算锚点对应的中心位置
  let centerX: number;
  let centerY: number;
  
  switch (anchor) {
    case 'center':
      centerX = mapWidth / 2;
      centerY = mapHeight / 2;
      break;
    case 'nw':
      centerX = totalW / 2;
      centerY = totalH / 2;
      break;
    case 'n':
      centerX = mapWidth / 2;
      centerY = totalH / 2;
      break;
    case 'ne':
      centerX = mapWidth - totalW / 2;
      centerY = totalH / 2;
      break;
    case 'w':
      centerX = totalW / 2;
      centerY = mapHeight / 2;
      break;
    case 'e':
      centerX = mapWidth - totalW / 2;
      centerY = mapHeight / 2;
      break;
    case 'sw':
      centerX = totalW / 2;
      centerY = mapHeight - totalH / 2;
      break;
    case 's':
      centerX = mapWidth / 2;
      centerY = mapHeight - totalH / 2;
      break;
    case 'se':
      centerX = mapWidth - totalW / 2;
      centerY = mapHeight - totalH / 2;
      break;
    default:
      centerX = mapWidth / 2;
      centerY = mapHeight / 2;
  }
  
  // 从中心位置计算左上角（加上 margin 偏移）
  return {
    x: Math.round(centerX - size.w / 2),
    y: Math.round(centerY - size.h / 2),
  };
}

/**
 * 检测矩形是否与已放置的块重叠
 */
function checkCollision(
  rect: { x: number; y: number; w: number; h: number },
  ctx: LayoutContext
): boolean {
  // 检测与已放置块的碰撞
  for (const block of ctx.placedBlocks) {
    if (rectsOverlap(rect, block)) {
      return true;
    }
  }
  
  // 检测与撤离区的碰撞
  if (ctx.extractZone && rectsOverlap(rect, ctx.extractZone)) {
    return true;
  }
  
  return false;
}

/**
 * 尝试找到一个不重叠的位置（简单的偏移搜索）
 */
function findNonOverlappingPosition(
  preferredPos: { x: number; y: number },
  size: { w: number; h: number },
  margin: number,
  ctx: LayoutContext,
  maxAttempts: number = 20
): { x: number; y: number } | null {
  const { mapWidth, mapHeight } = ctx;
  const totalW = size.w + margin * 2;
  const totalH = size.h + margin * 2;
  
  // 首先尝试首选位置
  const rect = {
    x: preferredPos.x - margin,
    y: preferredPos.y - margin,
    w: totalW,
    h: totalH,
  };
  
  if (!checkCollision(rect, ctx) && 
      rect.x >= 0 && rect.y >= 0 && 
      rect.x + rect.w <= mapWidth && rect.y + rect.h <= mapHeight) {
    return preferredPos;
  }
  
  // 尝试不同的偏移
  const offsets = [
    { dx: 0, dy: -100 },   // 上
    { dx: 0, dy: 100 },    // 下
    { dx: -100, dy: 0 },   // 左
    { dx: 100, dy: 0 },    // 右
    { dx: -100, dy: -100 }, // 左上
    { dx: 100, dy: -100 },  // 右上
    { dx: -100, dy: 100 },  // 左下
    { dx: 100, dy: 100 },   // 右下
  ];
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    for (const offset of offsets) {
      const testX = preferredPos.x + offset.dx * attempt;
      const testY = preferredPos.y + offset.dy * attempt;
      
      const testRect = {
        x: testX - margin,
        y: testY - margin,
        w: totalW,
        h: totalH,
      };
      
      if (!checkCollision(testRect, ctx) &&
          testRect.x >= 0 && testRect.y >= 0 &&
          testRect.x + testRect.w <= mapWidth && testRect.y + testRect.h <= mapHeight) {
        return { x: testX, y: testY };
      }
    }
  }
  
  return null; // 找不到合适位置
}

/**
 * 解析 RoomGroup 的位置（支持绝对坐标和相对定位）
 */
function resolveRoomGroupPosition(
  group: Partial<RoomGroup> & { rooms: RoomDef[] },
  ctx: LayoutContext,
  lineNumber: number
): { x: number; y: number } {
  const size = calculateRoomGroupSize(group as RoomGroup);
  const margin = group.margin ?? 0;
  
  // 如果提供了绝对坐标，直接使用
  if (group.x !== undefined && group.y !== undefined) {
    return { x: group.x, y: group.y };
  }
  
  // 如果提供了锚点，计算位置
  if (group.anchor) {
    const preferredPos = resolveAnchorPosition(group.anchor, size, margin, ctx);
    
    // 尝试找到不重叠的位置
    const finalPos = findNonOverlappingPosition(preferredPos, size, margin, ctx);
    
    if (finalPos) {
      return finalPos;
    }
    
    // 找不到合适位置，使用首选位置并警告
    console.warn(`[Layout] Line ${lineNumber}: 无法为 roomgroup (anchor=${group.anchor}) 找到不重叠的位置，使用首选位置`);
    return preferredPos;
  }
  
  // 既没有坐标也没有锚点，报错
  throw new Error(`Line ${lineNumber}: roomgroup 必须指定 x,y 坐标或 anchor 锚点`);
}

/**
 * 检测两个矩形是否重叠
 */
function rectsOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
): boolean {
  return !(
    a.x + a.w <= b.x || // a 在 b 左侧
    b.x + b.w <= a.x || // b 在 a 左侧
    a.y + a.h <= b.y || // a 在 b 上方
    b.y + b.h <= a.y    // b 在 a 上方
  );
}

/**
 * 计算两个矩形的重叠区域
 */
function getOverlapArea(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
): { x: number; y: number; w: number; h: number } | null {
  if (!rectsOverlap(a, b)) return null;
  
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const maxX = Math.min(a.x + a.w, b.x + b.w);
  const maxY = Math.min(a.y + a.h, b.y + b.h);
  
  return {
    x,
    y,
    w: maxX - x,
    h: maxY - y,
  };
}

/**
 * 检测点是否在矩形内
 */
function pointInRect(
  px: number, py: number,
  rect: { x: number; y: number; w: number; h: number }
): boolean {
  return px >= rect.x && px < rect.x + rect.w && py >= rect.y && py < rect.y + rect.h;
}

// ============================================================
// lintMap: 结构化的地图检测器
// ============================================================

/**
 * 对地图模板进行全面检测，返回结构化的 LintResult
 * 这是新的主检测函数，detectOverlaps 会调用它
 */
export function lintMap(
  template: MapTemplate,
  roomGroups: Array<{ group: RoomGroup; startObstacleIndex: number }> = []
): LintResult {
  const errors: LintIssue[] = [];
  const warnings: LintIssue[] = [];
  
  const { width, height } = template.mapConfig;
  
  // 计算所有房间边界（用于室内检测）
  const roomBounds: Array<{ x: number; y: number; w: number; h: number; groupId: string }> = [];
  for (const { group } of roomGroups) {
    const roomRects = calculateRoomRects(group);
    for (const rect of roomRects) {
      roomBounds.push({
        ...rect,
        groupId: `roomgroup@(${group.x},${group.y})`,
      });
    }
  }
  
  // 定义类型集合
  const solidTypes = ['wall', 'door_closed', 'crate', 'container', 'rock_large', 'tree_large', 'water'];
  const chestTypes = ['crate', 'chest_closed', 'chest_open', 'weapon_crate', 'throwable_crate', 'medical_crate', 'equipment_crate'];
  const wallTypes = ['wall', 'door_closed'];
  
  // ============================================================
  // 1. 障碍物越界检测 (error)
  // ============================================================
  for (let i = 0; i < template.obstacles.length; i++) {
    const obs = template.obstacles[i];
    if (obs.x < 0 || obs.y < 0 || obs.x + obs.w > width || obs.y + obs.h > height) {
      errors.push({
        type: 'out_of_bounds',
        severity: 'error',
        message: `障碍物 [${i}] ${obs.type} 越界: (${obs.x}, ${obs.y}) ${obs.w}x${obs.h}，地图尺寸 ${width}x${height}`,
        entities: [obs.id ?? `obs_${i}`],
        location: { x: obs.x, y: obs.y, w: obs.w, h: obs.h },
        details: { mapWidth: width, mapHeight: height },
      });
    }
  }
  
  // ============================================================
  // 2. 出生点被固体障碍物覆盖检测 (error)
  // ============================================================
  const SPAWN_RADIUS = 30; // 出生点需要的净空半径
  for (let si = 0; si < template.spawns.length; si++) {
    const spawn = template.spawns[si];
    const spawnRect = {
      x: spawn.x - SPAWN_RADIUS,
      y: spawn.y - SPAWN_RADIUS,
      w: SPAWN_RADIUS * 2,
      h: SPAWN_RADIUS * 2,
    };
    
    for (let oi = 0; oi < template.obstacles.length; oi++) {
      const obs = template.obstacles[oi];
      // 只检测固体障碍物（bush 不算）
      if (!solidTypes.includes(obs.type)) continue;
      
      const overlap = getOverlapArea(spawnRect, obs);
      if (overlap && overlap.w * overlap.h > 100) { // 重叠面积 > 100px²
        errors.push({
          type: 'spawn_blocked',
          severity: 'error',
          message: `出生点 [${si}] @ (${spawn.x}, ${spawn.y}) 被 ${obs.type} [${oi}] 覆盖`,
          entities: [`spawn_${si}`, obs.id ?? `obs_${oi}`],
          location: { x: spawn.x, y: spawn.y },
          details: { obstacleIndex: oi, obstacleType: obs.type },
        });
        break; // 每个 spawn 只报告一次
      }
    }
  }
  
  // ============================================================
  // 2b. AI spawn 点被固体障碍物覆盖检测 (error)
  // ============================================================
  const AI_SPAWN_RADIUS = 40; // AI spawn 点需要的净空半径（比玩家大一点）
  for (let ai = 0; ai < template.aiSpawns.length; ai++) {
    const aiSpawn = template.aiSpawns[ai];
    const aiRect = {
      x: aiSpawn.x - AI_SPAWN_RADIUS,
      y: aiSpawn.y - AI_SPAWN_RADIUS,
      w: AI_SPAWN_RADIUS * 2,
      h: AI_SPAWN_RADIUS * 2,
    };
    
    for (let oi = 0; oi < template.obstacles.length; oi++) {
      const obs = template.obstacles[oi];
      // 只检测固体障碍物（bush 不算）
      if (!solidTypes.includes(obs.type)) continue;
      
      const overlap = getOverlapArea(aiRect, obs);
      if (overlap && overlap.w * overlap.h > 100) { // 重叠面积 > 100px²
        errors.push({
          type: 'spawn_blocked',
          severity: 'error',
          message: `AI spawn [${ai}] @ (${aiSpawn.x}, ${aiSpawn.y}) 被 ${obs.type} [${oi}] 覆盖`,
          entities: [`ai_${ai}`, obs.id ?? `obs_${oi}`],
          location: { x: aiSpawn.x, y: aiSpawn.y },
          details: { obstacleIndex: oi, obstacleType: obs.type, isAI: true },
        });
        break; // 每个 AI spawn 只报告一次
      }
    }
  }
  
  // ============================================================
  // 3. 撤离点被固体障碍物覆盖检测 (error/warning)
  // ============================================================
  if (template.mapConfig.extractZone) {
    const extractZone = template.mapConfig.extractZone;
    
    // 撤离点越界检测
    if (extractZone.x < 0 || extractZone.y < 0 || 
        extractZone.x + extractZone.w > width || extractZone.y + extractZone.h > height) {
      errors.push({
        type: 'out_of_bounds',
        severity: 'error',
        message: `撤离点越界: (${extractZone.x}, ${extractZone.y}) ${extractZone.w}x${extractZone.h}`,
        entities: ['extractZone'],
        location: extractZone,
      });
    }
    
    // 撤离点被覆盖检测
    for (let i = 0; i < template.obstacles.length; i++) {
      const obs = template.obstacles[i];
      if (!solidTypes.includes(obs.type)) continue;
      
      const overlap = getOverlapArea(extractZone, obs);
      if (overlap) {
        const extractArea = extractZone.w * extractZone.h;
        const overlapArea = overlap.w * overlap.h;
        const overlapPercent = (overlapArea / extractArea) * 100;
        
        // 覆盖超过 30% 是 error，否则是 warning
        const severity: LintSeverity = overlapPercent > 30 ? 'error' : 'warning';
        const issue: LintIssue = {
          type: 'extract_blocked',
          severity,
          message: `撤离点被 ${obs.type} [${i}] 覆盖 ${overlapPercent.toFixed(1)}%`,
          entities: ['extractZone', obs.id ?? `obs_${i}`],
          location: overlap,
          details: { overlapPercent, obstacleIndex: i },
        };
        
        if (severity === 'error') {
          errors.push(issue);
        } else {
          warnings.push(issue);
        }
      }
    }
  }
  
  // ============================================================
  // 4. 障碍物之间的重叠检测 (warning，过滤小重叠和 roomgroup 内部墙角)
  // ============================================================
  
  // 构建 roomgroup 索引范围，用于判断两个障碍物是否属于同一个 roomgroup
  const roomGroupRanges: Array<{ start: number; end: number }> = [];
  for (const { startObstacleIndex } of roomGroups) {
    const nextStart = roomGroups.find(rg => rg.startObstacleIndex > startObstacleIndex)?.startObstacleIndex 
      ?? template.obstacles.length;
    roomGroupRanges.push({ start: startObstacleIndex, end: nextStart });
  }
  
  // 判断两个索引是否在同一个 roomgroup 内
  const inSameRoomGroup = (idxA: number, idxB: number): boolean => {
    for (const range of roomGroupRanges) {
      if (idxA >= range.start && idxA < range.end && idxB >= range.start && idxB < range.end) {
        return true;
      }
    }
    return false;
  };
  
  for (let i = 0; i < template.obstacles.length; i++) {
    for (let j = i + 1; j < template.obstacles.length; j++) {
      const obsA = template.obstacles[i];
      const obsB = template.obstacles[j];
      
      const overlap = getOverlapArea(obsA, obsB);
      if (overlap) {
        const areaA = obsA.w * obsA.h;
        const areaB = obsB.w * obsB.h;
        const overlapArea = overlap.w * overlap.h;
        const percentA = (overlapArea / areaA) * 100;
        const percentB = (overlapArea / areaB) * 100;
        const maxPercent = Math.max(percentA, percentB);
        
        // 过滤小重叠（roomgroup 角落的有意重叠）
        if (overlapArea < 500 && maxPercent < 30) continue;
        
        // 过滤同一 roomgroup 内的墙角重叠（wall-wall 且重叠面积小）
        if (obsA.type === 'wall' && obsB.type === 'wall' && 
            inSameRoomGroup(i, j) && overlapArea <= 400) {
          continue;
        }
        
        // 过滤同一 roomgroup 内的墙-门重叠（走廊入口处的正常重叠）
        const isWallDoorPair = (obsA.type === 'wall' && obsB.type === 'door_closed') ||
                               (obsA.type === 'door_closed' && obsB.type === 'wall');
        if (isWallDoorPair && inSameRoomGroup(i, j)) {
          continue;
        }
        
        warnings.push({
          type: 'obstacle_overlap',
          severity: 'warning',
          message: `障碍物重叠: ${obsA.type} [${i}] <-> ${obsB.type} [${j}]，面积 ${overlapArea}px² (${maxPercent.toFixed(1)}%)`,
          entities: [obsA.id ?? `obs_${i}`, obsB.id ?? `obs_${j}`],
          location: overlap,
          details: { 
            indexA: i, indexB: j,
            percentA: percentA.toFixed(1), 
            percentB: percentB.toFixed(1),
          },
        });
      }
    }
  }
  
  // ============================================================
  // 5. 草丛在室内检测 (warning)
  // ============================================================
  for (let i = 0; i < template.obstacles.length; i++) {
    const obs = template.obstacles[i];
    if (obs.type !== 'bush') continue;
    
    const centerX = obs.x + obs.w / 2;
    const centerY = obs.y + obs.h / 2;
    
    for (const room of roomBounds) {
      if (pointInRect(centerX, centerY, room)) {
        warnings.push({
          type: 'bush_indoor',
          severity: 'warning',
          message: `草丛 [${i}] 位于室内 (${room.groupId})`,
          entities: [obs.id ?? `obs_${i}`],
          location: { x: obs.x, y: obs.y, w: obs.w, h: obs.h },
          details: { roomGroupId: room.groupId },
        });
        break;
      }
    }
  }
  
  // ============================================================
  // 6. 宝箱与墙壁重叠检测 (warning)
  // ============================================================
  for (let i = 0; i < template.obstacles.length; i++) {
    const chest = template.obstacles[i];
    if (!chestTypes.includes(chest.type)) continue;
    
    for (let j = 0; j < template.obstacles.length; j++) {
      if (i === j) continue;
      const wall = template.obstacles[j];
      if (!wallTypes.includes(wall.type)) continue;
      
      const overlap = getOverlapArea(chest, wall);
      if (overlap) {
        warnings.push({
          type: 'chest_wall_overlap',
          severity: 'warning',
          message: `宝箱 ${chest.type} [${i}] 与墙壁 [${j}] 重叠`,
          entities: [chest.id ?? `obs_${i}`, wall.id ?? `obs_${j}`],
          location: overlap,
          details: { chestIndex: i, wallIndex: j },
        });
      }
    }
  }
  
  // ============================================================
  // 7. 房间组封闭检测 (error)
  // ============================================================
  for (const { group } of roomGroups) {
    const roomRects = calculateRoomRects(group);
    let hasExternalDoor = false;
    
    for (let i = 0; i < group.rooms.length; i++) {
      const room = group.rooms[i];
      const rect = roomRects[i];
      const doors = room.doors.toLowerCase();
      const externalWalls = detectExternalWalls(rect, i, roomRects);
      
      if ((externalWalls.north && doors.includes('n')) ||
          (externalWalls.south && doors.includes('s')) ||
          (externalWalls.east && doors.includes('e')) ||
          (externalWalls.west && doors.includes('w'))) {
        hasExternalDoor = true;
        break;
      }
    }
    
    if (!hasExternalDoor) {
      const gx = group.x ?? 0;
      const gy = group.y ?? 0;
      errors.push({
        type: 'roomgroup_sealed',
        severity: 'error',
        message: `房间组 @ (${gx}, ${gy}) 封闭无外部入口`,
        entities: group.rooms.map(r => r.id),
        location: { x: gx, y: gy },
        details: { 
          layout: group.layout,
          roomCount: group.rooms.length,
          rooms: group.rooms.map(r => ({ id: r.id, doors: r.doors })),
        },
      });
    }
  }
  
  // ============================================================
  // 8. 门口净空检测 (warning) - 检测门前是否被堵
  // ============================================================
  const DOOR_CLEARANCE = 60; // 门前需要的净空距离
  for (let i = 0; i < template.obstacles.length; i++) {
    const door = template.obstacles[i];
    if (door.type !== 'door_closed') continue;
    
    // 判断门的朝向（水平门还是垂直门）
    const isHorizontal = door.w > door.h;
    
    // 计算门前净空区域
    const clearanceZones: Array<{ x: number; y: number; w: number; h: number; side: string }> = [];
    if (isHorizontal) {
      // 水平门：检测上下两侧
      clearanceZones.push({
        x: door.x, y: door.y - DOOR_CLEARANCE, w: door.w, h: DOOR_CLEARANCE,
        side: 'north',
      });
      clearanceZones.push({
        x: door.x, y: door.y + door.h, w: door.w, h: DOOR_CLEARANCE,
        side: 'south',
      });
    } else {
      // 垂直门：检测左右两侧
      clearanceZones.push({
        x: door.x - DOOR_CLEARANCE, y: door.y, w: DOOR_CLEARANCE, h: door.h,
        side: 'west',
      });
      clearanceZones.push({
        x: door.x + door.w, y: door.y, w: DOOR_CLEARANCE, h: door.h,
        side: 'east',
      });
    }
    
    for (const zone of clearanceZones) {
      for (let j = 0; j < template.obstacles.length; j++) {
        if (i === j) continue;
        const obs = template.obstacles[j];
        // 只检测固体障碍物，排除 bush 和其他门
        if (!solidTypes.includes(obs.type) || obs.type === 'door_closed') continue;
        
        const overlap = getOverlapArea(zone, obs);
        if (overlap && overlap.w * overlap.h > 200) {
          warnings.push({
            type: 'door_blocked',
            severity: 'warning',
            message: `门 [${i}] 的 ${zone.side} 侧被 ${obs.type} [${j}] 堵住`,
            entities: [door.id ?? `obs_${i}`, obs.id ?? `obs_${j}`],
            location: { x: door.x, y: door.y, w: door.w, h: door.h },
            details: { doorIndex: i, blockerIndex: j, side: zone.side },
          });
          break; // 每侧只报告一次
        }
      }
    }
  }
  
  return {
    mapId: template.id,
    mapName: template.name,
    errors,
    warnings,
    summary: {
      totalIssues: errors.length + warnings.length,
      errorCount: errors.length,
      warningCount: warnings.length,
    },
  };
}

/**
 * 格式化 LintResult 为可读字符串（用于控制台输出）
 */
export function formatLintResult(result: LintResult): string {
  const lines: string[] = [];
  
  if (result.summary.totalIssues === 0) {
    lines.push(`✅ 地图 "${result.mapId}" 检测通过，无问题`);
    return lines.join('\n');
  }
  
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push(`📍 地图 "${result.mapId}" (${result.mapName || 'unnamed'}) 检测结果:`);
  lines.push(`   ${result.summary.errorCount} 个错误, ${result.summary.warningCount} 个警告`);
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  let index = 1;
  
  // 先输出错误
  for (const issue of result.errors) {
    lines.push(`${index}. ❌ [ERROR] ${issue.message}`);
    index++;
  }
  
  // 再输出警告
  for (const issue of result.warnings) {
    lines.push(`${index}. ⚠️  [WARN] ${issue.message}`);
    index++;
  }
  
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  if (result.summary.errorCount > 0) {
    lines.push('💡 提示: 存在错误，地图可能无法正常游玩');
  } else {
    lines.push('💡 提示: 仅有警告，建议修复以提升地图质量');
  }
  
  return lines.join('\n');
}

/**
 * 检测地图模板中的区域重叠并输出警告（兼容旧接口）
 * @deprecated 请使用 lintMap() 获取结构化结果
 */
function detectOverlaps(template: MapTemplate, roomGroups: Array<{ group: RoomGroup; startObstacleIndex: number }> = []): void {
  const result = lintMap(template, roomGroups);
  
  if (result.summary.totalIssues > 0) {
    console.warn('\n' + formatLintResult(result) + '\n');
  }
}

/**
 * 验证 RoomGroup 的可达性（检测是否有外部入口）
 * @deprecated 已整合到 lintMap() 中
 */
function validateRoomGroupAccessibility(_roomGroups: Array<{ group: RoomGroup; startObstacleIndex: number }>): void {
  // 现在由 lintMap 处理，这里保留空实现以兼容
}

/**
 * Room Group 辅助函数：计算每个房间的实际坐标和尺寸
 */
function calculateRoomRects(group: RoomGroup): Array<{ x: number; y: number; w: number; h: number }> {
  const { layout, cellW, cellH, cols, rooms } = group;
  const x = group.x ?? 0;
  const y = group.y ?? 0;
  const rects: Array<{ x: number; y: number; w: number; h: number }> = [];
  
  if (layout === 'horizontal') {
    let currentX = x;
    for (const room of rooms) {
      const w = room.w ?? cellW ?? 300;
      const h = cellH ?? 300;
      rects.push({ x: currentX, y, w, h });
      currentX += w;
    }
  } else if (layout === 'vertical') {
    let currentY = y;
    for (const room of rooms) {
      const w = cellW ?? 300;
      const h = room.h ?? cellH ?? 300;
      rects.push({ x, y: currentY, w, h });
      currentY += h;
    }
  } else if (layout === 'corridor') {
    // 走廊布局：房间沿走廊排列
    const cw = cellW ?? 300;
    const ch = cellH ?? 300;
    const corridorWidth = group.corridorWidth ?? 100;
    const side = group.corridorSide ?? 'both';
    
    // 计算走廊的 Y 位置
    let corridorY = y;
    if (side === 'north' || side === 'both') {
      corridorY = y + ch; // 走廊在北侧房间下方
    }
    
    // 房间交替放置在走廊两侧
    let currentX = x;
    for (let i = 0; i < rooms.length; i++) {
      const room = rooms[i];
      const w = room.w ?? cw;
      
      // 决定房间在哪一侧
      let roomY: number;
      if (side === 'north') {
        roomY = y; // 所有房间在走廊北侧
      } else if (side === 'south') {
        roomY = y + corridorWidth; // 所有房间在走廊南侧
      } else {
        // both: 交替放置
        roomY = (i % 2 === 0) ? y : (y + ch + corridorWidth);
      }
      
      rects.push({ x: currentX, y: roomY, w, h: ch });
      currentX += w;
    }
  } else if (layout === 'grid') {
    const cw = cellW ?? 300;
    const ch = cellH ?? 300;
    const c = cols ?? 2;
    for (let i = 0; i < rooms.length; i++) {
      const row = Math.floor(i / c);
      const col = i % c;
      rects.push({
        x: x + col * cw,
        y: y + row * ch,
        w: cw,
        h: ch,
      });
    }
  }
  
  return rects;
}

/**
 * 检查两个矩形在X轴上是否有重叠
 */
function rectsOverlapX(a: { x: number; w: number }, b: { x: number; w: number }): boolean {
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x);
}

/**
 * 检查两个矩形在Y轴上是否有重叠
 */
function rectsOverlapY(a: { y: number; h: number }, b: { y: number; h: number }): boolean {
  return !(a.y + a.h <= b.y || b.y + b.h <= a.y);
}

/**
 * 检测某个房间的哪些墙是外墙（不与其他房间共享）
 */
function detectExternalWalls(
  rect: { x: number; y: number; w: number; h: number },
  index: number,
  allRects: Array<{ x: number; y: number; w: number; h: number }>
): { north: boolean; south: boolean; east: boolean; west: boolean } {
  const walls = { north: true, south: true, east: true, west: true };
  
  for (let i = 0; i < allRects.length; i++) {
    if (i === index) continue;
    const other = allRects[i];
    
    // 检测北侧是否有相邻房间（other在rect上方）
    if (Math.abs(rect.y - (other.y + other.h)) < 1 && rectsOverlapX(rect, other)) {
      walls.north = false;
    }
    // 南侧（other在rect下方）
    if (Math.abs((rect.y + rect.h) - other.y) < 1 && rectsOverlapX(rect, other)) {
      walls.south = false;
    }
    // 西侧（other在rect左侧）
    if (Math.abs(rect.x - (other.x + other.w)) < 1 && rectsOverlapY(rect, other)) {
      walls.west = false;
    }
    // 东侧（other在rect右侧）
    if (Math.abs((rect.x + rect.w) - other.x) < 1 && rectsOverlapY(rect, other)) {
      walls.east = false;
    }
  }
  
  return walls;
}

/**
 * 生成单段墙体（可选带门）
 */
function generateWallSegmentWithDoor(
  obstacles: any[],
  x: number,
  y: number,
  w: number,
  h: number,
  hasDoor: boolean,
  doorWidth: number
): void {
  if (!hasDoor) {
    // 无门，整段墙
    obstacles.push({
      id: `wall_${obstacles.length}`,
      x, y, w, h,
      type: 'wall',
    });
  } else {
    // 有门，分成三段：墙-门-墙
    if (w > h) {
      // 水平墙
      const wallW = (w - doorWidth) / 2;
      if (wallW > 0) {
        obstacles.push({ id: `wall_${obstacles.length}`, x, y, w: wallW, h, type: 'wall' });
        obstacles.push({
          id: `door_${obstacles.length}`,
          x: x + wallW,
          y,
          w: doorWidth,
          h,
          type: 'door_closed',
          hp: 100,
          maxHp: 100,
        });
        obstacles.push({ id: `wall_${obstacles.length}`, x: x + wallW + doorWidth, y, w: wallW, h, type: 'wall' });
      }
    } else {
      // 垂直墙
      const wallH = (h - doorWidth) / 2;
      if (wallH > 0) {
        obstacles.push({ id: `wall_${obstacles.length}`, x, y, w, h: wallH, type: 'wall' });
        obstacles.push({
          id: `door_${obstacles.length}`,
          x,
          y: y + wallH,
          w,
          h: doorWidth,
          type: 'door_closed',
          hp: 100,
          maxHp: 100,
        });
        obstacles.push({ id: `wall_${obstacles.length}`, x, y: y + wallH + doorWidth, w, h: wallH, type: 'wall' });
      }
    }
  }
}

/**
 * 为某个房间的某一侧生成墙体（带门）
 */
function generateWallWithDoor(
  obstacles: any[],
  rect: { x: number; y: number; w: number; h: number },
  side: 'north' | 'south' | 'east' | 'west',
  hasDoor: boolean,
  wallThickness: number,
  doorWidth: number
): void {
  if (side === 'north') {
    generateWallSegmentWithDoor(obstacles, rect.x, rect.y, rect.w, wallThickness, hasDoor, doorWidth);
  } else if (side === 'south') {
    generateWallSegmentWithDoor(obstacles, rect.x, rect.y + rect.h - wallThickness, rect.w, wallThickness, hasDoor, doorWidth);
  } else if (side === 'west') {
    generateWallSegmentWithDoor(obstacles, rect.x, rect.y, wallThickness, rect.h, hasDoor, doorWidth);
  } else if (side === 'east') {
    generateWallSegmentWithDoor(obstacles, rect.x + rect.w - wallThickness, rect.y, wallThickness, rect.h, hasDoor, doorWidth);
  }
}

/**
 * 生成共享墙（两个房间之间的墙）
 */
function generateSharedWalls(
  obstacles: any[],
  rects: Array<{ x: number; y: number; w: number; h: number }>,
  rooms: RoomDef[],
  wallThickness: number,
  doorWidth: number
): void {
  // 检测所有相邻房间对，生成共享墙
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const r1 = rects[i];
      const r2 = rects[j];
      const room1 = rooms[i];
      const room2 = rooms[j];
      
      // 垂直共享墙 (r1在左，r2在右)
      if (Math.abs((r1.x + r1.w) - r2.x) < 1 && rectsOverlapY(r1, r2)) {
        const overlapY = Math.max(r1.y, r2.y);
        const overlapH = Math.min(r1.y + r1.h, r2.y + r2.h) - overlapY;
        const hasDoor = room1.doors.includes('e') || room2.doors.includes('w');
        
        const wallX = r1.x + r1.w - wallThickness / 2;
        generateWallSegmentWithDoor(obstacles, wallX, overlapY, wallThickness, overlapH, hasDoor, doorWidth);
      }
      
      // 水平共享墙 (r1在上，r2在下)
      if (Math.abs((r1.y + r1.h) - r2.y) < 1 && rectsOverlapX(r1, r2)) {
        const overlapX = Math.max(r1.x, r2.x);
        const overlapW = Math.min(r1.x + r1.w, r2.x + r2.w) - overlapX;
        const hasDoor = room1.doors.includes('s') || room2.doors.includes('n');
        
        const wallY = r1.y + r1.h - wallThickness / 2;
        generateWallSegmentWithDoor(obstacles, overlapX, wallY, overlapW, wallThickness, hasDoor, doorWidth);
      }
    }
  }
}

/**
 * 根据 RoomGroup 定义生成所有墙体和门
 */
function generateRoomGroupWalls(group: RoomGroup): any[] {
  const obstacles: any[] = [];
  const { wallThickness, doorWidth, rooms, layout } = group;
  
  // 计算每个房间的实际坐标和尺寸
  const roomRects = calculateRoomRects(group);
  
  // 走廊布局需要特殊处理
  if (layout === 'corridor') {
    return generateCorridorWalls(group, roomRects);
  }
  
  // 生成所有房间的外墙
  for (let i = 0; i < rooms.length; i++) {
    const room = rooms[i];
    const rect = roomRects[i];
    const doors = room.doors.toLowerCase();
    
    // 检测哪些墙是外墙（不与其他房间共享）
    const walls = detectExternalWalls(rect, i, roomRects);
    
    // 生成外墙
    if (walls.north) {
      generateWallWithDoor(obstacles, rect, 'north', doors.includes('n'), wallThickness, doorWidth);
    }
    if (walls.south) {
      generateWallWithDoor(obstacles, rect, 'south', doors.includes('s'), wallThickness, doorWidth);
    }
    if (walls.west) {
      generateWallWithDoor(obstacles, rect, 'west', doors.includes('w'), wallThickness, doorWidth);
    }
    if (walls.east) {
      generateWallWithDoor(obstacles, rect, 'east', doors.includes('e'), wallThickness, doorWidth);
    }
  }
  
  // 生成共享墙（位于两个房间之间）
  generateSharedWalls(obstacles, roomRects, rooms, wallThickness, doorWidth);
  
  return obstacles;
}

/**
 * 为走廊布局生成墙壁
 * 走廊布局：中间是走廊，两侧是房间
 */
function generateCorridorWalls(
  group: RoomGroup,
  roomRects: Array<{ x: number; y: number; w: number; h: number }>
): any[] {
  const obstacles: any[] = [];
  const { wallThickness, doorWidth, rooms } = group;
  const x = group.x ?? 0;
  const y = group.y ?? 0;
  const cellH = group.cellH ?? 300;
  const corridorWidth = group.corridorWidth ?? 100;
  const side = group.corridorSide ?? 'both';
  
  // 计算走廊的位置
  let corridorY = y;
  if (side === 'north' || side === 'both') {
    corridorY = y + cellH;
  }
  
  // 计算走廊长度
  let corridorLength = 0;
  for (const room of rooms) {
    corridorLength += room.w ?? group.cellW ?? 300;
  }
  
  // 生成走廊的外墙（东西两端）
  // 西端墙（带门作为入口）
  const westDoorY = corridorY + Math.max(0, (corridorWidth - doorWidth) / 2);
  const westWallTopH = Math.max(wallThickness, (corridorWidth - doorWidth) / 2);
  const westWallBottomH = Math.max(wallThickness, (corridorWidth - doorWidth) / 2);
  
  if (westWallTopH > 0) {
    obstacles.push({
      id: `wall_${obstacles.length}`,
      x: x,
      y: corridorY,
      w: wallThickness,
      h: westWallTopH,
      type: 'wall',
    });
  }
  obstacles.push({
    id: `door_${obstacles.length}`,
    x: x,
    y: westDoorY,
    w: wallThickness,
    h: Math.min(doorWidth, corridorWidth),
    type: 'door_closed',
    hp: 100,
    maxHp: 100,
  });
  if (westWallBottomH > 0) {
    obstacles.push({
      id: `wall_${obstacles.length}`,
      x: x,
      y: westDoorY + Math.min(doorWidth, corridorWidth),
      w: wallThickness,
      h: westWallBottomH,
      type: 'wall',
    });
  }
  
  // 东端墙（带门作为入口）
  const eastDoorY = corridorY + Math.max(0, (corridorWidth - doorWidth) / 2);
  if (westWallTopH > 0) {
    obstacles.push({
      id: `wall_${obstacles.length}`,
      x: x + corridorLength - wallThickness,
      y: corridorY,
      w: wallThickness,
      h: westWallTopH,
      type: 'wall',
    });
  }
  obstacles.push({
    id: `door_${obstacles.length}`,
    x: x + corridorLength - wallThickness,
    y: eastDoorY,
    w: wallThickness,
    h: Math.min(doorWidth, corridorWidth),
    type: 'door_closed',
    hp: 100,
    maxHp: 100,
  });
  if (westWallBottomH > 0) {
    obstacles.push({
      id: `wall_${obstacles.length}`,
      x: x + corridorLength - wallThickness,
      y: eastDoorY + Math.min(doorWidth, corridorWidth),
      w: wallThickness,
      h: westWallBottomH,
      type: 'wall',
    });
  }
  
  // 生成每个房间的墙壁
  for (let i = 0; i < rooms.length; i++) {
    const room = rooms[i];
    const rect = roomRects[i];
    const doors = room.doors.toLowerCase();
    
    // 判断房间在走廊的哪一侧
    const isNorthSide = rect.y < corridorY;
    
    // 生成房间的外墙
    // 北墙
    if (isNorthSide) {
      generateWallWithDoor(obstacles, rect, 'north', doors.includes('n'), wallThickness, doorWidth);
    } else {
      // 南侧房间的北墙面向走廊，需要门
      generateWallWithDoor(obstacles, rect, 'north', true, wallThickness, doorWidth);
    }
    
    // 南墙
    if (!isNorthSide) {
      generateWallWithDoor(obstacles, rect, 'south', doors.includes('s'), wallThickness, doorWidth);
    } else {
      // 北侧房间的南墙面向走廊，需要门
      generateWallWithDoor(obstacles, rect, 'south', true, wallThickness, doorWidth);
    }
    
    // 西墙（如果是第一个房间或与前一个房间不相邻）
    const prevRect = i > 0 ? roomRects[i - 1] : null;
    const shareWestWall = prevRect && Math.abs(rect.x - (prevRect.x + prevRect.w)) < 1 && rect.y === prevRect.y;
    if (!shareWestWall) {
      generateWallWithDoor(obstacles, rect, 'west', doors.includes('w'), wallThickness, doorWidth);
    }
    
    // 东墙（如果是最后一个房间或与下一个房间不相邻）
    const nextRect = i < roomRects.length - 1 ? roomRects[i + 1] : null;
    const shareEastWall = nextRect && Math.abs((rect.x + rect.w) - nextRect.x) < 1 && rect.y === nextRect.y;
    if (!shareEastWall) {
      generateWallWithDoor(obstacles, rect, 'east', doors.includes('e'), wallThickness, doorWidth);
    }
  }
  
  // 生成同侧相邻房间之间的共享墙
  for (let i = 0; i < roomRects.length - 1; i++) {
    const r1 = roomRects[i];
    const r2 = roomRects[i + 1];
    
    // 只处理同一侧的相邻房间
    if (r1.y !== r2.y) continue;
    if (Math.abs((r1.x + r1.w) - r2.x) >= 1) continue;
    
    const room1 = rooms[i];
    const room2 = rooms[i + 1];
    const hasDoor = room1.doors.includes('e') || room2.doors.includes('w');
    
    generateWallSegmentWithDoor(
      obstacles,
      r1.x + r1.w - wallThickness / 2,
      r1.y,
      wallThickness,
      r1.h,
      hasDoor,
      doorWidth
    );
  }
  
  return obstacles;
}

/**
 * 解析 @roomgroup 指令及其子房间定义
 * 支持两种定位方式：
 * 1. 绝对坐标：x=100 y=200
 * 2. 相对定位：anchor=center margin=60
 */
function parseRoomGroup(
  tokens: string[],
  lines: string[],
  currentIndex: number,
  lineNumber: number,
  layoutCtx?: LayoutContext
): { roomGroup: RoomGroup; endLineIndex: number } {
  const { kv } = parseKeyValues(tokens);
  
  // 解析基础参数
  const layout = (kv.layout as RoomGroupLayout) || 'horizontal';
  
  // 解析房间定义（读取后续缩进行）
  const rooms: RoomDef[] = [];
  let endLineIndex = currentIndex;
  
  // 解析默认地板类型
  const defaultFloorType = kv.floortype || kv.floor || 'tile';
  
  for (let i = currentIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    if (!trimmed || trimmed.startsWith('#')) {
      endLineIndex = i;
      continue;
    }
    
    // 检查是否为缩进行（房间定义）
    if (!line.startsWith(' ') && !line.startsWith('\t')) {
      // 非缩进行，roomgroup定义结束
      break;
    }
    
    // 解析房间定义: "room1: w=300 doors=e floor=wood"
    const match = trimmed.match(/^(\w+):\s*(.+)$/);
    if (!match) {
      endLineIndex = i;
      continue;
    }
    
    const roomId = match[1];
    const roomTokens = splitTokens(match[2]);
    const roomKv = parseKeyValues(roomTokens).kv;
    
    rooms.push({
      id: roomId,
      w: roomKv.w ? parseNumber(roomKv.w, i + 1, 'room.w') : undefined,
      h: roomKv.h ? parseNumber(roomKv.h, i + 1, 'room.h') : undefined,
      doors: roomKv.doors || '',
      floorType: (roomKv.floor || roomKv.floortype) as any || undefined,
    });
    
    endLineIndex = i;
  }
  
  // 解析位置参数
  const hasAbsolutePos = kv.x !== undefined && kv.y !== undefined;
  const hasAnchor = kv.anchor !== undefined;
  const margin = kv.margin ? parseNumber(kv.margin, lineNumber, 'margin') : 0;
  
  // 构建部分 RoomGroup（用于计算尺寸）
  const partialGroup = {
    layout,
    cellW: kv.cellw ? parseNumber(kv.cellw, lineNumber, 'cellW') : undefined,
    cellH: kv.cellh ? parseNumber(kv.cellh, lineNumber, 'cellH') : undefined,
    cols: kv.cols ? parseNumber(kv.cols, lineNumber, 'cols') : undefined,
    rows: kv.rows ? parseNumber(kv.rows, lineNumber, 'rows') : undefined,
    margin,
    anchor: kv.anchor as AnchorType | undefined,
    rooms,
  };
  
  // 解析位置
  let x: number;
  let y: number;
  
  if (hasAbsolutePos) {
    x = parseNumber(kv.x, lineNumber, 'roomgroup.x');
    y = parseNumber(kv.y, lineNumber, 'roomgroup.y');
  } else if (hasAnchor && layoutCtx) {
    // 使用布局器计算位置
    const pos = resolveRoomGroupPosition(
      { ...partialGroup, x: undefined, y: undefined },
      layoutCtx,
      lineNumber
    );
    x = pos.x;
    y = pos.y;
  } else if (hasAnchor && !layoutCtx) {
    throw new Error(`Line ${lineNumber}: 使用 anchor 定位需要先定义 @map 指令`);
  } else {
    throw new Error(`Line ${lineNumber}: roomgroup 必须指定 x,y 坐标或 anchor 锚点`);
  }
  
  const roomGroup: RoomGroup = {
    layout,
    x, 
    y,
    cellW: partialGroup.cellW,
    cellH: partialGroup.cellH,
    cols: partialGroup.cols,
    rows: partialGroup.rows,
    wallThickness: kv.wallthickness ? parseNumber(kv.wallthickness, lineNumber, 'wallThickness') : 20,
    doorWidth: kv.doorwidth ? parseNumber(kv.doorwidth, lineNumber, 'doorWidth') : 120,
    id: kv.id,
    margin,
    floorType: defaultFloorType as any,
    rooms,
  };
  
  return {
    roomGroup,
    endLineIndex,
  };
}


export function createDefaultMapTemplate(id: string = 'default'): MapTemplate {
  return {
    id,
    mapConfig: { ...DEFAULT_MAP_CONFIG },
    obstacles: [],
    spawns: [],
    pois: [],
    zones: [],
    rooms: [], // 新增: 房间列表
    aiSpawns: [],
    itemRespawns: [],
    aiRespawn: undefined,
  };
}

export function parseMapTemplateText(text: string): MapTemplate {
  const template = createDefaultMapTemplate();
  const roomGroups: Array<{ group: RoomGroup; startObstacleIndex: number }> = []; // 跟踪所有房间组
  
  // 布局上下文：在 @map 指令解析后创建，用于 anchor 定位
  let layoutCtx: LayoutContext | undefined;

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    const tokenized = parseTokens(lines[i], lineNumber);
    if (!tokenized) {
      continue;
    }
    const { directive, tokens } = tokenized;

    if (directive === '@meta') {
      const { kv } = parseKeyValues(tokens);
      if (kv.id) {
        template.id = kv.id;
      }
      if (kv.name) {
        template.name = kv.name;
      }
      if (kv.description || kv.desc) {
        template.description = kv.description || kv.desc;
      }
    } else if (directive === '@map') {
      const { kv, positionals } = parseKeyValues(tokens);
      if (positionals.length >= 2) {
        template.mapConfig.width = parseNumber(positionals[0], lineNumber, 'width');
        template.mapConfig.height = parseNumber(positionals[1], lineNumber, 'height');
        if (positionals.length >= 3) {
          template.mapConfig.seed = parseNumber(positionals[2], lineNumber, 'seed');
        }
      } else {
        if (kv.width) template.mapConfig.width = parseNumber(kv.width, lineNumber, 'width');
        if (kv.height) template.mapConfig.height = parseNumber(kv.height, lineNumber, 'height');
        if (kv.seed) template.mapConfig.seed = parseNumber(kv.seed, lineNumber, 'seed');
      }
      
      // 创建布局上下文（用于 anchor 定位）
      layoutCtx = {
        mapWidth: template.mapConfig.width,
        mapHeight: template.mapConfig.height,
        placedBlocks: [],
        extractZone: undefined,
      };
    } else if (directive === '@extract') {
      template.mapConfig.extractZone = parseRect(tokens, lineNumber, {
        x: 'extract.x',
        y: 'extract.y',
        w: 'extract.w',
        h: 'extract.h',
      });
      
      // 更新布局上下文的撤离区（用于避让）
      if (layoutCtx) {
        layoutCtx.extractZone = template.mapConfig.extractZone;
      }
    } else if (directive === '@obstacle') {
      // 注意：障碍物行通常是这种形式：
      // @obstacle x=850 y=850 w=300 h=300 type=wall
      // 也就是全部是 key=value，没有位置参数。
      // 之前错误地只把 positionals 传给 parseRect，导致 x/y/w/h 解析成空字符串，
      // Number('') === 0，从而在 Zod 校验时触发 "Number must be greater than 0"。
      const { kv } = parseKeyValues(tokens);
      const rect = parseRect(tokens, lineNumber, {
        x: 'obstacle.x',
        y: 'obstacle.y',
        w: 'obstacle.w',
        h: 'obstacle.h',
      });
      const obstacle: any = {
        ...rect,
        id: kv.id || `obstacle_${template.obstacles.length}`,
        type: kv.type || 'wall',
        hp: kv.hp ? parseNumber(kv.hp, lineNumber, 'obstacle.hp') : undefined,
        maxHp: kv.maxhp ? parseNumber(kv.maxhp, lineNumber, 'obstacle.maxHp') : undefined,
        // 额外属性
        doorTargetId: kv.doortargetid || kv.targetid || undefined,
        doorLocked: kv.doorlocked === 'true' || kv.locked === 'true',
        doorKeyId: kv.doorkeyid || kv.keyid || undefined,
        doorOpen: kv.dooropen === 'true' || kv.open === 'true',
        doorAutoClose: kv.doorautoclose === 'true' || kv.autoclose === 'true',
        doorAutoCloseDelay: kv.doorautoclosedelay ? parseNumber(kv.doorautoclosedelay, lineNumber, 'obstacle.doorAutoCloseDelay') : undefined,
        doorOpenSound: kv.dooropensound || undefined,
        doorCloseSound: kv.doorclosesound || undefined,
        doorLockedSound: kv.doorlockedsound || undefined,
        doorUnlockSound: kv.doorunlocksound || undefined,
        chestItems: kv.chestitems ? kv.chestitems.split(',').map((s: string) => s.trim()) : undefined,
        chestCapacity: kv.chestcapacity ? parseNumber(kv.chestcapacity, lineNumber, 'obstacle.chestCapacity') : undefined,
        chestRespawnDelay: kv.chestrespawndelay ? parseNumber(kv.chestrespawndelay, lineNumber, 'obstacle.chestRespawnDelay') : undefined,
        chestRespawnCount: kv.chestrespawncount ? parseNumber(kv.chestrespawncount, lineNumber, 'obstacle.chestRespawnCount') : undefined,
        chestLootTable: kv.chestloottable || undefined,
        chestRarityWeights: kv.chestrarityweights || undefined,
        supplyStackItems: kv.supplysitems ? kv.supplysitems.split(',').map((s: string) => s.trim()) : undefined,
        supplyStackCapacity: kv.supplyscapacity ? parseNumber(kv.supplyscapacity, lineNumber, 'obstacle.supplyStackCapacity') : undefined,
        supplyStackRespawnDelay: kv.supplysrespawndelay ? parseNumber(kv.supplysrespawndelay, lineNumber, 'obstacle.supplyStackRespawnDelay') : undefined,
        supplyStackRespawnCount: kv.supplysrespawncount ? parseNumber(kv.supplysrespawncount, lineNumber, 'obstacle.supplyStackRespawnCount') : undefined,
        supplyStackLootTable: kv.supplysloottable || undefined,
        supplyStackRarityWeights: kv.supplysrarityweights || undefined,
      };

      const type = obstacle.type;
      
      // 为可破坏物体初始化hp（如果地图文件中没有指定）
      if (!obstacle.hp || !obstacle.maxHp) {
        if (type === 'crate') {
          obstacle.hp = 100;
          obstacle.maxHp = 100;
        } else if (type === 'door_closed' || type === 'door') {
          obstacle.type = 'door_closed';
          obstacle.hp = 100;
          obstacle.maxHp = 100;
        } else if (type === 'glass') {
          obstacle.hp = 30;
          obstacle.maxHp = 30;
        } else if (type === 'chest_closed' || type === 'chest') {
          obstacle.type = 'chest_closed';
          obstacle.hp = 100;
          obstacle.maxHp = 100;
        } else if (type === 'weapon_crate' || type === 'throwable_crate' || type === 'medical_crate' || type === 'equipment_crate') {
          obstacle.hp = 100;
          obstacle.maxHp = 100;
        } else if (type === 'vehicle') {
          obstacle.hp = 150;
          obstacle.maxHp = 150;
        } else if (type === 'supply_stack') {
          obstacle.hp = 100;
          obstacle.maxHp = 100;
        } else if (type === 'fence_wood') {
          obstacle.hp = 50;
          obstacle.maxHp = 50;
        } else if (type === 'fence_metal') {
          obstacle.hp = 100;
          obstacle.maxHp = 100;
        }
      }

      template.obstacles.push(obstacle);
    } else if (directive === '@spawn') {
      template.spawns.push(parsePoint(tokens, lineNumber));
    } else if (directive === '@poi') {
      // 新增: 解析 POI
      const { kv, positionals } = parseKeyValues(tokens);
      const poi: POI = {
        id: kv.id || `poi_${template.pois.length + 1}`,
        x: positionals.length >= 2 ? parseNumber(positionals[0], lineNumber, 'poi.x') : parseNumber(kv.x ?? '', lineNumber, 'poi.x'),
        y: positionals.length >= 2 ? parseNumber(positionals[1], lineNumber, 'poi.y') : parseNumber(kv.y ?? '', lineNumber, 'poi.y'),
        type: kv.type || 'generic',
        name: kv.name,
        description: kv.description || kv.desc,
      };
      template.pois.push(poi);
    } else if (directive === '@zone') {
      // 新增: 解析区域
      const rect = parseRect(tokens, lineNumber, {
        x: 'zone.x',
        y: 'zone.y',
        w: 'zone.w',
        h: 'zone.h',
      });
      const { kv } = parseKeyValues(tokens);
      const zone: Zone = {
        ...rect,
        id: kv.id || `zone_${template.zones.length + 1}`,
        type: kv.type || 'generic',
        name: kv.name,
        description: kv.description || kv.desc,
      };
      template.zones.push(zone);
    } else if (directive === '@room') {
      // 新增: 解析房间（生成四面墙和门）
      const { kv, positionals } = parseKeyValues(tokens);
      // 支持位置参数或kv参数
      const roomX = positionals.length >= 1 ? parseNumber(positionals[0], lineNumber, 'room.x') : parseNumber(kv.x ?? '', lineNumber, 'room.x');
      const roomY = positionals.length >= 2 ? parseNumber(positionals[1], lineNumber, 'room.y') : parseNumber(kv.y ?? '', lineNumber, 'room.y');
      const roomW = positionals.length >= 3 ? parseNumber(positionals[2], lineNumber, 'room.w') : parseNumber(kv.w ?? '', lineNumber, 'room.w');
      const roomH = positionals.length >= 4 ? parseNumber(positionals[3], lineNumber, 'room.h') : parseNumber(kv.h ?? '', lineNumber, 'room.h');
      
      const wallThickness = 20;
      const doorWidth = 120;
      const doorDirs = (kv.door || '').toLowerCase(); // n, s, e, w
      // Default to all walls if not specified. Format: walls=nsw (missing e) or walls=all or empty
      const wallsConfig = kv.walls ? kv.walls.toLowerCase() : 'nswe'; 
      
      const addWall = (x: number, y: number, w: number, h: number) => {
        template.obstacles.push({
          id: `roomwall_${template.obstacles.length}`,
          x, y, w, h,
          type: 'wall',
        });
      };

      const addDoor = (x: number, y: number, w: number, h: number) => {
        template.obstacles.push({
          id: `roomdoor_${template.obstacles.length}`,
          x, y, w, h,
          type: 'door_closed',
          hp: 100,
          maxHp: 100,
        });
      };

      // North Wall
      if (wallsConfig.includes('n')) {
        if (doorDirs.includes('n')) {
          const wallW = (roomW - doorWidth) / 2;
          addWall(roomX, roomY, wallW, wallThickness); // Left part
          addDoor(roomX + wallW, roomY, doorWidth, wallThickness); // Door
          addWall(roomX + wallW + doorWidth, roomY, wallW, wallThickness); // Right part
        } else {
          addWall(roomX, roomY, roomW, wallThickness);
        }
      }

      // South Wall
      if (wallsConfig.includes('s')) {
        if (doorDirs.includes('s')) {
          const wallW = (roomW - doorWidth) / 2;
          const y = roomY + roomH - wallThickness;
          addWall(roomX, y, wallW, wallThickness);
          addDoor(roomX + wallW, y, doorWidth, wallThickness);
          addWall(roomX + wallW + doorWidth, y, wallW, wallThickness);
        } else {
          addWall(roomX, roomY + roomH - wallThickness, roomW, wallThickness);
        }
      }

      // West Wall
      if (wallsConfig.includes('w')) {
        if (doorDirs.includes('w')) {
          const wallH = (roomH - doorWidth) / 2;
          addWall(roomX, roomY, wallThickness, wallH);
          addDoor(roomX, roomY + wallH, wallThickness, doorWidth);
          addWall(roomX, roomY + wallH + doorWidth, wallThickness, wallH);
        } else {
          addWall(roomX, roomY, wallThickness, roomH);
        }
      }

      // East Wall
      if (wallsConfig.includes('e')) {
        if (doorDirs.includes('e')) {
          const wallH = (roomH - doorWidth) / 2;
          const x = roomX + roomW - wallThickness;
          addWall(x, roomY, wallThickness, wallH);
          addDoor(x, roomY + wallH, wallThickness, doorWidth);
          addWall(x, roomY + wallH + doorWidth, wallThickness, wallH);
        } else {
          addWall(roomX + roomW - wallThickness, roomY, wallThickness, roomH);
        }
      }

    } else if (directive === '@roomgroup') {
      // 新增: 解析房间组（高级语法）
      const result = parseRoomGroup(tokens, lines, i, lineNumber, layoutCtx);
      const startObstacleIndex = template.obstacles.length; // 记录起始索引
      const obstacles = generateRoomGroupWalls(result.roomGroup);
      template.obstacles.push(...obstacles);
      // 跟踪房间组用于后续验证
      roomGroups.push({ group: result.roomGroup, startObstacleIndex });
      
      // 新增: 生成房间对象并添加到 template.rooms
      const roomRects = calculateRoomRects(result.roomGroup);
      for (let ri = 0; ri < result.roomGroup.rooms.length; ri++) {
        const roomDef = result.roomGroup.rooms[ri];
        const rect = roomRects[ri];
        const groupId = result.roomGroup.id || `roomgroup_${roomGroups.length - 1}`;
        
        // 解析门的位置信息
        const doorDirs = roomDef.doors.toLowerCase();
        const doors: Array<{ side: 'n' | 's' | 'e' | 'w'; position: number; isExternal: boolean }> = [];
        
        // 简化：假设门在中间位置（0.5），外部门标记为 true
        if (doorDirs.includes('n')) doors.push({ side: 'n', position: 0.5, isExternal: true });
        if (doorDirs.includes('s')) doors.push({ side: 's', position: 0.5, isExternal: true });
        if (doorDirs.includes('e')) doors.push({ side: 'e', position: 0.5, isExternal: true });
        if (doorDirs.includes('w')) doors.push({ side: 'w', position: 0.5, isExternal: true });
        
        template.rooms.push({
          id: `${groupId}_${roomDef.id}`,
          x: rect.x,
          y: rect.y,
          w: rect.w,
          h: rect.h,
          floorType: roomDef.floorType || result.roomGroup.floorType || 'tile',
          groupId: groupId,
          doors: doors,
        });
      }
      
      // 将 roomgroup 的边界框添加到布局上下文（用于后续 roomgroup 的避让）
      if (layoutCtx) {
        const size = calculateRoomGroupSize(result.roomGroup);
        const margin = result.roomGroup.margin ?? 0;
        const gx = result.roomGroup.x ?? 0;
        const gy = result.roomGroup.y ?? 0;
        layoutCtx.placedBlocks.push({
          x: gx - margin,
          y: gy - margin,
          w: size.w + margin * 2,
          h: size.h + margin * 2,
          id: result.roomGroup.id,
        });
      }
      
      // 跳过已读取的房间定义行
      i = result.endLineIndex;

    } else if (directive === '@aispawn' || directive === '@ai') {
      // 新增: 解析AI spawn点
      const { kv, positionals } = parseKeyValues(tokens);

      // 解析角色类型
      const role = (kv.role as AIRole) || 'basic';

      const aiSpawn: AISpawn = {
        x: positionals.length >= 2
          ? parseNumber(positionals[0], lineNumber, 'ai.x')
          : parseNumber(kv.x ?? '', lineNumber, 'ai.x'),
        y: positionals.length >= 2
          ? parseNumber(positionals[1], lineNumber, 'ai.y')
          : parseNumber(kv.y ?? '', lineNumber, 'ai.y'),
        type: kv.type === 'guard' ? 'guard' : 'patrol',
        role: role,
        weaponTypeId: kv.weapon || undefined, // 改为可选，未指定则使用角色预设
        count: kv.count ? parseNumber(kv.count, lineNumber, 'ai.count') : 1,
        visionRange: kv.vision ? parseNumber(kv.vision, lineNumber, 'ai.vision') : undefined,
        visionAngleDeg: kv.visionangle || kv.visionAngle
          ? parseNumber(kv.visionangle || kv.visionAngle, lineNumber, 'ai.visionAngle')
          : undefined,
        guardRadius: kv.radius ? parseNumber(kv.radius, lineNumber, 'ai.radius') : undefined,
        patrolPointIds: kv.patrol ? kv.patrol.split(',').map((s: string) => s.trim()) : undefined,
        hp: kv.hp ? parseNumber(kv.hp, lineNumber, 'ai.hp') : undefined,
        armorReduction: kv.armor ? parseNumber(kv.armor, lineNumber, 'ai.armor') : undefined,
        moveSpeed: kv.speed ? parseNumber(kv.speed, lineNumber, 'ai.speed') : undefined,
      };
      template.aiSpawns.push(aiSpawn);
    } else if (directive === '@itemrespawn') {
      // 新增: 解析物品重刷配置（支持多条规则）
      const { kv } = parseKeyValues(tokens);

      // 解析 itemIds（逗号分隔）
      let itemIds: string[] | undefined;
      if (kv.items || kv.itemids) {
        const raw = kv.items || kv.itemids;
        itemIds = raw
          .split(',')
          .map((s: string) => s.trim())
          .filter((s: string) => s.length > 0);
      }

      // 解析 rarityWeights，形如 "COMMON:60,RARE:30,EPIC:10"
      let rarityWeights: ItemRespawn['rarityWeights'] | undefined;
      if (kv.rarityweights || kv.rarity || kv.lootweights) {
        const raw = kv.rarityweights || kv.rarity || kv.lootweights;
        const parts = raw.split(',');
        const weights: any = {};
        for (const part of parts) {
          const [k, v] = part.split(':').map((s) => s.trim());
          if (!k || !v) continue;
          const upperK = k.toUpperCase();
          const num = Number(v);
          if (!Number.isFinite(num)) continue;
          if (upperK === 'COMMON' || upperK === 'RARE' || upperK === 'EPIC' || upperK === 'LEGENDARY') {
            weights[upperK] = num;
          }
        }
        if (Object.keys(weights).length > 0) {
          rarityWeights = weights;
        }
      }

      // 解析 mode 字段（兼容大小写和简写）
      let mode: ItemRespawn['mode'] = 'both';
      if (kv.mode) {
        const m = kv.mode.toLowerCase();
        if (m === 'initial' || m === 'init') mode = 'initial';
        else if (m === 'respawn' || m === 're') mode = 'respawn';
        else mode = 'both';
      }

      const config: ItemRespawn = {
        id: kv.id,
        mode,
        intervalTicks: kv.interval
          ? parseNumber(kv.interval, lineNumber, 'itemRespawn.interval')
          : parseNumber(kv.intervalticks ?? '600', lineNumber, 'itemRespawn.intervalTicks'), // 默认600 ticks (30秒)
        count: kv.count ? parseNumber(kv.count, lineNumber, 'itemRespawn.count') : 1,
        maxItems:
          kv.maxitems || kv.max
            ? parseNumber(kv.maxitems || kv.max, lineNumber, 'itemRespawn.maxItems')
            : undefined,
        zoneId: kv.zoneid || kv.zone,
        itemIds,
        rarityWeights,
      };

      template.itemRespawns.push(config);
    } else if (directive === '@airespawn') {
      // 新增: 解析AI重刷配置
      const { kv } = parseKeyValues(tokens);
      template.aiRespawn = {
        intervalTicks: kv.interval ? parseNumber(kv.interval, lineNumber, 'aiRespawn.interval') : parseNumber(kv.intervalticks ?? '1200', lineNumber, 'aiRespawn.intervalTicks'), // 默认1200 ticks (60秒)
        spawnId: kv.spawnid || kv.spawn,
        maxAIs: kv.maxais || kv.max ? parseNumber(kv.maxais || kv.max, lineNumber, 'aiRespawn.maxAIs') : undefined,
      };
    } else if (directive === '@note' || directive === '@comment') {
      continue;
    } else {
      throw new Error(`Line ${lineNumber}: Unknown directive "${directive}"`);
    }
  }

  // 区域重叠检测
  detectOverlaps(template, roomGroups);

  // 房间组可达性检测
  validateRoomGroupAccessibility(roomGroups);

  return MAP_TEMPLATE_SCHEMA.parse(template);
}

/**
 * 解析地图模板文本，返回模板和房间组信息（用于 linter）
 */
export function parseMapTemplateTextWithRoomGroups(text: string): {
  template: MapTemplate;
  roomGroups: Array<{ group: RoomGroup; startObstacleIndex: number }>;
} {
  const template = createDefaultMapTemplate();
  const roomGroups: Array<{ group: RoomGroup; startObstacleIndex: number }> = [];
  
  // 布局上下文：在 @map 指令解析后创建，用于 anchor 定位
  let layoutCtx: LayoutContext | undefined;

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    const tokenized = parseTokens(lines[i], lineNumber);
    if (!tokenized) {
      continue;
    }
    const { directive, tokens } = tokenized;

    // 复用 parseMapTemplateText 的解析逻辑（简化版，只处理关键指令）
    if (directive === '@meta') {
      const { kv } = parseKeyValues(tokens);
      if (kv.id) template.id = kv.id;
      if (kv.name) template.name = kv.name;
      if (kv.description || kv.desc) template.description = kv.description || kv.desc;
    } else if (directive === '@map') {
      const { kv, positionals } = parseKeyValues(tokens);
      if (positionals.length >= 2) {
        template.mapConfig.width = parseNumber(positionals[0], lineNumber, 'width');
        template.mapConfig.height = parseNumber(positionals[1], lineNumber, 'height');
      } else {
        if (kv.width) template.mapConfig.width = parseNumber(kv.width, lineNumber, 'width');
        if (kv.height) template.mapConfig.height = parseNumber(kv.height, lineNumber, 'height');
      }
      layoutCtx = {
        mapWidth: template.mapConfig.width,
        mapHeight: template.mapConfig.height,
        placedBlocks: [],
        extractZone: undefined,
      };
    } else if (directive === '@extract') {
      template.mapConfig.extractZone = parseRect(tokens, lineNumber, {
        x: 'extract.x', y: 'extract.y', w: 'extract.w', h: 'extract.h',
      });
      if (layoutCtx) layoutCtx.extractZone = template.mapConfig.extractZone;
    } else if (directive === '@roomgroup') {
      const result = parseRoomGroup(tokens, lines, i, lineNumber, layoutCtx);
      const startObstacleIndex = template.obstacles.length;
      const obstacles = generateRoomGroupWalls(result.roomGroup);
      template.obstacles.push(...obstacles);
      roomGroups.push({ group: result.roomGroup, startObstacleIndex });
      if (layoutCtx) {
        const size = calculateRoomGroupSize(result.roomGroup);
        const margin = result.roomGroup.margin ?? 0;
        const gx = result.roomGroup.x ?? 0;
        const gy = result.roomGroup.y ?? 0;
        layoutCtx.placedBlocks.push({
          x: gx - margin, y: gy - margin,
          w: size.w + margin * 2, h: size.h + margin * 2,
          id: result.roomGroup.id,
        });
      }
      i = result.endLineIndex;
    }
    // 其他指令由 parseMapTemplateText 处理
  }

  // 重新完整解析以获取所有数据
  const fullTemplate = parseMapTemplateText(text);
  
  return { template: fullTemplate, roomGroups };
}

function quoteIfNeeded(value: string): string {
  if (!value) return '""';
  if (/[\s"]/g.test(value)) {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return value;
}

export function formatMapTemplateText(template: MapTemplate): string {
  const lines: string[] = [];
  lines.push('# MAPTEXT v1');
  lines.push('# LLM-Friendly Map Template Format');
  lines.push('# Directives: @meta, @map, @extract, @obstacle, @spawn, @poi, @zone');
  lines.push('');
  
  // Meta 信息
  let metaLine = `@meta id=${quoteIfNeeded(template.id)}`;
  if (template.name) metaLine += ` name=${quoteIfNeeded(template.name)}`;
  if (template.description) metaLine += ` desc=${quoteIfNeeded(template.description)}`;
  lines.push(metaLine);
  
  // 地图配置
  lines.push(
    `@map width=${template.mapConfig.width} height=${template.mapConfig.height} seed=${template.mapConfig.seed}`
  );
  
  // 撤离区
  lines.push(
    `@extract x=${template.mapConfig.extractZone.x} y=${template.mapConfig.extractZone.y} w=${template.mapConfig.extractZone.w} h=${template.mapConfig.extractZone.h}`
  );
  
  // 障碍物
  if (template.obstacles.length > 0) {
    lines.push('');
    lines.push('# Obstacles (walls, buildings, etc.)');
    for (const obstacle of template.obstacles) {
      const typeParam = obstacle.type && obstacle.type !== 'wall' ? ` type=${obstacle.type}` : '';
      lines.push(`@obstacle x=${obstacle.x} y=${obstacle.y} w=${obstacle.w} h=${obstacle.h}${typeParam}`);
    }
  }
  
  // 出生点
  if (template.spawns.length > 0) {
    lines.push('');
    lines.push('# Spawn points');
    for (const spawn of template.spawns) {
      lines.push(`@spawn x=${spawn.x} y=${spawn.y}`);
    }
  }
  
  // POI
  if (template.pois.length > 0) {
    lines.push('');
    lines.push('# Points of Interest');
    for (const poi of template.pois) {
      let poiLine = `@poi x=${poi.x} y=${poi.y} id=${quoteIfNeeded(poi.id)} type=${poi.type}`;
      if (poi.name) poiLine += ` name=${quoteIfNeeded(poi.name)}`;
      if (poi.description) poiLine += ` desc=${quoteIfNeeded(poi.description)}`;
      lines.push(poiLine);
    }
  }
  
  // 区域
  if (template.zones.length > 0) {
    lines.push('');
    lines.push('# Zones (functional areas)');
    for (const zone of template.zones) {
      let zoneLine = `@zone x=${zone.x} y=${zone.y} w=${zone.w} h=${zone.h} id=${quoteIfNeeded(zone.id)} type=${zone.type}`;
      if (zone.name) zoneLine += ` name=${quoteIfNeeded(zone.name)}`;
      if (zone.description) zoneLine += ` desc=${quoteIfNeeded(zone.description)}`;
      lines.push(zoneLine);
    }
  }
  
  // 物品重刷配置
  if (template.itemRespawns && template.itemRespawns.length > 0) {
    lines.push('');
    lines.push('# Item respawn configuration');
    for (const cfg of template.itemRespawns) {
      let itemRespawnLine = '@itemrespawn';
      if (cfg.id) itemRespawnLine += ` id=${quoteIfNeeded(cfg.id)}`;
      if (cfg.mode && cfg.mode !== 'both') itemRespawnLine += ` mode=${cfg.mode}`;
      itemRespawnLine += ` intervalTicks=${cfg.intervalTicks} count=${cfg.count}`;
      if (cfg.maxItems) itemRespawnLine += ` maxItems=${cfg.maxItems}`;
      if (cfg.zoneId) itemRespawnLine += ` zoneId=${quoteIfNeeded(cfg.zoneId)}`;
      if (cfg.itemIds && cfg.itemIds.length > 0) {
        itemRespawnLine += ` items=${cfg.itemIds.join(',')}`;
      }
      if (cfg.rarityWeights) {
        const parts: string[] = [];
        if (cfg.rarityWeights.COMMON !== undefined) {
          parts.push(`COMMON:${cfg.rarityWeights.COMMON}`);
        }
        if (cfg.rarityWeights.RARE !== undefined) {
          parts.push(`RARE:${cfg.rarityWeights.RARE}`);
        }
        if (cfg.rarityWeights.EPIC !== undefined) {
          parts.push(`EPIC:${cfg.rarityWeights.EPIC}`);
        }
        if (cfg.rarityWeights.LEGENDARY !== undefined) {
          parts.push(`LEGENDARY:${cfg.rarityWeights.LEGENDARY}`);
        }
        if (parts.length > 0) {
          itemRespawnLine += ` rarityWeights=${parts.join(',')}`;
        }
      }
      lines.push(itemRespawnLine);
    }
  }
  
  // AI重刷配置
  if (template.aiRespawn) {
    lines.push('');
    lines.push('# AI respawn configuration');
    let aiRespawnLine = `@airespawn intervalTicks=${template.aiRespawn.intervalTicks}`;
    if (template.aiRespawn.spawnId) aiRespawnLine += ` spawnId=${quoteIfNeeded(template.aiRespawn.spawnId)}`;
    if (template.aiRespawn.maxAIs) aiRespawnLine += ` maxAIs=${template.aiRespawn.maxAIs}`;
    lines.push(aiRespawnLine);
  }
  
  return lines.join('\n');
}
