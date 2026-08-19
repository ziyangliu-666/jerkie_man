/**
 * Stat labels for weapon, armor, backpack and consumable cards, plus the one
 * equipment name that has no entry in the item catalog.
 *
 * Conventions for callers:
 * - Every `stat.*` key is a bare label. Render it as `${label}: ${value}` and
 *   join the pairs with ` | `.
 * - Where English wants the unit inside the value, use the `unit.*` templates:
 *   `t('unit.sec', { value: 5 })` -> `5s`.
 * - Where English word order differs from label-colon-value, the label has a
 *   `.fmt` twin that carries the whole fragment: `t('stat.rpm.fmt', { value })`
 *   -> `900 RPM`. Prefer the `.fmt` form when one exists.
 * - `stat.capacity` resolves to the bare label with no count, and to the whole
 *   `Capacity: 8 slots` fragment when called with one.
 */
export const EQUIPMENT: Record<string, string> = {
  // Default melee weapon. Not in the item catalog, so its name lives here.
  'item.w_fists.name': 'Fists',

  // --- Weapons ---
  'stat.damage': 'Damage',
  'stat.pellets': 'Pellets',
  'stat.mag': 'Mag',
  'stat.range': 'Range',
  'stat.reach': 'Reach', // melee swing range
  'stat.rpm': 'RPM',
  'stat.rpm.fmt': '{value} RPM',
  'stat.speed': 'Speed', // movement modifier carried by heavy or light gear

  // --- Armor ---
  'stat.armor': 'Damage Reduction',

  // --- Backpacks ---
  'stat.capacity': 'Capacity',
  'stat.capacity_one': 'Capacity: {count} slot',
  'stat.capacity_other': 'Capacity: {count} slots',

  // --- Consumables ---
  'stat.heal': 'Restores',
  'stat.radius': 'Blast Radius',
  'stat.duration': 'Duration',
  'stat.dps': 'Burn',
  'stat.blindRadius': 'Flash Radius',
  'stat.blindDuration': 'Blind',
  'stat.smokeRadius': 'Smoke Radius',
  'stat.fireRadius': 'Fire Radius',
  'stat.speedBonus': 'Speed',
  'stat.regen': 'Regen',
  'stat.disguiseDuration': 'Disguise',

  // --- Any item ---
  'stat.value': 'Value',
  'stat.stackMax': 'Max Stack',

  // --- Units ---
  'unit.hp': '{value} HP',
  'unit.hps': '{value} HP/s',
  'unit.sec': '{value}s',
  'unit.px': '{value} px',
};
