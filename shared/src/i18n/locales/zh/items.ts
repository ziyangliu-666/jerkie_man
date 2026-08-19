/**
 * 物品名称 / 描述 / 快捷栏缩写 —— 紫阳协议
 *
 * key 由目录 id 推导：item.<id>.name / .desc / .short
 * `.short` 是局内快捷栏图标文字，UI 空间极小，控制在 2-3 个汉字。
 *
 * 英文是源语言，中文是翻译；但两边都必须说真话。
 * 文中每一个数值都来自 item_catalog.ts / equipment.ts / 服务端模拟，
 * 代码改了这里就要跟着改。
 */
export const ITEMS: Record<string, string> = {
  // --- 稀有度 ---------------------------------------------------------------
  'rarity.common': '普通',
  'rarity.rare': '稀有',
  'rarity.epic': '史诗',
  'rarity.legendary': '传说',

  // --- 医疗 -----------------------------------------------------------------
  'item.medkit.name': '急救包',
  'item.medkit.desc': '恢复 50 点生命。使用需读条 1 秒，期间无法移动、无法开火，也无法中断。',
  'item.medkit.short': '医疗',

  'item.advanced_medkit.name': '高级急救包',
  'item.advanced_medkit.desc': '恢复 100 点生命，任何残血状态都能一次拉满。读条同样是 1 秒——它只是量更大，不是更快。',
  'item.advanced_medkit.short': '高级',

  'item.combat_stim.name': '战斗兴奋剂',
  'item.combat_stim.desc': '15 秒内移动速度 +40%。即时生效、无读条，可以在交火中和撤退途中直接用。',
  'item.combat_stim.short': '兴奋',

  'item.regeneration_serum.name': '再生血清',
  'item.regeneration_serum.desc': '20 秒内每秒恢复 15 点生命，全程活下来共 300 点。即时生效，移动和开火都不会打断。',
  'item.regeneration_serum.short': '再生',

  // --- 投掷物 ---------------------------------------------------------------
  'item.frag_grenade.name': '破片手雷',
  'item.frag_grenade.desc': '100 像素范围内最高 300 伤害，越靠边缘衰减越多。防具可以减伤，但爆炸不会放过投掷者本人。',
  'item.frag_grenade.short': '手雷',

  'item.flash_grenade.name': '闪光弹',
  'item.flash_grenade.desc': '致盲 150 像素内的所有单位 5 秒。玩家视野全白，AI 则完全失去索敌能力。不造成任何伤害。',
  'item.flash_grenade.short': '闪光',

  'item.smoke_grenade.name': '烟雾弹',
  'item.smoke_grenade.desc': '生成半径 200 像素的烟雾，持续 15 秒。AI 看不见烟中的目标，自己站在烟里也无法开火；哨戒炮台同样会被烟雾挡住。',
  'item.smoke_grenade.short': '烟雾',

  'item.molotov.name': '燃烧弹',
  'item.molotov.desc': '点燃半径 120 像素的火场 8 秒，每秒 100 伤害。火焰完全无视防具减伤，也照样烧点火的人。',
  'item.molotov.short': '燃烧',

  // --- 战术道具 -------------------------------------------------------------
  'item.w_decoy.name': '全息诱饵',
  'item.w_decoy.desc': '投出一个带着你当前武器和防具的全息替身：50 生命、存在 15 秒，会吸引 AI 开火。被打爆时炸开一圈眩晕，150 像素内所有单位——包括你自己——被眩晕 3 秒。',
  'item.w_decoy.short': '诱饵',

  'item.i_sentry_turret.name': '哨戒炮台',
  'item.i_sentry_turret.desc': '在脚下部署 30 秒。150 生命、400 像素交战距离，以每秒 10 发的冲锋枪火力自动索敌。永远不会打你，但看不见躲在草丛或烟雾里的目标。',
  'item.i_sentry_turret.short': '炮台',

  'item.i_disguise.name': '拟态血清',
  'item.i_disguise.desc': '30 秒内所有 AI 都把你当成同类，直接从你身边走过。一旦受到任何伤害，伪装立刻失效。',
  'item.i_disguise.short': '拟态',

  // --- 战利品材料 -----------------------------------------------------------
  'item.scrap_metal.name': '废金属',
  'item.scrap_metal.desc': '从残骸上剥下来的钢板和钢筋。单价很低，但一堆能叠 20 个，商店照单全收。',

  'item.cloth.name': '布料',
  'item.cloth.desc': '从家具和铺盖上割下来的碎布。全图最廉价的散货，一堆 30 个，唯一用途就是卖钱。',

  'item.electronics.name': '电子零件',
  'item.electronics.desc': '从报废设备里拆出的完好电路板和传感器。体积小，一堆 10 个，单格价值远高于废金属。',

  'item.medical_supplies.name': '医疗物资',
  'item.medical_supplies.desc': '未拆封的临床药品，成色好、卖价高。注意：它不能在战局里给你回血。',

  'item.weapon_parts.name': '武器零件',
  'item.weapon_parts.desc': '枪机、弹簧和枪管毛坯，成色可直接出手。纯粹是卖钱的货——局内无法用它修枪或改装。',

  'item.rare_metal.name': '稀有合金',
  'item.rare_metal.desc': '航空级合金锭，又轻又硬。单格收益极高，看到就优先装它。',

  'item.advanced_circuit.name': '高级电路板',
  'item.advanced_circuit.desc': '完好的军规电路板。全图单格收益最高的战利品之一，一堆只能叠 3 个。',

  'item.legendary_core.name': '反应堆核心',
  'item.legendary_core.desc': '密封的动力核心，摸上去还是温的。局内没有任何用途——它存在的意义就是被你带出去。',

  'item.pure_gold.name': '金条',
  'item.pure_gold.desc': '精炼金锭，无标识、无法追溯。战术价值为零，变现价值拉满，一格能装 5 根。',

  // --- 武器 -----------------------------------------------------------------
  'item.w_pistol.name': '手枪',
  'item.w_pistol.desc': '制式副武器。单发 25 伤害，6 发弹匣，1.5 秒换弹。足够可靠，但很快就会被你捡到的几乎一切超越。',

  'item.w_smg.name': '冲锋枪',
  'item.w_smg.desc': '每分钟 600 发，30 发弹匣，单发 20 伤害。清房间的火力密度；5° 散布让走廊之外的对枪变成掷硬币。',

  'item.w_burst.name': '三连发步枪',
  'item.w_burst.desc': '每次三连发，单发 30 伤害，散布仅 2°。中距离对枪最稳妥的选择。',

  'item.w_dmr.name': '精确步枪',
  'item.w_dmr.desc': '半自动，单发 50 伤害，有效射程超过 1900 像素。10 发弹匣加 3 秒换弹，逼你每一枪都命中。',

  'item.w_shotgun.name': '霰弹枪',
  'item.w_shotgun.desc': '每发 8 颗弹丸、单颗 20 伤害，全中 160。弹丸飞到 180 像素就消失——这是一把门口专用武器。',

  'item.w_sniper.name': '狙击步枪',
  'item.w_sniper.desc': '单发 90 伤害，散布几乎为零，射程覆盖大半张地图。打完 5 发要等 3.8 秒换弹。',

  'item.w_grenade_launcher.name': '榴弹发射器',
  'item.w_grenade_launcher.desc': '一次一发 40 毫米榴弹：200 像素范围内 400 爆炸伤害。榴弹出膛 3 秒后必定起爆，打不打得中都一样。',

  'item.w_minigun.name': '加特林机枪',
  'item.w_minigun.desc': '每分钟 1200 发，200 发弹链，单发 18 伤害。装备期间移动速度 -25%，6 秒换弹的时间里你毫无还手之力。',

  'item.w_anti_material.name': '反器材步枪',
  'item.w_anti_material.desc': '单发 150 伤害，弹速 2000 像素/秒，能打到地图任何角落，无甲目标一枪毙命。但它并不比手枪更能穿墙——能否穿透只取决于掩体本身，与口径无关。',

  'item.w_double_barrel.name': '双管霰弹枪',
  'item.w_double_barrel.desc': '两发子弹，每发 12 颗弹丸、贴脸 300 伤害。射程只有 150 像素，换弹 4 秒：要么两管打完，要么什么都没有。',

  'item.w_laser_rifle.name': '激光步枪',
  'item.w_laser_rifle.desc': '零散布、3000 像素/秒弹速——不用预判提前量，准星在哪就打在哪。单发 35 伤害，每分钟 400 发，射程 1500 像素。',

  'item.w_crossbow.name': '弩',
  'item.w_crossbow.desc': '单发 60 伤害，散布 0.5°，5 发弹匣。弩箭射出即消耗、无法回收；开火也不比枪械更隐蔽——AI 靠视野发现你，游戏里没有声音侦测。',

  'item.w_auto_shotgun.name': '全自动霰弹枪',
  'item.w_auto_shotgun.desc': '全自动倾泻，每分钟 400 发，每发 6 颗弹丸、单颗 18 伤害。12 发弹匣，射程 220 像素，打空要 4 秒换弹。',

  'item.w_precision_rifle.name': '精确射手步枪',
  'item.w_precision_rifle.desc': '单发 65 伤害，15 发弹匣，0.4° 散布，射程 2500 像素。狙击枪的伤害，步枪的节奏。',

  'item.w_micro_smg.name': '微型冲锋枪',
  'item.w_micro_smg.desc': '每分钟 1000 发，50 发弹匣，单发 12 伤害。12° 散布、595 像素射程：门口无敌，隔个院子就是废铁。',

  'item.w_chainsaw.name': '链锯',
  'item.w_chainsaw.desc': '每秒 20 次判定、每次 15 伤害，折合每秒 300 伤害，覆盖 180° 扇形。但全部收益都在 60 像素之内。',

  'item.w_burst_grenade_launcher.name': '自动榴弹发射器',
  'item.w_burst_grenade_launcher.desc': '6 发弹匣、每 450 毫秒一发，每发在 100 像素范围内造成 180 爆炸伤害。封锁路口和必经门洞的首选。',

  'item.w_katana.name': '武士刀',
  'item.w_katana.desc': '一刀 120 伤害，攻击距离 80 像素、90° 扇形，携带时移动速度 +15%。地图上大多数目标都挡不住干净的一刀。',

  'item.w_sledgehammer.name': '大锤',
  'item.w_sledgehammer.desc': '一击 250 伤害，砸实了没有任何单位能活下来。挥击间隔 1.2 秒，携带时移动速度 -30%。',

  'item.w_whip.name': '长鞭',
  'item.w_whip.desc': '350 像素的近战距离，是其他近战武器的四倍以上，但判定只有 5° 一条细缝，必须瞄准。单次仅 10 伤害——靠距离和耐心杀人，不是靠力量。',

  'item.w_bubble_gun.name': '泡泡枪',
  'item.w_bubble_gun.desc': '每分钟 1200 发、单发 20 伤害，持续命中折合每秒 400 伤害。泡泡飞行速度只有 200 像素/秒、存活 10 秒，持续开火会在你面前留下一整片缓慢漂移的弹幕。',

  // --- 背包 -----------------------------------------------------------------
  'item.bag_sling.name': '小挎包',
  'item.bag_sling.desc': '8 格容量。勉强算个包，但总好过空手进场。',

  'item.bag_daypack.name': '小背包',
  'item.bag_daypack.desc': '12 格容量。想靠这一局赚钱的最低配置。',

  'item.bag_tactical.name': '战术背包',
  'item.bag_tactical.desc': '16 格容量，分区合理的承载装具。',

  'item.bag_expedition.name': '大背包',
  'item.bag_expedition.desc': '20 格容量。一趟就能把整片建筑群搬空。',

  'item.bag_military.name': '军用背包',
  'item.bag_military.desc': '24 格容量，全游戏最大的背包，没有之一。',

  // --- 防具 -----------------------------------------------------------------
  'item.armor_light.name': '轻甲',
  'item.armor_light.desc': '10% 减伤，不影响移动速度。',

  'item.armor_kevlar.name': '凯夫拉甲',
  'item.armor_kevlar.desc': '25% 减伤，足以应付小口径火力。',

  'item.armor_plate.name': '插板甲',
  'item.armor_plate.desc': '陶瓷插板提供 40% 减伤。认真打一局的标准配置。',

  'item.armor_heavy.name': '重甲',
  'item.armor_heavy.desc': '70% 减伤，全游戏最硬的护甲。代价是移动速度 -20%，而且燃烧伤害依然无视防具。',

  'item.armor_exo.name': '外骨骼装甲',
  'item.armor_exo.desc': '55% 减伤，同时移动速度 +25%。唯一一件让你变快而不是变慢的防具。',
};
