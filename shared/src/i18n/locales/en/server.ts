/**
 * Server-originated copy.
 *
 * The server never sends prose. It sends an event `key` plus `params`, an error
 * `code`, or a structured actor/weapon — every word below is rendered here.
 *
 * Param convention: a param named `item` always carries an item type id and must
 * be resolved through `itemName()` before interpolation. Everything else
 * (nicknames, counts, amounts, map ids) is interpolated verbatim.
 */
export const SERVER: Record<string, string> = {
  // ---------------------------------------------------------------------
  // HUD event log — S2C_EVENT keys pushed by the room
  // ---------------------------------------------------------------------
  'event.extract.loot_one': '{name} extracted with 1 item',
  'event.extract.loot_other': '{name} extracted with {count} items',
  'event.extract.empty': '{name} extracted empty-handed',
  'event.player.downed': '{name} went down, loot dropped',
  'event.chest.opened': '{name} opened a chest',
  'event.pickup.item': '{name} picked up {item} ×{qty}',
  'event.pickup.lootBag': '{name} looted a bag',
  'event.item.dropped': '{name} dropped {item} ×{qty}',
  'event.turret.deployed': '{name} deployed a Sentry Turret',
  'event.server.resetting': 'Server is resetting the world',

  // ---------------------------------------------------------------------
  // Chat commands
  // ---------------------------------------------------------------------
  'chat.self': '[You] {text}',

  'cmd.admin.granted': 'Admin access granted',
  'cmd.admin.denied': 'Wrong password',
  'cmd.adminOnly': 'Admin only',
  'cmd.map.usage': 'Usage: /map <map id>',
  'cmd.map.notFound': 'No map named {map}',
  'cmd.maps.list': 'Maps: {maps}',
  'cmd.players.roster_one': '1 player online',
  'cmd.players.roster_other': '{count} players online',
  'cmd.give.usage': 'Usage: /give <nickname> <amount>',
  'cmd.give.ok': 'Gave {amount} credits to {name}',
  'cmd.heal.usage': 'Usage: /heal <nickname>',
  'cmd.heal.ok': 'Healed {name}',
  'cmd.kill.usage': 'Usage: /kill <nickname>',
  'cmd.kill.ok': 'Killed {name}',
  'cmd.kick.usage': 'Usage: /kick <nickname>',
  'cmd.kick.ok': 'Kicked {name}',
  'cmd.playerNotFound': 'No player named {name}',
  'cmd.alivePlayerNotFound': 'No living player named {name}',
  'cmd.ping.pong': 'Pong',
  'cmd.unknown': 'Unknown command: /{command}',
  'cmd.status': 'Room · tick {tick} · {players} players · seed {seed}',
  'cmd.help.admin':
    '/admin <password> · /map <id> · /maps · /maplist · /reset · /players · /playerlist · /give <nickname> <amount> · /heal <nickname> · /kill <nickname> · /kick <nickname> · /ping · /help',
  'cmd.help.player': '/admin <password> · /maps · /maplist · /players · /playerlist · /ping · /help',

  // ---------------------------------------------------------------------
  // Errors — key is `error.` + the S2C_ERROR code, verbatim
  // ---------------------------------------------------------------------
  'error.session.notAuthenticated': 'Handshake not complete',
  'error.session.noAccount': 'Account not found',
  'error.session.badRequest': 'Malformed request',
  'error.session.adminDisabled': 'Admin commands are disabled',

  'error.stash.itemMissing': 'Item is not in your stash',
  'error.stash.notEnough': 'Not enough of that item in your stash',
  'error.loadout.locked': 'Loadout is locked during a raid',
  'error.loadout.full': 'Loadout is full',
  'error.loadout.overCapacity': 'Loadout exceeds backpack capacity',
  'error.loadout.itemMissing': 'Item is not in your loadout',
  'error.loadout.notEnough': 'Not enough of that item in your loadout',
  'error.market.notEnoughCredits': 'Not enough credits',
  'error.market.sellFailed': 'Cannot sell that item',

  'error.equip.slotMismatch': 'Item does not fit that slot',
  'error.equip.unknownSlot': 'Unknown equipment slot',
  'error.equip.unequipFailed': 'Cannot unequip that',
  'error.equip.weaponMissing': 'You are not carrying that weapon',
  'error.equip.invalidWeapon': 'Not a weapon',
  'error.equip.backpackRequired': 'Pick a backpack first',
  'error.equip.backpackMissing': 'You are not carrying that backpack',
  'error.equip.backpackTooSmall': 'Backpack is too small for what you are carrying',
  'error.equip.invalidBackpack': 'Not a backpack',
  'error.equip.armorMissing': 'You are not carrying that armor',
  'error.equip.invalidArmor': 'Not armor',

  'error.raid.notAlive': 'You are out of the fight',
  'error.inventory.full': 'Backpack is full',
  'error.inventory.itemMissing': 'Item not found',
  'error.inventory.unknownItem': 'Unknown item',
  'error.inventory.invalidQuantity': 'Invalid quantity',
  'error.inventory.invalidSlot': 'Nothing in that slot',
  'error.inventory.removeFailed': 'Could not use that item',
  'error.drop.weaponEquipped': 'Unequip the weapon first',
  'error.drop.backpackEquipped': 'Unequip the backpack first',
  'error.drop.armorEquipped': 'Unequip the armor first',

  'error.interact.noTarget': 'Nothing to interact with',
  'error.interact.itemGone': 'That item is gone',
  'error.interact.bagEmpty': 'Loot bag is empty',
  'error.interact.outOfReach': 'Out of reach',

  'error.use.busy': 'Already using an item',
  'error.use.fullHealth': 'Already at full health',
  'error.use.notUsable': 'That item cannot be used',
  'error.use.mustThrow': 'Aim and throw it',
  'error.throw.noThrowable': 'No throwable equipped',
  'error.throw.outOfRange': 'Target is out of range',

  // ---------------------------------------------------------------------
  // Enemy archetypes — COMBAT_ACTOR.enemyKind, via enemyName()
  // ---------------------------------------------------------------------
  'enemy.scout': 'Scout',
  'enemy.sniper': 'Sniper',
  'enemy.heavy': 'Heavy',
  'enemy.feral': 'Feral',
  'enemy.turret': 'Sentry Turret',

  // ---------------------------------------------------------------------
  // Buffs — PLAYER_BUFF.id, via buffName()
  // ---------------------------------------------------------------------

  // ---------------------------------------------------------------------
  // Kill feed / debrief — the COMBAT_ACTOR and COMBAT_WEAPON branches that
  // have no item id behind them
  // ---------------------------------------------------------------------
  'killfeed.environment': 'Environment',
  'killfeed.admin': 'Admin',
  'killfeed.unknown': 'Unknown',
  'killfeed.turret.owned': "{owner}'s Sentry Turret",
  'killfeed.weapon.fists': 'Fists',
  'killfeed.weapon.autocannon': 'Autocannon',
  'killfeed.weapon.console': 'Console',
  'killfeed.weapon.unknown': 'Unknown',
};
