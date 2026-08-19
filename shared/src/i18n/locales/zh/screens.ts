/**
 * 界面框架文案：对应 `client/index.html` 中所有静态文本。
 *
 * 键名与 en/screens.ts 一一对应，缺键即为 bug。
 * 术语以 docs/LOCALIZATION.md 第 3 节为准。
 */
export const SCREENS: Record<string, string> = {
  // ===== 启动屏 =====
  'start.subtitle': '撤离协议 // v.0.9',
  'start.server.label': '服务器地址 //:',
  'start.btn.initialize': '初始化 // 开始',

  // ===== 语言切换 =====
  // 首次进入时玩家还没选过语言，弹窗文案两种语言都保留。
  'lang.select': '语言',
  'lang.modal.title': 'LANGUAGE // 语言',
  'lang.modal.prompt': 'Select your language / 选择你的语言',

  // ===== 音乐面板（#bgmControl） =====
  'ui.bgm.panel': '音乐控制',
  'ui.bgm.mute': '切换音乐 (M)',
  'ui.bgm.next': '下一首 (N)',
  'ui.bgm.track': '选择曲目',
  'ui.bgm.volume': '调整音量',

  // ===== 通用控件 =====
  'ui.btn.confirm': '确认',
  'ui.btn.cancel': '取消',
  'ui.btn.swap': '交换',
  'ui.btn.unequip': '卸下',
  'ui.btn.expand': '展开',
  'ui.btn.collapse': '收起',
  'ui.btn.deploy': '进入战局',
  'ui.btn.returnToBase': '返回藏身处',
  'ui.chat.placeholder': '按 / 键输入命令',
  'ui.debug.toggle': '切换调试面板 (F1)',
  'common.unknown': '未知',

  // ===== 局内 HUD =====
  'hud.gear': '装备',
  'hud.weapon': '武器',
  'hud.weapon.fists': '拳头',
  'hud.backpack': '背包',
  'hud.armor': '防具',
  'hud.health': '生命',
  'hud.stamina': '耐力',
  'hud.status': '状态',

  // ===== 玩家身份弹窗 =====
  'operator.create.title': '设置昵称',
  'operator.create.prompt': '请输入你的昵称（1-32 字符）',
  'operator.callsign.placeholder': '输入昵称...',
  'operator.rename.title': '修改昵称',
  'operator.rename.prompt': '请输入新昵称（1-32 字符）',

  // ===== 装备选择弹窗 =====
  'equip.select.title': '选择要装备的物品',

  // ===== 结算界面（#resultUI） =====
  'debrief.title.success': '任务完成',
  'debrief.title.failure': '任务失败',
  'debrief.status.extracted': '撤离成功',
  'debrief.status.kia': '阵亡',
  'debrief.status.survived': '生还',
  'debrief.status.dead': '阵亡',
  'debrief.totalValue': '总价值',
  'debrief.moneyDetail': '战利品: {loot} | 现金: {cash}',
  'debrief.kia': '阵亡',
  'debrief.killer': '击杀者：',
  'debrief.weapon': '武器：',
  'debrief.statusLabel': '状态',
  'debrief.loot': '获得战利品',
  'debrief.loot.empty': '未带出任何物品',

  // ===== 藏身处外框 =====
  'hideout.decor.stream': '数据流: 正常 // 系统核心: 在线',
  'hideout.operator': '昵称',
  'hideout.statusLabel': '状态',
  'hideout.status.connecting': '连接中...',
  'hideout.status.online': '在线',
  'hideout.tab.gear': '装备与仓库',
  'hideout.tab.market': '商店',

  // ===== 装备 / 整备 / 仓库 =====
  'gear.title': '装备与整备',
  'gear.desc': '点击装备槽位从仓库选择并装备',
  'gear.slot.weapon': '武器',
  'gear.slot.backpack': '背包',
  'gear.slot.armor': '防具',
  'gear.slot.hint': '(点击装备)',
  'gear.slot.empty': '未装备',
  'loadout.title': '整备道具',
  'stash.title': '仓库',

  // ===== 分类筛选（仓库与商店共用） =====
  'category.weapons': '武器',
  'category.armor': '防具',
  'category.backpacks': '背包',
  'category.consumables': '消耗品',
  'category.materials': '材料',

  // ===== 商店 =====
  'market.title': '商店',
  'market.desc': '购买的物品直接进入仓库',
};
