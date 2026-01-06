// 协议
export * from './protocol.js';

// 数学工具
export * from './math.js';

// 随机数生成器
export * from './rng.js';

// 游戏模拟逻辑（共享）
export * from './sim.js';

// 内容配置
export * from './content.js';

// 物品系统类型和目录
export * from './types.js';
export * from './item_catalog.js';

// 装备系统
export * from './equipment.js';

// Fire control helpers (shared rules)
export * from './fireControl.js';

// 国际化支持
export * from './i18n.js';

// 常量（单一数据源）
export * from './constants.js';

// Profile工具函数（单一数据源）
export * from './profileUtils.js';
export * from './mapTemplate.js';

// 障碍物配置
export * from './obstacleConfig.js';

// 显式导出内容加载器函数
export { loadMapConfig, loadItemTypes } from './content.js';
