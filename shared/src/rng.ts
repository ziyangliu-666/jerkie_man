/**
 * 可复现的随机数生成器
 * 基于 Mulberry32 算法，速度快且分布均匀
 */

/**
 * 创建一个可复现的随机数生成器
 * @param seed 种子值（整数）
 * @returns 返回一个函数，每次调用生成 0-1 之间的随机数
 */
export function createRng(seed: number): () => number {
  // Mulberry32 算法
  let state = seed >>> 0; // 确保是 32 位无符号整数
  
  return function(): number {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

