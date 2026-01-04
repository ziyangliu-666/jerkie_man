import { Player } from './player.js';
import { ProfileManager } from './profile.js';
import type { PLAYER_STATE, BULLET_STATE, ITEM_STATE, C2S_INPUT, MAP_CONFIG, OBSTACLE_STATE, WorldItem, LootBag, ItemInstance, WeaponRuntime } from '@jerkie-man/shared';
import { loadMapConfig, loadItemTypes, circleVsAABB, createRng, rectIntersects, segmentIntersectsCircle, getItemType, getAllItemTypes, getItemTypesByRarity, getWeaponDef, getArmorDef, applySpread } from '@jerkie-man/shared';
import { log } from './logger.js';

// Step4: 内部子弹类型（包含spawnAt、damage和bulletLifeMs用于TTL检查和伤害计算）
type Bullet = BULLET_STATE & { spawnAt: number; damage: number; bulletLifeMs: number };

export class Room {
  public id: string;
  public players: Map<string, Player>;
  public bullets: Bullet[]; // Step4: 使用内部类型，包含spawnAt
  public items: ITEM_STATE[]; // Day1占位（测试数据）
  public obstacles: OBSTACLE_STATE[]; // Day4-2: 障碍物列表
  // 新增: 物品系统
  public worldItems: Map<string, WorldItem>; // 世界物品（wid -> WorldItem）
  public lootBags: Map<string, LootBag>; // 掉落包（bid -> LootBag）
  public profileManager: ProfileManager; // 玩家档案管理器
  // 新增: playerId -> accountId 映射（用于撤离时保存到正确的 Profile）
  private playerToAccount: Map<string, string> = new Map();
  // Day4-1: Room 持有世界配置（seed + mapConfig），作为唯一真相来源
  public readonly seed: number;
  public readonly mapConfig: MAP_CONFIG;
  public tick: number;
  // 修复: 可复现 ID 生成，使用 rng 而不是 Date.now()
  private itemIdCounter = 0; // items ID 计数器
  private bulletIdCounter = 0; // bullets ID 计数器
  private worldItemIdCounter = 0; // worldItems ID 计数器
  private lootBagIdCounter = 0; // lootBags ID 计数器
  // 游戏化增强: 事件队列（ring buffer），最多保留 50 条
  private events: Array<{ tick: number; timestamp: number; message: string }> = [];
  private readonly MAX_EVENTS = 50;
  private readonly PICKUP_RADIUS = 40; // 拾取半径（像素）
  // 新增: 战局结果队列（playerId -> result）
  public raidResults: Map<string, { result: 'EXTRACTED' | 'DIED'; accountId: string; loot?: ItemInstance[]; moneyGained?: number; moneyLost?: number }> = new Map();
  // 新增: 战斗事件队列（playerId -> 事件列表）
  public combatEvents: Map<string, Array<{ kind: 'DRY_FIRE' | 'HIT' | 'DAMAGE_TAKEN'; direction?: number }>> = new Map();

  constructor(id: string, seed?: number) {
    this.id = id;
    this.players = new Map();
    this.bullets = [];
    this.items = []; // 保留兼容
    this.obstacles = []; // Day4-2: 初始化障碍物列表
    // 新增: 初始化物品系统
    this.worldItems = new Map();
    this.lootBags = new Map();
    this.profileManager = new ProfileManager();
    
    // P1-1 修复: 支持 seed 注入（优先级：参数 > 环境变量 > 随机）
    // 用于调试/测试时稳定生成同一场景
    if (seed !== undefined) {
      this.seed = seed;
    } else if (process.env.SEED !== undefined) {
      const envSeed = parseInt(process.env.SEED, 10);
      if (isNaN(envSeed)) {
        throw new Error(`Invalid SEED environment variable: ${process.env.SEED}`);
      }
      this.seed = envSeed;
    } else {
      // Day4-1: 随机生成 seed（int，范围 0 到 2^31-1）
      this.seed = Math.floor(Math.random() * 2**31);
    }
    
    // P1-1 修复: 使用 this.seed 加载 mapConfig，确保 seed 和 mapConfig.seed 一致
    this.mapConfig = loadMapConfig(this.seed);
    
    this.tick = 0;
    
    // Day4-2: 初始化时生成障碍物（用 seed）
    this.generateObstacles();
    
    // P2-1: 停用旧 items 系统（只使用 worldItems）
    // this.generateItems(30);
    
    // 新增: 生成世界物品（使用新的物品系统）
    this.generateWorldItems(30);
  }
  
  // Day3: 生成物品（简单测试，随机分布，避免重叠）
  private generateItems(count: number): void {
    const itemTypes = loadItemTypes();
    const minDistance = 32; // 物品之间最小距离
    // 使用 seed + 固定偏移作为 items 的 RNG seed，避免和 obstacles 完全相同
    const itemsRng = createRng(this.seed + 1000000);
    
    for (let i = 0; i < count; i++) {
      let attempts = 0;
      let x: number, y: number;
      let valid = false;
      
      // 随机生成位置，避免重叠
      while (!valid && attempts < 50) {
        x = itemsRng() * this.mapConfig.width;
        y = itemsRng() * this.mapConfig.height;
        
        // 修复: 检查是否在撤离区内
        if (this.isInExtractZone(x, y)) {
          attempts++;
          continue;
        }
        
        // 修复: 检查是否和障碍物碰撞（物品当作半径8的圆）
        const ITEM_RADIUS = 8;
        let collidedWithObstacle = false;
        for (const obstacle of this.obstacles) {
          if (circleVsAABB(x, y, ITEM_RADIUS, obstacle)) {
            collidedWithObstacle = true;
            break;
          }
        }
        if (collidedWithObstacle) {
          attempts++;
          continue;
        }
        
        // 检查是否和其他物品太近
        valid = true;
        for (const existing of this.items) {
          const dx = x - existing.x;
          const dy = y - existing.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < minDistance) {
            valid = false;
            break;
          }
        }
        attempts++;
      }
      
      if (valid) {
        const itemType = itemTypes[Math.floor(itemsRng() * itemTypes.length)];
        // 修复: 使用 rng + 计数器生成可复现的 ID（代替 Date.now()）
        const itemId = `item_${this.itemIdCounter++}_${Math.floor(itemsRng() * 1000000).toString(36)}`;
        this.items.push({
          id: itemId,
          x: x!,
          y: y!,
          type: itemType.id,
          quantity: 1,
        });
      }
    }
    
