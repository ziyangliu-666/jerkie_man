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
  'item.medkit.desc': '1 second locked in place — no moving, no shooting, no cancelling. Break contact first.',
  'item.medkit.short': 'MED',

  'item.advanced_medkit.name': 'Trauma Kit',
  'item.advanced_medkit.desc': 'A full heal for the same 1 second of standing perfectly still. Bigger, not faster.',
  'item.advanced_medkit.short': 'TRAUMA',

  'item.combat_stim.name': 'Combat Stim',
  'item.combat_stim.desc': 'Instant, no lockout. Take it mid-fight, or to close the last gap to an exfil.',
  'item.combat_stim.short': 'STIM',

  'item.regeneration_serum.name': 'Regen Serum',
  'item.regeneration_serum.desc': 'Instant, and it heals while you move and shoot. Too slow to save a losing fight.',
  'item.regeneration_serum.short': 'REGEN',

  // --- Throwables -----------------------------------------------------------
  'item.frag_grenade.name': 'Frag Grenade',
  'item.frag_grenade.desc': 'Armor blunts it, and being the thrower earns no exemption. Mind your own blast.',
  'item.frag_grenade.short': 'FRAG',

  'item.flash_grenade.name': 'Flashbang',
  'item.flash_grenade.desc': 'No damage at all. Players lose the screen, AI lose you outright — then you move.',
  'item.flash_grenade.short': 'FLASH',

  'item.smoke_grenade.name': 'Smoke Grenade',
  'item.smoke_grenade.desc': 'AI cannot pick you out of it, or shoot at all from inside it. Turrets are blind too.',
  'item.smoke_grenade.short': 'SMOKE',

  'item.molotov.name': 'Molotov',
  'item.molotov.desc': 'Fire ignores armor completely and does not care who lit it. Never throw it short.',
  'item.molotov.short': 'MOLLY',

  // --- Tactical -------------------------------------------------------------
  'item.w_decoy.name': 'Holo Decoy',
  'item.w_decoy.desc': 'A hologram that runs and pulls AI fire. Shot down, it stuns 150px for 3s — you too.',
  'item.w_decoy.short': 'DECOY',

  'item.i_sentry_turret.name': 'Sentry Turret',
  'item.i_sentry_turret.desc': 'Holds a 400px bubble and never shoots you. Blind to anything in a bush or smoke.',
  'item.i_sentry_turret.short': 'SENTRY',

  'item.i_disguise.name': 'Mimic Serum',
  'item.i_disguise.desc': 'Every AI reads you as one of their own and walks past. Any damage breaks it at once.',
  'item.i_disguise.short': 'MIMIC',

  // --- Salvage --------------------------------------------------------------
  'item.scrap_metal.name': 'Scrap Metal',
  'item.scrap_metal.desc': 'Plate and rebar stripped off anything that stopped moving. Cheap, but always sells.',

  'item.cloth.name': 'Cloth',
  'item.cloth.desc': 'Torn fabric off furniture and bedrolls. The cheapest thing worth bending down for.',

  'item.electronics.name': 'Electronics',
  'item.electronics.desc': 'Boards and sensors pulled from dead gear. Small, and worth far more than scrap.',

  'item.medical_supplies.name': 'Medical Supplies',
  'item.medical_supplies.desc': 'Sealed clinical stock. Traders pay well — it will not patch you up in a raid.',

  'item.weapon_parts.name': 'Weapon Parts',
  'item.weapon_parts.desc': 'Gunsmith-grade springs and barrel blanks. Trade stock: nothing here can be modded.',

  'item.rare_metal.name': 'Rare Alloy',
  'item.rare_metal.desc': 'Aerospace billet, light and absurdly strong. Take it over anything common.',

  'item.advanced_circuit.name': 'Advanced Circuit',
  'item.advanced_circuit.desc': 'An intact military board. One of the best credit-per-slot pickups in a raid.',

  'item.legendary_core.name': 'Reactor Core',
  'item.legendary_core.desc': 'A sealed power core, still warm. Its whole purpose is surviving the trip out.',

  'item.pure_gold.name': 'Gold Bullion',
  'item.pure_gold.desc': 'Refined, unmarked, untraceable. Zero tactical use, maximum resale.',

  // --- Weapons --------------------------------------------------------------
  'item.w_pistol.name': 'Pistol',
  'item.w_pistol.desc': 'A starting sidearm. Reliable, and outclassed by almost anything you will find.',

  'item.w_smg.name': 'SMG',
  'item.w_smg.desc': 'Room-clearing volume fire. Past a hallway the spread turns every burst into a guess.',

  'item.w_burst.name': 'Burst Rifle',
  'item.w_burst.desc': 'Three-round bursts, tight spread. The disciplined answer to mid-range fights.',

  'item.w_dmr.name': 'DMR',
  'item.w_dmr.desc': 'Semi-auto precision. A thin mag and a slow reload punish every shot you waste.',

  'item.w_shotgun.name': 'Pump Shotgun',
  'item.w_shotgun.desc': 'A doorway weapon and nothing else. Pellets die out fast and the pump is slow.',

  'item.w_sniper.name': 'Sniper Rifle',
  'item.w_sniper.desc': 'One shot decides the fight at range. Miss, and the reload leaves you open.',

  'item.w_grenade_launcher.name': 'Grenade Launcher',
  'item.w_grenade_launcher.desc': 'One 40mm at a time. The blast does the killing, and it cooks off 3 seconds out.',

  'item.w_minigun.name': 'Minigun',
  'item.w_minigun.desc': 'Suppression, not mobility. Spin up, hold the lane, and pray it does not run dry.',

  'item.w_anti_material.name': 'Anti-Materiel Rifle',
  'item.w_anti_material.desc': 'Reaches anywhere on the map and one-shots the unarmored. It still cannot punch cover.',

  'item.w_double_barrel.name': 'Double-Barrel Shotgun',
  'item.w_double_barrel.desc': 'Both barrels or nothing. Contact range only, and the reload is an eternity.',

  'item.w_laser_rifle.name': 'Laser Rifle',
  'item.w_laser_rifle.desc': 'Zero spread, near-instant bolts. No leading a runner — point and it is already there.',

  'item.w_crossbow.name': 'Crossbow',
  'item.w_crossbow.desc': 'Quiet-looking, not quiet. Bolts are spent on firing, and AI hunt by sight anyway.',

  'item.w_auto_shotgun.name': 'Auto Shotgun',
  'item.w_auto_shotgun.desc': 'Full-auto buckshot. Devastating in a hallway, and dry before you notice.',

  'item.w_precision_rifle.name': 'Marksman Rifle',
  'item.w_precision_rifle.desc': 'Sniper damage on a rifleman rhythm. No punishment for taking a second shot.',

  'item.w_micro_smg.name': 'Machine Pistol',
  'item.w_micro_smg.desc': 'Brutal in a doorway, useless across a courtyard. Spray it, do not aim it.',

  'item.w_chainsaw.name': 'Chainsaw',
  'item.w_chainsaw.desc': 'Shreds whatever is in front of you. Ignores armor, and only ever bites one target.',

  'item.w_burst_grenade_launcher.name': 'Auto Grenade Launcher',
  'item.w_burst_grenade_launcher.desc': 'Area denial. Walk explosions across a choke point and nothing comes through it.',

  'item.w_katana.name': 'Katana',
  'item.w_katana.desc': 'One clean cut kills most things here. Ignores armor, and you carry it light.',

  'item.w_sledgehammer.name': 'Sledgehammer',
  'item.w_sledgehammer.desc': 'Nothing survives a clean hit. Between swings you are a slow, obvious target.',

  'item.w_whip.name': 'Whip',
  'item.w_whip.desc': 'Kills from further out than any other melee, through a sliver you must aim exactly.',

  'item.w_bubble_gun.name': 'Bubble Gun',
  'item.w_bubble_gun.desc': 'Fills the air with slow, long-lived bubbles. They hurt. They do not slow anyone.',

  // --- Backpacks ------------------------------------------------------------
  'item.bag_sling.name': 'Sling Bag',
  'item.bag_sling.desc': 'Barely a bag, but it beats deploying with pockets.',

  'item.bag_daypack.name': 'Daypack',
  'item.bag_daypack.desc': 'The baseline for a raid you intend to profit from.',

  'item.bag_tactical.name': 'Tactical Pack',
  'item.bag_tactical.desc': 'Organized load-bearing space, and enough of it to be worth the credits.',

  'item.bag_expedition.name': 'Expedition Pack',
  'item.bag_expedition.desc': 'Enough to strip a whole compound in one trip.',

  'item.bag_military.name': 'Military Rucksack',
  'item.bag_military.desc': 'The largest pack in the game. Nothing else comes close.',

  // --- Armor ----------------------------------------------------------------
  'item.armor_light.name': 'Light Vest',
  'item.armor_light.desc': 'Token protection at no cost to your legs. Better than deploying in a shirt.',

  'item.armor_kevlar.name': 'Kevlar Vest',
  'item.armor_kevlar.desc': 'Holds up against small-caliber fire, and you will not feel it while moving.',

  'item.armor_plate.name': 'Plate Carrier',
  'item.armor_plate.desc': 'Ceramic plates. Standard kit for a raid you plan on coming back from.',

  'item.armor_heavy.name': 'Heavy Armor',
  'item.armor_heavy.desc': 'The hardest plating in the game. You will be slower, and fire still ignores it.',

  'item.armor_exo.name': 'Exo Armor',
  'item.armor_exo.desc': 'The only armor that makes you faster instead of slower. Priced accordingly.',
};
