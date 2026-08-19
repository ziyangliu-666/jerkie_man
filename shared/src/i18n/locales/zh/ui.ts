/**
 * main.ts 在运行时生成的文案：藏身处里被替换的标签、动态创建的物品卡和按钮、
 * HUD 事件日志、管理员确认框、聊天命令补全。
 *
 * 归属划分——这里不与任何其他 catalog 重复：
 * - `client/index.html` 里的静态文案        -> screens.ts
 * - 属性标签（`stat.*`）和单位（`unit.*`）  -> equipment.ts
 * - 物品名/描述、稀有度                     -> items.ts
 * - 调试面板（`hud.*`）                     -> hud.ts
 * - Canvas 叠加层（`combat.*`）             -> combat.ts
 * - 服务端下发的一切，以及敌人和击杀播报角色 -> server.ts
 *
 * 英文是源语言，这里是译文。术语表见 docs/LOCALIZATION.md。
 */
export const UI: Record<string, string> = {
  // ===== 文档标题（<title> 在 <head> 里，只能从 JS 设） =====================
  'app.title': 'ZIYANG PROTOCOL',

  // ===== 启动屏 ============================================================
  // 标签和按钮在 screens.ts，这里只有需要插值的这一条。
  'start.server.placeholder': '默认: {url}',

  // ===== 客户端校验 ========================================================
  // 服务端返回的失败是 error code，文案在 server.ts。
  'error.callsign.empty': '昵称不能为空',
  'error.callsign.tooLong': '昵称不能超过 32 字符',

  // ===== 藏身处顶栏 ========================================================
  'hideout.name.unset': '未设置',
  'hideout.name.editHint': '点击改名',
  'hideout.status.offline': '离线', // 在线那一半在 screens.ts

  // ===== 装备槽 ============================================================
  // 槽位名本身在 screens.ts（`gear.slot.*`），这里只有运行时才会出现的状态。
  'slot.invalid': '无效{slot}',

  // ===== 装备/切换选择弹窗 =================================================
  // screens.ts 管静态标题，这里是运行时带插值的两条。
  'equip.select.titleSlot': '选择要装备的{slot}',
  'equip.select.empty': '仓库和整备区中都没有可装备的{slot}',
  'equip.swap.title': '选择要切换的武器',
  'equip.swap.empty': '背包里没有可切换的武器',
  'equip.source.stash': '仓库',
  'equip.source.loadout': '整备区',

  // ===== main.ts 动态创建的按钮 ============================================
  // 确认/取消/进入战局/交换/卸下/展开/收起 在 screens.ts。
  'ui.btn.equip': '装备',
  'ui.btn.equipped': '已装备',
  'ui.btn.unequipped': '已卸下',
  'ui.btn.drop': '丢弃',
  'ui.btn.sell': '卖出',
  'ui.btn.buy': '购买',
  'ui.btn.buyEquip': '购买并装备',
  'ui.btn.buyLoadout': '购买并带入',
  'ui.btn.added': '已带入',
  'ui.btn.moveToStash': '移回仓库',
  'ui.btn.addToLoadout': '带入',

  // ===== 列表空态 ==========================================================
  'loadout.empty': '整备区为空',
  'stash.empty': '仓库为空',
  'list.emptyCategory': '该分类暂无物品',

  // ===== 商店 ==============================================================
  'market.bought_one': '已购买 {count} 个',
  'market.bought_other': '已购买 {count} 个',

  // ===== 局内装备面板 ======================================================
  // 武器 meta 由 `stat.*` 标签拼出来，保证用词不会跑偏。
  'raid.weapon.notReady': '未就绪',
  'raid.weapon.reloading': '换弹中',
  'raid.bag.default': '基础背包',
  'raid.bag.meta': '容量 {used}/{cap} | 总数 {total}',
  'raid.bag.empty': '空',
  'raid.bag.equipped': '已装备',
  'raid.armor.none': '无防具',
  'raid.noAmmo': '没有弹药',

  // ===== 屏幕 HUD ==========================================================
  'hud.sprinting': '冲刺中',
  'hud.killfeed.killed': '击杀',

  // ===== 可拼装的计数片段 ==================================================
  // `event.world.init` 一句里有四个计数，而 t() 一次只解一个 count，
  // 所以整句由这些片段拼出来。
  'count.items_one': '{count} 个物品',
  'count.items_other': '{count} 个物品',
  'count.obstacles_one': '{count} 个障碍物',
  'count.obstacles_other': '{count} 个障碍物',
  'count.worldItems_one': '{count} 个世界物品',
  'count.worldItems_other': '{count} 个世界物品',
  'count.rooms_one': '{count} 个房间',
  'count.rooms_other': '{count} 个房间',

  // ===== 事件日志（客户端自己产生的；服务端的在 server.ts） ================
  'event.client.started': '客户端已启动',
  'event.net.connected': '已连接到服务器',
  'event.net.disconnected': '已断开服务器连接',
  'event.net.worldCleared': '世界已清空',
  'event.net.playerId': '玩家ID：{id}',
  'event.net.accountId': '账号ID：{id}',
  'event.net.mapConfig': '已接收服务器地图配置（种子：{seed}）',
  'event.net.mapConfigMissing': '服务器未提供地图配置，改用本地配置',
  'event.world.init': '世界已初始化：{obstacles}，{items}，{worldItems}，{rooms}',
  'event.callsign.set': '昵称已设置：{name}',
  'event.equip.done': '已装备 {item}',
  'event.equip.noProfile': '无法装备：未加载玩家数据',
  'event.unequipped': '已卸下{slot}',
  'event.unequip.failed': '卸下失败：连接未就绪',
  'event.weapon.swapped': '已切换到 {item}',
  'event.raid.deploying': '正在进入战局...',
  'event.raid.deployFailed': '进入战局失败：连接未就绪',
  'event.raid.ended': '战局结束：{result}',
  'event.drop.unavailable': '当前无法丢弃物品',
  'event.drop.done': '已丢弃物品',
  'event.drop.failed': '丢弃失败：连接未就绪',
  'event.market.bought': '已购买 {item}',
  'event.market.boughtEquip': '已购买并装备 {item}',
  'event.market.boughtLoadout': '已购买并带入：{item}',
  'event.market.insufficient': '金钱不足：需要 {value}',
  'event.entity.selected': '已选中实体：{id}',
  'event.entity.deselected': '已取消选中实体',

  // ===== 管理员 ============================================================
  'admin.confirm.resetAccount': '重置账号并重新连接？这将清空当前账号的所有进度（金钱、仓库等）。',
  'admin.confirm.resetWorld':
    '重置服务端世界？这将断开所有玩家连接并重新生成地图。\n\n你的账号数据（金钱、仓库）不会丢失。',
  'event.admin.requestingStatus': '[管理员] 正在请求服务器状态...',
  'event.admin.resettingWorld': '[管理员] 正在重置世界...',

  // ===== 聊天命令补全（客户端） ============================================
  // 命令本身由服务端执行，这里只是输入时下拉框里的提示。
  'chat.cmd.admin': '激活管理员权限',
  'chat.cmd.help': '显示所有命令',
  'chat.cmd.maps': '查看所有可用地图',
  'chat.cmd.players': '查看在线玩家列表',
  'chat.cmd.ping': '测试连接延迟',
  'chat.cmd.map': '切换地图（需要管理员）',
  'chat.cmd.reset': '重置当前房间（需要管理员）',
  'chat.cmd.give': '给玩家加钱（需要管理员）',
  'chat.cmd.heal': '治疗玩家（需要管理员）',
  'chat.cmd.kill': '击杀玩家（需要管理员）',
  'chat.cmd.kick': '踢出玩家（需要管理员）',
  'chat.suggest.map': '切换到地图: {map}',
  'chat.suggest.give': '给 {name} 加钱',
  'chat.suggest.heal': '治疗 {name}',
  'chat.suggest.kill': '击杀 {name}',
  'chat.suggest.kick': '踢出 {name}',

  // 服务端事件的客户端文案：服务端只发 key/参数，句子在这里成型
  'event.error': '错误：{reason}',
  'event.autoEquip.weapon': '捡起并装备了{item}',
  'event.autoEquip.bag': '换上了{item}',
  'event.autoEquip.armor': '换上了{item}',
};
