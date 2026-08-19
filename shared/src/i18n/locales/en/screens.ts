/**
 * Screen chrome: everything declared statically in `client/index.html`.
 *
 * Every key here is referenced from the markup via `data-i18n`,
 * `data-i18n-placeholder` or `data-i18n-title`, or is used by `main.ts` when it
 * swaps a label at runtime (result title, extract/KIA badge, expand/collapse).
 *
 * English is the source language — see docs/LOCALIZATION.md.
 */
export const SCREENS: Record<string, string> = {
  // ===== Start screen =====
  'start.subtitle': 'EXTRACTION_PROTOCOL // v.0.9',
  'start.server.label': 'SERVER_UPLINK_TARGET //:',
  'start.btn.initialize': 'INITIALIZE // START',

  // ===== Language switch =====
  // The modal is the first thing a player ever sees, before a locale is picked,
  // so its copy is deliberately bilingual in both catalogs.
  'lang.select': 'Language',
  'lang.modal.title': 'LANGUAGE // 语言',
  'lang.modal.prompt': 'Select your language / 选择你的语言',

  // ===== Audio panel (#bgmControl) =====
  'ui.bgm.panel': 'Audio',
  'ui.bgm.mute': 'Toggle music (M)',
  'ui.bgm.next': 'Next track (N)',
  'ui.bgm.track': 'Select track',
  'ui.bgm.volume': 'Volume',

  // ===== Shared chrome =====
  'ui.btn.confirm': 'Confirm',
  'ui.btn.cancel': 'Cancel',
  'ui.btn.swap': 'Swap',
  'ui.btn.unequip': 'Unequip',
  'ui.btn.expand': 'Expand',
  'ui.btn.collapse': 'Collapse',
  'ui.btn.deploy': 'Deploy',
  'ui.btn.returnToBase': 'Return to Base',
  'ui.chat.placeholder': 'Press / for commands',
  'ui.debug.toggle': 'Toggle debug panel (F1)',
  'common.unknown': 'Unknown',

  // ===== In-raid HUD =====
  // CSS uppercases these headers; keep the catalog in Title Case.
  'hud.gear': 'Gear',
  'hud.weapon': 'Weapon',
  'hud.weapon.fists': 'Fists',
  'hud.backpack': 'Backpack',
  'hud.armor': 'Armor',
  'hud.health': 'Health',
  'hud.stamina': 'Stamina',
  'hud.status': 'Status',

  // ===== Operator identity modals =====
  'operator.create.title': 'Set Your Nickname',
  'operator.create.prompt': 'Enter your nickname (1-32 characters)',
  'operator.callsign.placeholder': 'Nickname',
  'operator.rename.title': 'Change Nickname',
  'operator.rename.prompt': 'Enter a new nickname (1-32 characters)',

  // ===== Equip picker =====
  'equip.select.title': 'Select an item to equip',

  // ===== Debrief (#resultUI) =====
  'debrief.title.success': 'OPERATION COMPLETE',
  'debrief.title.failure': 'OPERATION FAILED',
  'debrief.status.extracted': 'EXTRACTED',
  'debrief.status.kia': 'KIA',
  'debrief.status.survived': 'Survived',
  'debrief.status.dead': 'Dead',
  'debrief.totalValue': 'TOTAL VALUE',
  'debrief.moneyDetail': 'Loot: {loot} | Cash: {cash}',
  'debrief.kia': 'KILLED IN ACTION',
  'debrief.killer': 'Killer:',
  'debrief.weapon': 'Weapon:',
  'debrief.statusLabel': 'Status',
  'debrief.loot': 'ACQUIRED LOOT',
  'debrief.loot.empty': 'NO ITEMS RECOVERED',

  // ===== Hideout shell =====
  'hideout.decor.stream': 'STREAMING_DATA: OK // SYSTEM_CORE: ONLINE',
  'hideout.operator': 'NICKNAME',
  'hideout.statusLabel': 'STATUS',
  'hideout.status.connecting': 'CONNECTING...',
  'hideout.status.online': 'ONLINE',
  'hideout.tab.gear': 'Gear & Stash',
  'hideout.tab.market': 'Market',

  // ===== Gear / loadout / stash panel =====
  'gear.title': 'Gear & Loadout',
  'gear.desc': 'Click a slot to equip from your stash.',
  'gear.slot.weapon': 'Weapon',
  'gear.slot.backpack': 'Backpack',
  'gear.slot.armor': 'Armor',
  'gear.slot.hint': '(click to equip)',
  'gear.slot.empty': 'Empty',
  'loadout.title': 'Loadout',
  'stash.title': 'Stash',

  // ===== Category filters (stash + market share these) =====
  'category.weapons': 'Weapons',
  'category.armor': 'Armor',
  'category.backpacks': 'Backpacks',
  'category.consumables': 'Consumables',
  'category.materials': 'Materials',

  // ===== Market panel =====
  'market.title': 'Market',
  'market.desc': 'Purchases go straight to your stash.',
};
