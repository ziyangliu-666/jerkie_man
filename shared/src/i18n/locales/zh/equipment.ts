/**
 * 装备属性标签（武器 / 护甲 / 背包 / 消耗品），以及物品目录里没有的那件装备名。
 * 键的用法说明见 en/equipment.ts。
 */
export const EQUIPMENT: Record<string, string> = {
  // 默认近战武器，不在物品目录中，名字放这里
  'item.w_fists.name': '拳头',

  // --- 武器 ---
  'stat.damage': '伤害',
  'stat.pellets': '弹丸',
  'stat.mag': '弹匣',
  'stat.range': '射程',
  'stat.reach': '攻击范围',
  'stat.rpm': '射速',
  'stat.rpm.fmt': '{value} 发/分',
  'stat.speed': '移速',

  // --- 护甲 ---
  'stat.armor': '减伤',

  // --- 背包 ---
  'stat.capacity': '容量',
  'stat.capacity_one': '容量: {count} 格',
  'stat.capacity_other': '容量: {count} 格',

  // --- 消耗品 ---
  'stat.heal': '恢复',
  'stat.radius': '爆炸半径',
  'stat.duration': '持续时间',
  'stat.dps': '灼烧',
  'stat.blindRadius': '致盲范围',
  'stat.blindDuration': '致盲时长',
  'stat.smokeRadius': '烟雾范围',
  'stat.fireRadius': '火焰范围',
  'stat.speedBonus': '速度加成',
  'stat.regen': '回复',
  'stat.disguiseDuration': '伪装时长',

  // --- 通用 ---
  'stat.value': '价值',
  'stat.stackMax': '最大堆叠',

  // --- 单位 ---
  'unit.hp': '{value}HP',
  'unit.hps': '{value}HP/秒',
  'unit.sec': '{value}秒',
  'unit.px': '{value}像素',

  // 属性条的短标签。空间极窄，英文 3-5 个大写字母，中文 2 字。
  'stat.short.damage': '伤害',
  'stat.short.rpm': '射速',
  'stat.short.mag': '弹匣',
  'stat.short.range': '射程',
  'stat.short.reach': '范围',
  'stat.short.armor': '减伤',
  'stat.short.capacity': '容量',
  'stat.short.speed': '移速',
  'stat.short.heal': '回复',
  'stat.short.radius': '范围',
  'stat.short.duration': '持续',
  'stat.short.dps': '每秒',
};
