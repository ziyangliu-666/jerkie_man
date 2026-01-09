import { z } from 'zod';
import { DEFAULT_MAP_CONFIG, MAP_CONFIG_SCHEMA, Zone } from './content.js';
import { OBSTACLE_STATE_SCHEMA } from './protocol.js';

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

export const MAP_TEMPLATE_SCHEMA = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  description: z.string().optional(), // 新增: 地图描述
  mapConfig: MAP_CONFIG_SCHEMA,
  obstacles: z.array(OBSTACLE_STATE_SCHEMA),
  spawns: z.array(SPAWN_POINT_SCHEMA).default([]),
  pois: z.array(POI_SCHEMA).default([]), // 新增: POI 列表
  zones: z.array(ZONE_SCHEMA).default([]), // 新增: 区域列表
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
});

export const ROOM_GROUP_SCHEMA = z.object({
  layout: z.enum(['horizontal', 'vertical', 'grid']),
  x: z.number().nonnegative(),
  y: z.number().nonnegative(),
  cellW: z.number().positive().optional(),
  cellH: z.number().positive().optional(),
  cols: z.number().int().positive().optional(),
  rows: z.number().int().positive().optional(),
  wallThickness: z.number().positive().default(20),
  doorWidth: z.number().positive().default(120),
  rooms: z.array(ROOM_DEF_SCHEMA),
});

export type RoomDef = z.infer<typeof ROOM_DEF_SCHEMA>;
export type RoomGroup = z.infer<typeof ROOM_GROUP_SCHEMA>;
export type RoomGroupLayout = 'horizontal' | 'vertical' | 'grid';

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
 * 检测地图模板中的区域重叠并输出警告
 */
