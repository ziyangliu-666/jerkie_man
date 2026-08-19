/**
 * In-raid combat overlay copy: nameplates, status badges, AI/turret state
 * labels, loot tooltips and the extraction bar.
 *
 * Almost everything here is drawn on the canvas in a fixed-size badge, so keep
 * the wording short. See docs/LOCALIZATION.md §6 (text expansion).
 */
export const COMBAT: Record<string, string> = {
  // --- Nameplates -----------------------------------------------------------
  // Drawn over a dead player's body. Rendered as two lines, never concatenated.
  'combat.nameplate.corpse': "{name}'s corpse",
  'combat.nameplate.killedBy': 'Killed by {killer} · {weapon}',
  'combat.nameplate.killedByUnarmed': 'Killed by {killer}',

  // --- Status badges (drawn under the player) -----------------------------
  'combat.status.healing': 'HEALING',
  'combat.status.blinded': 'BLIND',
  'combat.status.stunned': 'STUNNED',
  'combat.status.concealed': 'CONCEALED',

  // --- Buffs ----------------------------------------------------------------
  // Resolved from the buff id via buffName(); never sent over the wire.
  'buff.combat_stim': 'STIMMED',
  'buff.regeneration_serum': 'REGEN',
  'buff.disguise_kit': 'DISGUISED',

  // --- AI behaviour states --------------------------------------------------
  // `combat.ai.idle` is deliberately not "Idle" — the Chinese is a joke about
  // goofing off on the job, and the English keeps that.
  'combat.ai.idle': 'SLACKING',
  'combat.ai.patrol': 'PATROL',
  'combat.ai.spotting': 'CONTACT',
  'combat.ai.chase': 'PURSUING',
  'combat.ai.attack': 'ENGAGING',
  'combat.ai.search': 'SEARCHING',
  'combat.ai.return': 'RETURNING',

  // --- Sentry turret states -------------------------------------------------
  'combat.turret.idle': 'STANDBY',
  'combat.turret.spooling': 'SPOOLING',
  'combat.turret.firing': 'FIRING',
  'combat.turret.reloading': 'RELOADING',

  // --- Loot bag tooltip -----------------------------------------------------
  'combat.loot.empty': 'Empty loot bag',
  'combat.loot.more_one': '… +{count} more item',
  'combat.loot.more_other': '… +{count} more items',

  // --- Extraction bar -------------------------------------------------------
  'combat.extract.inProgress': 'EXTRACTING…',

  // --- Throwable aiming -----------------------------------------------------
  'combat.throw.hint': 'LMB THROW · RMB CANCEL',
};
