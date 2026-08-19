/**
 * 障碍物名称与说明文本。
 * 描述以代码实际行为为准：是否挡人、子弹穿透后剩余多少伤害、多少 HP 被打坏、掉什么。
 */
export const OBSTACLES: Record<string, string> = {
  'obstacle.wall.name': '石墙',
  'obstacle.wall.desc': '阻挡移动、子弹和视线，无法破坏。',

  'obstacle.crate.name': '木箱',
  'obstacle.crate.desc': '硬掩体，子弹完全无法穿透。100 HP，打坏后约 30% 概率掉落 1 件物品。',

  'obstacle.weapon_crate.name': '武器箱',
  'obstacle.weapon_crate.desc': '硬掩体，100 HP。打坏后掉落 1 把武器，5% 概率为传说级。',

  'obstacle.throwable_crate.name': '投掷物箱',
  'obstacle.throwable_crate.desc': '硬掩体，100 HP。打坏后散落 2-4 件投掷物：手雷、烟雾弹、闪光弹、燃烧瓶。',

  'obstacle.medical_crate.name': '医疗箱',
  'obstacle.medical_crate.desc': '硬掩体，100 HP。打坏后掉落 2-3 件医疗物品。',

  'obstacle.equipment_crate.name': '装备箱',
  'obstacle.equipment_crate.desc': '硬掩体，100 HP。打坏后掉落 1 件护甲或背包，5% 概率为传说级。',

  'obstacle.vehicle.name': '废弃车辆',
  'obstacle.vehicle.desc': '子弹可穿透车身，伤害衰减到 20%。150 HP，摧毁后留下 1-2 件低级物资。',

  'obstacle.supply_stack.name': '物资堆',
  'obstacle.supply_stack.desc': '子弹穿透后保留 30% 伤害。100 HP，摧毁后散落 2-4 件低级物资。',

  'obstacle.fence_wood.name': '木栅栏',
  'obstacle.fence_wood.desc': '可以直接翻越，期间移速降到 80%。子弹穿透后保留 70% 伤害，50 HP 就能打断。',

  'obstacle.fence_metal.name': '金属栅栏',
  'obstacle.fence_metal.desc': '挡人不挡枪，子弹穿透后保留 50% 伤害。100 HP。',

  'obstacle.shrub.name': '灌木丛',
  'obstacle.shrub.desc': '稀疏植被，人和子弹都能穿过，移速降到 90%，但敌人无法透视。',

  'obstacle.rock_large.name': '大岩石',
  'obstacle.rock_large.desc': '不可破坏的硬掩体，阻挡移动、子弹和视线。',

  'obstacle.bush.name': '草丛',
  'obstacle.bush.desc': '躲进去敌人就会跟丢；已经锁定你的敌人仍能大致判断你的位置。不挡人也不挡子弹。',

  'obstacle.water.name': '水域',
  'obstacle.water.desc': '可以涉水通过，移速减半。子弹和视线都能穿过。',

  'obstacle.door_closed.name': '门（关）',
  'obstacle.door_closed.desc': '阻挡移动、子弹和视线。没法开门，只能打掉 100 HP。',

  'obstacle.door_open.name': '门（开）',
  'obstacle.door_open.desc': '可以通行，而且关不上了。',

  'obstacle.glass.name': '玻璃',
  'obstacle.glass.desc': '人过不去，子弹穿透后保留 90% 伤害。只有 30 HP，一梭子就碎。',

  'obstacle.chest_closed.name': '宝箱',
  'obstacle.chest_closed.desc': '只能打碎，打掉 100 HP。开出 2 件高级物资：80% 史诗，20% 传说。',

  'obstacle.chest_open.name': '空宝箱',
  'obstacle.chest_open.desc': '已经被搜刮干净，可以直接走过去。',

  'obstacle.broken.name': '残骸',
  'obstacle.broken.desc': '掩体被摧毁后留下的残骸，不阻挡任何东西。',
};
