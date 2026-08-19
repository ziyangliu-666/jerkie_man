/**
 * 新手引导与战场手册。
 *
 * 引导是全局少数允许口语化的地方，但仍保持军事简洁：一条提示一两句话说完。
 * 所有数值以代码实际行为为准：撤离 5 秒自动读条、拾取判定 40px、
 * 箱子和门要打碎（各约 100 伤害）、护甲减伤上限 70%。
 *
 * `**文字**` 在提示正文、目标行和硬规则列表中会渲染为高亮；
 * 标题、分区标题、按键表和道具提示是纯文本，不要写标记。
 */
export const TUTORIAL: Record<string, string> = {
  // --- 卡片框架 ---
  'tutorial.badge': '新手引导',
  'tutorial.progress': '{current} / {total}',
  'tutorial.btn.next': '下一步',
  'tutorial.btn.finish': '完成',
  'tutorial.btn.gotit': '知道了',
  'tutorial.btn.skip': '跳过引导',
  'tutorial.btn.guide': '战场手册',
  'tutorial.btn.close': '关闭',

  // --- 藏身处 ---
  'tutorial.hideout.welcome.title': '欢迎来到藏身处',
  'tutorial.hideout.welcome.body':
    '这里是你的装备唯一安全的地方。整备完毕就进入战局——带出这道门的东西，都可能丢。',

  'tutorial.hideout.gear.title': '三个装备槽',
  'tutorial.hideout.gear.body':
    '武器、背包、防具，点击槽位从仓库装备。背包决定你能带多少，防具决定减伤：最低 **10%**，最高 **70%**。',

  'tutorial.hideout.loadout.title': '整备区',
  'tutorial.hideout.loadout.body':
    '整备区放的是跟你一起进战局的东西，格数等于背包容量。留在仓库里的，谁也拿不走。',

  'tutorial.hideout.market.title': '商店',
  'tutorial.hideout.market.body':
    '买东西直接进仓库，带回来的战利品也在这里卖。材料没有别的用途——游戏里没有合成，材料就是拿来换钱的。',

  'tutorial.hideout.deploy.title': '进入战局',
  'tutorial.hideout.deploy.body':
    '准备好就出发。撤离成功，战利品入库；倒在里面，整套装备留在原地。前几局带你输得起的东西。',

  // --- 战局 ---
  'tutorial.raid.move.title': '移动',
  'tutorial.raid.move.body': '**WASD** 移动。八个方向，走对角线不会更快。',
  'tutorial.raid.move.objective': '用 WASD 移动',

  'tutorial.raid.fire.title': '瞄准与射击',
  'tutorial.raid.fire.body':
    '准星跟着鼠标走。**鼠标左键**开火——全自动武器按住连发，连发武器每次点击打一轮。空手时是近战挥击，近战完全无视护甲。',
  'tutorial.raid.fire.objective': '开一枪',

  'tutorial.raid.reload.title': '换弹',
  'tutorial.raid.reload.body':
    '**R** 换弹。弹匣满或正在换弹时按了没用。打空之后再点一次左键，会自动换弹。',
  'tutorial.raid.reload.objective': '换一次弹',

  'tutorial.raid.sprint.title': '冲刺',
  'tutorial.raid.sprint.body':
    '按住**空格**冲刺，速度 1.5 倍，每秒消耗 20 点耐力。耐力见底就会被锁住，必须回到 **35%** 以上才能再冲——在那之前按空格只会让耐力条抖一下。',
  'tutorial.raid.sprint.objective': '冲刺一次',

  'tutorial.raid.breach.title': '没有开箱键',
  'tutorial.raid.breach.body':
    '这里没有“打开”这个操作。箱子、宝箱、门全都用枪打碎——各约 **100 点伤害**——里面的东西会散在地上。',

  'tutorial.raid.loot.title': '拾取',
  'tutorial.raid.loot.body':
    '**E** 只能捡物品和掉落包，判定距离只有 **40px**。要几乎踩在上面：提示没亮，就是还不够近。',
  'tutorial.raid.loot.objective': '捡起一件东西',

  'tutorial.raid.autoequip.title': '装备会自己换',
  'tutorial.raid.autoequip.body':
    '捡到更大的背包或更好的护甲会立刻自动换上，旧的丢进背包。空手时捡到的第一把枪会直接装备。搜刮完记得看一眼自己的槽位。',

  'tutorial.raid.hotbar.title': '道具',
  'tutorial.raid.hotbar.body':
    '**1** 到 **5** 使用背包里的道具。投掷物会先进入瞄准状态——**左键**投出，**右键**取消。手雷不认人，照样炸你。其余道具看战场手册。',

  'tutorial.raid.extract.title': '撤离',
  'tutorial.raid.extract.body':
    '绿色区域就是撤离点。不用按键，也不用等提示——站进去连续 **5 秒**。中途离开或者被打出去，进度直接归零重来。',
  'tutorial.raid.extract.objective': '走到撤离区',

  // --- 结算 ---
  'tutorial.result.extracted.title': '撤离成功',
  'tutorial.result.extracted.body':
    '背包里的东西已经进仓库，并按价值结算成金钱。这就是整个循环：轻装进去，满载出来，见好就收。',

  'tutorial.result.kia.title': '装备全丢了',
  'tutorial.result.kia.body':
    '你携带的一切——背包物品、武器、背包、护甲——都变成一个掉落包留在阵亡的地方，并从仓库里删除。只有留在藏身处的东西还在。摸熟地图之前，别带贵的。',

  // --- 战场手册 ---
  'tutorial.guide.launcher': '战场手册',
  'tutorial.guide.title': '战场手册',
  'tutorial.guide.subtitle': '操作、硬规则，以及每件装备的真实效果',
  'tutorial.guide.section.controls': '操作',
  'tutorial.guide.section.rules': '硬规则',
  'tutorial.guide.section.medical': '医疗',
  'tutorial.guide.section.ordnance': '爆炸物',
  'tutorial.guide.section.tactical': '战术',
  'tutorial.guide.section.salvage': '材料',

  'tutorial.guide.rule.extract':
    '撤离是自动的：站在绿区内连续 **5 秒**，不用按任何键，离开就归零。',
  'tutorial.guide.rule.breach': '箱子和门是打碎的，不是打开的，各约 **100 点伤害**。',
  'tutorial.guide.rule.reach': '拾取判定只有 **40px**。提示没亮，就是站得不够近。',
  'tutorial.guide.rule.autoequip':
    '更好的护甲和更大的背包会在拾取瞬间自动换上；空手时捡到的枪也一样。',
  'tutorial.guide.rule.death': '死亡会掉落你携带的一切，包括身上的装备，并从仓库中删除。',
  'tutorial.guide.rule.armor': '护甲减伤上限 **70%**。近战伤害和燃烧伤害不吃减伤。',
  'tutorial.guide.rule.refresh': '局内刷新页面等于这一局白打，装备一起没。',

  'tutorial.guide.salvage.title': '材料',
  'tutorial.guide.salvage.body':
    '废金属、布料、电路、内核。游戏里没有任何合成台——材料的唯一用途就是带出去卖。只看每格值多少钱。',

  'tutorial.guide.tip.medkit': '读条 1 秒，期间完全不能动。先脱离视线再用。',
  'tutorial.guide.tip.advanced_medkit': '回满血，但同样要在原地定住 1 秒。',
  'tutorial.guide.tip.combat_stim': '即时生效，没有读条。',
  'tutorial.guide.tip.regeneration_serum': '即时生效，之后持续回血，边打边回。',
  'tutorial.guide.tip.frag_grenade': '爆炸不认人，照样炸自己。',
  'tutorial.guide.tip.flash_grenade': '只致盲，不造成伤害。',
  'tutorial.guide.tip.smoke_grenade': '敌人完全无法透过烟雾看到你。',
  'tutorial.guide.tip.molotov': '燃烧伤害不吃护甲减伤。',
  'tutorial.guide.tip.i_disguise': '受到任何伤害立刻破除。',
  'tutorial.guide.tip.i_sentry_turret': '在脚下部署，不是投掷物。',
  'tutorial.guide.tip.w_decoy': '假人会自己跑，还顶着你的昵称和外观。',

  // --- 按键表 ---
  'tutorial.key.move': '移动',
  'tutorial.key.aim': '瞄准',
  'tutorial.key.fire': '开火 / 近战',
  'tutorial.key.reload': '换弹',
  'tutorial.key.sprint': '冲刺',
  'tutorial.key.pickup': '拾取',
  'tutorial.key.hotbar': '使用道具',
  'tutorial.key.throw': '投掷 / 取消',
  'tutorial.key.panel': '信息面板',
  'tutorial.key.music': '静音 / 下一首',
  'tutorial.key.chat': '聊天',

  // 需要翻译的按键名（其余按键保持原样）
  'tutorial.cap.mouse': '鼠标',
  'tutorial.cap.lmb': '鼠标左键',
  'tutorial.cap.space': '空格',
  'tutorial.cap.throw': '左键 / 右键',
};
