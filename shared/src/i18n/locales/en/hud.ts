export const HUD: Record<string, string> = {
  // --- Section headers (F1 debug panel) ---
  'hud.section.connection': 'CONNECTION',
  'hud.section.players': 'PLAYERS',
  'hud.section.counts': 'COUNTS',
  'hud.section.status': 'COMBAT STATUS',
  'hud.section.nearby': 'NEARBY',
  'hud.section.inventory': 'BACKPACK (IN RAID)',
  'hud.section.selected': 'SELECTED ENTITY',
  'hud.section.events': 'EVENT LOG',

  // --- Field labels, shared across sections ---
  'hud.field.status': 'Status',
  'hud.field.ping': 'Ping',
  'hud.field.account': 'Account',
  'hud.field.clientTime': 'Client Time',
  'hud.field.serverTick': 'Last Server Tick',
  'hud.field.extraction': 'Extraction',
  'hud.field.health': 'Health',
  'hud.field.weapon': 'Weapon',
  'hud.field.mag': 'Mag',
  'hud.field.reloading': 'Reloading',
  'hud.field.cooldown': 'Cooldown',
  'hud.field.using': 'Using',
  'hud.field.killedBy': 'Killed By',
  'hud.field.id': 'ID',
  'hud.field.position': 'Position',
  'hud.field.loot': 'Loot',
  'hud.field.lastInputSeq': 'Last Input Seq',
  'hud.field.lastInputTick': 'Last Input Tick',
  'hud.field.capacity': 'Capacity',
  'hud.field.totalValue': 'Total Value',

  // --- Operator state, used by the players table, combat status and entity inspector ---
  'hud.state.alive': 'Alive',
  'hud.state.dead': 'KIA',
  'hud.state.extracted': 'Extracted',

  // --- Connection ---
  'hud.connection.connected': 'Connected',
  'hud.connection.disconnected': 'Disconnected',
  'hud.connection.reconnecting': 'Reconnecting (attempt {attempt})',
  'hud.connection.reconnectingRetry': 'Reconnecting (attempt {attempt}, retry in {ms}ms)',

  // --- Players table ---
  'hud.players.empty': 'No players',
  'hud.players.col.name': 'NAME',
  'hud.players.col.hp': 'HP',
  'hud.players.col.pos': 'POS',
  'hud.players.col.status': 'STATUS',

  // --- Counts ---
  'hud.counts.bullets': 'Bullets',
  'hud.counts.worldItems': 'World Items',
  'hud.counts.lootBags': 'Loot Bags',

  // --- Combat status ---
  'hud.status.notInRaid': 'Not in a raid',
  'hud.status.hp.healthy': 'Healthy',
  'hud.status.hp.hurt': 'Hurt',
  'hud.status.hp.wounded': 'Wounded',
  'hud.status.hp.critical': 'Critical',
  'hud.status.fists': 'Fists',

  // --- Nearby. E only picks things up; extraction runs on a timer, no key press. ---
  'hud.nearby.item': 'Item',
  'hud.nearby.item.hint': 'Press E to pick up',
  'hud.nearby.lootBag': 'Loot Bag',
  'hud.nearby.lootBag.hint': 'Press E to loot',
  'hud.nearby.extractZone': 'Extraction Zone',
  'hud.nearby.extractZone.hint': 'Stay inside to extract',
  'hud.nearby.none': 'Nothing nearby',

  // --- In-raid backpack ---
  'hud.inventory.empty': 'Empty',
  'hud.inventory.unavailable': 'Unavailable',
  'hud.inventory.total_one': '{count} item total',
  'hud.inventory.total_other': '{count} items total',
  'hud.inventory.stack.max': 'Max {max}',
  'hud.inventory.stack.none': 'No',
  'hud.inventory.drop': 'Drop',
  'hud.inventory.col.item': 'ITEM',
  'hud.inventory.col.rarity': 'RARITY',
  'hud.inventory.col.qty': 'QTY',
  'hud.inventory.col.value': 'VALUE',
  'hud.inventory.col.stack': 'STACK',

  // --- Selected entity ---
  'hud.selected.none': 'None — click a player',

  // --- Shared fallback ---
  'hud.unknown': 'Unknown',
};
