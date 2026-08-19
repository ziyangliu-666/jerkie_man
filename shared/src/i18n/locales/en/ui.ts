/**
 * Copy that `main.ts` builds at runtime: hideout chrome it swaps, the item
 * cards and buttons it creates, the HUD event log, admin confirms and the chat
 * command palette.
 *
 * Ownership — nothing here duplicates another catalog:
 * - Static markup in `client/index.html`  -> screens.ts
 * - Stat labels (`stat.*`) and units (`unit.*`) -> equipment.ts
 * - Item names/descriptions, rarity        -> items.ts
 * - Debug panel (`hud.*`)                  -> hud.ts
 * - Canvas overlay (`combat.*`)            -> combat.ts
 * - Anything the server originates, plus enemies and kill-feed actors -> server.ts
 *
 * English is the source language. See docs/LOCALIZATION.md for the glossary.
 */
export const UI: Record<string, string> = {
  // ===== Document title (set from JS — <title> lives in <head>) =============
  'app.title': 'ZIYANG PROTOCOL',

  // ===== Start screen ======================================================
  // The label and the button live in screens.ts; only this one is interpolated.
  'start.server.placeholder': 'Default: {url}',

  // ===== Client-side validation ============================================
  // Server-side failures come back as error codes and resolve from server.ts.
  'error.callsign.empty': 'Nickname cannot be empty',
  'error.callsign.tooLong': 'Nickname cannot exceed 32 characters',

  // ===== Hideout top bar ===================================================
  'hideout.name.unset': 'No nickname',
  'hideout.name.editHint': 'Change nickname',
  'hideout.status.offline': 'OFFLINE', // the ONLINE half is screens.ts

  // ===== Equipment slots ===================================================
  // Slot names themselves are screens.ts (`gear.slot.*`); this is the one
  // runtime-only state.
  'slot.invalid': 'Invalid {slot}',

  // ===== Equip / swap picker ===============================================
  // screens.ts owns the static title; these are the runtime, parameterised ones.
  // No article: the slot label is a Title Case noun, so "Select a Armor" would
  // be wrong for one of the three. "Equip Armor" works for all of them.
  'equip.select.titleSlot': 'Equip {slot}',
  'equip.select.empty': 'No {slot} available in stash or loadout',
  'equip.swap.title': 'Select a weapon to swap to',
  'equip.swap.empty': 'No other weapon in your backpack',
  'equip.source.stash': 'Stash',
  'equip.source.loadout': 'Loadout',

  // ===== Buttons main.ts creates ===========================================
  // Confirm/Cancel/Deploy/Swap/Unequip/Expand/Collapse are screens.ts.
  'ui.btn.equip': 'Equip',
  'ui.btn.equipped': 'Equipped',
  'ui.btn.unequipped': 'Unequipped',
  'ui.btn.drop': 'Drop',
  'ui.btn.sell': 'Sell',
  'ui.btn.buy': 'Buy',
  'ui.btn.buyEquip': 'Buy & Equip',
  'ui.btn.buyLoadout': 'Buy & Carry',
  'ui.btn.added': 'Added',
  'ui.btn.moveToStash': 'Move to Stash',
  'ui.btn.addToLoadout': 'Add to Loadout',

  // ===== List empty states =================================================
  'loadout.empty': 'Loadout is empty',
  'stash.empty': 'Stash is empty',
  'list.emptyCategory': 'No items in this category',

  // ===== Market ============================================================
  'market.bought_one': '{count} bought',
  'market.bought_other': '{count} bought',

  // ===== In-raid gear panel ================================================
  // Weapon meta is composed from `stat.*` labels so the words never drift.
  'raid.weapon.notReady': 'Not ready',
  'raid.weapon.reloading': 'Reloading',
  'raid.bag.default': 'Basic Backpack',
  'raid.bag.meta': 'Capacity {used}/{cap} | Items {total}',
  'raid.bag.empty': 'Empty',
  'raid.bag.equipped': 'Equipped',
  'raid.armor.none': 'No Armor',
  'raid.noAmmo': 'NO AMMO',

  // ===== Screen HUD ========================================================
  'hud.sprinting': 'SPRINTING',
  'hud.killfeed.killed': 'KILLED',

  // ===== Countable fragments ===============================================
  // `event.world.init` puts four counts in one sentence and t() resolves one
  // `count` at a time, so the sentence is assembled from these.
  'count.items_one': '{count} item',
  'count.items_other': '{count} items',
  'count.obstacles_one': '{count} obstacle',
  'count.obstacles_other': '{count} obstacles',
  'count.worldItems_one': '{count} world item',
  'count.worldItems_other': '{count} world items',
  'count.rooms_one': '{count} room',
  'count.rooms_other': '{count} rooms',

  // ===== Event log (client-originated; server events are in server.ts) =====
  'event.client.started': 'Client started',
  'event.net.connected': 'Connected to server',
  'event.net.disconnected': 'Disconnected from server',
  'event.net.worldCleared': 'World cleared',
  'event.net.playerId': 'Player ID: {id}',
  'event.net.accountId': 'Account ID: {id}',
  'event.net.mapConfig': 'Map config received (seed: {seed})',
  'event.net.mapConfigMissing': 'No map config from server, falling back to the local one',
  'event.world.init': 'World ready: {obstacles}, {items}, {worldItems}, {rooms}',
  'event.callsign.set': 'Nickname set: {name}',
  'event.equip.done': 'Equipped {item}',
  'event.equip.noProfile': 'Cannot equip: operator data not loaded',
  'event.unequipped': 'Unequipped {slot}',
  'event.unequip.failed': 'Unequip failed: not connected',
  'event.weapon.swapped': 'Swapped to {item}',
  'event.raid.deploying': 'Deploying...',
  'event.raid.deployFailed': 'Deploy failed: not connected',
  'event.raid.ended': 'Raid over: {result}',
  'event.drop.unavailable': 'Cannot drop items right now',
  'event.drop.done': 'Item dropped',
  'event.drop.failed': 'Drop failed: not connected',
  'event.market.bought': 'Bought {item}',
  'event.market.boughtEquip': 'Bought and equipped {item}',
  'event.market.boughtLoadout': 'Bought and added to loadout: {item}',
  'event.market.insufficient': 'Not enough credits: need {value}',
  'event.entity.selected': 'Entity selected: {id}',
  'event.entity.deselected': 'Entity deselected',

  // ===== Admin ============================================================
  'admin.confirm.resetAccount':
    'Reset this account and reconnect? All progress on it (credits, stash) is wiped.',
  'admin.confirm.resetWorld':
    'Reset the server world? Every player is disconnected and the map is regenerated.\n\nYour account data (credits, stash) is not affected.',
  'event.admin.requestingStatus': '[ADMIN] Requesting server status...',
  'event.admin.resettingWorld': '[ADMIN] Resetting world...',

  // ===== Chat command palette (client-side autocomplete) ===================
  // The commands themselves are handled server-side; these are the hints the
  // dropdown shows while you type.
  'chat.cmd.admin': 'Unlock admin access',
  'chat.cmd.help': 'List every command',
  'chat.cmd.maps': 'List available maps',
  'chat.cmd.players': 'List online players',
  'chat.cmd.ping': 'Measure connection latency',
  'chat.cmd.map': 'Switch map (admin)',
  'chat.cmd.reset': 'Reset the current room (admin)',
  'chat.cmd.give': 'Give credits to a player (admin)',
  'chat.cmd.heal': 'Heal a player (admin)',
  'chat.cmd.kill': 'Kill a player (admin)',
  'chat.cmd.kick': 'Kick a player (admin)',
  'chat.suggest.map': 'Switch to {map}',
  'chat.suggest.give': 'Give credits to {name}',
  'chat.suggest.heal': 'Heal {name}',
  'chat.suggest.kill': 'Kill {name}',
  'chat.suggest.kick': 'Kick {name}',

  // 服务端事件的客户端文案：服务端只发 key/参数，句子在这里成型
  'event.error': 'Error: {reason}',
  'event.autoEquip.weapon': 'Picked up and equipped {item}',
  'event.autoEquip.bag': 'Swapped to {item}',
  'event.autoEquip.armor': 'Swapped to {item}',
};
