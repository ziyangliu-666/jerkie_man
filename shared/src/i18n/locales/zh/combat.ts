/**
 * 局内战斗覆盖层文案：名牌、状态徽标、AI/炮塔状态、掉落物提示、撤离进度条。
 *
 * 英文是源语言，这里只做等价表达。中文没有复数形态，`_one` 变体不需要，
 * 运行时对任意 count 都取 `_other`。
 */
export const COMBAT: Record<string, string> = {
  // --- 名牌 -----------------------------------------------------------------
  'combat.nameplate.corpse': '{name} 的坟墓',
  'combat.nameplate.killedBy': '被 {killer} 用 {weapon} 击杀',
  'combat.nameplate.killedByUnarmed': '被 {killer} 击杀',

  // --- 状态徽标 -------------------------------------------------------------
  'combat.status.healing': '治疗中',
  'combat.status.blinded': '致盲',
  'combat.status.stunned': '眩晕',
  'combat.status.concealed': '隐蔽',

  // --- Buff -----------------------------------------------------------------
  'buff.combat_stim': '兴奋',
  'buff.regeneration_serum': '再生',
  'buff.disguise_kit': '伪装',

  // --- AI 行为状态 ----------------------------------------------------------
  'combat.ai.idle': '摸鱼',
  'combat.ai.patrol': '巡逻',
  'combat.ai.spotting': '发现',
  'combat.ai.chase': '追击',
  'combat.ai.attack': '攻击',
  'combat.ai.search': '搜索',
  'combat.ai.return': '返回',

  // --- 哨兵炮塔状态 ---------------------------------------------------------
  'combat.turret.idle': '待机',
  'combat.turret.spooling': '预热',
  'combat.turret.firing': '射击',
  'combat.turret.reloading': '装弹',

  // --- 掉落包提示 -----------------------------------------------------------
  'combat.loot.empty': '空掉落包',
  'combat.loot.more_other': '… 还有 {count} 个物品',

  // --- 撤离进度条 -----------------------------------------------------------
  'combat.extract.inProgress': '正在撤离…',

  // --- 投掷瞄准 -------------------------------------------------------------
  'combat.throw.hint': '左键投掷 · 右键取消',
};
