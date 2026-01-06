/**
 * ProfileManager - 玩家档案管理器
 * 管理玩家的 money、stash 和 bagCap
 * 支持 JSON 文件持久化（server/data/profiles.json）
 */
import type { ItemInstance, PlayerProfile, PlayerEquipment } from '@jerkie-man/shared';
import { getItemType, getBagDef, BAGS } from '@jerkie-man/shared';
import { log } from './logger.js';
import * as fs from 'fs';
import * as path from 'path';

// 持久化文件路径
// 使用 __dirname 替代 process.cwd()，避免从不同目录运行时路径不一致
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'data');
const PROFILES_FILE = path.join(DATA_DIR, 'profiles.json');

/**
 * 玩家档案管理器
 * - 使用 accountId 作为 key（而非 playerId）
 * - 支持 JSON 文件持久化
 * - 支持获取/更新 Profile
 * - 支持从仓库卖出物品
 */
export class ProfileManager {
  // 使用 accountId 作为 key（跨连接持久）
  private profiles: Map<string, PlayerProfile> = new Map();
  
  private readonly DEFAULT_BAG_CAP = 4;
  private readonly DEFAULT_MONEY = 10000; // 初始金钱：10000
  private readonly DEFAULT_DISPLAY_NAME = null; // 默认未设置昵称
  private readonly DEFAULT_EQUIPMENT: PlayerEquipment = {
    weaponIid: null,
    bagIid: null,
    armorIid: null,
  };
  
  // 脏标记：是否需要写盘
  private isDirty = false;
  // 写盘节流：最多每 5 秒写一次
  private lastSaveTime = 0;
  private readonly SAVE_INTERVAL_MS = 5000;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.loadFromDisk();
    
