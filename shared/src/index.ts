// 协议
export * from './protocol.js';

// 数学工具
export * from './math.js';

// 随机数生成器
export * from './rng.js';

// 游戏模拟逻辑（共享）
export * from './sim.js';

// 内容配置
// 内容配置
export { 
  MAP_CONFIG_SCHEMA, 
  DEFAULT_MAP_CONFIG, 
  ITEM_TYPE_SCHEMA, 
  loadMapConfig, 
  loadItemTypes 
} from './content.js';
export type { MAP_CONFIG, Zone, ITEM_TYPE } from './content.js';

// 物品系统类型和目录
export * from './types.js';
export * from './item_catalog.js';

// 装备系统
export * from './equipment.js';

// Fire control helpers (shared rules)
export * from './fireControl.js';

// 国际化支持
export * from './i18n/index.js';

// 常量（单一数据源）
export * from './constants.js';

// Profile工具函数（单一数据源）
export * from './profileUtils.js';
export * from './mapTemplate.js';

// 障碍物配置
export * from './obstacleConfig.js';

// 显式导出内容加载器函数 (已在上文导出)
// export { loadMapConfig, loadItemTypes } from './content.js';

// 二进制编解码器 (MessagePack)
export * from './binaryCodec.js';

// 字段名压缩
export * from './fieldCompression.js';
