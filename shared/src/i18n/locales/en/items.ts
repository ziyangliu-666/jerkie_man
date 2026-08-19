/**
 * Item names, descriptions and hotbar labels — ZIYANG PROTOCOL
 *
 * Key format derives from the catalog id: item.<id>.name / .desc / .short
 * `.short` is the in-raid hotbar icon label: 3-6 characters, ALL CAPS.
 *
 * English is the source language. Every number below is read out of
 * item_catalog.ts, equipment.ts or the server sim — if the code changes,
 * this file changes with it.
 */
export const ITEMS: Record<string, string> = {
  // --- Rarity ---------------------------------------------------------------
  'rarity.common': 'Common',
  'rarity.rare': 'Rare',
  'rarity.epic': 'Epic',
  'rarity.legendary': 'Legendary',

  // --- Medical --------------------------------------------------------------
  'item.medkit.name': 'Medkit',
  'item.medkit.desc': 'Restores 50 health. Locks you in place for 1 second while it goes in — you cannot move, shoot, or stop it once it starts.',
  'item.medkit.short': 'MED',

  'item.advanced_medkit.name': 'Trauma Kit',
  'item.advanced_medkit.desc': 'Restores 100 health, a full recovery from any survivable state. Same 1 second lockout as a standard medkit — it is bigger, not faster.',
  'item.advanced_medkit.short': 'TRAUMA',

  'item.combat_stim.name': 'Combat Stim',
  'item.combat_stim.desc': '+40% movement speed for 15 seconds. Takes effect instantly with no lockout, so it works mid-fight and mid-retreat.',
  'item.combat_stim.short': 'STIM',

  'item.regeneration_serum.name': 'Regen Serum',
  'item.regeneration_serum.desc': 'Heals 15 health per second for 20 seconds — 300 health if you live through all of it. Applies instantly and keeps working while you move and shoot.',
  'item.regeneration_serum.short': 'REGEN',

  // --- Throwables -----------------------------------------------------------
  'item.frag_grenade.name': 'Frag Grenade',
  'item.frag_grenade.desc': 'Up to 300 damage inside a 100px blast, falling off toward the edge. Armor cuts it down; throwing it does not exempt you from it.',
  'item.frag_grenade.short': 'FRAG',

  'item.flash_grenade.name': 'Flashbang',
  'item.flash_grenade.desc': 'Blinds everything within 150px for 5 seconds. Players lose their screen, AI lose target acquisition completely. Deals no damage.',
  'item.flash_grenade.short': 'FLASH',

  'item.smoke_grenade.name': 'Smoke Grenade',
  'item.smoke_grenade.desc': 'A 200px smoke cloud for 15 seconds. AI cannot pick out targets inside it and cannot shoot while standing in it — sentry turrets are blind to it too.',
  'item.smoke_grenade.short': 'SMOKE',

  'item.molotov.name': 'Molotov',
  'item.molotov.desc': 'Burns a 120px zone for 8 seconds at 100 damage per second. Fire ignores armor entirely and does not care who lit it.',
  'item.molotov.short': 'MOLLY',

  // --- Tactical -------------------------------------------------------------
  'item.w_decoy.name': 'Holo Decoy',
  'item.w_decoy.desc': 'Throws out a running hologram carrying your weapon and armor: 50 health, 15 seconds, and AI will shoot at it. Destroy it and it bursts — everything within 150px is stunned for 3 seconds, you included.',
  'item.w_decoy.short': 'DECOY',

  'item.i_sentry_turret.name': 'Sentry Turret',
  'item.i_sentry_turret.desc': 'Deploys at your feet for 30 seconds. 150 health, 400px engagement range, SMG fire at 10 rounds per second. It never targets you, and it cannot see anything sitting in a bush or in smoke.',
  'item.i_sentry_turret.short': 'SENTRY',

  'item.i_disguise.name': 'Mimic Serum',
  'item.i_disguise.desc': 'For 30 seconds every AI reads you as one of their own and walks straight past. Taking any damage burns it off instantly.',
  'item.i_disguise.short': 'MIMIC',

  // --- Salvage --------------------------------------------------------------
  'item.scrap_metal.name': 'Scrap Metal',
  'item.scrap_metal.desc': 'Stripped plate and rebar off anything that stopped moving. Low value, stacks 20 deep, and the Market always buys.',

  'item.cloth.name': 'Cloth',
  'item.cloth.desc': 'Torn fabric cut from furniture and bedrolls. The cheapest bulk salvage on the map — 30 to a stack, and selling it is the only thing it is for.',

  'item.electronics.name': 'Electronics',
  'item.electronics.desc': 'Intact boards and sensors pulled from dead equipment. Small, stacks 10 deep, and worth far more per slot than scrap.',

  'item.medical_supplies.name': 'Medical Supplies',
  'item.medical_supplies.desc': 'Sealed clinical stock in sale condition. Traders pay well for it — it will not patch you up in a raid.',

  'item.weapon_parts.name': 'Weapon Parts',
  'item.weapon_parts.desc': 'Bolts, springs and barrel blanks in gunsmith condition. Trade stock only: nothing in the field can be repaired or modified with it.',

  'item.rare_metal.name': 'Rare Alloy',
  'item.rare_metal.desc': 'Aerospace-grade billet, light and absurdly strong. High credits per slot — take it over anything common.',

  'item.advanced_circuit.name': 'Advanced Circuit',
  'item.advanced_circuit.desc': 'An intact military-grade board. One of the best credit-per-slot pickups in a raid, and only 3 fit in a stack.',

  'item.legendary_core.name': 'Reactor Core',
  'item.legendary_core.desc': 'A sealed power core, still warm to the touch. Nothing in the field can use it — its entire purpose is to survive the trip out.',

  'item.pure_gold.name': 'Gold Bullion',
  'item.pure_gold.desc': 'A bar of refined gold, unmarked and untraceable. Zero tactical use, maximum resale, and 5 fit in a single slot.',

  // --- Weapons --------------------------------------------------------------
  'item.w_pistol.name': 'Pistol',
  'item.w_pistol.desc': 'Standard sidearm. 25 damage a shot, 6 in the mag, 1.5 second reload. Reliable, and outclassed by nearly everything you will find in the field.',

  'item.w_smg.name': 'SMG',
  'item.w_smg.desc': '600 rounds per minute from a 30-round mag at 20 damage a hit. Volume fire for clearing rooms — 5° of spread makes anything past a hallway a coin flip.',

  'item.w_burst.name': 'Burst Rifle',
  'item.w_burst.desc': 'Fires 3-round bursts of 30 damage with tight 2° spread. The disciplined answer to mid-range fights.',

  'item.w_dmr.name': 'DMR',
  'item.w_dmr.desc': 'Semi-automatic, 50 damage a shot, effective past 1900px. A 10-round mag and a 3 second reload reward hitting what you aim at.',

  'item.w_shotgun.name': 'Pump Shotgun',
  'item.w_shotgun.desc': '8 pellets of 20 damage a shell — 160 if all of them land. Pellets die out at 180px, so this is a doorway weapon and nothing else.',

  'item.w_sniper.name': 'Sniper Rifle',
  'item.w_sniper.desc': '90 damage a shot, near-zero spread, and reach across most of the map. 5 rounds, then a 3.8 second reload you will feel.',

  'item.w_grenade_launcher.name': 'Grenade Launcher',
  'item.w_grenade_launcher.desc': 'One 40mm at a time: 400 explosion damage across a 200px radius. The round cooks off 3 seconds after it leaves the tube whether it hits anything or not.',

  'item.w_minigun.name': 'Minigun',
  'item.w_minigun.desc': '1200 rounds per minute out of a 200-round belt at 18 damage each. Costs 25% of your movement speed while equipped, and the 6 second reload leaves you defenseless.',

  'item.w_anti_material.name': 'Anti-Materiel Rifle',
  'item.w_anti_material.desc': '150 damage a round at 2000px per second, accurate anywhere on the map and lethal in one hit to an unarmored target. It does not punch through cover any better than a pistol — penetration is decided by the wall, not the caliber.',

  'item.w_double_barrel.name': 'Double-Barrel Shotgun',
  'item.w_double_barrel.desc': 'Two shells, 12 pellets each, 300 damage a barrel at contact range. 150px of reach and a 4 second reload: both barrels or nothing.',

  'item.w_laser_rifle.name': 'Laser Rifle',
  'item.w_laser_rifle.desc': 'Zero spread and 3000px per second bolts — no lead, no drift, it lands exactly where the crosshair sits. 35 damage at 400 rounds per minute out to 1500px.',

  'item.w_crossbow.name': 'Crossbow',
  'item.w_crossbow.desc': '60 damage a bolt with 0.5° spread and 5 in the magazine. Bolts are spent on firing and cannot be recovered, and it is no stealthier than a rifle — AI find you by sight, not by sound.',

  'item.w_auto_shotgun.name': 'Auto Shotgun',
  'item.w_auto_shotgun.desc': 'Full-auto shells at 400 rounds per minute, 6 pellets of 18 damage each. 12 in the mag, 220px of reach, and a 4 second reload once you run it dry.',

  'item.w_precision_rifle.name': 'Marksman Rifle',
  'item.w_precision_rifle.desc': '65 damage a shot, a 15-round magazine, and 0.4° spread out to 2500px. Sniper damage on a rifleman rhythm.',

  'item.w_micro_smg.name': 'Machine Pistol',
  'item.w_micro_smg.desc': '1000 rounds per minute from a 50-round mag at 12 damage a bullet. 12° of spread and 595px of reach: brutal in a doorway, useless across a courtyard.',

  'item.w_chainsaw.name': 'Chainsaw',
  'item.w_chainsaw.desc': '20 hits a second at 15 damage each — 300 damage per second across a wide 180° arc. All of it lives inside 60px.',

  'item.w_burst_grenade_launcher.name': 'Auto Grenade Launcher',
  'item.w_burst_grenade_launcher.desc': 'Six grenades on a 450ms cycle, 180 explosion damage in a 100px radius each. Area denial for choke points and anything that has to come through a door.',

  'item.w_katana.name': 'Katana',
  'item.w_katana.desc': '120 damage a swing at 80px reach in a 90° arc, plus 15% movement speed while carried. One clean cut kills most things on the map.',

  'item.w_sledgehammer.name': 'Sledgehammer',
  'item.w_sledgehammer.desc': '250 damage a swing — nothing survives a clean hit. The swing cycles once every 1.2 seconds and you move 30% slower carrying it.',

  'item.w_whip.name': 'Whip',
  'item.w_whip.desc': '350px of melee reach, over four times any other close-quarters weapon, through a 5° sliver you have to aim exactly. Only 10 damage a strike: it kills by distance and patience, not force.',

  'item.w_bubble_gun.name': 'Bubble Gun',
  'item.w_bubble_gun.desc': '1200 rounds per minute of 20-damage bubbles, 400 damage per second held on target. Bubbles crawl at 200px per second and stay live for 10 seconds, so sustained fire leaves a slow-drifting screen of them hanging in the air.',

  // --- Backpacks ------------------------------------------------------------
  'item.bag_sling.name': 'Sling Bag',
  'item.bag_sling.desc': '8 slots. Barely a bag, but it beats deploying with pockets.',

  'item.bag_daypack.name': 'Daypack',
  'item.bag_daypack.desc': '12 slots. The baseline for a raid you intend to profit from.',

  'item.bag_tactical.name': 'Tactical Pack',
  'item.bag_tactical.desc': '16 slots of organized load-bearing space.',

  'item.bag_expedition.name': 'Expedition Pack',
  'item.bag_expedition.desc': '20 slots. Enough to strip a whole compound in one trip.',

  'item.bag_military.name': 'Military Rucksack',
  'item.bag_military.desc': '24 slots — the largest pack in the game. Nothing else comes close.',

  // --- Armor ----------------------------------------------------------------
  'item.armor_light.name': 'Light Vest',
  'item.armor_light.desc': '10% damage reduction with no movement penalty.',

  'item.armor_kevlar.name': 'Kevlar Vest',
  'item.armor_kevlar.desc': '25% damage reduction. Holds up against small-caliber fire.',

  'item.armor_plate.name': 'Plate Carrier',
  'item.armor_plate.desc': '40% damage reduction from ceramic plates. The standard kit for a serious raid.',

  'item.armor_heavy.name': 'Heavy Armor',
  'item.armor_heavy.desc': '70% damage reduction, the hardest plating in the game. You move 20% slower in it, and burn damage still ignores armor completely.',

  'item.armor_exo.name': 'Exo Armor',
  'item.armor_exo.desc': '55% damage reduction and 25% more movement speed. The only armor that makes you faster instead of slower.',
};
