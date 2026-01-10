import type { PLAYER_STATE, OBSTACLE_STATE, PlayerInventory, ItemInstance, WeaponRuntime, PLAYER_BUFF } from '@jerkie-man/shared';
import { simulatePlayerMove, getItemType, getWeaponDef, getArmorDef, getBagDef, PositionHistory, calculateStaminaChange, canSprint, getSprintSpeedMultiplier, msToTicks, ticksToMs, EXTRACT_DURATION_MS } from '@jerkie-man/shared';

// 内部 Buff 运行时类型（仅服务端使用）
// 内部 Buff 运行时类型（仅服务端使用）
type InternalBuffKind = 'speed' | 'damage_reduction' | 'regeneration' | 'disguise';

type InternalBuff = {
  id: string;
  name: string;
  kind: InternalBuffKind;
  // 数值效果（服务端权威）
  speedMultiplier?: number;
  damageReductionBonus?: number;
  hpPerSecond?: number; // 新增: 每秒回复生命值（用于 regeneration buff）
  // 时间轴（基于 tick）
  startedAtTick: number;
  durationTicks: number;
};

export class Player {
  public id: string;
  public x: number;
  public y: number;
  public hp: number;
  public stamina: number; // 新增: 当前耐力值
  public maxStamina: number; // 新增: 最大耐力值
  public isSprinting: boolean = false; // 新增: 是否正在冲刺
  public status: 'ALIVE' | 'DEAD' | 'EXTRACTED';
  public lastInputSeq: number;
  public lastInputTick: number;
  public lootCount: number; // Day3: 战利品计数（已废弃，保留兼容）
  public extractProgress: number = 0; // 游戏化增强: 撤离进度（毫秒，0到EXTRACT_DURATION_MS）
  public inventory: PlayerInventory; // 新增: 背包系统
  public name: string | undefined; // 新增: 玩家昵称（用于显示）
  public weaponRuntime: WeaponRuntime | undefined; // 新增: 武器运行时状态（局内状态）
  public lastShoot: boolean = false; // track previous shoot state for burst gating
  public armorReduction: number = 0; // 新增: 护甲减伤（0-1，例如0.25表示减少25%伤害）
  public equippedBagTypeId: string | null = null; // 新增: 局内装备背包
  public equippedArmorTypeId: string | null = null; // 新增: 局内装备护甲
  public equippedWeaponItem: ItemInstance | null = null; // 新增: 局内装备武器实例
  public equippedBagItem: ItemInstance | null = null; // 新增: 局内装备背包实例
  public equippedArmorItem: ItemInstance | null = null; // 新增: 局内装备护甲实例
  public killedBy: string | undefined; // 新增: 击杀者玩家ID
  public killedByWeaponName: string | undefined; // 新增: 击杀使用的武器名称
  public positionHistory: PositionHistory; // 延迟补偿: 位置历史记录
  public lastShotOriginX?: number;
  public lastShotOriginY?: number;
  // 新增: 短效 Buff 列表（仅服务端运行时使用）
  private activeBuffs: InternalBuff[] = [];
  public flashedUntil: number = 0; // 新增: 闪光弹致盲结束时间（毫秒时间戳，0表示未被闪）
  public stunnedUntil: number = 0; // 新增: 眩晕结束时间（毫秒时间戳，0表示未被眩晕）
  // 新增: 道具读条状态（例如急救包使用中）
  public usingItemTypeId: string | null = null;
  public usingItemIid: string | null = null;
  public usingItemEndTick: number = 0;
  public usingItemTotalDurationTicks: number = 0;
  public lastMeleeSide: number = 1; // 新增: 记录最后一次近战挥击方向
  public aimRad: number = 0; // 新增: 同步玩家的瞄准方向

  // 新增: 伪装AI行为状态（类似真实AI的字段）
  public disguisedAimRad: number = 0; // 伪装玩家的枪口角度
  public disguisedIdleLookTargetAngle?: number; // 当前要转向的目标角度
  public disguisedIdleNextLookChangeTime?: number; // 下次改变视角的时间
  public disguisedIdleBaseAngle?: number; // 基础角度（初始朝向）
  public disguisedFirstSpottedTime?: number; // 首次发现目标的时间（用于SPOTTING状态）

  // 修复: 移动速度已移至 shared/sim.ts，这里不再需要（保留注释用于文档）
  // SPEED = 200 (在 shared/sim.ts 中定义)

