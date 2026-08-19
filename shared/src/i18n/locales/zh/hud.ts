export const HUD: Record<string, string> = {
  // --- 分区标题（F1 调试面板） ---
  'hud.section.connection': '连接',
  'hud.section.players': '玩家',
  'hud.section.counts': '计数',
  'hud.section.status': '战斗状态',
  'hud.section.nearby': '附近',
  'hud.section.inventory': '背包（局内）',
  'hud.section.selected': '选中实体',
  'hud.section.events': '事件日志',

  // --- 通用字段标签 ---
  'hud.field.status': '状态',
  'hud.field.ping': '延迟',
  'hud.field.account': '账号',
  'hud.field.clientTime': '客户端时间',
  'hud.field.serverTick': '最后服务器 Tick',
  'hud.field.extraction': '撤离进度',
  'hud.field.health': '生命',
  'hud.field.weapon': '武器',
  'hud.field.mag': '弹匣',
  'hud.field.reloading': '换弹中',
  'hud.field.cooldown': '冷却',
  'hud.field.using': '正在使用',
  'hud.field.killedBy': '击杀来源',
  'hud.field.id': 'ID',
  'hud.field.position': '位置',
  'hud.field.loot': '战利品',
  'hud.field.lastInputSeq': '最后输入序号',
  'hud.field.lastInputTick': '最后输入 Tick',
  'hud.field.capacity': '容量',
  'hud.field.totalValue': '总价值',

  // --- 玩家状态：玩家表格、战斗状态、选中实体共用 ---
  'hud.state.alive': '存活',
  'hud.state.dead': '阵亡',
  'hud.state.extracted': '已撤离',

  // --- 连接 ---
  'hud.connection.connected': '已连接',
  'hud.connection.disconnected': '已断开',
  'hud.connection.reconnecting': '重连中（第 {attempt} 次）',
  'hud.connection.reconnectingRetry': '重连中（第 {attempt} 次，{ms}ms 后重试）',

  // --- 玩家表格 ---
  'hud.players.empty': '无玩家',
  'hud.players.col.name': '名字',
  'hud.players.col.hp': '血量',
  'hud.players.col.pos': '坐标',
  'hud.players.col.status': '状态',

  // --- 计数 ---
  'hud.counts.bullets': '子弹',
  'hud.counts.worldItems': '世界物品',
  'hud.counts.lootBags': '掉落包',

  // --- 战斗状态 ---
  'hud.status.notInRaid': '未进入战局',
  'hud.status.hp.healthy': '良好',
  'hud.status.hp.hurt': '轻伤',
  'hud.status.hp.wounded': '重伤',
  'hud.status.hp.critical': '危急',
  'hud.status.fists': '拳头',

  // --- 附近：E 只能拾取，撤离靠站位读条，不需要按键 ---
  'hud.nearby.item': '物品',
  'hud.nearby.item.hint': '按 E 拾取',
  'hud.nearby.lootBag': '掉落包',
  'hud.nearby.lootBag.hint': '按 E 搜刮',
  'hud.nearby.extractZone': '撤离区',
  'hud.nearby.extractZone.hint': '留在区域内即可撤离',
  'hud.nearby.none': '附近无目标',

  // --- 局内背包 ---
  'hud.inventory.empty': '空',
  'hud.inventory.unavailable': '不可用',
  'hud.inventory.total_one': '共 {count} 件',
  'hud.inventory.total_other': '共 {count} 件',
  'hud.inventory.stack.max': '上限 {max}',
  'hud.inventory.stack.none': '否',
  'hud.inventory.drop': '丢弃',
  'hud.inventory.col.item': '物品',
  'hud.inventory.col.rarity': '稀有度',
  'hud.inventory.col.qty': '数量',
  'hud.inventory.col.value': '价格',
  'hud.inventory.col.stack': '堆叠',

  // --- 选中实体 ---
  'hud.selected.none': '无（点击玩家）',

  // --- 通用兜底 ---
  'hud.unknown': '未知',
};
