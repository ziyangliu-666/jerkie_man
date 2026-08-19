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
  'item.medkit.desc': '读条 1 秒，期间不能动、不能开火，也不能取消。先脱离接触再用。',
  'item.medkit.short': '医疗',

  'item.advanced_medkit.name': '高级急救包',
  'item.advanced_medkit.desc': '一次回满，代价还是站着不动读条 1 秒。它只是量更大，不是更快。',
  'item.advanced_medkit.short': '高级',

  'item.combat_stim.name': '战斗兴奋剂',
  'item.combat_stim.desc': '即时生效，没有读条。交火中能用，冲最后一段撤离路也能用。',
  'item.combat_stim.short': '兴奋',

  'item.regeneration_serum.name': '再生血清',
  'item.regeneration_serum.desc': '即时生效，边跑边打都在回血。但太慢，救不了正在崩的局面。',
  'item.regeneration_serum.short': '再生',

  // --- 投掷物 ---------------------------------------------------------------
  'item.frag_grenade.name': '破片手雷',
  'item.frag_grenade.desc': '护甲能减伤，但投掷者不在豁免之列。小心把自己一起炸了。',
  'item.frag_grenade.short': '手雷',

  'item.flash_grenade.name': '闪光弹',
  'item.flash_grenade.desc': '完全不造成伤害。玩家视野全白，AI 彻底失去索敌，趁机转移。',
  'item.flash_grenade.short': '闪光',

  'item.smoke_grenade.name': '烟雾弹',
  'item.smoke_grenade.desc': 'AI 看不见烟里的目标，站进烟里也开不了火，炮台同样是瞎的。',
  'item.smoke_grenade.short': '烟雾',

  'item.molotov.name': '燃烧弹',
  'item.molotov.desc': '火焰完全无视护甲，也照样烧点火的人。千万别扔近了。',
  'item.molotov.short': '燃烧',

  // --- 战术道具 -------------------------------------------------------------
  'item.w_decoy.name': '全息诱饵',
  'item.w_decoy.desc': '会跑的全息替身，吸 AI 火力。打爆时 150 像素内眩晕 3 秒，含你。',
  'item.w_decoy.short': '诱饵',

  'item.i_sentry_turret.name': '哨戒炮台',
  'item.i_sentry_turret.desc': '自动守住 400 像素范围，永远不打你。但草丛和烟里的目标它看不见。',
  'item.i_sentry_turret.short': '炮台',

  'item.i_disguise.name': '拟态血清',
  'item.i_disguise.desc': '所有 AI 都把你当同类，直接从身边走过。受到任何伤害立刻破除。',
  'item.i_disguise.short': '拟态',

  // --- 战利品材料 -----------------------------------------------------------
  'item.scrap_metal.name': '废金属',
  'item.scrap_metal.desc': '从残骸上剥下来的钢板和钢筋。不值钱，但商店照单全收。',

  'item.cloth.name': '布料',
  'item.cloth.desc': '从家具和铺盖上割下来的碎布。全图最便宜、还值得弯腰捡的东西。',

  'item.electronics.name': '电子零件',
  'item.electronics.desc': '从报废设备里拆出的电路板和传感器。体积小，单价远高于废金属。',

  'item.medical_supplies.name': '医疗物资',
  'item.medical_supplies.desc': '未拆封的临床药品，商人给价很好。但它在局里救不了你。',

  'item.weapon_parts.name': '武器零件',
  'item.weapon_parts.desc': '枪机弹簧和枪管毛坯，成色可直接出手。只能卖钱，局内改不了枪。',

  'item.rare_metal.name': '稀有合金',
  'item.rare_metal.desc': '航空级合金锭，又轻又硬。看到就优先装，别装那些普通货。',

  'item.advanced_circuit.name': '高级电路板',
  'item.advanced_circuit.desc': '完好的军规电路板。全图单格收益最高的战利品之一。',

  'item.legendary_core.name': '反应堆核心',
  'item.legendary_core.desc': '密封的动力核心，摸上去还是温的。唯一的意义就是被你带出去。',

  'item.pure_gold.name': '金条',
  'item.pure_gold.desc': '精炼金锭，无标识、无法追溯。战术价值为零，变现价值拉满。',

  // --- 武器 -----------------------------------------------------------------
  'item.w_pistol.name': '手枪',
  'item.w_pistol.desc': '开局副武器。足够可靠，但很快就会被你捡到的一切超越。',

  'item.w_smg.name': '冲锋枪',
  'item.w_smg.desc': '清房间用的火力密度。出了走廊，散布会让每次扫射都变成赌博。',

  'item.w_burst.name': '三连发步枪',
  'item.w_burst.desc': '三连发，散布很小。中距离对枪最稳妥的选择。',

  'item.w_dmr.name': '精确步枪',
  'item.w_dmr.desc': '半自动精确射击。弹匣浅、换弹慢，浪费一发就要付代价。',

  'item.w_shotgun.name': '霰弹枪',
  'item.w_shotgun.desc': '纯门口武器。弹丸出门就没，一发一泵，慢得让人心慌。',

  'item.w_sniper.name': '狙击步枪',
  'item.w_sniper.desc': '远距离一枪定胜负。打空了，漫长的换弹就是你的破绽。',

  'item.w_grenade_launcher.name': '榴弹发射器',
  'item.w_grenade_launcher.desc': '一次一发 40 毫米。杀人的是爆炸，出膛 3 秒后必炸。',

  'item.w_minigun.name': '加特林机枪',
  'item.w_minigun.desc': '压制武器，不是机动武器。架住一条路，然后祈祷别打空。',

  'item.w_anti_material.name': '反器材步枪',
  'item.w_anti_material.desc': '射程覆盖全图，无甲一枪毙命。但它照样穿不了掩体。',

  'item.w_double_barrel.name': '双管霰弹枪',
  'item.w_double_barrel.desc': '要么两管打完，要么什么都没有。只能贴脸，换弹长得离谱。',

  'item.w_laser_rifle.name': '激光步枪',
  'item.w_laser_rifle.desc': '零散布，弹速极快。打移动目标不用预判，准星在哪就打在哪。',

  'item.w_crossbow.name': '弩',
  'item.w_crossbow.desc': '看着安静，其实不是。箭射出就没了，AI 本来也只靠眼睛找人。',

  'item.w_auto_shotgun.name': '全自动霰弹枪',
  'item.w_auto_shotgun.desc': '全自动霰弹。走廊里毁天灭地，然后你还没反应过来就空了。',

  'item.w_precision_rifle.name': '精确射手步枪',
  'item.w_precision_rifle.desc': '狙击枪的伤害，步枪的节奏。补第二枪不用犹豫。',

  'item.w_micro_smg.name': '微型冲锋枪',
  'item.w_micro_smg.desc': '门口无敌，隔个院子就是废铁。这枪不用瞄，泼就完事。',

  'item.w_chainsaw.name': '链锯',
  'item.w_chainsaw.desc': '正面撕碎一切。无视护甲，但每次判定只能咬中一个目标。',

  'item.w_burst_grenade_launcher.name': '自动榴弹发射器',
  'item.w_burst_grenade_launcher.desc': '区域封锁。把爆炸铺在必经路口，那道门就没人能过。',

  'item.w_katana.name': '武士刀',
  'item.w_katana.desc': '干净一刀能杀掉这里的大多数东西。无视护甲，还带得轻快。',

  'item.w_sledgehammer.name': '大锤',
  'item.w_sledgehammer.desc': '砸实了没有活口。但两次挥击之间，你就是个显眼的慢靶子。',

  'item.w_whip.name': '长鞭',
  'item.w_whip.desc': '近战里够得最远的武器，但判定只有一条细缝，必须瞄准。',

  'item.w_bubble_gun.name': '泡泡枪',
  'item.w_bubble_gun.desc': '把慢悠悠的泡泡糊满整个屏幕。是真伤害，但不会减速任何人。',

  // --- 背包 -----------------------------------------------------------------
  'item.bag_sling.name': '小挎包',
  'item.bag_sling.desc': '勉强算个包，但总好过空手进场。',

  'item.bag_daypack.name': '小背包',
  'item.bag_daypack.desc': '想靠这一局赚钱，这是最低配置。',

  'item.bag_tactical.name': '战术背包',
  'item.bag_tactical.desc': '分区合理的承载装具，容量也对得起价钱。',

  'item.bag_expedition.name': '大背包',
  'item.bag_expedition.desc': '一趟就能把整片建筑群搬空。',

  'item.bag_military.name': '军用背包',
  'item.bag_military.desc': '全游戏最大的背包，没有之一。',

  // --- 防具 -----------------------------------------------------------------
  'item.armor_light.name': '轻甲',
  'item.armor_light.desc': '聊胜于无的防护，但完全不坠腿。总比穿件衬衫强。',

  'item.armor_kevlar.name': '凯夫拉甲',
  'item.armor_kevlar.desc': '能扛住小口径火力，穿着跑动也几乎没感觉。',

  'item.armor_plate.name': '插板甲',
  'item.armor_plate.desc': '陶瓷插板。打算活着回来的那种局，标配就是它。',

  'item.armor_heavy.name': '重甲',
  'item.armor_heavy.desc': '全游戏最硬的护甲。代价是变慢，而且燃烧伤害照样无视它。',

  'item.armor_exo.name': '外骨骼装甲',
  'item.armor_exo.desc': '唯一一件让你变快而不是变慢的护甲，价格也配得上。',
};
