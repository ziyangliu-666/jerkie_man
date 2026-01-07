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

// 新增: AI spawn点定义
export const AI_SPAWN_SCHEMA = z.object({
  x: z.number().nonnegative(),
  y: z.number().nonnegative(),
  type: z.enum(['patrol', 'guard']),
  weaponTypeId: z.string(),
  count: z.number().int().positive().default(1),
  patrolPointIds: z.array(z.string()).optional(),
  guardRadius: z.number().positive().optional(),
  visionRange: z.number().positive().default(300),
  visionAngleDeg: z.number().min(0).max(360).default(360),
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
});

export type MapTemplate = z.infer<typeof MAP_TEMPLATE_SCHEMA>;
export type SpawnPoint = z.infer<typeof SPAWN_POINT_SCHEMA>;
export type POI = z.infer<typeof POI_SCHEMA>;
export type Zone = z.infer<typeof ZONE_SCHEMA>;
export type AISpawn = z.infer<typeof AI_SPAWN_SCHEMA>;

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
      const aiSpawn: AISpawn = {
        x: positionals.length >= 2
          ? parseNumber(positionals[0], lineNumber, 'ai.x')
          : parseNumber(kv.x ?? '', lineNumber, 'ai.x'),
        y: positionals.length >= 2
          ? parseNumber(positionals[1], lineNumber, 'ai.y')
          : parseNumber(kv.y ?? '', lineNumber, 'ai.y'),
        type: kv.type === 'guard' ? 'guard' : 'patrol',
        weaponTypeId: kv.weapon || 'w_pistol',
        count: kv.count ? parseNumber(kv.count, lineNumber, 'ai.count') : 1,
        visionRange: kv.vision ? parseNumber(kv.vision, lineNumber, 'ai.vision') : 300,
        visionAngleDeg: kv.visionangle || kv.visionAngle
          ? parseNumber(kv.visionangle || kv.visionAngle, lineNumber, 'ai.visionAngle')
          : 360,
        guardRadius: kv.radius ? parseNumber(kv.radius, lineNumber, 'ai.radius') : undefined,
        patrolPointIds: kv.patrol ? kv.patrol.split(',').map((s: string) => s.trim()) : undefined,
      };
      template.aiSpawns.push(aiSpawn);
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
  
  return lines.join('\n');
}
