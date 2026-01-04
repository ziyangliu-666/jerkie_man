import type { PLAYER_STATE, OBSTACLE_STATE, PlayerInventory, ItemInstance, WeaponRuntime } from '@jerkie-man/shared';
import { simulatePlayerMove, getItemType, PositionHistory } from '@jerkie-man/shared';

export class Player {
  public id: string;
  public x: number;
  public y: number;
  public hp: number;
  public status: 'ALIVE' | 'DEAD' | 'EXTRACTED';
  public lastInputSeq: number;
  public lastInputTick: number;
  public lootCount: number; // Day3: 战利品计数（已废弃，保留兼容）
  public extractProgress: number = 0; // 游戏化增强: 撤离进度（毫秒，0-2000）
  public inventory: PlayerInventory; // 新增: 背包系统
  public name: string | undefined; // 新增: 玩家昵称（用于显示）
  public weaponRuntime: WeaponRuntime | undefined; // 新增: 武器运行时状态（局内状态）
  public lastShoot: boolean = false; // track previous shoot state for burst gating
  public armorReduction: number = 0; // 新增: 护甲减伤（0-1，例如0.25表示减少25%伤害）
  public killedBy: string | undefined; // 新增: 击杀者玩家ID
  public killedByWeaponName: string | undefined; // 新增: 击杀使用的武器名称
  public positionHistory: PositionHistory; // 延迟补偿: 位置历史记录

  // 修复: 移动速度已移至 shared/sim.ts，这里不再需要（保留注释用于文档）
  // SPEED = 200 (在 shared/sim.ts 中定义)
  
  private readonly EXTRACT_DURATION_MS = 2000; // 游戏化增强: 撤离需要持续2秒

  constructor(id: string, x: number = 0, y: number = 0, bagCap: number = 4, name?: string, weaponRuntime?: WeaponRuntime) {
    this.id = id;
    this.x = x;
    this.y = y;
    this.hp = 100;
    this.status = 'ALIVE';
    this.lastInputSeq = 0;
    this.lastInputTick = 0;
    this.lootCount = 0; // Day3: 初始化为0（已废弃，保留兼容）
    // 新增: 初始化背包
    this.inventory = {
      bagCap,
      items: [],
    };
    this.name = name; // 新增: 设置玩家昵称
    this.weaponRuntime = weaponRuntime; // 新增: 设置武器运行时状态
    this.positionHistory = new PositionHistory(50); // 延迟补偿: 保留50帧（2.5秒@20Hz）
  }

  // 处理输入，更新位置
  // Day2: 如果玩家已死亡，不允许移动
  // Day3: EXTRACTED 玩家也不能移动
  // Day4-2: 添加碰撞检测（世界边界 + obstacles）
  processInput(
    keys: { up: boolean; down: boolean; left: boolean; right: boolean },
    deltaTime: number, // 秒
    mapWidth: number,
    mapHeight: number,
    obstacles: OBSTACLE_STATE[] = [] // Day4-2: 障碍物列表
  ): void {
    // Day2/Day3: 死亡或已撤离的玩家不能移动
    if (this.status === 'DEAD' || this.status === 'EXTRACTED') {
      return;
    }

    // 修复: 使用 shared 的 simulatePlayerMove，确保 client/server 逻辑一致
    const newPos = simulatePlayerMove(
      { x: this.x, y: this.y },
      keys,
      deltaTime,
      mapWidth,
      mapHeight,
      obstacles
    );
    
    // 更新位置
    this.x = newPos.x;
    this.y = newPos.y;
  }

  // Day2: 受到伤害（现在考虑防具减伤）
  takeDamage(amount: number): void {
    if (this.status === 'DEAD') {
      return; // 已死亡不再扣血
    }
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp <= 0) {
      this.hp = 0;
      this.status = 'DEAD';
    }
  }

  /**
   * 添加物品到背包（堆叠合并）
   * P2-4: 修复 stackMax 拆分逻辑，确保每个堆叠不超过 stackMax
   */
  addItem(typeId: string, qty: number): { success: boolean; added: number } {
    const itemType = getItemType(typeId);
    let remaining = qty;
    let totalAdded = 0;
    
    // 1. 先尝试合并到现有堆叠
    for (const item of this.inventory.items) {
      if (remaining <= 0) break;
      if (item.typeId !== typeId) continue;
      if (item.qty >= itemType.stackMax) continue;
      
      const spaceLeft = itemType.stackMax - item.qty;
      const toAdd = Math.min(spaceLeft, remaining);
      item.qty += toAdd;
      remaining -= toAdd;
      totalAdded += toAdd;
    }
    
    // 2. 如果还有剩余，创建新堆叠（每个不超过 stackMax）
    while (remaining > 0) {
    if (this.inventory.items.length >= this.inventory.bagCap) {
        // 背包满了，返回部分成功（如果有添加过）
        return { success: totalAdded > 0, added: totalAdded };
  }

      // 每个新堆叠最多 stackMax
      const stackQty = Math.min(remaining, itemType.stackMax);
        this.inventory.items.push({
          iid: this.generateIid(),
          typeId,
        qty: stackQty,
        });
      remaining -= stackQty;
      totalAdded += stackQty;
      }
    
    return { success: true, added: totalAdded };
  }

  /**
   * 从背包移除物品
   */
  removeItem(iid: string, qty: number): boolean {
    const item = this.inventory.items.find(i => i.iid === iid);
    if (!item || item.qty < qty) {
      return false;
    }
    
    item.qty -= qty;
    if (item.qty <= 0) {
      const index = this.inventory.items.indexOf(item);
      this.inventory.items.splice(index, 1);
    }
    return true;
  }

  /**
   * 清空背包（用于死亡掉落）
   */
  clearInventory(): ItemInstance[] {
    const items = [...this.inventory.items];
    this.inventory.items = [];
    return items;
  }

  /**
   * 生成物品实例 ID
   */
  private generateIid(): string {
    return `i${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  toState(): PLAYER_STATE {
    return {
      id: this.id,
      x: this.x,
      y: this.y,
      hp: this.hp,
      status: this.status,
      lastInputSeq: this.lastInputSeq,
      lastInputTick: this.lastInputTick,
      lootCount: this.lootCount, // Day3: 包含战利品计数（已废弃，保留兼容）
      extractProgress: this.extractProgress, // 游戏化增强: 包含撤离进度
      inventory: this.inventory, // 新增: 包含背包
      name: this.name, // 新增: 包含玩家昵称
      weaponRuntime: this.weaponRuntime, // 新增: 包含武器运行时状态
      killedBy: this.killedBy, // 新增: 击杀者名字
      killedByWeaponName: this.killedByWeaponName, // 新增: 击杀使用的武器名称
    };
  }
}
