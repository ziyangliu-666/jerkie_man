/**
 * 基于 seed 的伪随机数生成器
 * 使用 mulberry32 算法，简单高效，适合游戏场景
 */

/**
 * 创建一个基于 seed 的伪随机数生成器
 * @param seed 随机种子（整数）
 * @returns 返回一个函数，每次调用返回 [0, 1) 范围内的随机数
 */
export function createRng(seed: number): () => number {
  let state = seed;
  
  return function(): number {
    // mulberry32 算法
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t = t ^ (t + Math.imul(t ^ (t >>> 7), state | 61));
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}


