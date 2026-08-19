/**
 * Typed accessors for the catalog entries that are looked up by id.
 *
 * Item, weapon and obstacle definitions carry no display strings at all — the
 * id is the key. This keeps one source of truth per name instead of the two
 * that used to drift apart between item_catalog and equipment.
 */
import { t, hasKey } from './index.js';
import type { Rarity } from '../types.js';
import type { COMBAT_ACTOR, COMBAT_WEAPON } from '../protocol.js';

/** Display name for any catalog item, weapon, bag or armor. */
export function itemName(typeId: string): string {
  return t(`item.${typeId}.name`);
}

/** Long description shown in the market and stash cards. */
export function itemDesc(typeId: string): string {
  return t(`item.${typeId}.desc`);
}

/**
 * Compact label for the in-raid hotbar. Falls back to the full name when an
 * item has no dedicated short form.
 */
export function itemShortName(typeId: string): string {
  const key = `item.${typeId}.short`;
  const short = t(key);
  return short === key ? itemName(typeId) : short;
}

export function rarityLabel(rarity: Rarity): string {
  return t(`rarity.${rarity.toLowerCase()}`);
}

export function obstacleName(type: string): string {
  return t(`obstacle.${type}.name`);
}

export function obstacleDesc(type: string): string {
  return t(`obstacle.${type}.desc`);
}

/** Enemy archetype shown in the kill feed and on nameplates. */
export function enemyName(kind: string): string {
  return t(`enemy.${kind}`);
}

/** Buff label drawn under the player. Resolved from the buff id, never sent over the wire. */
export function buffName(buffId: string): string {
  return t(`buff.${buffId}`);
}

/**
 * Display name for a combat participant.
 *
 * Player callsigns are user input and pass through untranslated; everything
 * else resolves from the catalog. Kill feed, nameplates, the HUD and the
 * debrief screen all render actors through here so they cannot drift apart.
 */
export function combatActorName(actor: COMBAT_ACTOR): string {
  switch (actor.kind) {
    case 'player':
      return actor.name;
    case 'enemy':
      return enemyName(actor.enemyKind);
    case 'turret':
      return actor.ownerName
        ? t('killfeed.turret.owned', { owner: actor.ownerName })
        : t('enemy.turret');
    case 'environment':
      return t('killfeed.environment');
    case 'admin':
      return t('killfeed.admin');
    default:
      return t('killfeed.unknown');
  }
}

/**
 * Display name for whatever did the killing.
 *
 * An unknown item id falls back to the raw id — showing `w_foo` beats showing
 * `item.w_foo.name` when a catalog entry is missing.
 */
export function combatWeaponName(weapon: COMBAT_WEAPON): string {
  if (weapon.kind === 'item') {
    return hasKey(`item.${weapon.itemTypeId}.name`) ? itemName(weapon.itemTypeId) : weapon.itemTypeId;
  }
  return t(`killfeed.weapon.${weapon.specialId}`);
}