function detectOverlaps(template: MapTemplate, roomGroups: Array<{ group: RoomGroup; startObstacleIndex: number }> = []): void {
  const warnings: string[] = [];
  const criticalWarnings: string[] = []; // 关键警告，不会被过滤

  // 1. 检测障碍物之间的重叠
  for (let i = 0; i < template.obstacles.length; i++) {
    for (let j = i + 1; j < template.obstacles.length; j++) {
      const obsA = template.obstacles[i];
      const obsB = template.obstacles[j];
      
      const overlap = getOverlapArea(obsA, obsB);
      if (overlap) {
        const areaA = obsA.w * obsA.h;
        const areaB = obsB.w * obsB.h;
        const overlapArea = overlap.w * overlap.h;
        const overlapPercentA = ((overlapArea / areaA) * 100).toFixed(1);
        const overlapPercentB = ((overlapArea / areaB) * 100).toFixed(1);
        
        warnings.push(
          `⚠️  障碍物重叠 [${i}] <-> [${j}]:
    [${i}] ${obsA.type} @ (${obsA.x}, ${obsA.y}) ${obsA.w}x${obsA.h} (id: ${obsA.id})
    [${j}] ${obsB.type} @ (${obsB.x}, ${obsB.y}) ${obsB.w}x${obsB.h} (id: ${obsB.id})
    重叠区域: (${overlap.x}, ${overlap.y}) ${overlap.w}x${overlap.h}
    重叠面积: ${overlapArea} (占 [${i}] 的 ${overlapPercentA}%, 占 [${j}] 的 ${overlapPercentB}%)`
        );
      }
    }
  }

  // 注意: 区域 (zones) 之间的重叠是允许的，不进行检测

  // 2. 检测撤离点与障碍物的重叠
  if (template.mapConfig.extractZone) {
    const extractZone = template.mapConfig.extractZone;
    for (let i = 0; i < template.obstacles.length; i++) {
      const obs = template.obstacles[i];
      const overlap = getOverlapArea(extractZone, obs);
      
      if (overlap) {
        const extractArea = extractZone.w * extractZone.h;
        const obsArea = obs.w * obs.h;
        const overlapArea = overlap.w * overlap.h;
        const overlapPercentExtract = ((overlapArea / extractArea) * 100).toFixed(1);
        const overlapPercentObs = ((overlapArea / obsArea) * 100).toFixed(1);
        
        warnings.push(
          `⚠️  撤离点与障碍物重叠 ExtractZone <-> [${i}]:
    撤离点 @ (${extractZone.x}, ${extractZone.y}) ${extractZone.w}x${extractZone.h}
    [${i}] ${obs.type} @ (${obs.x}, ${obs.y}) ${obs.w}x${obs.h} (id: ${obs.id})
    重叠区域: (${overlap.x}, ${overlap.y}) ${overlap.w}x${overlap.h}
    重叠面积: ${overlapArea} (占撤离点 ${overlapPercentExtract}%, 占障碍物 ${overlapPercentObs}%)`
        );
      }
    }
  }

  // 3. 检测草丛是否在室内（房间内）
  // 计算所有房间的边界
  const roomBounds: Array<{ x: number; y: number; w: number; h: number; groupId: string }> = [];
  for (const { group } of roomGroups) {
    const roomRects = calculateRoomRects(group);
    for (const rect of roomRects) {
      roomBounds.push({
        x: rect.x,
        y: rect.y,
        w: rect.w,
        h: rect.h,
        groupId: `roomgroup @ (${group.x}, ${group.y})`,
      });
    }
  }

  // 检查每个草丛是否在房间内
  for (let i = 0; i < template.obstacles.length; i++) {
    const obs = template.obstacles[i];
    if (obs.type === 'bush') {
      // 检查草丛中心点是否在任何房间内
      const centerX = obs.x + obs.w / 2;
      const centerY = obs.y + obs.h / 2;
      
      for (const room of roomBounds) {
        if (
          centerX >= room.x &&
          centerX < room.x + room.w &&
          centerY >= room.y &&
          centerY < room.y + room.h
        ) {
          criticalWarnings.push(
            `⚠️  草丛位于室内 [${i}]:
    [${i}] ${obs.type} @ (${obs.x}, ${obs.y}) ${obs.w}x${obs.h} (id: ${obs.id})
    位于房间: ${room.groupId}
    建议: 将草丛移至室外区域`
          );
          break; // 只报告一次
        }
      }
    }
  }

  // 4. 检测宝箱与墙壁的重叠
  const chestTypes = ['crate', 'chest_closed', 'chest_open', 'weapon_crate', 'throwable_crate', 'medical_crate', 'equipment_crate'];
  const wallTypes = ['wall', 'door_closed'];
  
  for (let i = 0; i < template.obstacles.length; i++) {
    const chest = template.obstacles[i];
    if (chestTypes.includes(chest.type)) {
      // 检查与所有墙壁的重叠
      for (let j = 0; j < template.obstacles.length; j++) {
        if (i === j) continue;
        const wall = template.obstacles[j];
        
        if (wallTypes.includes(wall.type)) {
          const overlap = getOverlapArea(chest, wall);
          if (overlap) {
            const chestArea = chest.w * chest.h;
            const wallArea = wall.w * wall.h;
            const overlapArea = overlap.w * overlap.h;
            const overlapPercentChest = ((overlapArea / chestArea) * 100).toFixed(1);
            const overlapPercentWall = ((overlapArea / wallArea) * 100).toFixed(1);
            
            criticalWarnings.push(
              `⚠️  宝箱与墙壁重叠 [${i}] <-> [${j}]:
    [${i}] ${chest.type} @ (${chest.x}, ${chest.y}) ${chest.w}x${chest.h} (id: ${chest.id})
    [${j}] ${wall.type} @ (${wall.x}, ${wall.y}) ${wall.w}x${wall.h} (id: ${wall.id})
    重叠区域: (${overlap.x}, ${overlap.y}) ${overlap.w}x${overlap.h}
    重叠面积: ${overlapArea} (占 [${i}] 的 ${overlapPercentChest}%, 占 [${j}] 的 ${overlapPercentWall}%)
    建议: 调整宝箱位置以避免与墙壁重叠`
            );
          }
        }
      }
    }
  }

  // 过滤掉小重叠（@roomgroup角落处的有意重叠）
  const significantWarnings = warnings.filter(warning => {
    // 提取重叠面积和百分比
    const areaMatch = warning.match(/重叠面积: (\d+)/);
    const percentMatches = warning.match(/占 \[.*?\] 的 ([\d.]+)%, 占 \[.*?\] 的 ([\d.]+)%/);
    
    if (areaMatch && percentMatches) {
      const area = parseInt(areaMatch[1]);
      const percent1 = parseFloat(percentMatches[1]);
      const percent2 = parseFloat(percentMatches[2]);
      const maxPercent = Math.max(percent1, percent2);
      
      // 过滤条件：重叠面积<500px² 且 重叠率<30% 的视为正常（角落重叠）
      if (area < 500 && maxPercent < 30) {
        return false; // 过滤掉
      }
    }
    
    return true; // 保留
  });

  // 合并所有警告（关键警告 + 过滤后的普通警告）
  const allWarnings = [...criticalWarnings, ...significantWarnings];

  // 输出所有警告
  if (allWarnings.length > 0) {
    console.warn('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.warn(`📍 地图 "${template.id}" (${template.name || 'unnamed'}) 检测到 ${allWarnings.length} 个重叠问题:`);
    console.warn('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    allWarnings.forEach((warning, index) => {
      console.warn(`${index + 1}. ${warning}`);
    });
    console.warn('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.warn('💡 提示: 您可以使用 LLM 调整地图配置以消除这些重叠\n');
  }
}

/**
 * 验证 RoomGroup 的可达性（检测是否有外部入口）
 * 警告：如果整个房间组没有任何外部门，玩家将无法进入
 */
function validateRoomGroupAccessibility(roomGroups: Array<{ group: RoomGroup; startObstacleIndex: number }>): void {
  const warnings: string[] = [];
  
  for (const { group, startObstacleIndex } of roomGroups) {
    const roomRects = calculateRoomRects(group);
    
    // 检查每个房间是否有外部门（不与其他房间共享的门）
    let hasExternalDoor = false;
    
    for (let i = 0; i < group.rooms.length; i++) {
      const room = group.rooms[i];
      const rect = roomRects[i];
      const doors = room.doors.toLowerCase();
      
      // 检测该房间的外墙（不与其他房间共享的墙）
      const externalWalls = detectExternalWalls(rect, i, roomRects);
      
      // 检查每个外墙是否有门
      if (externalWalls.north && doors.includes('n')) hasExternalDoor = true;
      if (externalWalls.south && doors.includes('s')) hasExternalDoor = true;
      if (externalWalls.east && doors.includes('e')) hasExternalDoor = true;
      if (externalWalls.west && doors.includes('w')) hasExternalDoor = true;
      
      if (hasExternalDoor) break;
    }
    
    if (!hasExternalDoor) {
      const layoutDesc = group.layout === 'horizontal' ? '横向排列' : 
                         group.layout === 'vertical' ? '纵向排列' : '网格布局';
      warnings.push(
        `⚠️  封闭的房间组 (${layoutDesc}) @ (${group.x}, ${group.y}):\n` +
        `    房间数量: ${group.rooms.length}\n` +
        `    房间列表: ${group.rooms.map(r => `${r.id} (doors=${r.doors})`).join(', ')}\n` +
        `    ❌ 问题: 所有门都是内部互通，没有对外的入口！\n` +
        `    💡 建议: 至少为一个房间添加外部门，例如 doors=n 或 doors=wens`
      );
    }
  }
  
  if (warnings.length > 0) {
    console.warn('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.warn(`🚪 房间组可达性检查: 发现 ${warnings.length} 个封闭房间组`);
    console.warn('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    warnings.forEach((warning, index) => {
      console.warn(`${index + 1}. ${warning}`);
    });
    console.warn('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  }
}

/**
 * Room Group 辅助函数：计算每个房间的实际坐标和尺寸
 */
function calculateRoomRects(group: RoomGroup): Array<{ x: number; y: number; w: number; h: number }> {
  const { layout, x, y, cellW, cellH, cols, rooms } = group;
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
  const { wallThickness, doorWidth, rooms } = group;
  
  // 计算每个房间的实际坐标和尺寸
  const roomRects = calculateRoomRects(group);
  
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
 * 解析 @roomgroup 指令及其子房间定义
 */
function parseRoomGroup(
  tokens: string[],
  lines: string[],
  currentIndex: number,
  lineNumber: number
): { roomGroup: RoomGroup; endLineIndex: number } {
  const { kv } = parseKeyValues(tokens);
  
  // 解析基础参数
  const layout = (kv.layout as RoomGroupLayout) || 'horizontal';
  const x = parseNumber(kv.x ?? '', lineNumber, 'roomgroup.x');
  const y = parseNumber(kv.y ?? '', lineNumber, 'roomgroup.y');
  
  // 解析房间定义（读取后续缩进行）
  const rooms: RoomDef[] = [];
  let endLineIndex = currentIndex;
  
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
    
    // 解析房间定义: "room1: w=300 doors=e"
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
    });
    
    endLineIndex = i;
  }
  
  const roomGroup: RoomGroup = {
    layout,
    x, 
    y,
    cellW: kv.cellw ? parseNumber(kv.cellw, lineNumber, 'cellW') : undefined,
    cellH: kv.cellh ? parseNumber(kv.cellh, lineNumber, 'cellH') : undefined,
    cols: kv.cols ? parseNumber(kv.cols, lineNumber, 'cols') : undefined,
    rows: kv.rows ? parseNumber(kv.rows, lineNumber, 'rows') : undefined,
    wallThickness: kv.wallthickness ? parseNumber(kv.wallthickness, lineNumber, 'wallThickness') : 20,
    doorWidth: kv.doorwidth ? parseNumber(kv.doorwidth, lineNumber, 'doorWidth') : 120,
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
    aiSpawns: [],
    itemRespawns: [],
    aiRespawn: undefined,
  };
}

export function parseMapTemplateText(text: string): MapTemplate {
  const template = createDefaultMapTemplate();
  const roomGroups: Array<{ group: RoomGroup; startObstacleIndex: number }> = []; // 跟踪所有房间组

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
    } else if (directive === '@extract') {
      template.mapConfig.extractZone = parseRect(tokens, lineNumber, {
        x: 'extract.x',
        y: 'extract.y',
        w: 'extract.w',
        h: 'extract.h',
      });
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
      const result = parseRoomGroup(tokens, lines, i, lineNumber);
      const startObstacleIndex = template.obstacles.length; // 记录起始索引
      const obstacles = generateRoomGroupWalls(result.roomGroup);
      template.obstacles.push(...obstacles);
      // 跟踪房间组用于后续验证
      roomGroups.push({ group: result.roomGroup, startObstacleIndex });
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
