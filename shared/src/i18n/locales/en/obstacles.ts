/**
 * Obstacle names and tooltip copy.
 *
 * Descriptions state what the simulation actually does: whether the thing stops
 * you, how much damage a round keeps after passing through it, how much punishment
 * it takes before it breaks, and what it leaves behind.
 */
export const OBSTACLES: Record<string, string> = {
  'obstacle.wall.name': 'Stone Wall',
  'obstacle.wall.desc': 'Blocks movement, bullets and line of sight. Nothing you carry will bring it down.',

  'obstacle.crate.name': 'Wooden Crate',
  'obstacle.crate.desc': 'Hard cover — rounds stop dead. Breaks after 100 damage, and about a third of the time something falls out of it.',

  'obstacle.weapon_crate.name': 'Weapon Crate',
  'obstacle.weapon_crate.desc': 'Hard cover, 100 HP. Break it open for one weapon; 5% of the time a Legendary one.',

  'obstacle.throwable_crate.name': 'Ordnance Crate',
  'obstacle.throwable_crate.desc': 'Hard cover, 100 HP. Breaking it scatters 2-4 throwables — frags, smoke, flashbangs, incendiaries.',

  'obstacle.medical_crate.name': 'Medical Crate',
  'obstacle.medical_crate.desc': 'Hard cover, 100 HP. Breaking it drops 2-3 medical items.',

  'obstacle.equipment_crate.name': 'Equipment Crate',
  'obstacle.equipment_crate.desc': 'Hard cover, 100 HP. Breaking it drops one armor piece or backpack; 5% of the time a Legendary one.',

  'obstacle.vehicle.name': 'Wrecked Car',
  'obstacle.vehicle.desc': 'Rounds punch through the panels and keep 20% of their damage. 150 HP, and the wreck leaves 1-2 pieces of low-grade loot.',

  'obstacle.supply_stack.name': 'Supply Stack',
  'obstacle.supply_stack.desc': 'Rounds bleed through at 30% damage. Topples after 100 damage and scatters 2-4 low-tier items.',

  'obstacle.fence_wood.name': 'Wooden Fence',
  'obstacle.fence_wood.desc': 'Low enough to push straight through at 80% speed. Rounds come through at 70% damage, and 50 damage flattens the section.',

  'obstacle.fence_metal.name': 'Metal Fence',
  'obstacle.fence_metal.desc': 'Stops you but not incoming fire — rounds come through at 50% damage. 100 HP.',

  'obstacle.shrub.name': 'Scrub',
  'obstacle.shrub.desc': 'Thin growth. Bodies and bullets pass straight through and it drags you to 90% speed, but hostiles cannot see through it.',

  'obstacle.rock_large.name': 'Boulder',
  'obstacle.rock_large.desc': 'Hard cover that cannot be destroyed. Blocks movement, bullets and line of sight.',

  'obstacle.bush.name': 'Bush',
  'obstacle.bush.desc': 'Step inside and hostiles lose you — anyone already tracking you keeps a rough fix on your position. Stops neither movement nor bullets.',

  'obstacle.water.name': 'Water',
  'obstacle.water.desc': 'Wadeable at half speed. Bullets and sightlines cross it freely.',

  'obstacle.door_closed.name': 'Door (Closed)',
  'obstacle.door_closed.desc': 'Blocks movement, fire and sight. There is no way to open it — put 100 damage through it.',

  'obstacle.door_open.name': 'Door (Open)',
  'obstacle.door_open.desc': 'Clear doorway. It cannot be shut again.',

  'obstacle.glass.name': 'Glass Pane',
  'obstacle.glass.desc': 'You cannot walk through it, but rounds pass at 90% damage. 30 HP — one burst and it is gone.',

  'obstacle.chest_closed.name': 'Loot Cache',
  'obstacle.chest_closed.desc': 'Break it open with 100 damage — it does not unlock any other way. Pays out two high-tier items: 80% Epic, 20% Legendary.',

  'obstacle.chest_open.name': 'Looted Cache',
  'obstacle.chest_open.desc': 'Already emptied. Walk straight over it.',

  'obstacle.broken.name': 'Rubble',
  'obstacle.broken.desc': 'What is left where cover used to be. Blocks nothing.',
};
