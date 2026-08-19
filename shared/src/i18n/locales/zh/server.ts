/**
 * 服务端产生的文案（中文翻译）。
 *
 * 服务端只发 key / code / 结构化数据，所有可读文字都在这里渲染。
 * 参数约定：名为 `item` 的参数一定是物品 typeId，客户端需要先经过
 * `itemName()` 再插值；其余参数（昵称、数量、金额、地图 ID）原样插入。
 */
export const SERVER: Record<string, string> = {
  // ---------------------------------------------------------------------
  // HUD 事件流 —— room 推送的 S2C_EVENT key
  // ---------------------------------------------------------------------
  'event.extract.loot_one': '{name} 带着 {count} 件战利品撤离',
  'event.extract.loot_other': '{name} 带着 {count} 件战利品撤离',
  'event.extract.empty': '{name} 空手撤离',
  'event.player.downed': '{name} 阵亡，战利品已掉落',
  'event.chest.opened': '{name} 打开了箱子',
  'event.pickup.item': '{name} 拾取 {item} ×{qty}',
  'event.pickup.lootBag': '{name} 拾取了掉落包',
  'event.item.dropped': '{name} 丢弃 {item} ×{qty}',
  'event.turret.deployed': '{name} 部署了自动哨兵',
  'event.server.resetting': '服务器正在重置世界',

  // ---------------------------------------------------------------------
  // 聊天命令
  // ---------------------------------------------------------------------
  'chat.self': '[你] {text}',

  'cmd.admin.granted': '已获得管理员权限',
  'cmd.admin.denied': '密码错误',
  'cmd.adminOnly': '需要管理员权限',
  'cmd.map.usage': '用法：/map <地图ID>',
  'cmd.map.notFound': '未找到地图：{map}',
  'cmd.maps.list': '可用地图：{maps}',
  'cmd.players.roster_one': '在线玩家 {count} 名',
  'cmd.players.roster_other': '在线玩家 {count} 名',
  'cmd.give.usage': '用法：/give <玩家> <金额>',
  'cmd.give.ok': '已给 {name} 发放 {amount} 金钱',
  'cmd.heal.usage': '用法：/heal <玩家>',
  'cmd.heal.ok': '已治疗 {name}',
  'cmd.kill.usage': '用法：/kill <玩家>',
  'cmd.kill.ok': '已击杀 {name}',
  'cmd.kick.usage': '用法：/kick <玩家>',
  'cmd.kick.ok': '已踢出 {name}',
  'cmd.playerNotFound': '未找到玩家：{name}',
  'cmd.alivePlayerNotFound': '未找到存活玩家：{name}',
  'cmd.ping.pong': 'Pong',
  'cmd.unknown': '未知命令：/{command}',
  'cmd.status': '房间 · tick {tick} · {players} 名玩家 · 种子 {seed}',
  'cmd.help.admin':
    '/admin <密码> · /map <id> · /maps · /maplist · /reset · /players · /playerlist · /give <玩家> <金额> · /heal <玩家> · /kill <玩家> · /kick <玩家> · /ping · /help',
  'cmd.help.player': '/admin <密码> · /maps · /maplist · /players · /playerlist · /ping · /help',

  // ---------------------------------------------------------------------
  // 错误 —— key 是 `error.` 加 S2C_ERROR 的 code 原文
  // ---------------------------------------------------------------------
  'error.session.notAuthenticated': '握手未完成',
  'error.session.noAccount': '未找到账号',
  'error.session.badRequest': '请求格式错误',
  'error.session.adminDisabled': '管理员命令已禁用',

  'error.stash.itemMissing': '仓库中没有该物品',
  'error.stash.notEnough': '仓库中该物品数量不足',
  'error.loadout.locked': '战局中无法修改整备',
  'error.loadout.full': '整备区已满',
  'error.loadout.overCapacity': '整备区超出背包容量',
  'error.loadout.itemMissing': '整备区中没有该物品',
  'error.loadout.notEnough': '整备区中该物品数量不足',
  'error.market.notEnoughCredits': '余额不足',
  'error.market.sellFailed': '无法卖出该物品',

  'error.equip.slotMismatch': '该物品无法装备到此槽位',
  'error.equip.unknownSlot': '未知装备槽位',
  'error.equip.unequipFailed': '无法卸下',
  'error.equip.weaponMissing': '背包中没有该武器',
  'error.equip.invalidWeapon': '该物品不是武器',
  'error.equip.backpackRequired': '需要先选择背包',
  'error.equip.backpackMissing': '背包中没有该背包',
  'error.equip.backpackTooSmall': '该背包装不下当前物品',
  'error.equip.invalidBackpack': '该物品不是背包',
  'error.equip.armorMissing': '背包中没有该防具',
  'error.equip.invalidArmor': '该物品不是防具',

  'error.raid.notAlive': '你已退出战斗',
  'error.inventory.full': '背包已满',
  'error.inventory.itemMissing': '未找到该物品',
  'error.inventory.unknownItem': '未知物品',
  'error.inventory.invalidQuantity': '数量无效',
  'error.inventory.invalidSlot': '该槽位没有物品',
  'error.inventory.removeFailed': '无法消耗该物品',
  'error.drop.weaponEquipped': '请先卸下武器',
  'error.drop.backpackEquipped': '请先卸下背包',
  'error.drop.armorEquipped': '请先卸下防具',

  'error.interact.noTarget': '附近没有可交互目标',
  'error.interact.itemGone': '该物品已消失',
  'error.interact.bagEmpty': '掉落包已空',
  'error.interact.outOfReach': '距离太远',

  'error.use.busy': '正在使用其他物品',
  'error.use.fullHealth': '生命值已满',
  'error.use.notUsable': '该物品无法使用',
  'error.use.mustThrow': '需要瞄准后投掷',
  'error.throw.noThrowable': '没有可投掷物',
  'error.throw.outOfRange': '目标超出投掷距离',

  // ---------------------------------------------------------------------
  // 敌人类型 —— COMBAT_ACTOR.enemyKind，经 enemyName() 查表
  // ---------------------------------------------------------------------
  'enemy.scout': '侦查兵',
  'enemy.sniper': '狙击手',
  'enemy.heavy': '重装兵',
  'enemy.feral': '野怪',
  'enemy.turret': '自动哨兵',

  // ---------------------------------------------------------------------
  // Buff —— PLAYER_BUFF.id，经 buffName() 查表
  // ---------------------------------------------------------------------

  // ---------------------------------------------------------------------
  // 击杀播报 / 结算 —— COMBAT_ACTOR、COMBAT_WEAPON 中没有物品 ID 的分支
  // ---------------------------------------------------------------------
  'killfeed.environment': '环境伤害',
  'killfeed.admin': '管理员',
  'killfeed.unknown': '未知',
  'killfeed.turret.owned': '{owner} 的自动哨兵',
  'killfeed.weapon.fists': '拳头',
  'killfeed.weapon.autocannon': '自动火炮',
  'killfeed.weapon.console': '控制台',
  'killfeed.weapon.unknown': '未知',
};
