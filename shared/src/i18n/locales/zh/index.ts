import { ITEMS } from './items.js';
import { EQUIPMENT } from './equipment.js';
import { OBSTACLES } from './obstacles.js';
import { UI } from './ui.js';
import { SCREENS } from './screens.js';
import { HUD } from './hud.js';
import { COMBAT } from './combat.js';
import { TUTORIAL } from './tutorial.js';
import { SERVER } from './server.js';

export const ZH: Record<string, string> = {
  ...ITEMS,
  ...EQUIPMENT,
  ...OBSTACLES,
  ...UI,
  ...SCREENS,
  ...HUD,
  ...COMBAT,
  ...TUTORIAL,
  ...SERVER,
};
