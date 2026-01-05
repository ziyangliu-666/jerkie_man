import { z } from 'zod';
import { DEFAULT_MAP_CONFIG, MAP_CONFIG_SCHEMA } from './content.js';
import { OBSTACLE_STATE_SCHEMA } from './protocol.js';

export const SPAWN_POINT_SCHEMA = z.object({
  x: z.number().nonnegative(),
  y: z.number().nonnegative(),
});

export const MAP_TEMPLATE_SCHEMA = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  mapConfig: MAP_CONFIG_SCHEMA,
  obstacles: z.array(OBSTACLE_STATE_SCHEMA),
  spawns: z.array(SPAWN_POINT_SCHEMA).default([]),
});

export type MapTemplate = z.infer<typeof MAP_TEMPLATE_SCHEMA>;
export type SpawnPoint = z.infer<typeof SPAWN_POINT_SCHEMA>;

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
      const rect = parseRect(tokens, lineNumber, {
        x: 'obstacle.x',
        y: 'obstacle.y',
        w: 'obstacle.w',
        h: 'obstacle.h',
      });
      template.obstacles.push(rect);
    } else if (directive === '@spawn') {
      template.spawns.push(parsePoint(tokens, lineNumber));
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
  lines.push(
    `@meta id=${quoteIfNeeded(template.id)}${template.name ? ` name=${quoteIfNeeded(template.name)}` : ''}`
  );
  lines.push(
    `@map width=${template.mapConfig.width} height=${template.mapConfig.height} seed=${template.mapConfig.seed}`
  );
  lines.push(
    `@extract x=${template.mapConfig.extractZone.x} y=${template.mapConfig.extractZone.y} w=${template.mapConfig.extractZone.w} h=${template.mapConfig.extractZone.h}`
  );
  if (template.obstacles.length > 0) {
    lines.push('');
    for (const obstacle of template.obstacles) {
      lines.push(`@obstacle x=${obstacle.x} y=${obstacle.y} w=${obstacle.w} h=${obstacle.h}`);
    }
  }
  if (template.spawns.length > 0) {
    lines.push('');
    for (const spawn of template.spawns) {
      lines.push(`@spawn x=${spawn.x} y=${spawn.y}`);
    }
  }
  return lines.join('\n');
}
