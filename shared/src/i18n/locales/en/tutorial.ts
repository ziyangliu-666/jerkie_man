/**
 * First-run onboarding and the Field Guide.
 *
 * This is the one place in the catalog where a conversational register is
 * allowed (see docs/LOCALIZATION.md §2) — still terse, still operational,
 * never a manual. One or two sentences per card.
 *
 * Every number here is read out of the simulation, not out of the design docs:
 * extraction is 5s and automatic, pickup reach is 40px, crates take 100 damage
 * and are shot open rather than opened, armor tops out at 70% reduction.
 *
 * `**text**` renders as an accent span in card bodies, objectives and the
 * field-rule list. Titles, section headers, key rows and item tips are plain
 * text — no markers there.
 */
export const TUTORIAL: Record<string, string> = {
  // --- Card chrome ---
  'tutorial.badge': 'FIELD TRAINING',
  'tutorial.progress': '{current} / {total}',
  'tutorial.btn.next': 'Next',
  'tutorial.btn.finish': 'Done',
  'tutorial.btn.gotit': 'Got It',
  'tutorial.btn.skip': 'Skip Tutorial',
  'tutorial.btn.guide': 'Field Guide',
  'tutorial.btn.close': 'Close',

  // --- Hideout ---
  'tutorial.hideout.welcome.title': 'Welcome to the Hideout',
  'tutorial.hideout.welcome.body':
    'This is the only place your gear is safe. Kit up, then Deploy. Whatever you carry out that door is what you can lose.',

  'tutorial.hideout.gear.title': 'Three Slots',
  'tutorial.hideout.gear.body':
    'Weapon, Backpack, Armor — click a slot to equip from your Stash. The backpack sets how much you can carry, the armor sets your damage reduction: **10%** on the cheap plates, **70%** on the best.',

  'tutorial.hideout.loadout.title': 'Loadout',
  'tutorial.hideout.loadout.body':
    'Loadout is what ships out with you, and it holds exactly as many slots as your backpack. Anything left in the Stash cannot be taken off you.',

  'tutorial.hideout.market.title': 'Market',
  'tutorial.hideout.market.body':
    'Buy straight into your Stash, sell whatever you hauled home. Materials have no other use — there is no crafting anywhere, they are cargo you cash in.',

  'tutorial.hideout.deploy.title': 'Deploy',
  'tutorial.hideout.deploy.body':
    'Go when you are ready. Extract and the haul is banked; go down and the whole kit stays on the map. First few runs, take gear you can afford to lose.',

  // --- Raid ---
  'tutorial.raid.move.title': 'Move',
  'tutorial.raid.move.body': '**WASD**. Eight directions, and diagonals are not faster.',
  'tutorial.raid.move.objective': 'Move with WASD',

  'tutorial.raid.fire.title': 'Aim and Fire',
  'tutorial.raid.fire.body':
    'You aim wherever the cursor sits. **Left click** fires — hold it down for full-auto, one click per burst on burst weapons. Empty hands means a melee swing instead, and melee ignores armor completely.',
  'tutorial.raid.fire.objective': 'Take a shot',

  'tutorial.raid.reload.title': 'Reload',
  'tutorial.raid.reload.body':
    '**R** reloads. It does nothing on a full mag or mid-reload. Run the mag dry and the next click reloads for you.',
  'tutorial.raid.reload.objective': 'Reload',

  'tutorial.raid.sprint.title': 'Sprint',
  'tutorial.raid.sprint.body':
    'Hold **Space** for 1.5x speed at 20 stamina a second. Burn the bar to zero and you are locked out until it climbs back past **35%** — until then the bar just twitches at you.',
  'tutorial.raid.sprint.objective': 'Sprint',

  'tutorial.raid.breach.title': 'Nothing Opens',
  'tutorial.raid.breach.body':
    'There is no open key. Crates, caches and doors come apart under fire — about **100 damage** each — and the contents hit the floor.',

  'tutorial.raid.loot.title': 'Pick Up',
  'tutorial.raid.loot.body':
    '**E** takes items and loot bags, and only from **40px** out. Stand on top of it: if the prompt is not lit, you are not close enough.',
  'tutorial.raid.loot.objective': 'Pick something up',

  'tutorial.raid.autoequip.title': 'It Swaps Itself',
  'tutorial.raid.autoequip.body':
    'A bigger backpack or better armor equips the moment you touch it and the old one drops into your bag. Empty-handed, the first gun you pick up is the gun you are holding. Check your slots after a looting run.',

  'tutorial.raid.hotbar.title': 'Consumables',
  'tutorial.raid.hotbar.body':
    '**1** through **5** uses what is in your bag. A throwable arms an aiming cursor first — **left click** throws, **right click** backs out. Frags do not care who threw them. The Field Guide has the rest.',

  'tutorial.raid.extract.title': 'Extraction',
  'tutorial.raid.extract.body':
    'The green box is your way out. No key, no prompt — stand inside it for **5 seconds** without a break. Step out, or get pushed out, and the timer drops straight back to zero.',
  'tutorial.raid.extract.objective': 'Reach the extraction zone',

  // --- Debrief ---
  'tutorial.result.extracted.title': 'You Made It Out',
  'tutorial.result.extracted.body':
    'Your bag emptied into the Stash and paid out on the way. That is the loop: go in light, come out heavy, and leave before the map decides for you.',

  'tutorial.result.kia.title': 'You Lost the Kit',
  'tutorial.result.kia.body':
    'Everything you carried is a loot bag on the ground where you fell — bag, weapon, backpack, armor — and it is gone from your Stash. Only what you left at the Hideout survived. Run cheap until the map is yours.',

  // --- Field Guide ---
  'tutorial.guide.launcher': 'Field Guide',
  'tutorial.guide.title': 'Field Guide',
  'tutorial.guide.subtitle': 'Controls, hard rules, and what the gear actually does',
  'tutorial.guide.section.controls': 'CONTROLS',
  'tutorial.guide.section.rules': 'FIELD RULES',
  'tutorial.guide.section.medical': 'MEDICAL',
  'tutorial.guide.section.ordnance': 'ORDNANCE',
  'tutorial.guide.section.tactical': 'TACTICAL',
  'tutorial.guide.section.salvage': 'SALVAGE',

  'tutorial.guide.rule.extract':
    'Extraction runs itself. **5 seconds** inside the green zone, no key press, and leaving resets the timer to zero.',
  'tutorial.guide.rule.breach':
    'Crates, caches and doors are shot open, not opened. Roughly **100 damage** each.',
  'tutorial.guide.rule.reach': 'Pickup reach is **40px**. If the prompt is dark, you are too far out.',
  'tutorial.guide.rule.autoequip':
    'Better armor and bigger packs equip themselves on pickup — so does any gun, if your hands are empty.',
  'tutorial.guide.rule.death':
    'Dying drops everything you carried, equipped slots included, and deletes it from your Stash.',
  'tutorial.guide.rule.armor':
    'Armor tops out at **70%** damage reduction. Melee and burn damage go straight through it.',
  'tutorial.guide.rule.refresh': 'Reloading the page mid-raid ends the run. The kit goes with it.',

  'tutorial.guide.salvage.title': 'Materials',
  'tutorial.guide.salvage.body':
    'Scrap, cloth, circuits, cores. There is no crafting bench anywhere in the game — materials exist to be carried out and sold. Value per slot is the only thing that matters.',

  'tutorial.guide.tip.medkit': 'One second rooted in place. Break line of sight before you use it.',
  'tutorial.guide.tip.advanced_medkit': 'Heals you to full, and locks you down for the same one second.',
  'tutorial.guide.tip.combat_stim': 'Instant. Nothing to interrupt.',
  'tutorial.guide.tip.regeneration_serum': 'Instant, then it ticks. The healing keeps running while you fight.',
  'tutorial.guide.tip.frag_grenade': 'The blast does not care that you threw it.',
  'tutorial.guide.tip.flash_grenade': 'Blinds only. No damage.',
  'tutorial.guide.tip.smoke_grenade': 'Hostiles cannot see through it at all.',
  'tutorial.guide.tip.molotov': 'Burn damage ignores armor.',
  'tutorial.guide.tip.i_disguise': 'Any damage at all breaks it instantly.',
  'tutorial.guide.tip.i_sentry_turret': 'Deploys where you stand. It is not a throwable.',
  'tutorial.guide.tip.w_decoy': 'It runs, and it wears your nickname and your colors.',

  // --- Control rows ---
  'tutorial.key.move': 'Move',
  'tutorial.key.aim': 'Aim',
  'tutorial.key.fire': 'Fire / Melee',
  'tutorial.key.reload': 'Reload',
  'tutorial.key.sprint': 'Sprint',
  'tutorial.key.pickup': 'Pick Up',
  'tutorial.key.hotbar': 'Use Item',
  'tutorial.key.throw': 'Throw / Cancel',
  'tutorial.key.panel': 'Info Panel',
  'tutorial.key.music': 'Mute / Next Track',
  'tutorial.key.chat': 'Chat',

  // Key caps that are words rather than literal keys.
  'tutorial.cap.mouse': 'Mouse',
  'tutorial.cap.lmb': 'Left Click',
  'tutorial.cap.space': 'Space',
  'tutorial.cap.throw': 'Left / Right Click',
};