    log('GENERATE_ITEMS', {
      room: this.id,
      count: this.items.length,
      tick: this.tick,
    });
  }

  // 新增: 生成世界物品（使用新的物品系统）
  private generateWorldItems(count: number): void {
    const allItemTypes = getAllItemTypes();
    const minDistance = 32;
    // 使用 seed + 固定偏移作为 worldItems 的 RNG seed
    const itemsRng = createRng(this.seed + 2000000);
    
    // 按稀有度权重分组物品
    const commonItems = getItemTypesByRarity('COMMON');
    const rareItems = getItemTypesByRarity('RARE');
    const questItems = getItemTypesByRarity('QUEST');
    
    for (let i = 0; i < count; i++) {
      let attempts = 0;
      let x: number, y: number;
      let valid = false;
      
      while (!valid && attempts < 50) {
        x = itemsRng() * this.mapConfig.width;
        y = itemsRng() * this.mapConfig.height;
        
        if (this.isInExtractZone(x, y)) {
          attempts++;
          continue;
        }
        
        const ITEM_RADIUS = 8;
        let collidedWithObstacle = false;
        for (const obstacle of this.obstacles) {
          if (circleVsAABB(x, y, ITEM_RADIUS, obstacle)) {
            collidedWithObstacle = true;
            break;
          }
        }
        if (collidedWithObstacle) {
          attempts++;
          continue;
        }
        
        // 检查和其他 worldItems 的距离
        valid = true;
        for (const existing of this.worldItems.values()) {
          const dx = x - existing.x;
          const dy = y - existing.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < minDistance) {
            valid = false;
            break;
          }
        }
        attempts++;
      }
      
      if (valid) {
        // 按权重选择物品类型（70% COMMON, 25% RARE, 5% QUEST）
        const roll = itemsRng();
        let itemType;
        if (roll < 0.7 && commonItems.length > 0) {
          itemType = commonItems[Math.floor(itemsRng() * commonItems.length)];
        } else if (roll < 0.95 && rareItems.length > 0) {
          itemType = rareItems[Math.floor(itemsRng() * rareItems.length)];
        } else if (questItems.length > 0) {
          itemType = questItems[Math.floor(itemsRng() * questItems.length)];
        } else {
          itemType = allItemTypes[Math.floor(itemsRng() * allItemTypes.length)];
        }
        
        const wid = `wid_${this.seed}_${this.worldItemIdCounter++}_${itemsRng().toString(36).substring(2, 11)}`;
        const qty = Math.floor(itemsRng() * 3) + 1; // 1-3 个
        
        this.worldItems.set(wid, {
          wid,
          typeId: itemType.id,
          qty,
          x: x!,
          y: y!,
        });
      }
    }
    
    log('WORLD_ITEMS_GENERATED', {
      count: this.worldItems.size,
      tick: this.tick,
    });
  }
  
  // Day4-2: 生成障碍物（用 seed，确保可复现）
  private generateObstacles(): void {
    // 使用 shared 的 createRng，确保可复现
    const rng = createRng(this.seed);
    
    const count = 10 + Math.floor(rng() * 11); // 10-20 个障碍物
    const minSize = 40;
    const maxSize = 120;
    const minDistance = 60; // 障碍物之间最小距离
    const playerSpawnRadius = 100; // 玩家出生区域范围，避免障碍物
    
    for (let i = 0; i < count; i++) {
      let attempts = 0;
      let x: number, y: number, w: number, h: number;
      let valid = false;
      
      // 随机生成位置和大小，避免重叠、避开玩家出生点和撤离区
      while (!valid && attempts < 100) {
        w = minSize + rng() * (maxSize - minSize);
        h = minSize + rng() * (maxSize - minSize);
        x = rng() * (this.mapConfig.width - w);
        y = rng() * (this.mapConfig.height - h);
        
        // 检查是否和其他障碍物太近
        valid = true;
        for (const existing of this.obstacles) {
          const dx = (x + w / 2) - (existing.x + existing.w / 2);
          const dy = (y + h / 2) - (existing.y + existing.h / 2);
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < minDistance) {
            valid = false;
            break;
          }
        }
        
        // 检查是否和玩家出生点（地图中心）太近
        if (valid) {
          const centerX = this.mapConfig.width / 2;
          const centerY = this.mapConfig.height / 2;
          const dx = (x + w / 2) - centerX;
          const dy = (y + h / 2) - centerY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < playerSpawnRadius) {
            valid = false;
          }
        }
        
        // 修复: 检查是否与撤离区相交（加 padding）
        if (valid) {
          const zone = this.mapConfig.extractZone;
          const padding = 30; // 额外的安全边距
          const paddedZone = {
            x: zone.x - padding,
            y: zone.y - padding,
            w: zone.w + padding * 2,
            h: zone.h + padding * 2,
          };
          const obstacleRect = { x, y, w, h };
          if (rectIntersects(obstacleRect, paddedZone)) {
            valid = false;
          }
        }
        
        attempts++;
      }
      
      if (valid) {
        this.obstacles.push({
          x: x!,
          y: y!,
          w: w!,
          h: h!,
        });
      }
    }
    
    log('GENERATE_OBSTACLES', {
      room: this.id,
      count: this.obstacles.length,
      seed: this.seed,
      tick: this.tick,
    });
  }
  
  // Day3: 检测点是否在撤离区内（用于碰撞检测）
  private isInExtractZone(x: number, y: number): boolean {
    const zone = this.mapConfig.extractZone;
    return x >= zone.x && x <= zone.x + zone.w && y >= zone.y && y <= zone.y + zone.h;
  }

  // 游戏化增强: 推送事件到队列
  private pushEvent(message: string): void {
    const event = {
      tick: this.tick,
      timestamp: Date.now(),
      message,
    };
    this.events.push(event);
    // Ring buffer: 超过最大数量时移除最旧的
    if (this.events.length > this.MAX_EVENTS) {
      this.events.shift();
    }
  }

  // 游戏化增强: 获取并清空事件队列（供 server 广播使用）
  drainEvents(): Array<{ tick: number; timestamp: number; message: string }> {
    const events = [...this.events];
    this.events = [];
    return events;
  }

  // P0-2 修复: 寻找安全的出生点（避开障碍物 + 撤离区 + 边界 + 其他玩家）
  public findSpawnPoint(): { x: number; y: number } {
    const PLAYER_RADIUS = 10; // 和 Player.processInput 一致
    const MIN_SPAWN_PLAYER_DISTANCE = 120; // 修复: 和其他玩家的最小距离
    const MAX_ATTEMPTS = 80;
    
    // 修复: 使用 seed + tick + 玩家数量 + 随机数初始化 RNG，确保每次复活点位都是随机的
    // 结合 tick 和 Math.random() 确保每次调用都有不同的随机序列
    const randomOffset = Math.floor(Math.random() * 1000000);
    const spawnRng = createRng(this.seed + this.tick * 10000 + this.players.size * 1000 + randomOffset);
    
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      // 随机点，但是离边界至少 PLAYER_RADIUS
      const x = PLAYER_RADIUS + spawnRng() * (this.mapConfig.width - 2 * PLAYER_RADIUS);
      const y = PLAYER_RADIUS + spawnRng() * (this.mapConfig.height - 2 * PLAYER_RADIUS);
      
      // 检查是否在撤离区内
      if (this.isInExtractZone(x, y)) {
        continue;
      }
      
      // 检查是否和障碍物碰撞
      let collided = false;
      for (const obstacle of this.obstacles) {
        if (circleVsAABB(x, y, PLAYER_RADIUS, obstacle)) {
          collided = true;
          break;
        }
      }
      if (collided) {
        continue;
      }
      
      // 修复: 检查和其他玩家的距离
      let tooCloseToPlayer = false;
      for (const [playerId, player] of this.players.entries()) {
        // 只检查 ALIVE 玩家
        if (player.status !== 'ALIVE') {
          continue;
        }
        const dx = x - player.x;
        const dy = y - player.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < MIN_SPAWN_PLAYER_DISTANCE) {
          tooCloseToPlayer = true;
          break;
        }
      }
      if (tooCloseToPlayer) {
        continue;
      }
      
      // 所有检测通过，返回安全出生点
      return { x, y };
    }
    
    // Fallback: 地图中心附近的安全点
    const centerX = this.mapConfig.width / 2;
    const centerY = this.mapConfig.height / 2;
    const fallbackRadius = 200; // 从中心附近 200px 范围内搜索
    
    for (let offset = 0; offset < fallbackRadius; offset += 20) {
      for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
        const x = centerX + Math.cos(angle) * offset;
        const y = centerY + Math.sin(angle) * offset;
        
        // 边界检查
        if (x < PLAYER_RADIUS || x > this.mapConfig.width - PLAYER_RADIUS ||
            y < PLAYER_RADIUS || y > this.mapConfig.height - PLAYER_RADIUS) {
          continue;
        }
        
        // 撤离区检查
        if (this.isInExtractZone(x, y)) {
          continue;
        }
        
        // 障碍物检查
        let collided = false;
        for (const obstacle of this.obstacles) {
          if (circleVsAABB(x, y, PLAYER_RADIUS, obstacle)) {
            collided = true;
            break;
          }
        }
        if (collided) {
          continue;
        }
        
        // 修复: 检查和其他玩家的距离（fallback 阶段也不能靠近玩家）
        let tooCloseToPlayer = false;
        for (const [playerId, player] of this.players.entries()) {
          if (player.status !== 'ALIVE') {
            continue;
          }
          const dx = x - player.x;
          const dy = y - player.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < MIN_SPAWN_PLAYER_DISTANCE) {
            tooCloseToPlayer = true;
            break;
          }
        }
        if (tooCloseToPlayer) {
          continue;
        }
        
        // 所有检测通过，返回安全出生点
        return { x, y };
      }
    }
    
    // 最后的 fallback：地图中心（可能不安全，但是避免崩溃）
    log('SPAWN_FALLBACK', {
      room: this.id,
      reason: 'no safe spawn found',
      tick: this.tick,
    });
    return { x: centerX, y: centerY };
  }

  addPlayer(playerId: string, accountId?: string): Player {
    // P0-2 修复: 使用 findSpawnPoint 计算安全出生点
    const spawn = this.findSpawnPoint();
    // 保存 playerId -> accountId 映射（用于撤离时保存到正确的 Profile）
    if (accountId) {
      this.playerToAccount.set(playerId, accountId);
    }
    // 新增: 从 profile 获取 bagCap 和 displayName（使用 accountId，如果提供的话）
    const bagCap = accountId 
      ? this.profileManager.getBagCap(accountId) 
      : this.profileManager.getBagCap(playerId);
    const profile = accountId 
      ? this.profileManager.getProfileData(accountId)
      : null;
    const displayName = profile?.displayName ?? undefined;
    
    // 新增: 初始化武器运行时状态（从stash+prep查找）
    let weaponRuntime: WeaponRuntime | undefined = undefined;
    if (profile && profile.equipment.weaponIid) {
      // 在stash和prep中查找武器
      const pool = [...profile.stash, ...profile.prep];
      const weaponItem = pool.find(item => item.iid === profile.equipment.weaponIid);
      if (weaponItem) {
        try {
          const weaponDef = getWeaponDef(weaponItem.typeId);
          weaponRuntime = {
            weaponTypeId: weaponItem.typeId,
            ammoInMag: weaponDef.magSize,
            reloadingUntilTick: 0,
            nextFireTick: this.tick,
          };
          log('WEAPON_INIT', {
            room: this.id,
            player: playerId,
            weaponIid: profile.equipment.weaponIid,
            weaponTypeId: weaponItem.typeId,
            ammoInMag: weaponDef.magSize,
            tick: this.tick,
          });
        } catch (err) {
          // 无效的武器类型，使用默认FISTS
          log('WEAPON_INIT_ERROR', {
            room: this.id,
            player: playerId,
            weaponIid: profile.equipment.weaponIid,
            weaponTypeId: weaponItem.typeId,
            error: err instanceof Error ? err.message : String(err),
            tick: this.tick,
          });
        }
      } else {
        // 武器不在stash或prep中（不应该发生，但为了安全）
        log('WEAPON_NOT_FOUND', {
          room: this.id,
          player: playerId,
          weaponIid: profile.equipment.weaponIid,
          stashCount: profile.stash.length,
          prepCount: profile.prep.length,
          tick: this.tick,
        });
      }
    }
    // 如果没有装备武器，使用默认FISTS（空装可玩）
    if (!weaponRuntime) {
      try {
        const defaultWeaponDef = getWeaponDef('w_fists');
        weaponRuntime = {
          weaponTypeId: 'w_fists',
          ammoInMag: 0, // FISTS 没有弹药
          reloadingUntilTick: 0,
          nextFireTick: this.tick,
        };
        log('WEAPON_INIT_DEFAULT_FISTS', {
          room: this.id,
          player: playerId,
          hasWeaponIid: profile?.equipment.weaponIid ? 'yes' : 'no',
          tick: this.tick,
        });
      } catch {
        // 如果连FISTS都没有，weaponRuntime保持undefined（不应该发生）
      }
    }
    
    const player = new Player(playerId, spawn.x, spawn.y, bagCap, displayName ?? undefined, weaponRuntime);
    
    // 新增: 初始化护甲减伤（从stash+prep查找）
    if (profile && profile.equipment.armorIid) {
      const pool = [...profile.stash, ...profile.prep];
      const armorItem = pool.find(item => item.iid === profile.equipment.armorIid);
      if (armorItem) {
        try {
          const armorDef = getArmorDef(armorItem.typeId);
          player.armorReduction = armorDef.damageReduction;
          log('ARMOR_INIT', {
            room: this.id,
            player: playerId,
            armorIid: profile.equipment.armorIid,
            armorTypeId: armorItem.typeId,
            damageReduction: armorDef.damageReduction,
            tick: this.tick,
          });
        } catch (err) {
          // 无效的护甲类型，使用默认0
          log('ARMOR_INIT_ERROR', {
            room: this.id,
            player: playerId,
            armorIid: profile.equipment.armorIid,
            armorTypeId: armorItem.typeId,
            error: err instanceof Error ? err.message : String(err),
            tick: this.tick,
          });
        }
      }
    }
    
    // 修复: 收集所有装备的物品ID（用于避免重复添加）
    const equippedIids = new Set<string>();
    if (profile) {
      if (profile.equipment.weaponIid) equippedIids.add(profile.equipment.weaponIid);
      if (profile.equipment.armorIid) equippedIids.add(profile.equipment.armorIid);
      if (profile.equipment.bagIid) equippedIids.add(profile.equipment.bagIid);
    }
    
    // 新增: 将prep物品添加到玩家背包（按槽位添加，不是qty总和）
    // 修复: 跳过装备的物品，避免重复添加（装备物品会在后面单独添加）
    if (profile && profile.prep) {
      for (const prepItem of profile.prep) {
        // 跳过装备的物品（它们会在后面单独添加）
        if (equippedIids.has(prepItem.iid)) {
          continue;
        }
        const result = player.addItem(prepItem.typeId, prepItem.qty);
        if (!result.success || result.added < prepItem.qty) {
          log('PREP_ITEM_PARTIAL_ADD', {
            room: this.id,
            player: playerId,
            typeId: prepItem.typeId,
            requested: prepItem.qty,
            added: result.added,
            tick: this.tick,
          });
        }
      }
    }
    
    // 修复: 将装备的物品也添加到inventory，这样它们会在死亡时掉落
    if (profile) {
      const pool = [...profile.stash, ...profile.prep];
      const equippedItems: ItemInstance[] = [];
      
      // 收集所有装备的物品
      if (profile.equipment.weaponIid) {
        const weaponItem = pool.find(item => item.iid === profile.equipment.weaponIid);
        if (weaponItem) {
          equippedItems.push(weaponItem);
        }
      }
      if (profile.equipment.armorIid) {
        const armorItem = pool.find(item => item.iid === profile.equipment.armorIid);
        if (armorItem) {
          equippedItems.push(armorItem);
        }
      }
      if (profile.equipment.bagIid) {
        const bagItem = pool.find(item => item.iid === profile.equipment.bagIid);
        if (bagItem) {
          equippedItems.push(bagItem);
        }
      }
      
      // 将装备物品添加到inventory（死亡时会掉落）
      for (const equippedItem of equippedItems) {
        const result = player.addItem(equippedItem.typeId, equippedItem.qty);
        if (!result.success || result.added < equippedItem.qty) {
          log('EQUIPPED_ITEM_PARTIAL_ADD', {
            room: this.id,
            player: playerId,
            typeId: equippedItem.typeId,
            iid: equippedItem.iid,
            requested: equippedItem.qty,
            added: result.added,
            tick: this.tick,
          });
        } else {
          log('EQUIPPED_ITEM_ADDED_TO_INVENTORY', {
            room: this.id,
            player: playerId,
            typeId: equippedItem.typeId,
            iid: equippedItem.iid,
            qty: equippedItem.qty,
            tick: this.tick,
          });
        }
      }
    }
    
    this.players.set(playerId, player);
    log('PLAYER_JOIN', {
      room: this.id,
      player: playerId,
      accountId: accountId ?? 'N/A',
      name: displayName ?? 'N/A',
      pos: `(${spawn.x.toFixed(1)},${spawn.y.toFixed(1)})`,
      tick: this.tick,
    });
    return player;
  }

  removePlayer(playerId: string): void {
    if (this.players.has(playerId)) {
      this.players.delete(playerId);
      this.playerToAccount.delete(playerId);
      log('PLAYER_LEAVE', {
        room: this.id,
        player: playerId,
        tick: this.tick,
      });
    }
  }

  getPlayer(playerId: string): Player | undefined {
    return this.players.get(playerId);
  }

  // 新增: 更新所有玩家的撤离进度（每 tick 自动检查，不依赖输入）
  public updateExtractProgress(): void {
    for (const [playerId, player] of this.players.entries()) {
      if (player.status === 'ALIVE') {
        if (this.isInExtractZone(player.x, player.y)) {
          // 在撤离区内，自动增加进度（不需要按F）
          player.extractProgress += 50; // 每 tick 50ms（20Hz = 50ms/tick）
          if (player.extractProgress >= 2000) {
            // 进度满了，撤离成功
            player.status = 'EXTRACTED';
            player.extractProgress = 0;
            
            // 新增: 处理玩家撤离（inventory -> stash）
            this.handlePlayerExtract(playerId);
            
            log('EXTRACT', {
              room: this.id,
              player: playerId,
              loot: player.lootCount,
              pos: `(${player.x.toFixed(1)},${player.y.toFixed(1)})`,
              tick: this.tick,
            });
            // 游戏化增强: 推送撤离事件
            this.pushEvent(`${playerId} extracted with loot=${player.lootCount}`);
          }
        } else {
          // 不在撤离区内，重置进度
          player.extractProgress = 0;
        }
      } else {
        // 非 ALIVE 状态，重置撤离进度
        player.extractProgress = 0;
      }
    }
  }

  // 新增: 更新武器运行时状态（处理换弹完成）
  public updateWeaponRuntime(playerId: string): void {
    const player = this.players.get(playerId);
    if (!player || !player.weaponRuntime) return;
    
    const wr = player.weaponRuntime;
    if (wr.reloadingUntilTick > 0 && this.tick >= wr.reloadingUntilTick) {
      // 换弹完成
      try {
        const weaponDef = getWeaponDef(wr.weaponTypeId);
        wr.ammoInMag = weaponDef.magSize;
        wr.reloadingUntilTick = 0;
      } catch {
        // 无效武器类型，忽略
      }
    }
  }

  // 新增: 根据 profile 更新玩家的武器运行时状态（用于装备武器后更新）
  public updatePlayerWeaponFromProfile(playerId: string, accountId: string): void {
    const player = this.players.get(playerId);
    if (!player) return;
    
    const profile = this.profileManager.getProfileData(accountId);
    if (!profile) return;
    
    // 查找装备的武器（在stash和prep中查找）
    let weaponRuntime: WeaponRuntime | undefined = undefined;
    if (profile.equipment.weaponIid) {
      const pool = [...profile.stash, ...profile.prep];
      const weaponItem = pool.find(item => item.iid === profile.equipment.weaponIid);
      if (weaponItem) {
        try {
          const weaponDef = getWeaponDef(weaponItem.typeId);
          weaponRuntime = {
            weaponTypeId: weaponItem.typeId,
            ammoInMag: weaponDef.magSize,
            reloadingUntilTick: 0,
            nextFireTick: this.tick,
          };
        } catch {
          // 无效的武器类型，使用默认FISTS
        }
      }
    }
    
    // 如果没有装备武器，使用默认FISTS
    if (!weaponRuntime) {
      try {
        const defaultWeaponDef = getWeaponDef('w_fists');
        weaponRuntime = {
          weaponTypeId: 'w_fists',
          ammoInMag: 0, // FISTS 没有弹药
          reloadingUntilTick: 0,
          nextFireTick: this.tick,
        };
      } catch {
        // 如果连FISTS都没有，weaponRuntime保持undefined（不应该发生）
      }
    }
    
    // 更新玩家的武器运行时状态
    player.weaponRuntime = weaponRuntime;
    
    log('UPDATE_WEAPON_RUNTIME', {
      room: this.id,
      player: playerId,
      accountId: accountId,
      weaponTypeId: weaponRuntime?.weaponTypeId ?? 'none',
      tick: this.tick,
    });
  }

  // 节流日志：每200ms打印一次
  private lastProcessLog = new Map<string, number>();

  // 新增: 处理连发自动完成
  private processBurstFire(playerId: string, player: Player, aimRad: number): void {
    if (!player.weaponRuntime) return;
    
    const wr = player.weaponRuntime;
    if (wr.burstRemaining === undefined || wr.burstRemaining <= 0) return;
    
    try {
      const weaponDef = getWeaponDef(wr.weaponTypeId);
      
      // 检查弹药
      if (wr.ammoInMag <= 0) {
        // 弹匣空了，中断连发
        wr.burstRemaining = 0;
        wr.burstNextTick = undefined;
        return;
      }
      
      // 检查是否在换弹
      if (this.tick < wr.reloadingUntilTick) {
        // 正在换弹，中断连发
        wr.burstRemaining = 0;
        wr.burstNextTick = undefined;
        return;
      }
      
      const burstIntervalMs = weaponDef.burstIntervalMs ?? weaponDef.fireIntervalMs;
      
      // 发射连发中的一发
      wr.ammoInMag -= 1;
      wr.burstRemaining -= 1;
      
      if (wr.burstRemaining > 0) {
        // 还有剩余，设置下一发的时间
        wr.burstNextTick = this.tick + Math.ceil(burstIntervalMs / 50);
      } else {
        // 连发结束，设置下次可以开火的时间（使用完整的fireIntervalMs）
        wr.nextFireTick = this.tick + Math.ceil(weaponDef.fireIntervalMs / 50);
        wr.burstRemaining = undefined;
        wr.burstNextTick = undefined;
      }
      
      // 发射子弹
      const bulletId = this.spawnBullet(playerId, player, aimRad, weaponDef, undefined); // 连发不使用shotId
      
      log('SPAWN_BULLET_BURST', {
        room: this.id,
        player: playerId,
        tick: this.tick,
        bullet: bulletId,
        weapon: wr.weaponTypeId,
        ammo: wr.ammoInMag,
        burstRemaining: wr.burstRemaining,
      });
    } catch {
      // 无效武器类型，中断连发
      if (wr.burstRemaining !== undefined) {
        wr.burstRemaining = 0;
        wr.burstNextTick = undefined;
      }
    }
  }
  
  // 新增: 发射子弹的公共方法
  private spawnBullet(playerId: string, player: Player, aimRad: number, weaponDef: any, shotId: number | undefined): string {
    const pelletCount = weaponDef.pelletCount ?? 1; // 默认1颗子弹
    
    // 调试日志：打印weaponDef内容
    log('SPAWN_BULLET_DEBUG', {
      room: this.id,
      player: playerId,
      weaponTypeId: weaponDef.typeId,
      pelletCountValue: pelletCount,
      weaponDefPelletCount: weaponDef.pelletCount,
    });
    const now = Date.now();
    let firstBulletId: string | undefined = undefined;
    
    // 调试日志
    if (pelletCount > 1) {
      log('SPAWN_BULLET_PELLETS', {
        room: this.id,
        player: playerId,
        weapon: weaponDef.typeId,
        pelletCount: pelletCount,
        beforeBullets: this.bullets.length,
      });
    }
    
    // 霰弹枪：一次发射多颗弹丸
    if (pelletCount > 1) {
      const spreadRad = (weaponDef.spreadDeg * Math.PI) / 180; // 总散布角度（弧度）
      
      for (let i = 0; i < pelletCount; i++) {
        // 为每颗弹丸生成独立的随机数生成器
        const bulletRng = createRng(this.seed + this.tick + this.bulletIdCounter + i);
        
        // 在总散布角度内均匀分布弹丸
        // 使用均匀分布：从 -spreadRad/2 到 +spreadRad/2
        const offset = (bulletRng() - 0.5) * spreadRad;
        const actualAimRad = aimRad + offset;
        
        // 生成子弹
        const vx = Math.cos(actualAimRad) * weaponDef.bulletSpeed;
        const vy = Math.sin(actualAimRad) * weaponDef.bulletSpeed;
        
        const bulletId = `b${this.bulletIdCounter++}_${Math.floor(bulletRng() * 1000000).toString(36)}`;
        if (i === 0) {
          firstBulletId = bulletId; // 返回第一颗子弹的ID
        }
        
        this.bullets.push({
          id: bulletId,
          x: player.x,
          y: player.y,
          vx,
          vy,
          ownerId: playerId,
          clientShotId: i === 0 ? shotId : undefined, // 只有第一颗子弹使用shotId
          spawnAt: now, // 记录生成时间，用于TTL检查
          damage: weaponDef.damage, // 记录伤害值，用于命中扣血
          bulletLifeMs: weaponDef.bulletLifeMs, // 子弹生命周期（毫秒）
        });
      }
      
      // 调试日志：确认生成了多颗子弹
      if (pelletCount > 1) {
        log('SPAWN_BULLET_PELLETS_DONE', {
          room: this.id,
          player: playerId,
          weapon: weaponDef.typeId,
          pelletCount: pelletCount,
          afterBullets: this.bullets.length,
          generated: pelletCount,
        });
      }
    } else {
      // 普通武器：单颗子弹
      const bulletRng = createRng(this.seed + this.tick + this.bulletIdCounter);
      const actualAimRad = applySpread(aimRad, weaponDef.spreadDeg, bulletRng);
      
      // 生成子弹
      const vx = Math.cos(actualAimRad) * weaponDef.bulletSpeed;
      const vy = Math.sin(actualAimRad) * weaponDef.bulletSpeed;
      
      const bulletId = `b${this.bulletIdCounter++}_${Math.floor(bulletRng() * 1000000).toString(36)}`;
      firstBulletId = bulletId;
      
      this.bullets.push({
        id: bulletId,
        x: player.x,
        y: player.y,
        vx,
        vy,
        ownerId: playerId,
        clientShotId: shotId, // 客户端发射ID（用于预测子弹对齐，连发时为undefined）
        spawnAt: now, // 记录生成时间，用于TTL检查
        damage: weaponDef.damage, // 记录伤害值，用于命中扣血
        bulletLifeMs: weaponDef.bulletLifeMs, // 子弹生命周期（毫秒）
      });
    }
    
    return firstBulletId!;
  }

  // 处理输入（在tick循环中调用）
  // Day2: 添加开火逻辑
  processInput(playerId: string, input: C2S_INPUT): void {
    const player = this.players.get(playerId);
    if (!player) return;

    // 只使用seq去重（忽略tick，简化测试）
    if (input.seq <= player.lastInputSeq) {
      return;
    }

    const oldX = player.x;
    const oldY = player.y;

    player.lastInputSeq = input.seq;
    player.lastInputTick = input.tick;

    // 更新玩家位置（20Hz tick = 50ms = 0.05s）
    // P0-1 修复: 传入 obstacles 参数，使碰撞检测生效
    const deltaTime = 0.05;
    player.processInput(input.keys, deltaTime, this.mapConfig.width, this.mapConfig.height, this.obstacles);

    // P0-1 修复: 移除旧拾取逻辑（interact 不再触发拾取）
    // 拾取现在只通过 C2S_PICKUP_WORLD_ITEM / C2S_PICKUP_LOOT_BAG 消息处理
    // 保留 legacy items 拾取逻辑注释，以便未来需要时参考：
    // if (input.interact && player.status === 'ALIVE') {
    //   // 旧逻辑，对 this.items 拾取，已废弃
    // }
    
    // 撤离进度检查已移至 updateExtractProgress 方法（每 tick 自动检查，不依赖输入）
    
    // Day3: 处理输入（extract 脉冲事件，已废弃，保留兼容）
    if (input.extract && player.status === 'ALIVE') {
      if (this.isInExtractZone(player.x, player.y)) {
        // 兼容旧客户端，直接撤离（不推荐）
        player.status = 'EXTRACTED';
        player.extractProgress = 0;
        
        // 新增: 处理玩家撤离（inventory -> stash）
        this.handlePlayerExtract(playerId);
        
        log('EXTRACT', {
          room: this.id,
          player: playerId,
          loot: player.lootCount,
          pos: `(${player.x.toFixed(1)},${player.y.toFixed(1)})`,
          tick: this.tick,
        });
        // 游戏化增强: 推送撤离事件
        this.pushEvent(`${playerId} extracted with loot=${player.lootCount}`);
      }
    }
    
    // 新增: 处理换弹（手动换弹，R键）
    if (input.reload && player.status === 'ALIVE' && player.weaponRuntime) {
      const wr = player.weaponRuntime;
      // 只有在未换弹且弹匣未满时才能换弹
      if (wr.reloadingUntilTick === 0) {
        try {
          const weaponDef = getWeaponDef(wr.weaponTypeId);
          // 如果弹匣未满，开始换弹
          if (wr.ammoInMag < weaponDef.magSize) {
            wr.reloadingUntilTick = this.tick + Math.ceil(weaponDef.reloadMs / 50); // 50ms per tick
            log('RELOAD_START', {
              room: this.id,
              player: playerId,
              tick: this.tick,
              weapon: wr.weaponTypeId,
              reloadUntil: wr.reloadingUntilTick,
            });
          }
        } catch {
          // 无效武器类型，忽略
        }
      }
    }
    
    // 新增: 处理连发自动完成（即使玩家没有按下开火键，也要继续完成连发）
    if (player.weaponRuntime && player.weaponRuntime.burstRemaining !== undefined && player.weaponRuntime.burstRemaining > 0) {
      if (this.tick >= (player.weaponRuntime.burstNextTick ?? 0)) {
        // 连发间隔到了，自动发射下一发
        this.processBurstFire(playerId, player, input.aim);
      }
    }
    
    // 新增: 处理开火（使用武器参数）
    if (input.shoot && player.status === 'ALIVE') {
      // 检查是否有武器
      if (!player.weaponRuntime) {
        // 没有武器，发送干火事件
        if (!this.combatEvents.has(playerId)) {
          this.combatEvents.set(playerId, []);
        }
        this.combatEvents.get(playerId)!.push({ kind: 'DRY_FIRE' });
        return;
      }
      
      const wr = player.weaponRuntime;
      
      // 检查是否可以开火
      if (this.tick < wr.reloadingUntilTick) {
        // 正在换弹，不能开火（发送干火事件）
        if (!this.combatEvents.has(playerId)) {
          this.combatEvents.set(playerId, []);
        }
        this.combatEvents.get(playerId)!.push({ kind: 'DRY_FIRE' });
        return;
      }
      // 检查是否可以开火（考虑连发状态）
      if (wr.burstRemaining === undefined || wr.burstRemaining === 0) {
        // 不在连发中，检查常规冷却
        if (this.tick < wr.nextFireTick) {
          // 射速冷却未完成，不能开火
          return;
        }
      } else {
        // 在连发中，检查连发间隔
        if (this.tick < (wr.burstNextTick ?? 0)) {
          // 连发间隔未到，不能开火
          return;
        }
      }
      
      try {
        const weaponDef = getWeaponDef(wr.weaponTypeId);
        
        // 检查是否是 FISTS（近战武器）
        if (wr.weaponTypeId === 'w_fists') {
          // 近战攻击：检测范围内是否有敌人
          const MELEE_RANGE = 35; // 近战范围（像素）
          let hitTarget: Player | null = null;
          let minDist = MELEE_RANGE + 1;
          
          for (const [targetId, target] of this.players.entries()) {
            if (targetId === playerId || target.status !== 'ALIVE') continue;
            
            const dx = target.x - player.x;
            const dy = target.y - player.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            if (dist < minDist) {
              // 检查是否在瞄准方向（简化：检查角度差）
              const aimDir = Math.atan2(dy, dx);
              const aimDiff = Math.abs(aimDir - input.aim);
              const normalizedDiff = Math.min(aimDiff, Math.PI * 2 - aimDiff);
              
              if (normalizedDiff < Math.PI / 3) { // 60度范围内
                hitTarget = target;
                minDist = dist;
              }
            }
          }
          
          if (hitTarget) {
            // 命中！造成伤害
            const oldHp = hitTarget.hp;
            hitTarget.takeDamage(weaponDef.damage);
            const isDead = hitTarget.hp <= 0;
            
            if (isDead) {
              this.handlePlayerDeath(hitTarget.id);
            }
            
            // 新增: 发送战斗事件（命中反馈给攻击者，受伤反馈给被攻击者）
            const dx = hitTarget.x - player.x;
            const dy = hitTarget.y - player.y;
            const direction = Math.atan2(dy, dx);
            
            // 给攻击者发送命中事件
            if (!this.combatEvents.has(playerId)) {
              this.combatEvents.set(playerId, []);
            }
            this.combatEvents.get(playerId)!.push({ kind: 'HIT' });
            
            // 给被攻击者发送受伤事件
            if (!this.combatEvents.has(hitTarget.id)) {
              this.combatEvents.set(hitTarget.id, []);
            }
            this.combatEvents.get(hitTarget.id)!.push({ kind: 'DAMAGE_TAKEN', direction });
            
            log('MELEE_HIT', {
              room: this.id,
              player: playerId,
              target: hitTarget.id,
              tick: this.tick,
              damage: weaponDef.damage,
              hp: `${oldHp}->${hitTarget.hp}`,
            });
            
            // 推送命中事件
            this.pushEvent(`${playerId} melee hit ${hitTarget.id} (-${weaponDef.damage})`);
          }
          
          // 更新冷却
          wr.nextFireTick = this.tick + Math.ceil(weaponDef.fireIntervalMs / 50);
          return;
        }
        
        // 远程武器：检查弹药
        if (wr.ammoInMag <= 0) {
          // 弹匣空了，中断连发
          if (wr.burstRemaining !== undefined) {
            wr.burstRemaining = 0;
            wr.burstNextTick = undefined;
          }
          // 触发自动换弹（兜底）
          // 修复: 只有在未换弹时才能触发自动换弹，避免换弹完成后再次触发
          if (weaponDef.reloadMs > 0 && wr.reloadingUntilTick === 0) {
            wr.reloadingUntilTick = this.tick + Math.ceil(weaponDef.reloadMs / 50);
            // ammoInMag保持0，换弹完成后再回满
          }
          // 发送干火事件
          if (!this.combatEvents.has(playerId)) {
            this.combatEvents.set(playerId, []);
          }
          this.combatEvents.get(playerId)!.push({ kind: 'DRY_FIRE' });
          return;
        }
        
        // 检查是否在连发中
        const burstCount = weaponDef.burstCount ?? 1;
        const burstIntervalMs = weaponDef.burstIntervalMs ?? weaponDef.fireIntervalMs;
        
        // 如果正在连发中，检查是否可以发射下一发
        if (wr.burstRemaining !== undefined && wr.burstRemaining > 0) {
          if (this.tick < (wr.burstNextTick ?? 0)) {
            // 连发间隔未到，等待
            return;
          }
          
          // 发射连发中的一发
          wr.ammoInMag -= 1;
          wr.burstRemaining -= 1;
          
          if (wr.burstRemaining > 0) {
            // 还有剩余，设置下一发的时间
            wr.burstNextTick = this.tick + Math.ceil(burstIntervalMs / 50);
          } else {
            // 连发结束，设置下次可以开火的时间（使用完整的fireIntervalMs）
            wr.nextFireTick = this.tick + Math.ceil(weaponDef.fireIntervalMs / 50);
            wr.burstRemaining = undefined;
            wr.burstNextTick = undefined;
          }
        } else if (burstCount > 1) {
          // 开始新的连发，立即发射第一发
          wr.burstRemaining = burstCount - 1; // 减1因为马上要发射第一发
          wr.burstNextTick = this.tick + Math.ceil(burstIntervalMs / 50); // 设置第二发的时间
          wr.ammoInMag -= 1;
        } else {
          // 单发模式
          wr.nextFireTick = this.tick + Math.ceil(weaponDef.fireIntervalMs / 50);
          wr.ammoInMag -= 1;
        }
        
        // 发射子弹（提取为公共方法，供连发使用）
        const bulletId = this.spawnBullet(playerId, player, input.aim, weaponDef, input.shotId);
        const pelletCount = weaponDef.pelletCount ?? 1;
        
        log('SPAWN_BULLET', {
          room: this.id,
          player: playerId,
          tick: this.tick,
          bullet: bulletId,
          weapon: wr.weaponTypeId,
          ammo: wr.ammoInMag,
          pos: `(${player.x.toFixed(1)},${player.y.toFixed(1)})`,
          aim: input.aim.toFixed(2),
          pelletCount: pelletCount, // 记录弹丸数量
          totalBullets: this.bullets.length, // 记录总子弹数
        });
        
        // 修复: 开火后立即返回，防止同一 tick 内处理后续输入导致绕过冷却限制
        // 这确保即使队列中有多个 shoot=true 的输入，每个 tick 最多只开火一次
        return;
      } catch {
        // 无效武器类型，不能开火
      }
    }

    // 节流日志：每200ms打印一次
    const now = Date.now();
    const lastLog = this.lastProcessLog.get(playerId) || 0;
    if (now - lastLog >= 200) {
      log('PROCESS_INPUT', {
        room: this.id,
        player: playerId,
        tick: this.tick,
        seq: input.seq,
        pos: `(${oldX.toFixed(1)},${oldY.toFixed(1)})->(${player.x.toFixed(1)},${player.y.toFixed(1)})`,
      });
      this.lastProcessLog.set(playerId, now);
    }
  }

  // Day2: 更新子弹位置并检测命中
  // Step4: 性能优化 - 碰撞检测用dist^2，bulletsToRemove用Set
  updateBullets(deltaTime: number): void {
    const now = Date.now();
    const bulletsToRemove = new Set<string>(); // Step4: 用Set代替O(n^2)
    
    for (const bullet of this.bullets) {
      // Step4: 子弹TTL检查（使用武器特定的bulletLifeMs）
      if (now - bullet.spawnAt > bullet.bulletLifeMs) {
        bulletsToRemove.add(bullet.id);
        continue;
      }
      
      // 修复: 子弹和障碍物碰撞检测（使用简化采样方法）
      const oldX = bullet.x;
      const oldY = bullet.y;
      const newX = bullet.x + bullet.vx * deltaTime;
      const newY = bullet.y + bullet.vy * deltaTime;
      
      // 将移动分成 4 个采样点，每个检测障碍物碰撞
      const steps = 4;
      let hitObstacle = false;
      for (let step = 1; step <= steps; step++) {
        const t = step / steps;
        const stepX = oldX + (newX - oldX) * t;
        const stepY = oldY + (newY - oldY) * t;
        
        // 检查是否和障碍物碰撞（子弹当作点）
        for (const obstacle of this.obstacles) {
          // 点是否在矩形内（AABB 点包含检测）
          if (stepX >= obstacle.x && stepX <= obstacle.x + obstacle.w &&
              stepY >= obstacle.y && stepY <= obstacle.y + obstacle.h) {
            hitObstacle = true;
            break;
          }
        }
        if (hitObstacle) {
          break;
        }
      }
      
      if (hitObstacle) {
        // 命中障碍物，删除子弹
        bulletsToRemove.add(bullet.id);
        continue;
      }
      
      // 移动子弹
      bullet.x = newX;
      bullet.y = newY;
      
      // 边界检查
      if (bullet.x < 0 || bullet.x > this.mapConfig.width || 
          bullet.y < 0 || bullet.y > this.mapConfig.height) {
        bulletsToRemove.add(bullet.id);
        continue;
      }
      
      // 修复: 使用连续碰撞检测（CCD）替代离散检测
      // 检测 oldPos -> newPos 的线段是否和玩家圆相交，避免穿透子弹
      const PLAYER_HIT_RADIUS = 16;
      for (const [playerId, player] of this.players.entries()) {
        // 不能打自己，死亡或撤离玩家不受伤
        if (playerId === bullet.ownerId || player.status !== 'ALIVE') {
          continue;
        }
        
          // 使用线段 vs 圆的连续碰撞检测
        if (segmentIntersectsCircle(oldX, oldY, bullet.x, bullet.y, player.x, player.y, PLAYER_HIT_RADIUS)) {
          // 命中！
          const oldHp = player.hp;
          const wasAlive = player.status === 'ALIVE';
          
          // 新增: 计算伤害（应用防具减伤，使用player.armorReduction）
          const baseDamage = bullet.damage;
          const armorReduction = player.armorReduction;
          const finalDamage = Math.floor(baseDamage * (1 - armorReduction));
          player.takeDamage(finalDamage);
          const isDead = player.hp <= 0;
          
          // 新增: 玩家死亡时生成掉落包
          if (isDead) {
            this.handlePlayerDeath(player.id);
          }
          
          // 新增: 发送战斗事件（命中反馈给攻击者，受伤反馈给被攻击者）
          // 计算方向（从被攻击者到攻击者的方向，用于受伤方向指示）
          const attacker = this.players.get(bullet.ownerId);
          if (attacker) {
            const dx = attacker.x - player.x;
            const dy = attacker.y - player.y;
            const direction = Math.atan2(dy, dx);
            
            // 给攻击者发送命中事件
            if (!this.combatEvents.has(bullet.ownerId)) {
              this.combatEvents.set(bullet.ownerId, []);
            }
            this.combatEvents.get(bullet.ownerId)!.push({ kind: 'HIT' });
            
            // 给被攻击者发送受伤事件
            if (!this.combatEvents.has(playerId)) {
              this.combatEvents.set(playerId, []);
            }
            this.combatEvents.get(playerId)!.push({ kind: 'DAMAGE_TAKEN', direction });
          }
          
          log('HIT', {
            room: this.id,
            bullet: bullet.id,
            owner: bullet.ownerId,
            target: playerId,
            tick: this.tick,
            baseDamage: baseDamage,
            armorReduction: armorReduction,
            finalDamage: finalDamage,
            hp: `${oldHp}->${player.hp}`,
          });
          
          // 游戏化增强: 推送命中事件
          this.pushEvent(`${bullet.ownerId} hit ${playerId} (-${finalDamage})`);
          
          // 如果玩家死了，保存击杀信息并推送击杀事件和日志
          if (wasAlive && isDead) {
            const attacker = this.players.get(bullet.ownerId);
            if (attacker) {
              // 保存击杀信息
              player.killedBy = attacker.name || bullet.ownerId;
              // 获取武器名称
              if (attacker.weaponRuntime) {
                try {
                  const weaponDef = getWeaponDef(attacker.weaponRuntime.weaponTypeId);
                  player.killedByWeaponName = weaponDef.name;
                } catch {
                  // 无法获取武器定义，使用默认值
                  player.killedByWeaponName = '未知武器';
                }
              } else {
                player.killedByWeaponName = '拳头';
              }
              
              log('PLAYER_DEAD_WITH_KILL_INFO', {
                room: this.id,
                player: playerId,
                playerName: player.name,
                tick: this.tick,
                killer: bullet.ownerId,
                killerName: player.killedBy,
                weapon: player.killedByWeaponName,
              });
            } else {
              log('PLAYER_DEAD_NO_ATTACKER', {
                room: this.id,
                player: playerId,
                tick: this.tick,
                bulletOwner: bullet.ownerId,
              });
            }
            
            log('PLAYER_DEAD', {
              room: this.id,
              player: playerId,
              tick: this.tick,
              killer: bullet.ownerId,
            });
            // 游戏化增强: 推送击杀事件
            this.pushEvent(`${playerId} killed by ${bullet.ownerId}`);
          }
          
          bulletsToRemove.add(bullet.id); // Step4: 用Set.add
          break; // 一颗子弹只能命中一个目标
        }
      }
    }
    
    // Step4: 移除所有标记的子弹（用Set.has，O(1)查找）
    this.bullets = this.bullets.filter(b => !bulletsToRemove.has(b.id));
  }

  // 获取当前状态快照
  // Step4: 导出时只包含BULLET_STATE字段，不包含spawnAt，保证协议兼容
  // 修复: obstacles 已移至 WORLD_INIT，不再在 snapshot 中发送
  // 新增: 只包含 inWorld=true 的玩家（未来会实现 inWorld 字段，现在先包含所有玩家）
  getSnapshot(): {
    players: PLAYER_STATE[];
    bullets: BULLET_STATE[];
    items: ITEM_STATE[];
    worldItems: WorldItem[];
    lootBags: LootBag[];
  } {
    // 新增: 只包含 ALIVE/DEAD 状态的玩家（EXTRACTED 玩家不再出现在 snapshot 中）
    // 未来会改为检查 inWorld 字段
    const visiblePlayers = Array.from(this.players.values())
      .filter(p => p.status !== 'EXTRACTED')
      .map((p) => p.toState());
    
    return {
      players: visiblePlayers,
      // Step4: 映射内部Bullet类型到BULLET_STATE（去掉spawnAt和damage字段，保留clientShotId）
      bullets: this.bullets.map(({ spawnAt, damage, ...b }) => ({
        ...b,
        clientShotId: b.clientShotId, // 传递客户端发射ID
      })),
      items: [], // P2-1: 旧 items 系统已停用，返回空数组
      worldItems: this.getWorldItems(), // 新增: 世界物品
      lootBags: this.getLootBags(), // 新增: 掉落包
      // 修复: obstacles 已移至 S2C_WORLD_INIT，不再在 snapshot 中发送（减少带宽）
    };
  }
  
  // 修复: 获取静态障碍物列表（用于 WORLD_INIT）
  getObstacles(): OBSTACLE_STATE[] {
    return [...this.obstacles];
  }
  
  // P2-1: 旧 items 系统已停用，返回空数组（保持协议兼容）
  getItems(): ITEM_STATE[] {
    return []; // 返回空数组，不再使用旧 items
  }

  // 新增: 拾取世界物品
  tryPickupWorldItem(playerId: string, player: Player): boolean {
    let nearestWorldItem: WorldItem | null = null;
    let nearestWid: string | null = null;
    let nearestDist = this.PICKUP_RADIUS + 1;
    
    for (const [wid, worldItem] of this.worldItems.entries()) {
      const dx = worldItem.x - player.x;
      const dy = worldItem.y - player.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist < nearestDist) {
        nearestWorldItem = worldItem;
        nearestWid = wid;
        nearestDist = dist;
      }
    }
    
    if (nearestWorldItem && nearestWid) {
      const result = player.addItem(nearestWorldItem.typeId, nearestWorldItem.qty);
      if (result.success) {
        this.worldItems.delete(nearestWid);
        const itemType = getItemType(nearestWorldItem.typeId);
        this.pushEvent(`Player ${playerId} picked up ${itemType.name} x${result.added}`);
        log('PICKUP_WORLD_ITEM', {
          room: this.id,
          player: playerId,
          wid: nearestWid,
          typeId: nearestWorldItem.typeId,
          qty: result.added,
          tick: this.tick,
        });
        return true;
      }
    }
    return false;
  }

  // 新增: 拾取掉落包
  tryPickupLootBag(playerId: string, player: Player): boolean {
    let nearestBag: LootBag | null = null;
    let nearestBid: string | null = null;
    let nearestDist = this.PICKUP_RADIUS + 1;
    
    for (const [bid, bag] of this.lootBags.entries()) {
      if (bag.items.length === 0) continue;
      
      const dx = bag.x - player.x;
      const dy = bag.y - player.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist < nearestDist) {
        nearestBag = bag;
        nearestBid = bid;
        nearestDist = dist;
      }
    }
    
    if (nearestBag && nearestBid) {
      const remainingItems: typeof nearestBag.items = [];
      let pickedAny = false;
      
      for (const item of nearestBag.items) {
        const result = player.addItem(item.typeId, item.qty);
        if (result.success && result.added === item.qty) {
          pickedAny = true;
        } else if (result.success && result.added > 0) {
          remainingItems.push({
            iid: item.iid,
            typeId: item.typeId,
            qty: item.qty - result.added,
          });
          pickedAny = true;
        } else {
          remainingItems.push(item);
        }
      }
      
      if (pickedAny) {
        if (remainingItems.length === 0) {
          this.lootBags.delete(nearestBid);
        } else {
          nearestBag.items = remainingItems;
        }
        
        this.pushEvent(`Player ${playerId} picked up loot bag`);
        log('PICKUP_LOOT_BAG', {
          room: this.id,
          player: playerId,
          bid: nearestBid,
          tick: this.tick,
        });
        return true;
      }
    }
    return false;
  }

  // 新增: 处理玩家死亡（生成掉落包）
  handlePlayerDeath(playerId: string): { success: boolean; accountId?: string; moneyLost?: number } {
    const player = this.players.get(playerId);
    if (!player || player.status !== 'DEAD') return { success: false };
    
    const accountId = this.playerToAccount.get(playerId) ?? playerId;
    
    // 计算损失的金钱（prep 物品的价值，但 prep 已经在进入战局时移到 inventory 了）
    // 所以这里计算的是 inventory 中物品的价值
    let moneyLost = 0;
    const droppedItems = player.clearInventory();
    for (const item of droppedItems) {
      try {
        const itemType = getItemType(item.typeId);
        moneyLost += itemType.value * item.qty;
      } catch {
        // 未知物品类型，跳过
      }
    }
    
    if (droppedItems.length > 0) {
      const bid = `bag_${this.seed}_${this.lootBagIdCounter++}_${Date.now().toString(36)}`;
      this.lootBags.set(bid, {
        bid,
        x: player.x,
        y: player.y,
        items: droppedItems,
      });
      
      this.pushEvent(`Player ${playerId} died and dropped loot`);
      log('LOOT_BAG_CREATED', {
        room: this.id,
        player: playerId,
        accountId,
        bid,
        itemCount: droppedItems.length,
        moneyLost,
        tick: this.tick,
      });
    }
    
    // 修复: 清除装备引用，并从 stash/prep 中移除装备物品（因为它们已经掉落了）
    const profile = this.profileManager.getProfileData(accountId);
    const equippedIids = new Set<string>();
    if (profile.equipment.weaponIid) {
      equippedIids.add(profile.equipment.weaponIid);
      this.profileManager.equipItem(accountId, 'weapon', null);
    }
    if (profile.equipment.armorIid) {
      equippedIids.add(profile.equipment.armorIid);
      this.profileManager.equipItem(accountId, 'armor', null);
    }
    if (profile.equipment.bagIid) {
      equippedIids.add(profile.equipment.bagIid);
      this.profileManager.equipItem(accountId, 'bag', null);
    }
    
    // 从 stash/prep 中移除装备物品（因为它们已经掉落了）
    if (equippedIids.size > 0) {
      // 从 stash 中移除
      const newStash = profile.stash.filter(item => !equippedIids.has(item.iid));
      // 从 prep 中移除
      const newPrep = profile.prep.filter(item => !equippedIids.has(item.iid));
      this.profileManager.updateProfile(accountId, { stash: newStash, prep: newPrep });
      
      log('EQUIPPED_ITEMS_REMOVED_ON_DEATH', {
        room: this.id,
        player: playerId,
        accountId,
        removedIids: Array.from(equippedIids).join(','),
        tick: this.tick,
      });
    }
    
    // 添加到结果队列
    this.raidResults.set(playerId, {
      result: 'DIED',
      accountId,
      moneyLost,
    });
    
    return { success: true, accountId, moneyLost };
  }

  // 新增: 处理玩家撤离（inventory -> stash）
  // 返回结果信息，用于发送 S2C_RAID_RESULT
  handlePlayerExtract(playerId: string): { success: boolean; accountId?: string; loot?: ItemInstance[]; moneyGained?: number } {
    const player = this.players.get(playerId);
    if (!player || player.status !== 'EXTRACTED') return { success: false };
    
    const items = [...player.inventory.items];
    const accountId = this.playerToAccount.get(playerId) ?? playerId;
    let moneyGained = 0;
    
    if (items.length > 0) {
      // 使用 accountId 保存到正确的 Profile
      this.profileManager.addToStash(accountId, items);
      
      // 计算获得的金钱（物品价值总和）
      for (const item of items) {
        try {
          const itemType = getItemType(item.typeId);
          moneyGained += itemType.value * item.qty;
        } catch {
          // 未知物品类型，跳过
        }
      }
      
      // 更新金钱
      const profile = this.profileManager.getProfileData(accountId);
      this.profileManager.updateProfile(accountId, { money: profile.money + moneyGained });
      
      player.clearInventory();
      
      this.pushEvent(`Player ${playerId} extracted with ${items.length} items`);
      log('PLAYER_EXTRACT', {
        room: this.id,
        player: playerId,
        accountId: accountId,
        itemCount: items.length,
        moneyGained,
        tick: this.tick,
      });
    } else {
      // 修复: 即使没有物品，也要清空背包并记录日志
      player.clearInventory();
      this.pushEvent(`Player ${playerId} extracted with no items`);
      log('PLAYER_EXTRACT', {
        room: this.id,
        player: playerId,
        accountId: accountId,
        itemCount: 0,
        moneyGained: 0,
        tick: this.tick,
      });
    }
    
    // 修复: 无论是否有物品，都添加到结果队列（确保客户端能收到结果消息）
    this.raidResults.set(playerId, {
      result: 'EXTRACTED',
      accountId,
      loot: items,
      moneyGained,
    });
    
    return { success: true, accountId, loot: items, moneyGained };
  }

  // 新增: 获取玩家对应的 accountId
  getAccountId(playerId: string): string | undefined {
    return this.playerToAccount.get(playerId);
  }

  // 新增: 处理拾取世界物品（来自客户端消息）
  handlePickupWorldItem(playerId: string, wid: string): { success: boolean; message?: string } {
    const player = this.players.get(playerId);
    if (!player || player.status !== 'ALIVE') {
      return { success: false, message: 'Player not alive' };
    }
    
    const worldItem = this.worldItems.get(wid);
    if (!worldItem) {
      return { success: false, message: 'World item not found' };
    }
    
    const dx = worldItem.x - player.x;
    const dy = worldItem.y - player.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > this.PICKUP_RADIUS) {
      return { success: false, message: 'Too far away' };
    }
    
    const result = player.addItem(worldItem.typeId, worldItem.qty);
    if (result.success) {
      this.worldItems.delete(wid);
      const itemType = getItemType(worldItem.typeId);
      this.pushEvent(`Player ${playerId} picked up ${itemType.name} x${result.added}`);
      return { success: true };
    } else {
      return { success: false, message: 'Inventory full' };
    }
  }

  // 新增: 处理拾取掉落包（来自客户端消息）
  handlePickupLootBag(playerId: string, bid: string): { success: boolean; message?: string } {
    const player = this.players.get(playerId);
    if (!player || player.status !== 'ALIVE') {
      return { success: false, message: 'Player not alive' };
    }
    
    const bag = this.lootBags.get(bid);
    if (!bag || bag.items.length === 0) {
      return { success: false, message: 'Loot bag not found or empty' };
    }
    
    const dx = bag.x - player.x;
    const dy = bag.y - player.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > this.PICKUP_RADIUS) {
      return { success: false, message: 'Too far away' };
    }
    
    const remainingItems: typeof bag.items = [];
    let pickedAny = false;
    
    for (const item of bag.items) {
      const result = player.addItem(item.typeId, item.qty);
      if (result.success && result.added === item.qty) {
        pickedAny = true;
      } else if (result.success && result.added > 0) {
        remainingItems.push({
          iid: item.iid,
          typeId: item.typeId,
          qty: item.qty - result.added,
        });
        pickedAny = true;
      } else {
        remainingItems.push(item);
      }
    }
    
    if (pickedAny) {
      if (remainingItems.length === 0) {
        this.lootBags.delete(bid);
      } else {
        bag.items = remainingItems;
      }
      this.pushEvent(`Player ${playerId} picked up loot bag`);
      return { success: true };
    } else {
      return { success: false, message: 'Inventory full' };
    }
  }

  // 新增: 获取世界物品列表（用于 snapshot）
  getWorldItems(): WorldItem[] {
    return Array.from(this.worldItems.values());
  }

  // 新增: 获取掉落包列表（用于 snapshot）
  getLootBags(): LootBag[] {
    return Array.from(this.lootBags.values());
  }
  
  // 新增: 获取并清空战斗事件队列（供 server 广播使用）
  drainCombatEvents(): Map<string, Array<{ kind: 'DRY_FIRE' | 'HIT' | 'DAMAGE_TAKEN'; direction?: number }>> {
    const events = new Map(this.combatEvents);
    this.combatEvents.clear();
    return events;
  }

  // 新增: 自动交互（服务端选最近可交互目标）
  // 优先级：worldItems > lootBags
  handleAutoInteract(playerId: string): { success: boolean; message?: string; target?: string } {
    const player = this.players.get(playerId);
    if (!player || player.status !== 'ALIVE') {
      return { success: false, message: 'Player not alive' };
    }
    
    // 查找最近的世界物品
    let nearestWorldItem: WorldItem | null = null;
    let nearestWid: string | null = null;
    let nearestWorldDist = this.PICKUP_RADIUS + 1;
    
    for (const [wid, worldItem] of this.worldItems.entries()) {
      const dx = worldItem.x - player.x;
      const dy = worldItem.y - player.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist < nearestWorldDist) {
        nearestWorldItem = worldItem;
        nearestWid = wid;
        nearestWorldDist = dist;
      }
    }
    
    // 查找最近的掉落包
    let nearestBag: LootBag | null = null;
    let nearestBid: string | null = null;
    let nearestBagDist = this.PICKUP_RADIUS + 1;
    
    for (const [bid, bag] of this.lootBags.entries()) {
      if (bag.items.length === 0) continue;
      
      const dx = bag.x - player.x;
      const dy = bag.y - player.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist < nearestBagDist) {
        nearestBag = bag;
        nearestBid = bid;
        nearestBagDist = dist;
      }
    }
    
    // 没有可交互目标
    if (!nearestWorldItem && !nearestBag) {
      return { success: false, message: 'No target nearby' };
    }
    
    // 优先拾取世界物品（如果距离更近或相同）
    if (nearestWorldItem && nearestWid && nearestWorldDist <= nearestBagDist) {
      const result = player.addItem(nearestWorldItem.typeId, nearestWorldItem.qty);
      if (result.success) {
        this.worldItems.delete(nearestWid);
        const itemType = getItemType(nearestWorldItem.typeId);
        this.pushEvent(`Player ${playerId} picked up ${itemType.name} x${result.added}`);
        log('AUTO_PICKUP_WORLD', {
          room: this.id,
          player: playerId,
          wid: nearestWid,
          typeId: nearestWorldItem.typeId,
          qty: result.added,
          dist: nearestWorldDist.toFixed(1),
          tick: this.tick,
        });
        return { success: true, target: `world:${nearestWid}` };
      } else {
        return { success: false, message: 'Inventory full' };
      }
    }
    
    // 拾取掉落包
    if (nearestBag && nearestBid) {
      const remainingItems: typeof nearestBag.items = [];
      let pickedAny = false;
      
      for (const item of nearestBag.items) {
        const result = player.addItem(item.typeId, item.qty);
        if (result.success && result.added === item.qty) {
          pickedAny = true;
        } else if (result.success && result.added > 0) {
          remainingItems.push({
            iid: item.iid,
            typeId: item.typeId,
            qty: item.qty - result.added,
          });
          pickedAny = true;
        } else {
          remainingItems.push(item);
        }
      }
      
      if (pickedAny) {
        if (remainingItems.length === 0) {
          this.lootBags.delete(nearestBid);
        } else {
          nearestBag.items = remainingItems;
        }
        this.pushEvent(`Player ${playerId} picked up loot bag`);
        log('AUTO_PICKUP_BAG', {
          room: this.id,
          player: playerId,
          bid: nearestBid,
          dist: nearestBagDist.toFixed(1),
          tick: this.tick,
        });
        return { success: true, target: `bag:${nearestBid}` };
      } else {
        return { success: false, message: 'Inventory full' };
      }
    }
    
    return { success: false, message: 'No target nearby' };
  }
}
