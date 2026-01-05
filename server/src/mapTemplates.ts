import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMapTemplateText, type MapTemplate } from '@jerkie-man/shared';

export type MapTemplateCatalog = {
  dir: string;
  templates: Map<string, MapTemplate>;
};

const TEMPLATE_EXTENSIONS = new Set(['.map.txt', '.map']);

export function resolveMapTemplateDir(customDir?: string): string {
  if (customDir) {
    return path.resolve(customDir);
  }
  const serverDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(serverDir, '..', '..', 'shared', 'maps');
}

export function loadMapTemplates(dir: string): MapTemplateCatalog {
  const templates = new Map<string, MapTemplate>();
  if (!fs.existsSync(dir)) {
    return { dir, templates };
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    const fullName = entry.name.toLowerCase();
    const isTemplate = TEMPLATE_EXTENSIONS.has(fullName.endsWith('.map.txt') ? '.map.txt' : ext);
    if (!isTemplate) continue;

    const filePath = path.join(dir, entry.name);
    const text = fs.readFileSync(filePath, 'utf8');
    const parsed = parseMapTemplateText(text);
    const baseName = entry.name.replace(/\.map\.txt$/i, '').replace(/\.map$/i, '');
    const templateId = parsed.id === 'default' && baseName !== 'default' ? baseName : parsed.id;
    templates.set(templateId, { ...parsed, id: templateId });
  }

  return { dir, templates };
}

export function getMapTemplate(catalog: MapTemplateCatalog, id?: string | null): MapTemplate | undefined {
  if (!id) return undefined;
  return catalog.templates.get(id);
}

export function listMapTemplateIds(catalog: MapTemplateCatalog): string[] {
  return [...catalog.templates.keys()].sort();
}
