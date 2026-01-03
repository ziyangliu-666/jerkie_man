/**
 * ProfileManager - 玩家档案管理器
 * 管理玩家的 money、stash 和 bagCap
 */
import type { ItemInstance, PlayerProfile } from '@jerkie-man/shared';
import { getItemType, ITEM_CATALOG } from '@jerkie-man/shared';

/**
 * 玩家档案管理器
 * - 内存存储（MVP 阶段，未来可接入持久化）
 * - 支持获取/更新 Profile
 * - 支持从仓库卖出物品
 */
export class ProfileManager {
  private profiles: Map<string, PlayerProfile> = new Map();
  
  private readonly DEFAULT_BAG_CAP = 8;
  private readonly DEFAULT_MONEY = 0;

  /**
   * 获取玩家背包容量
   */
  getBagCap(playerId: string): number {
    return this.getProfileData(playerId).bagCap;
  }

  /**
   * 获取玩家 Profile（不存在则创建默认值）
   */
  getProfileData(playerId: string): PlayerProfile {
    let profile = this.profiles.get(playerId);
    if (!profile) {
      profile = {
        money: this.DEFAULT_MONEY,
        stash: [],
        bagCap: this.DEFAULT_BAG_CAP,
      };
      this.profiles.set(playerId, profile);
    }
    return profile;
  }

  /**
   * 更新玩家 Profile
   */
  updateProfile(playerId: string, updates: Partial<PlayerProfile>): PlayerProfile {
    const profile = this.getProfileData(playerId);
    if (updates.money !== undefined) {
      profile.money = updates.money;
    }
    if (updates.stash !== undefined) {
      profile.stash = updates.stash;
    }
    if (updates.bagCap !== undefined) {
      profile.bagCap = updates.bagCap;
    }
    return profile;
  }

  /**
   * 添加物品到仓库（撤离时调用）
   */
  addToStash(playerId: string, items: ItemInstance[]): void {
    const profile = this.getProfileData(playerId);
    
    for (const item of items) {
      // 尝试堆叠到现有物品
      const existing = profile.stash.find(
        s => s.typeId === item.typeId
      );
      
      if (existing) {
        // 简单堆叠（MVP：不检查 stackMax，stash 无容量限制）
        existing.qty += item.qty;
      } else {
        // 添加新物品（保持原 iid 或生成新的）
        profile.stash.push({
          iid: item.iid || this.generateIid(),
          typeId: item.typeId,
          qty: item.qty,
        });
      }
    }
  }

  /**
   * 从仓库卖出物品
   * @returns { success: boolean; money?: number } - 成功时返回新的 money 值
   */
  sellFromStash(
    playerId: string,
    iid: string,
    qty: number
  ): { success: boolean; money?: number } {
    const profile = this.getProfileData(playerId);
    
    // 查找物品
    const itemIndex = profile.stash.findIndex(s => s.iid === iid);
    if (itemIndex === -1) {
      return { success: false };
    }
    
    const item = profile.stash[itemIndex];
    if (item.qty < qty) {
      return { success: false };
    }
    
    // 获取物品价值
    let value = 1; // 默认值，防止崩溃
    try {
      const itemType = getItemType(item.typeId);
      value = itemType.value ?? 1;
    } catch {
      // 未知物品类型，使用默认值
    }
    
    // 扣减数量
    item.qty -= qty;
    if (item.qty <= 0) {
      profile.stash.splice(itemIndex, 1);
    }
    
    // 增加金钱
    const earned = value * qty;
    profile.money += earned;
    
    return { success: true, money: profile.money };
  }

  /**
   * 生成物品实例 ID
   */
  private generateIid(): string {
    return `i${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
}

