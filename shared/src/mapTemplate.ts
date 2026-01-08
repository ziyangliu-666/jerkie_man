import { z } from 'zod';
import { DEFAULT_MAP_CONFIG, MAP_CONFIG_SCHEMA } from './content.js';
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
export type Zone = z.infer<typeof ZONE_SCHEMA>;
export type AISpawn = z.infer<typeof AI_SPAWN_SCHEMA>;
export type ItemRespawn = z.infer<typeof ITEM_RESPAWN_SCHEMA>;
export type AIRespawn = z.infer<typeof AI_RESPAWN_SCHEMA>;

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
      const type = kv.type || 'wall';
      const obstacle: any = {
        ...rect,
        id: kv.id || `obs_${template.obstacles.length}`, // 确保每个障碍物有唯一ID（草丛逻辑依赖此ID）
        type, // 支持 type 参数，默认为 wall
      };

      // 对可破坏的木箱（crate）在导入时补齐 hp/maxHp，和随机生成逻辑保持一致
      if (type === 'crate') {
        obstacle.hp = 100;
        obstacle.maxHp = 100;
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
          if (upperK === 'COMMON' || upperK === 'RARE' || upperK === 'EPIC') {
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