    // 进程退出时保存
    process.on('beforeExit', () => this.saveNow());
    process.on('SIGINT', () => {
      this.saveNow();
      process.exit(0);
    });
    process.on('SIGTERM', () => {
      this.saveNow();
      process.exit(0);
    });
  }

  /**
   * 从磁盘加载 profiles
   */
  private loadFromDisk(): void {
    try {
      if (fs.existsSync(PROFILES_FILE)) {
        const data = fs.readFileSync(PROFILES_FILE, 'utf-8');
        const parsed = JSON.parse(data);
        
        // 验证并加载数据
        if (typeof parsed === 'object' && parsed !== null) {
          for (const [accountId, profile] of Object.entries(parsed)) {
            if (this.isValidProfile(profile)) {
              this.profiles.set(accountId, profile as PlayerProfile);
            }
          }
        }
        
        log('PROFILE_LOADED', { count: this.profiles.size, file: PROFILES_FILE });
      } else {
        log('PROFILE_FILE_NOT_FOUND', { file: PROFILES_FILE, creating: 'true' });
        // 确保目录存在
        if (!fs.existsSync(DATA_DIR)) {
          fs.mkdirSync(DATA_DIR, { recursive: true });
        }
      }
    } catch (error) {
      log('PROFILE_LOAD_ERROR', { 
        error: error instanceof Error ? error.message : String(error),
        file: PROFILES_FILE 
      });
      // 加载失败不影响启动，使用空 Map
    }
  }

  /**
   * 验证 Profile 结构
   */
  private isValidProfile(obj: unknown): obj is PlayerProfile {
    if (typeof obj !== 'object' || obj === null) return false;
    const p = obj as Record<string, unknown>;
    return (
      (p.displayName === null || typeof p.displayName === 'string') &&
      typeof p.money === 'number' &&
      Array.isArray(p.stash) &&
      Array.isArray(p.prep) &&
      typeof p.bagCap === 'number' &&
      (p.equipment === undefined || (
        typeof p.equipment === 'object' &&
        p.equipment !== null &&
        (p.equipment as Record<string, unknown>).weaponIid !== undefined &&
        (p.equipment as Record<string, unknown>).bagIid !== undefined &&
        (p.equipment as Record<string, unknown>).armorIid !== undefined
      ))
    );
  }
  
  /**
   * 判断物品类型（通过typeId前缀）
   */
  private getItemSlot(typeId: string): 'weapon' | 'bag' | 'armor' | null {
    if (typeId.startsWith('w_')) return 'weapon';
    if (typeId.startsWith('bag_')) return 'bag';
    if (typeId.startsWith('armor_')) return 'armor';
    return null;
  }

  /**
   * 判断物品是否可堆叠
   */
  private isStackable(typeId: string): boolean {
    try {
      const itemType = getItemType(typeId);
      return itemType.stackMax > 1;
    } catch {
      return false; // 未知物品类型，默认不可堆叠
    }
  }

  /**
   * 在stash和prep中查找物品实例
   */
  private findItemByIid(profile: PlayerProfile, iid: string): { place: 'stash' | 'prep'; index: number; item: ItemInstance } | null {
    // 先在stash中查找
    const stashIndex = profile.stash.findIndex(item => item.iid === iid);
    if (stashIndex !== -1) {
      return { place: 'stash', index: stashIndex, item: profile.stash[stashIndex] };
    }
    
    // 再在prep中查找
    const prepIndex = profile.prep.findIndex(item => item.iid === iid);
    if (prepIndex !== -1) {
      return { place: 'prep', index: prepIndex, item: profile.prep[prepIndex] };
    }
    
    return null;
  }

  /**
   * 归一化装备槽（清理无效的iid引用）
   */
  private normalizeEquipment(profile: PlayerProfile): void {
    // 检查weaponIid
    if (profile.equipment.weaponIid !== null) {
      const found = this.findItemByIid(profile, profile.equipment.weaponIid);
      if (!found) {
        profile.equipment.weaponIid = null;
      }
    }
    
    // 检查armorIid
    if (profile.equipment.armorIid !== null) {
      const found = this.findItemByIid(profile, profile.equipment.armorIid);
      if (!found) {
        profile.equipment.armorIid = null;
      }
    }
    
    // 检查bagIid
    if (profile.equipment.bagIid !== null) {
      const found = this.findItemByIid(profile, profile.equipment.bagIid);
      if (!found) {
        profile.equipment.bagIid = null;
      }
    }
    
    // 重新计算bagCap
    this.recomputeBagCap(profile);
  }

  /**
   * 重新计算背包容量
   */
  private recomputeBagCap(profile: PlayerProfile): void {
    if (profile.equipment.bagIid === null) {
      profile.bagCap = this.DEFAULT_BAG_CAP;
      return;
    }
    
    const found = this.findItemByIid(profile, profile.equipment.bagIid);
    if (!found) {
      profile.equipment.bagIid = null;
      profile.bagCap = this.DEFAULT_BAG_CAP;
      return;
    }
    
    try {
      const bagDef = getBagDef(found.item.typeId);
      profile.bagCap = bagDef.bagCap;
    } catch {
      profile.equipment.bagIid = null;
      profile.bagCap = this.DEFAULT_BAG_CAP;
    }
  }

  /**
   * 添加可堆叠物品到容器（按stackMax自动拆栈）
   */
  private addStackableToContainer(containerItems: ItemInstance[], typeId: string, qty: number): number {
    let remaining = qty;
    const itemType = getItemType(typeId);
    const stackMax = itemType.stackMax;
    
    // 先填充已有同typeId的栈
    for (const item of containerItems) {
      if (item.typeId === typeId && item.qty < stackMax) {
        const canAdd = Math.min(remaining, stackMax - item.qty);
        item.qty += canAdd;
        remaining -= canAdd;
        if (remaining <= 0) break;
      }
    }
    
    // 创建新栈（每个栈qty<=stackMax）
    while (remaining > 0) {
      const stackQty = Math.min(remaining, stackMax);
      containerItems.push({
        iid: this.generateIid(),
        typeId,
        qty: stackQty,
      });
      remaining -= stackQty;
    }
    
    return qty; // 全部添加成功
  }

  /**
   * 添加不可堆叠实例（每个实例qty=1）
   */
  private addNonStackableInstances(containerItems: ItemInstance[], typeId: string, count: number): void {
    for (let i = 0; i < count; i++) {
      containerItems.push({
        iid: this.generateIid(),
        typeId,
        qty: 1,
      });
    }
  }

  private normalizeContainers(profile: PlayerProfile): void {
    profile.stash = this.normalizeContainer(profile.stash);
    profile.prep = this.normalizeContainer(profile.prep);
  }

  private normalizeContainer(items: ItemInstance[]): ItemInstance[] {
    const stackTotals = new Map<string, number>();
    const keepItems: ItemInstance[] = [];

    for (const item of items) {
      let itemType: ReturnType<typeof getItemType> | null = null;
      try {
        itemType = getItemType(item.typeId);
      } catch {
        keepItems.push(item);
        continue;
      }

      if (itemType.stackMax <= 1) {
        keepItems.push(item);
        continue;
      }
      stackTotals.set(item.typeId, (stackTotals.get(item.typeId) ?? 0) + item.qty);
    }

    const stackedItems: ItemInstance[] = [];
    for (const [typeId, qty] of stackTotals) {
      const itemType = getItemType(typeId);
      let remaining = qty;
      while (remaining > 0) {
        const stackQty = Math.min(remaining, itemType.stackMax);
        stackedItems.push({
          iid: this.generateIid(),
          typeId,
          qty: stackQty,
        });
        remaining -= stackQty;
      }
    }

    const merged = [...keepItems, ...stackedItems];
    merged.sort((a, b) => this.compareItems(a, b));
    return merged;
  }

  private compareItems(a: ItemInstance, b: ItemInstance): number {
    const aCategory = this.getCategoryOrder(a.typeId);
    const bCategory = this.getCategoryOrder(b.typeId);
    if (aCategory !== bCategory) return aCategory - bCategory;

    const aType = this.safeGetItemType(a.typeId);
    const bType = this.safeGetItemType(b.typeId);
    const aRarity = this.getRarityOrder(aType?.rarity);
    const bRarity = this.getRarityOrder(bType?.rarity);
    if (aRarity !== bRarity) return aRarity - bRarity;

    const aName = aType?.name ?? a.typeId;
    const bName = bType?.name ?? b.typeId;
    if (aName !== bName) return aName.localeCompare(bName);

    const aStackable = (aType?.stackMax ?? 1) > 1;
    const bStackable = (bType?.stackMax ?? 1) > 1;
    if (aStackable && bStackable && a.qty !== b.qty) {
      return b.qty - a.qty;
    }
    return a.typeId.localeCompare(b.typeId);
  }

  private safeGetItemType(typeId: string): ReturnType<typeof getItemType> | null {
    try {
      return getItemType(typeId);
    } catch {
      return null;
    }
  }

  private getCategoryOrder(typeId: string): number {
    const slot = this.getItemSlot(typeId);
    if (slot === 'weapon') return 0;
    if (slot === 'armor') return 1;
    if (slot === 'bag') return 2;
    return 3;
  }

  private getRarityOrder(rarity?: string): number {
    if (rarity === 'COMMON') return 0;
    if (rarity === 'RARE') return 1;
    if (rarity === 'EPIC') return 2;
    return 3;
  }

  /**
   * 计算添加物品会额外占多少槽位
   */
  private calcExtraSlotsIfAdd(containerItems: ItemInstance[], typeId: string, qty: number): number {
    const itemType = getItemType(typeId);
    const stackMax = itemType.stackMax;
    
    if (stackMax <= 1) {
      // 不可堆叠：每个实例占1槽
      return qty;
    }
    
    // 可堆叠：计算需要的新栈数
    let remaining = qty;
    
    // 先填充已有栈
    for (const item of containerItems) {
      if (item.typeId === typeId && item.qty < stackMax) {
        const canAdd = Math.min(remaining, stackMax - item.qty);
        remaining -= canAdd;
        if (remaining <= 0) break;
      }
    }
    
    // 计算需要的新栈数
    if (remaining <= 0) {
      return 0; // 全部填充到已有栈，不占新槽
    }
    
    return Math.ceil(remaining / stackMax);
  }

  /**
   * 立即保存到磁盘（用于进程退出）
   */
  private saveNow(): void {
    if (!this.isDirty) return;
    
    try {
      // 确保目录存在
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      
      // 转换 Map 为 Object
      const data: Record<string, PlayerProfile> = {};
      for (const [accountId, profile] of this.profiles.entries()) {
        data[accountId] = profile;
      }
      
      // 原子写入（写入临时文件再重命名）
      const tempFile = PROFILES_FILE + '.tmp';
      fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf-8');
      fs.renameSync(tempFile, PROFILES_FILE);
      
      this.isDirty = false;
      this.lastSaveTime = Date.now();
      log('PROFILE_SAVED', { count: this.profiles.size, file: PROFILES_FILE });
    } catch (error) {
      log('PROFILE_SAVE_ERROR', { 
        error: error instanceof Error ? error.message : String(error),
        file: PROFILES_FILE 
      });
    }
  }

  /**
   * 标记需要保存（节流写盘）
   */
  private markDirty(): void {
    this.isDirty = true;
    
    // 如果距离上次保存超过间隔，立即保存
    const now = Date.now();
    if (now - this.lastSaveTime >= this.SAVE_INTERVAL_MS) {
      this.saveNow();
    } else if (!this.saveTimer) {
      // 否则设置延时保存
      this.saveTimer = setTimeout(() => {
        this.saveTimer = null;
        this.saveNow();
      }, this.SAVE_INTERVAL_MS - (now - this.lastSaveTime));
    }
  }

  /**
   * 获取玩家背包容量（从装备的背包动态计算）
   * @param accountId 账号 ID
   */
  getBagCap(accountId: string): number {
    const profile = this.getProfileData(accountId);
    // 确保bagCap是最新的
    this.recomputeBagCap(profile);
    return profile.bagCap;
  }

  /**
   * 获取玩家 Profile（不存在则创建默认值）
   * @param accountId 账号 ID
   */
  getProfileData(accountId: string): PlayerProfile {
    let profile = this.profiles.get(accountId);
    if (!profile) {
      profile = {
        displayName: this.DEFAULT_DISPLAY_NAME,
        phase: 'NAME', // 新账号默认为 NAME 阶段
        money: this.DEFAULT_MONEY,
        stash: [],
        prep: [],
        bagCap: this.DEFAULT_BAG_CAP,
        equipment: { ...this.DEFAULT_EQUIPMENT },
      };
      this.profiles.set(accountId, profile);
      this.markDirty();
      log('PROFILE_CREATED', { accountId, money: profile.money, bagCap: profile.bagCap });
    }
    // 兼容旧数据：如果缺少新字段，补充默认值
    if (profile.displayName === undefined) {
      profile.displayName = this.DEFAULT_DISPLAY_NAME;
      this.markDirty();
    }
    if ((profile as any).phase === undefined) {
      // 旧账号：根据 displayName 推断 phase
      (profile as any).phase = profile.displayName === null ? 'NAME' : 'HIDEOUT';
      this.markDirty();
    }
    // ✅ 修复：如果 phase 是 RESULT（临时状态），刷新/重连时自动返回 HIDEOUT
    if (profile.phase === 'RESULT') {
      profile.phase = 'HIDEOUT';
      this.markDirty();
      log('PHASE_AUTO_RESET', { accountId, from: 'RESULT', to: 'HIDEOUT', reason: 'reconnect' });
    }
    if (profile.equipment === undefined) {
      profile.equipment = { ...this.DEFAULT_EQUIPMENT };
      this.markDirty();
    }
    // 兼容旧数据：如果金钱为 0 且是新账号（stash 和 prep 都为空），给初始金钱
    if (profile.money === 0 && profile.stash.length === 0 && (profile.prep?.length ?? 0) === 0) {
      profile.money = this.DEFAULT_MONEY;
      this.markDirty();
      log('PROFILE_MONEY_INIT', { accountId, money: profile.money });
    }
    if (profile.prep === undefined) {
      profile.prep = [];
      this.markDirty();
    }
    // bagCap现在是动态计算的，但为了兼容，我们需要更新它
    this.recomputeBagCap(profile);
    return profile;
  }

  /**
   * 更新玩家阶段状态
   * @param accountId 账号 ID
   * @param phase 新阶段
   * @param onExitRaidCallback 可选回调，当玩家离开 RAID 时调用（用于清理映射）
   */
  updatePhase(accountId: string, phase: 'NAME' | 'HIDEOUT' | 'RAID' | 'RESULT', onExitRaidCallback?: () => void): void {
    const profile = this.getProfileData(accountId);
    const oldPhase = profile.phase;
    profile.phase = phase;
    this.markDirty();
    log('PHASE_UPDATE', { accountId, oldPhase, newPhase: phase });

    // ✅ 关键：当玩家离开 RAID 时，触发回调（用于清理 accountId → playerId 映射）
    if (oldPhase === 'RAID' && phase !== 'RAID' && onExitRaidCallback) {
      onExitRaidCallback();
    }
  }

  /**
   * 处理断线死亡：清空prep区物品，重置phase为HIDEOUT
   * @param accountId 账号 ID
   */
  handleDisconnectDeath(accountId: string): void {
    const profile = this.getProfileData(accountId);
    if (profile.phase !== 'RAID') {
      // 不在RAID中，无需处理死亡
      return;
    }

    // 清空整备区（丢失所有raid物品）
    profile.prep = [];

    // 重置phase为HIDEOUT
    profile.phase = 'HIDEOUT';

    this.markDirty();
    log('DISCONNECT_DEATH', {
      accountId,
      message: 'Player disconnected during RAID, all items lost'
    });
  }

  /**
   * 更新玩家 Profile
   * @param accountId 账号 ID
   */
  updateProfile(accountId: string, updates: Partial<PlayerProfile>): PlayerProfile {
    const profile = this.getProfileData(accountId);
    if (updates.displayName !== undefined) {
      profile.displayName = updates.displayName;
    }
    if (updates.money !== undefined) {
      profile.money = updates.money;
    }
    if (updates.stash !== undefined) {
      profile.stash = updates.stash;
    }
    if (updates.prep !== undefined) {
      profile.prep = updates.prep;
    }
    if (updates.bagCap !== undefined) {
      profile.bagCap = updates.bagCap;
    }
    if (updates.stash !== undefined || updates.prep !== undefined) {
      this.normalizeContainers(profile);
    }
    this.markDirty();
    return profile;
  }

  /**
   * 添加物品到仓库（撤离时调用）
   * @param accountId 账号 ID
   */
  addToStash(accountId: string, items: ItemInstance[]): void {
    const profile = this.getProfileData(accountId);
    
    for (const item of items) {
      const itemType = getItemType(item.typeId);
      
      if (itemType.stackMax <= 1) {
        // 不可堆叠：强制qty=1，保持原iid或生成新iid
        profile.stash.push({
          iid: item.iid || this.generateIid(),
          typeId: item.typeId,
          qty: 1, // 强制为1
        });
      } else {
        // 可堆叠：使用addStackableToContainer
        this.addStackableToContainer(profile.stash, item.typeId, item.qty);
      }
    }
    
    this.markDirty();
    this.normalizeContainers(profile);
    this.normalizeEquipment(profile);
    log('STASH_ADD', { accountId, itemCount: items.length, totalStash: profile.stash.length });
  }

  /**
   * 从仓库卖出物品
   * @param accountId 账号 ID
   * @returns { success: boolean; money?: number } - 成功时返回新的 money 值
   */
  sellFromStash(
    accountId: string,
    iid: string,
    qty: number
  ): { success: boolean; money?: number } {
    const profile = this.getProfileData(accountId);
    
    // 查找物品（在stash和prep中查找）
    const found = this.findItemByIid(profile, iid);
    if (!found) {
      return { success: false };
    }
    
    const item = found.item;
    const itemType = getItemType(item.typeId);
    
    // 不可堆叠物品：强制qty=1
    if (itemType.stackMax <= 1) {
      qty = 1;
    }
    
    if (item.qty < qty) {
      return { success: false };
    }
    
    // 获取物品价值
    const value = itemType.value ?? 1;
    
    // 扣减数量
    item.qty -= qty;
    if (item.qty <= 0) {
      // 删除物品
      if (found.place === 'stash') {
        profile.stash.splice(found.index, 1);
      } else {
        profile.prep.splice(found.index, 1);
      }
    }
    
    // 检查是否卖掉了已装备的物品
    if (profile.equipment.weaponIid === iid) {
      profile.equipment.weaponIid = null;
    }
    if (profile.equipment.armorIid === iid) {
      profile.equipment.armorIid = null;
    }
    if (profile.equipment.bagIid === iid) {
      profile.equipment.bagIid = null;
    }
    
    // 增加金钱
    const earned = value * qty;
    profile.money += earned;
    
    this.markDirty();
    this.normalizeContainers(profile);
    this.normalizeEquipment(profile);
    log('STASH_SELL', { accountId, iid, qty, earned, newMoney: profile.money });
    
    return { success: true, money: profile.money };
  }

  /**
   * 从仓库移动到整备区
   * @param accountId 账号 ID
   * @param iid 物品实例 ID
   * @param qty 数量
   * @returns { success: boolean; message?: string } - 成功时返回 true
   */
  moveStashToPrep(
    accountId: string,
    iid: string,
    qty: number
  ): { success: boolean; message?: string } {
    const profile = this.getProfileData(accountId);

    // ✅ 关键：只允许在 HIDEOUT 阶段修改整备区
    if (profile.phase !== 'HIDEOUT') {
      return { success: false, message: `Cannot modify prep area in phase: ${profile.phase}` };
    }

    // 查找仓库中的物品
    const stashItemIndex = profile.stash.findIndex(s => s.iid === iid);
    if (stashItemIndex === -1) {
      return { success: false, message: 'Item not found in stash' };
    }
    
    const stashItem = profile.stash[stashItemIndex];
    const itemType = getItemType(stashItem.typeId);
    
    // Case A: 不可堆叠（stackMax<=1）
    if (itemType.stackMax <= 1) {
      // qty必须为1
      if (qty !== 1) {
        qty = 1; // 忽略其他值，强制为1
      }
      
      // 容量校验：按槽位数
      if (profile.prep.length + 1 > profile.bagCap) {
        return { success: false, message: 'Prep area full' };
      }
      
      // 直接移动实例本体（iid不变）
      const [moved] = profile.stash.splice(stashItemIndex, 1);
      profile.prep.push(moved);
      
      this.markDirty();
      this.normalizeContainers(profile);
      this.normalizeEquipment(profile);
      log('MOVE_STASH_TO_PREP', { accountId, iid, qty: 1, typeId: stashItem.typeId });
      return { success: true };
    }
    
    // Case B: 可堆叠（stackMax>1）
    if (stashItem.qty < qty) {
      return { success: false, message: 'Not enough quantity in stash' };
    }
    
    // 计算额外槽位
    const extra = this.calcExtraSlotsIfAdd(profile.prep, stashItem.typeId, qty);
    if (profile.prep.length + extra > profile.bagCap) {
      return { success: false, message: 'Prep area full' };
    }
    
    // 从stash扣减
    stashItem.qty -= qty;
    if (stashItem.qty <= 0) {
      profile.stash.splice(stashItemIndex, 1);
    }
    
    // 添加到prep（自动堆叠）
    this.addStackableToContainer(profile.prep, stashItem.typeId, qty);
    
    this.markDirty();
    this.normalizeContainers(profile);
    this.normalizeEquipment(profile);
    log('MOVE_STASH_TO_PREP', { accountId, iid, qty, typeId: stashItem.typeId });
    return { success: true };
  }

  /**
   * 从整备区移动回仓库
   * @param accountId 账号 ID
   * @param iid 物品实例 ID
   * @param qty 数量
   * @returns { success: boolean; message?: string } - 成功时返回 true
   */
  movePrepToStash(
    accountId: string,
    iid: string,
    qty: number
  ): { success: boolean; message?: string } {
    const profile = this.getProfileData(accountId);

    // ✅ 关键：只允许在 HIDEOUT 阶段修改整备区
    if (profile.phase !== 'HIDEOUT') {
      return { success: false, message: `Cannot modify prep area in phase: ${profile.phase}` };
    }

    // 查找整备区中的物品
    const prepItemIndex = profile.prep.findIndex(p => p.iid === iid);
    if (prepItemIndex === -1) {
      return { success: false, message: 'Item not found in prep' };
    }
    
    const prepItem = profile.prep[prepItemIndex];
    const itemType = getItemType(prepItem.typeId);
    
    // Case A: 不可堆叠（stackMax<=1）
    if (itemType.stackMax <= 1) {
      // qty必须为1
      if (qty !== 1) {
        qty = 1; // 忽略其他值，强制为1
      }
      
      // 直接移动实例本体（iid不变）
      const [moved] = profile.prep.splice(prepItemIndex, 1);
      profile.stash.push(moved);
      
      this.markDirty();
      this.normalizeContainers(profile);
      this.normalizeEquipment(profile);
      log('MOVE_PREP_TO_STASH', { accountId, iid, qty: 1, typeId: prepItem.typeId });
      return { success: true };
    }
    
    // Case B: 可堆叠（stackMax>1）
    if (prepItem.qty < qty) {
      return { success: false, message: 'Not enough quantity in prep' };
    }
    
    // 从prep扣减
    prepItem.qty -= qty;
    if (prepItem.qty <= 0) {
      profile.prep.splice(prepItemIndex, 1);
    }
    
    // 添加到stash（自动堆叠）
    this.addStackableToContainer(profile.stash, prepItem.typeId, qty);
    
    this.markDirty();
    this.normalizeContainers(profile);
    this.normalizeEquipment(profile);
    log('MOVE_PREP_TO_STASH', { accountId, iid, qty, typeId: prepItem.typeId });
    return { success: true };
  }

  /**
   * 商店购买物品（买到仓库）
   * @param accountId 账号 ID
   * @param typeId 物品类型 ID
   * @param qty 数量
   * @returns { success: boolean; money?: number; message?: string } - 成功时返回新的 money 值
   */
  buyItem(
    accountId: string,
    typeId: string,
    qty: number
  ): { success: boolean; money?: number; message?: string } {
    const profile = this.getProfileData(accountId);
    
    // 获取物品类型
    let itemType;
    try {
      itemType = getItemType(typeId);
    } catch {
      return { success: false, message: 'Unknown item type' };
    }
    
    // 计算总价
    const totalCost = itemType.value * qty;
    if (profile.money < totalCost) {
      return { success: false, message: 'Not enough money' };
    }
    
    // 扣钱
    profile.money -= totalCost;
    
    // 添加到仓库（根据stackMax决定是否堆叠）
    if (itemType.stackMax <= 1) {
      // 不可堆叠：每个实例独立（武器/防具/背包）
      this.addNonStackableInstances(profile.stash, typeId, qty);
    } else {
      // 可堆叠：自动拆栈
      this.addStackableToContainer(profile.stash, typeId, qty);
    }
    
    this.markDirty();
    this.normalizeContainers(profile);
    this.normalizeEquipment(profile);
    log('BUY_ITEM', { accountId, typeId, qty, cost: totalCost, newMoney: profile.money });
    return { success: true, money: profile.money };
  }

  /**
   * 装备/卸下装备
   * @param accountId 账号 ID
   * @param slot 装备槽
   * @param iid 物品实例 ID（null 表示卸下）
   * @returns { success: boolean; message?: string }
   */
  equipItem(
    accountId: string,
    slot: 'weapon' | 'bag' | 'armor',
    iid: string | null
  ): { success: boolean; message?: string } {
    const profile = this.getProfileData(accountId);
    
    // 如果iid为null，表示卸下装备
    if (iid === null) {
      profile.equipment[`${slot}Iid` as keyof PlayerEquipment] = null;
      this.markDirty();
      this.normalizeEquipment(profile);
      log('UNEQUIP_ITEM', { accountId, slot });
      return { success: true };
    }
    
    // 查找要装备的物品（在stash和prep中查找）
    const found = this.findItemByIid(profile, iid);
    if (!found) {
      return { success: false, message: 'Item not found' };
    }
    
    const item = found.item;
    
    // 验证物品类型是否匹配槽位
    const itemSlot = this.getItemSlot(item.typeId);
    if (itemSlot !== slot) {
      return { success: false, message: `Item type does not match slot: ${itemSlot} != ${slot}` };
    }
    
    // 如果是背包，检查容量（如果新背包容量小于当前prep槽位数，禁止装备）
    if (slot === 'bag') {
      try {
        const bagDef = getBagDef(item.typeId);
        if (bagDef.bagCap < profile.prep.length) {
          return { success: false, message: 'Prep over capacity' };
        }
      } catch {
        return { success: false, message: 'Invalid bag type' };
      }
    }
    
    // 设置新装备
    profile.equipment[`${slot}Iid` as keyof PlayerEquipment] = iid;
    
    this.markDirty();
    this.normalizeContainers(profile);
    this.normalizeEquipment(profile);
    
    log('EQUIP_ITEM', { accountId, slot, iid: item.iid, typeId: item.typeId });
    return { success: true };
  }

  /**
   * 生成物品实例 ID
   */
  private generateIid(): string {
    return `i${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
}