  constructor(id: string, x: number = 0, y: number = 0, bagCap: number = 4, name?: string, weaponRuntime?: WeaponRuntime) {
    this.id = id;
    this.x = x;
    this.y = y;
    this.hp = 100;
    this.stamina = 100; // 新增: 初始化耐力为满值
    this.maxStamina = 100; // 新增: 初始化最大耐力
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

  /**
   * 新增: 开始使用一个需要读条的道具（例如急救包）
   */
  startUsingItem(typeId: string, iid: string, durationMs: number, currentTick: number): void {
    const durationTicks = msToTicks(durationMs);
    this.usingItemTypeId = typeId;
    this.usingItemIid = iid;
    this.usingItemTotalDurationTicks = durationTicks;
    // 结束 tick 使用“开区间”，这样 currentTick < usingItemEndTick 表示仍在读条中
    this.usingItemEndTick = currentTick + durationTicks;
  }

  /**
   * 新增: 取消当前道具读条（例如玩家死亡/道具失效）
   */
  cancelUsingItem(): void {
    this.usingItemTypeId = null;
    this.usingItemIid = null;
    this.usingItemEndTick = 0;
    this.usingItemTotalDurationTicks = 0;
  }

  /**
   * 新增: 当前是否正在使用需要读条的道具
   */
  isUsingItem(currentTick: number): boolean {
    return !!this.usingItemTypeId && currentTick < this.usingItemEndTick;
  }

  // 新增: 计算玩家的速度倍数（基于装备 buff）
  getSpeedMultiplier(): number {
    let multiplier = 1.0;
    
    // 检查武器 buff
    if (this.equippedWeaponItem) {
      try {
        const weaponDef = getWeaponDef(this.equippedWeaponItem.typeId);
        if (weaponDef.buffs?.speedMultiplier) {
          multiplier *= weaponDef.buffs.speedMultiplier;
        }
      } catch {
        // 忽略无效武器类型
      }
    }
    
    // 检查防具 buff
    if (this.equippedArmorItem) {
      try {
        const armorDef = getArmorDef(this.equippedArmorItem.typeId);
        if (armorDef.buffs?.speedMultiplier) {
          multiplier *= armorDef.buffs.speedMultiplier;
        }
      } catch {
        // 忽略无效防具类型
      }
    }
    
    // 检查背包 buff
    if (this.equippedBagItem) {
      try {
        const bagDef = getBagDef(this.equippedBagItem.typeId);
        if (bagDef.buffs?.speedMultiplier) {
          multiplier *= bagDef.buffs.speedMultiplier;
        }
      } catch {
        // 忽略无效背包类型
      }
    }

    // 检查短效 Buff（例如战斗兴奋剂）
    for (const buff of this.activeBuffs) {
      if (buff.kind === 'speed' && buff.speedMultiplier && buff.durationTicks > 0) {
        multiplier *= buff.speedMultiplier;
      }
    }
    
    return multiplier;
  }

  // 新增: 更新耐力（独立于移动输入，用于每tick恢复）
  updateStamina(deltaTime: number, isMoving: boolean, wantsSprint: boolean): void {
    // 更新冲刺状态
    this.isSprinting = canSprint(this.stamina, wantsSprint) && isMoving;

    // 更新耐力
    this.stamina = calculateStaminaChange(
      this.stamina,
      this.maxStamina,
      this.isSprinting,
      isMoving,
      deltaTime
    );

    // 如果耐力耗尽，停止冲刺
    if (this.stamina <= 0) {
      this.isSprinting = false;
    }
  }

  // 处理输入，更新位置
  // Day2: 如果玩家已死亡，不允许移动
  // Day3: EXTRACTED 玩家也不能移动
  // Day4-2: 添加碰撞检测（世界边界 + obstacles）
  // 新增: 考虑装备 buff 对速度的影响
  // 新增: 支持冲刺系统
  processInput(
    keys: { up: boolean; down: boolean; left: boolean; right: boolean },
    deltaTime: number, // 秒
    mapWidth: number,
    mapHeight: number,
    obstacles: OBSTACLE_STATE[] = [], // Day4-2: 障碍物列表
    wantsSprint: boolean = false // 新增: 是否想要冲刺
  ): void {
    // Day2/Day3: 死亡或已撤离的玩家不能移动
    if (this.status === 'DEAD' || this.status === 'EXTRACTED') {
      return;
    }

    // 检查是否正在移动
    const isMoving = keys.up || keys.down || keys.left || keys.right;

    // 更新耐力（使用统一的方法）
    this.updateStamina(deltaTime, isMoving, wantsSprint);

    // 计算速度倍数（基于装备 buff）
    const equipmentSpeedMultiplier = this.getSpeedMultiplier();
    
    // 计算冲刺速度倍数
    const sprintSpeedMultiplier = getSprintSpeedMultiplier(this.isSprinting);

    // 修复: 使用 shared 的 simulatePlayerMove，确保 client/server 逻辑一致
    const newPos = simulatePlayerMove(
      { x: this.x, y: this.y },
      keys,
      deltaTime,
      mapWidth,
      mapHeight,
      obstacles,
      equipmentSpeedMultiplier,
      sprintSpeedMultiplier
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
    // 受伤且伤害 > 0 时打破伪装
    if (amount > 0) {
      this.breakDisguise();
    }
  }

  /**
   * 新增: 检查是否处于伪装状态
   */
  isDisguised(): boolean {
    return this.activeBuffs.some(b => b.kind === 'disguise' && b.durationTicks > 0);
  }

  /**
   * 新增: 打破伪装
   */
  breakDisguise(): boolean {
    const disguiseBuffIndex = this.activeBuffs.findIndex(b => b.kind === 'disguise');
    if (disguiseBuffIndex !== -1) {
      this.activeBuffs.splice(disguiseBuffIndex, 1);
      return true;
    }
    return false;
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
   * 创建物品实例（不自动放入背包）
   */
  createItemInstance(typeId: string, qty: number): ItemInstance {
    return {
      iid: this.generateIid(),
      typeId,
      qty,
    };
  }

  /**
   * 从背包移除物品
   */
  removeItem(iid: string, qty: number): boolean {
    const itemIndex = this.inventory.items.findIndex(i => i.iid === iid);
    if (itemIndex === -1) {
      return false;
    }
    
    const item = this.inventory.items[itemIndex];
    if (item.qty < qty) {
      return false;
    }
    
    item.qty -= qty;
    if (item.qty <= 0) {
      // 立即移除数量为0或负数的物品，避免Zod验证错误
      this.inventory.items.splice(itemIndex, 1);
    }
    return true;
  }

  /**
   * 清理背包中的无效物品（数量为0或负数的物品）
   */
  cleanupInventory(): void {
    this.inventory.items = this.inventory.items.filter(item => item.qty > 0);
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

  /**
   * 新增: 添加/刷新短效 Buff
   * 如果同 id 的 Buff 已存在，则刷新持续时间
   */
  addOrRefreshBuff(params: {
    id: string;
    name: string;
    kind: InternalBuffKind;
    durationMs: number;
    speedMultiplier?: number;
    damageReductionBonus?: number;
    hpPerSecond?: number;
  }, currentTick: number): void {
    const durationTicks = msToTicks(params.durationMs);
    const existingIndex = this.activeBuffs.findIndex(b => b.id === params.id);
    const base: InternalBuff = {
      id: params.id,
      name: params.name,
      kind: params.kind,
      speedMultiplier: params.speedMultiplier,
      damageReductionBonus: params.damageReductionBonus,
      hpPerSecond: params.hpPerSecond,
      startedAtTick: currentTick,
      durationTicks,
    };
    if (existingIndex >= 0) {
      this.activeBuffs[existingIndex] = base;
    } else {
      this.activeBuffs.push(base);
    }
  }

  /**
   * 新增: 每 tick 更新 Buff（移除已过期 Buff，并处理持续效果如回血）
   */
  updateBuffs(currentTick: number): void {
    // 处理持续回血 Buff
    for (const buff of this.activeBuffs) {
      if (buff.kind === 'regeneration' && buff.hpPerSecond && this.status === 'ALIVE') {
        // 每 tick 回复 (hpPerSecond / 20) 点 HP（因为 20Hz = 每秒 20 tick）
        const hpPerTick = buff.hpPerSecond / 20;
        const oldHp = this.hp;
        this.hp = Math.min(100, this.hp + hpPerTick);
        // 如果回血了，记录日志（可选，避免日志过多）
        // if (this.hp > oldHp) {
        //   log('REGENERATION_TICK', { player: this.id, oldHp, newHp: this.hp, hpPerTick });
        // }
      }
    }
    
    // 移除已过期的 Buff
    this.activeBuffs = this.activeBuffs.filter((buff) => {
      return currentTick <= buff.startedAtTick + buff.durationTicks;
    });
  }

  /**
   * 新增: 将内部 Buff 转换为协议层可见的 PLAYER_BUFF
   */
  private getPublicBuffs(currentTick: number): PLAYER_BUFF[] {
    return this.activeBuffs.map<PLAYER_BUFF>((buff) => {
      const totalMs = ticksToMs(buff.durationTicks);
      const remainingTicks = Math.max(0, buff.startedAtTick + buff.durationTicks - currentTick);
      const remainingMs = ticksToMs(remainingTicks);
      return {
        id: buff.id,
        name: buff.name,
        kind: buff.kind,
        remainingMs,
        totalMs,
        speedMultiplier: buff.speedMultiplier,
        damageReductionBonus: buff.damageReductionBonus,
        hpPerSecond: buff.hpPerSecond,
      };
    });
  }

  /**
   * 新增: 更新伪装玩家的AI行为状态和枪口摆动
   * @param allPlayers 所有玩家列表（用于检测附近玩家）
   * @param currentTick 当前tick
   */
  public updateDisguisedAiBehavior(allPlayers: Player[], currentTick: number): void {
    if (!this.isDisguised()) {
      return;
    }

    const now = Date.now();
    
    // 初始化基础角度
    if (this.disguisedIdleBaseAngle === undefined) {
      this.disguisedIdleBaseAngle = this.disguisedAimRad || 0;
    }

    // 扫描附近玩家（模拟AI的视野检测）
    const VISION_RANGE = 300; // 视野范围
    let spottedPlayer: Player | null = null;
    let minDist = Infinity;

    for (const otherPlayer of allPlayers) {
      if (otherPlayer.id === this.id || otherPlayer.status !== 'ALIVE') {
        continue;
      }
      
      // 忽略其他伪装玩家（伪装AI不会发现伪装玩家）
      if (otherPlayer.isDisguised()) {
        continue;
      }

      const dx = otherPlayer.x - this.x;
      const dy = otherPlayer.y - this.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= VISION_RANGE && dist < minDist) {
        // 检查是否在视野角度内（简化：使用当前枪口方向±90度）
        const angleToTarget = Math.atan2(dy, dx);
        let angleDiff = Math.abs(angleToTarget - this.disguisedAimRad);
        while (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;
        
        // 视野角度180度（左右各90度）
        if (angleDiff <= Math.PI / 2) {
          spottedPlayer = otherPlayer;
          minDist = dist;
        }
      }
    }

    // 根据是否发现玩家更新状态
    if (spottedPlayer) {
      // 发现玩家，进入SPOTTING状态
      if (!this.disguisedFirstSpottedTime) {
        this.disguisedFirstSpottedTime = now;
      }
      
      // 瞄准发现的玩家
      const dx = spottedPlayer.x - this.x;
      const dy = spottedPlayer.y - this.y;
      const targetAngle = Math.atan2(dy, dx);
      
      // 快速转向目标（类似AI的SPOTTING状态）
      let angleDiff = targetAngle - this.disguisedAimRad;
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
      
      const turnSpeed = (270 * Math.PI / 180) * 0.05; // 每tick转动的弧度
      if (Math.abs(angleDiff) > turnSpeed) {
        this.disguisedAimRad += Math.sign(angleDiff) * turnSpeed;
      } else {
        this.disguisedAimRad = targetAngle;
      }
      
      // 规范化角度
      while (this.disguisedAimRad < 0) this.disguisedAimRad += Math.PI * 2;
      while (this.disguisedAimRad >= Math.PI * 2) this.disguisedAimRad -= Math.PI * 2;
    } else {
      // 没有发现玩家，执行IDLE状态的枪口摆动
      this.disguisedFirstSpottedTime = undefined;
      this.updateDisguisedIdleAim(now);
    }
  }

  /**
   * 新增: 更新伪装玩家IDLE状态的枪口摆动
   */
  private updateDisguisedIdleAim(now: number): void {
    // 如果还没有目标角度，或者到了改变视角的时间
    if (this.disguisedIdleLookTargetAngle === undefined || 
        (this.disguisedIdleNextLookChangeTime && now >= this.disguisedIdleNextLookChangeTime)) {
      
      const baseAngle = this.disguisedIdleBaseAngle || 0;
      
      // 随机选择左右两侧的角度（±120度范围）
      const leftRange = 120 * Math.PI / 180;
      const rightRange = 120 * Math.PI / 180;
      
      // 随机选择一个角度（在基础角度±120度范围内）
      const randomOffset = (Math.random() - 0.5) * (leftRange + rightRange);
      this.disguisedIdleLookTargetAngle = baseAngle + randomOffset;
      
      // 规范化角度
      while (this.disguisedIdleLookTargetAngle < 0) this.disguisedIdleLookTargetAngle += Math.PI * 2;
      while (this.disguisedIdleLookTargetAngle >= Math.PI * 2) this.disguisedIdleLookTargetAngle -= Math.PI * 2;
      
      // 设置下次改变视角的时间（1.5-2.5秒）
      this.disguisedIdleNextLookChangeTime = now + 1500 + Math.random() * 1000;
    }

    // 转向目标角度
    if (this.disguisedIdleLookTargetAngle !== undefined) {
      let angleDiff = this.disguisedIdleLookTargetAngle - this.disguisedAimRad;
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

      // 快速转向（每秒约270度）
      const turnSpeed = (270 * Math.PI / 180) * 0.05; // 每tick转动的弧度
      if (Math.abs(angleDiff) > turnSpeed) {
        this.disguisedAimRad += Math.sign(angleDiff) * turnSpeed;
      } else {
        this.disguisedAimRad = this.disguisedIdleLookTargetAngle;
      }
      
      // 规范化角度
      while (this.disguisedAimRad < 0) this.disguisedAimRad += Math.PI * 2;
      while (this.disguisedAimRad >= Math.PI * 2) this.disguisedAimRad -= Math.PI * 2;
    }
  }

  /**
   * 新增: 为伪装玩家生成伪AI行为状态（基于检测到的玩家）
   */
  private generateFakeAiBehavior(): 'IDLE' | 'PATROL' | 'SPOTTING' | 'CHASE' | 'ATTACK' | 'SEARCH' | 'RETURN' {
    // 如果发现了玩家，返回SPOTTING状态
    if (this.disguisedFirstSpottedTime) {
      return 'SPOTTING';
    }
    
    // 否则根据移动状态决定
    const now = Date.now();
    const pastPos = this.positionHistory.getPositionAt(now - 200);
    
    if (pastPos) {
      const dx = this.x - pastPos.x;
      const dy = this.y - pastPos.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance > 5) {
        return 'PATROL'; // 正在移动
      }
    }
    
    return 'IDLE'; // 静止状态
  }

  /**
   * 新增: 计算玩家移动方向（用于伪装玩家的枪口指向）
   * 基于positionHistory获取最近的位置变化
   * 如果玩家没有移动，返回默认方向（向右，0度）
   */
  private calculateMovementDirection(): number {
    // 使用当前位置（this.x, this.y）和之前记录的位置
    const now = Date.now();
    const pastPos = this.positionHistory.getPositionAt(now - 200); // 200ms前的位置

    // 如果历史不足，尝试使用更早的位置
    if (!pastPos) {
      const olderPos = this.positionHistory.getPositionAt(now - 500); // 500ms前的位置
      if (!olderPos) {
        return 0; // 完全没有历史记录，返回默认方向（向右）
      }
      // 使用更早的位置
      const dx = this.x - olderPos.x;
      const dy = this.y - olderPos.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      // 如果移动距离太小，返回默认方向
      if (distance < 1) {
        return 0; // 没有移动，返回默认方向（向右）
      }
      
      return Math.atan2(dy, dx);
    }

    // 使用当前位置和之前的位置计算方向
    const dx = this.x - pastPos.x;
    const dy = this.y - pastPos.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // 如果移动距离太小，返回默认方向（向右，0度）
    if (distance < 1) {
      return 0; // 没有移动，返回默认方向（向右）
    }

    // 计算角度
    return Math.atan2(dy, dx);
  }

  /**
   * 新增: 为伪装玩家生成伪AI角色（基于装备武器）
   */
  private generateFakeAiRole(): 'basic' | 'sniper' | 'heavy_gunner' | 'scout' {
    const weaponType = this.weaponRuntime?.weaponTypeId || '';
    
    // 根据武器类型推断AI角色
    if (weaponType.includes('sniper')) {
      return 'sniper';
    } else if (weaponType.includes('shotgun') || weaponType.includes('minigun') || weaponType.includes('grenade')) {
      return 'heavy_gunner';
    } else if (weaponType.includes('smg') || weaponType.includes('pistol')) {
      return 'scout';
    }
    
    return 'basic';
  }

  toState(currentTick: number): PLAYER_STATE {

    const weaponRuntime = this.weaponRuntime
      ? { ...this.weaponRuntime, fireCredit: this.getFireCredit(currentTick) }
      : undefined;
    
    // 安全过滤：确保背包中没有数量为0或负数的物品（防止Zod验证错误）
    const safeInventory = {
      ...this.inventory,
      items: this.inventory.items.filter(item => item.qty > 0)
    };
    
    // 确保 hp 始终为整数并在 0-100 之间，避免 Zod 验证错误
    const safeHp = Math.min(100, Math.max(0, Math.round(this.hp)));

    // 新增: 计算道具读条 HUD 信息（如果存在）
    let usingItemTypeId: string | null = null;
    let usingItemRemainingMs: number | undefined;
    let usingItemTotalMs: number | undefined;
    if (this.usingItemTypeId && currentTick < this.usingItemEndTick) {
      usingItemTypeId = this.usingItemTypeId;
      const remainingTicks = Math.max(0, this.usingItemEndTick - currentTick);
      usingItemRemainingMs = ticksToMs(remainingTicks);
      usingItemTotalMs = ticksToMs(this.usingItemTotalDurationTicks);
    }

    // 为伪装玩家生成伪AI状态
    const isDisguised = this.isDisguised();
    const disguisedAsAiBehavior = isDisguised ? this.generateFakeAiBehavior() : undefined;
    const disguisedAsAiRole = isDisguised ? this.generateFakeAiRole() : undefined;
    // 使用更新后的枪口角度（已经在updateDisguisedAiBehavior中更新）
    const disguisedAimRad = isDisguised ? this.disguisedAimRad : undefined;

    return {
      id: this.id,
      x: this.x,
      y: this.y,
      hp: safeHp,
      stamina: Math.round(this.stamina), // 新增: 耐力值（四舍五入到整数）
      maxStamina: this.maxStamina, // 新增: 最大耐力值
      isSprinting: this.isSprinting, // 新增: 冲刺状态
      status: this.status,
      lastInputSeq: this.lastInputSeq,
      lastInputTick: this.lastInputTick,
      lootCount: this.lootCount, // Day3: 包含战利品计数（已废弃，保留兼容）
      extractProgress: this.extractProgress, // 游戏化增强: 包含撤离进度
      inventory: safeInventory, // 新增: 包含背包（已过滤无效物品）
      name: this.name, // 新增: 包含玩家昵称
      weaponRuntime, // 新增: 包含武器运行时状态
      inBush: false, // 新增: 草丛状态（默认false，在getSnapshot中更新）
      inBushId: null,
      inSmoke: false, // 新增: 烟雾状态（默认false，在getSnapshot中更新）
      inSmokeId: null,
      isFlashed: false, // 新增: 闪光弹致盲状态（默认false，在getSnapshot中更新）
      flashEndTime: 0, // 新增: 致盲结束时间（毫秒时间戳）
      isStunned: this.stunnedUntil > Date.now(), // 新增: 眩晕状态（根据stunnedUntil计算）
      stunnedEndTime: this.stunnedUntil, // 新增: 眩晕结束时间（毫秒时间戳）
      raidEquipment: {
        weaponIid: this.equippedWeaponItem?.iid ?? null,
        bagIid: this.equippedBagItem?.iid ?? null,
        armorIid: this.equippedArmorItem?.iid ?? null,
        bagTypeId: this.equippedBagTypeId,
        armorTypeId: this.equippedArmorTypeId,
      },
      killedBy: this.killedBy, // 新增: 击杀者名字
      killedByWeaponName: this.killedByWeaponName, // 新增: 击杀使用的武器名称
      buffs: this.getPublicBuffs(currentTick), // 新增: 短效 Buff 列表
      usingItemTypeId,
      usingItemRemainingMs,
      usingItemTotalMs,
      disguisedAsAiBehavior, // 伪装玩家的伪AI行为
      disguisedAsAiRole, // 伪装玩家的伪AI角色
      disguisedAimRad, // 新增: 伪装玩家的枪口指向（基于移动方向）
      aimRad: this.aimRad, // 新增: 同步所有玩家的瞄准方向
    };
  }

  private getFireCredit(currentTick: number): number {
    const wr = this.weaponRuntime;
    if (!wr) return 0;
    if (currentTick < wr.reloadingUntilTick) return 0;

    let hasAmmo = wr.ammoInMag > 0;
    if (!hasAmmo) {
      try {
        const weaponDef = getWeaponDef(wr.weaponTypeId);
        hasAmmo = weaponDef.weaponKind === 'melee';
      } catch {
        return 0;
      }
    }

    if (!hasAmmo) return 0;
    return currentTick >= wr.nextFireTick ? 1 : 0;
  }
}
