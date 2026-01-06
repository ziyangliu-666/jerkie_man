import { Player } from './player.js';
import { ProfileManager } from './profile.js';
import type { PLAYER_STATE, BULLET_STATE, ITEM_STATE, C2S_INPUT, MAP_CONFIG, OBSTACLE_STATE, WorldItem, LootBag, ItemInstance, WeaponRuntime, WeaponDef, MapTemplate, SpawnPoint } from '@jerkie-man/shared';
import { loadMapConfig, loadItemTypes, circleVsAABB, createRng, rectIntersects, segmentIntersectsCircle, getItemType, getAllItemTypes, getItemTypesByRarity, getWeaponDef, getArmorDef, getBagDef, applySpread, msToTicks, getFireSchedule, shouldStartBurst, canFireTick, advanceFireCooldown, PLAYER_HIT_RADIUS } from '@jerkie-man/shared';
import { log } from './logger.js';

// Step4: 内部子弹类型（包含spawnAt、damage和bulletLifeMs用于TTL检查和伤害计算）
type Bullet = BULLET_STATE & { 
  spawnAt: number; 
  damage: number; 
  bulletLifeMs: number; 
  weaponTypeId: string;
  // 新增: 手雷相关字段
  isGrenade?: boolean;
  explodeTick?: number;
  targetX?: number;
  targetY?: number;
  spawnX: number;
  spawnY: number;
};

export class Room {
  public id: string;
  public players: Map<string, Player>;
  public bullets: Bullet[];
  public items: ITEM_STATE[];
  public obstacles: OBSTACLE_STATE[];
  public worldItems: Map<string, WorldItem>;
  public lootBags: Map<string, LootBag>;
  public profileManager: ProfileManager;
  private playerToAccount: Map<string, string> = new Map();
  public readonly seed: number;
  public readonly mapConfig: MAP_CONFIG;
  public readonly mapTemplateId?: string;
  public tick: number;
  private readonly spawnPoints: SpawnPoint[];
  private itemIdCounter = 0;
  private bulletIdCounter = 0;
  private worldItemIdCounter = 0;
  private lootBagIdCounter = 0;
  private events: Array<{ tick: number; timestamp: number; message: string }> = [];
  private readonly MAX_EVENTS = 50;
  private readonly PICKUP_RADIUS = 40;
  public raidResults: Map<string, { result: 'EXTRACTED' | 'DIED'; accountId: string; loot?: ItemInstance[]; moneyGained?: number; moneyLost?: number }> = new Map();
  public combatEvents: Map<string, Array<{ kind: 'DRY_FIRE' | 'HIT' | 'DAMAGE_TAKEN'; direction?: number }>> = new Map();
  public meleeSwings: Array<{ playerId: string; x: number; y: number; aimRad: number; range: number; arcRad: number }> = [];
  public explosions: Array<{ x: number; y: number; radius: number }> = [];

  constructor(id: string, options?: { seed?: number; mapTemplate?: MapTemplate }) {
    this.id = id;
    this.players = new Map();
    this.bullets = [];
    this.items = [];
    this.obstacles = [];
    this.worldItems = new Map();
    this.lootBags = new Map();
    this.profileManager = new ProfileManager();
    this.explosions = [];

    const mapTemplate = options?.mapTemplate;
    const seedOverride = options?.seed;
    if (seedOverride !== undefined) {
      this.seed = seedOverride;
    } else if (mapTemplate) {
      this.seed = mapTemplate.mapConfig.seed;
    } else if (process.env.SEED !== undefined) {
      const envSeed = parseInt(process.env.SEED, 10);
      if (isNaN(envSeed)) {
        throw new Error(`Invalid SEED environment variable: ${process.env.SEED}`);
      }
      this.seed = envSeed;
    } else {
      this.seed = Math.floor(Math.random() * 2**31);
    }

    this.mapConfig = mapTemplate ? { ...mapTemplate.mapConfig, seed: this.seed } : loadMapConfig(this.seed);
    this.mapTemplateId = mapTemplate?.id;
    this.spawnPoints = mapTemplate?.spawns ? mapTemplate.spawns.map((s) => ({ ...s })) : [];

    this.tick = 0;

    if (mapTemplate) {
      this.obstacles = mapTemplate.obstacles.map((obs) => ({ ...obs }));
    } else {
      this.generateObstacles();
    }

    this.generateWorldItems(30);
  }


  findBulletById(id: string): Bullet | undefined {
    return this.bullets.find(b => b.id === id);
  }

  findBulletByClientShotId(clientShotId: number | undefined, ownerId: string): Bullet | undefined {
    if (clientShotId === undefined) return undefined;
    return this.bullets.find(b => b.clientShotId === clientShotId && b.ownerId === ownerId);
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
    const epicItems = getItemTypesByRarity('EPIC');
    
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
        // 按权重选择物品类型（60% COMMON, 30% RARE, 10% EPIC）
        const roll = itemsRng();
        let itemType;
        if (roll < 0.6 && commonItems.length > 0) {
          itemType = commonItems[Math.floor(itemsRng() * commonItems.length)];
        } else if (roll < 0.9 && rareItems.length > 0) {
          itemType = rareItems[Math.floor(itemsRng() * rareItems.length)];
        } else if (epicItems.length > 0) {
          itemType = epicItems[Math.floor(itemsRng() * epicItems.length)];
        } else {
          itemType = allItemTypes[Math.floor(itemsRng() * allItemTypes.length)];
        }
        
          const wid = `wid_${this.seed}_${this.worldItemIdCounter++}_${itemsRng().toString(36).substring(2, 11)}`;
          const maxSpawnQty = Math.min(3, itemType.stackMax);
          const qty = maxSpawnQty > 1 ? Math.floor(itemsRng() * maxSpawnQty) + 1 : 1;
        
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

  // 新增: 局内武器切换（重置弹匣/换弹状态）
  private setPlayerWeaponRuntime(player: Player, weaponTypeId: string): boolean {
    try {
      const weaponDef = getWeaponDef(weaponTypeId);
      
      player.weaponRuntime = {
        weaponTypeId,
        ammoInMag: weaponDef.magSize,
        reloadingUntilTick: 0,
        nextFireTick: this.tick, // 允许立即开火（切换武器后）
      };
      return true;
    } catch {
      return false;
    }
  }

  private addInventoryItemInstance(player: Player, item: ItemInstance): boolean {
    if (player.inventory.items.length >= player.inventory.bagCap) {
      return false;
    }
    player.inventory.items.push({ ...item });
    return true;
  }

  private dropItemAtPlayer(player: Player, item: ItemInstance): void {
    const wid = `wid_${this.seed}_${this.worldItemIdCounter++}_${Date.now().toString(36)}`;
    this.worldItems.set(wid, {
      wid,
      typeId: item.typeId,
      qty: item.qty,
      x: player.x,
      y: player.y,
    });
  }

  // 新增: 自动装备判定（背包/护甲/拳头->武器）
  private tryAutoEquipItem(playerId: string, player: Player, item: ItemInstance): boolean {
    if (item.qty <= 0) {
      return false;
    }
    if (item.qty !== 1) {
      return false;
    }

    // 武器：仅当当前是拳头时自动替换
    if (!player.weaponRuntime || player.weaponRuntime.weaponTypeId === 'w_fists') {
      try {
        const weaponDef = getWeaponDef(item.typeId);
        if (this.setPlayerWeaponRuntime(player, weaponDef.typeId)) {
          player.equippedWeaponItem = { ...item, qty: 1 };
          this.pushEvent(`AUTO_EQUIP|${playerId}|自动装备：${weaponDef.name}`);
          return true;
        }
      } catch {
        // 不是武器，继续判断
      }
    }

    // 背包：容量更大时自动替换
    try {
      const bagDef = getBagDef(item.typeId);
      if (bagDef.bagCap > player.inventory.bagCap) {
        const oldBag = player.equippedBagItem;
        player.inventory.bagCap = bagDef.bagCap;
        player.equippedBagTypeId = bagDef.typeId;
        player.equippedBagItem = { ...item, qty: 1 };
        if (oldBag) {
          this.addInventoryItemInstance(player, oldBag);
        }
        this.pushEvent(`AUTO_EQUIP|${playerId}|自动装备：${bagDef.name}（容量 ${bagDef.bagCap}）`);
        return true;
      }
      return false;
    } catch {
      // 不是背包，继续判断
    }

    // 护甲：减伤更高时自动替换
    try {
      const armorDef = getArmorDef(item.typeId);
      if (armorDef.damageReduction > player.armorReduction) {
        const oldArmor = player.equippedArmorItem;
        player.armorReduction = armorDef.damageReduction;
        player.equippedArmorTypeId = armorDef.typeId;
        player.equippedArmorItem = { ...item, qty: 1 };
        if (oldArmor && !this.addInventoryItemInstance(player, oldArmor)) {
          this.dropItemAtPlayer(player, oldArmor);
        }
        this.pushEvent(`AUTO_EQUIP|${playerId}|自动装备：${armorDef.name}（减伤 ${Math.floor(armorDef.damageReduction * 100)}%）`);
        return true;
      }
    } catch {
      // ignore
    }

    return false;
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
    
    if (this.spawnPoints.length > 0) {
      const ordered = [...this.spawnPoints];
      for (let i = ordered.length - 1; i > 0; i--) {
        const j = Math.floor(spawnRng() * (i + 1));
        [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
      }
      for (const spawn of ordered) {
        const x = spawn.x;
        const y = spawn.y;
        if (x < PLAYER_RADIUS || x > this.mapConfig.width - PLAYER_RADIUS ||
            y < PLAYER_RADIUS || y > this.mapConfig.height - PLAYER_RADIUS) {
          continue;
        }
        if (this.isInExtractZone(x, y)) {
          continue;
        }
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
        let tooCloseToPlayer = false;
        for (const [, player] of this.players.entries()) {
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
        return { x, y };
      }
    }

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
    let equippedWeaponItem: ItemInstance | null = null;
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
          equippedWeaponItem = { ...weaponItem };
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
          equippedWeaponItem = null;
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
        equippedWeaponItem = null;
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
        equippedWeaponItem = null;
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
    player.equippedWeaponItem = equippedWeaponItem;
    
    // 新增: 初始化背包（从stash+prep查找）
    if (profile && profile.equipment.bagIid) {
      const pool = [...profile.stash, ...profile.prep];
      const bagItem = pool.find(item => item.iid === profile.equipment.bagIid);
      if (bagItem) {
        try {
          const bagDef = getBagDef(bagItem.typeId);
          player.inventory.bagCap = bagDef.bagCap;
          player.equippedBagTypeId = bagItem.typeId;
          player.equippedBagItem = { ...bagItem };
        } catch (err) {
          log('BAG_INIT_ERROR', {
            room: this.id,
            player: playerId,
            bagIid: profile.equipment.bagIid,
            bagTypeId: bagItem.typeId,
            error: err instanceof Error ? err.message : String(err),
            tick: this.tick,
          });
        }
      }
    }
    
    // 新增: 初始化护甲减伤（从stash+prep查找）
    if (profile && profile.equipment.armorIid) {
      const pool = [...profile.stash, ...profile.prep];
      const armorItem = pool.find(item => item.iid === profile.equipment.armorIid);
      if (armorItem) {
        try {
          const armorDef = getArmorDef(armorItem.typeId);
          player.armorReduction = armorDef.damageReduction;
          player.equippedArmorTypeId = armorItem.typeId;
          player.equippedArmorItem = { ...armorItem };
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
    
    // 装备物品不进入背包（仅保留在装备槽）
    
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
    player.equippedWeaponItem = null;
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
          player.equippedWeaponItem = { ...weaponItem };
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
        player.equippedWeaponItem = null;
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

  // 新增: 根据 profile 更新玩家的背包/护甲（用于进入战局时重置）
  public updatePlayerGearFromProfile(playerId: string, accountId: string): void {
    const player = this.players.get(playerId);
    if (!player) return;

    const profile = this.profileManager.getProfileData(accountId);
    if (!profile) return;

    player.inventory.bagCap = profile.bagCap;
    player.equippedBagTypeId = null;
    player.equippedBagItem = null;
    player.armorReduction = 0;
    player.equippedArmorTypeId = null;
    player.equippedArmorItem = null;

    const pool = [...profile.stash, ...profile.prep];
    if (profile.equipment.bagIid) {
      const bagItem = pool.find(item => item.iid === profile.equipment.bagIid);
      if (bagItem) {
        try {
          const bagDef = getBagDef(bagItem.typeId);
          player.inventory.bagCap = bagDef.bagCap;
          player.equippedBagTypeId = bagItem.typeId;
          player.equippedBagItem = { ...bagItem };
        } catch {
          // ignore invalid bag
        }
      }
    }

    if (profile.equipment.armorIid) {
      const armorItem = pool.find(item => item.iid === profile.equipment.armorIid);
      if (armorItem) {
        try {
          const armorDef = getArmorDef(armorItem.typeId);
          player.armorReduction = armorDef.damageReduction;
          player.equippedArmorTypeId = armorItem.typeId;
          player.equippedArmorItem = { ...armorItem };
        } catch {
          // ignore invalid armor
        }
      }
    }
  }

  // 新增: 局内装备切换（背包/护甲/武器）
  public handleRaidEquip(
    playerId: string,
    slot: 'weapon' | 'bag' | 'armor',
    iid: string | null,
    typeId?: string | null
  ): { success: boolean; message?: string } {
    const player = this.players.get(playerId);
    if (!player || player.status !== 'ALIVE') {
      return { success: false, message: 'Player not alive' };
    }

    if (slot === 'weapon') {
      if (!iid) {
        if (!player.equippedWeaponItem || player.weaponRuntime?.weaponTypeId === 'w_fists') {
          return { success: true };
        }
        if (player.inventory.items.length >= player.inventory.bagCap) {
          return { success: false, message: 'Bag is full' };
        }
        this.addInventoryItemInstance(player, player.equippedWeaponItem);
        player.equippedWeaponItem = null;
        const ok = this.setPlayerWeaponRuntime(player, 'w_fists');
        return ok ? { success: true } : { success: false, message: 'Failed to unequip weapon' };
      }

      const weaponItem = player.inventory.items.find(item => item.iid === iid) ??
        (typeId ? player.inventory.items.find(item => item.typeId === typeId) : undefined);
      if (!weaponItem) {
        return { success: false, message: 'Weapon not in inventory' };
      }
      try {
        getWeaponDef(weaponItem.typeId);
      } catch {
        return { success: false, message: 'Invalid weapon type' };
      }

      const oldWeapon = player.equippedWeaponItem;
      // 修复：武器只移除1个，不是全部数量
      const removed = player.removeItem(weaponItem.iid, 1);
      if (!removed) {
        return { success: false, message: 'Failed to remove item' };
      }
      const ok = this.setPlayerWeaponRuntime(player, weaponItem.typeId);
      if (!ok) {
        // 回滚：如果设置失败，把武器加回背包
        this.addInventoryItemInstance(player, { ...weaponItem, qty: 1 });
        return { success: false, message: 'Invalid weapon type' };
      }
      // 修复：装备的武器数量应该是1
      player.equippedWeaponItem = { ...weaponItem, qty: 1 };
      if (oldWeapon) {
        if (!this.addInventoryItemInstance(player, oldWeapon)) {
          this.dropItemAtPlayer(player, oldWeapon);
        }
      }
      return { success: true };
    }

    if (slot === 'bag') {
      if (!iid) {
        return { success: false, message: 'Bag item required' };
      }
      const bagItem = player.inventory.items.find(item => item.iid === iid) ??
        (typeId ? player.inventory.items.find(item => item.typeId === typeId) : undefined);
      if (!bagItem) {
        return { success: false, message: 'Bag not in inventory' };
      }
      try {
        const bagDef = getBagDef(bagItem.typeId);
        const currentCount = player.inventory.items.length;
        const willAddOldBag = !!player.equippedBagItem;
        const targetCount = currentCount - 1 + (willAddOldBag ? 1 : 0);
        if (bagDef.bagCap < targetCount) {
          return { success: false, message: 'Bag capacity too small' };
        }
        const oldBag = player.equippedBagItem;
        // 修复：背包只移除1个，不是全部数量
        const removed = player.removeItem(bagItem.iid, 1);
        if (!removed) {
          return { success: false, message: 'Failed to remove item' };
        }
        player.inventory.bagCap = bagDef.bagCap;
        player.equippedBagTypeId = bagDef.typeId;
        // 修复：装备的背包数量应该是1
        player.equippedBagItem = { ...bagItem, qty: 1 };
        if (oldBag && !this.addInventoryItemInstance(player, oldBag)) {
          this.dropItemAtPlayer(player, oldBag);
        }
        return { success: true };
      } catch {
        return { success: false, message: 'Invalid bag type' };
      }
    }

    if (slot === 'armor') {
      if (!iid) {
        // 卸下防具
        if (!player.equippedArmorItem) {
          return { success: true };
        }
        if (player.inventory.items.length >= player.inventory.bagCap) {
          return { success: false, message: 'Bag is full' };
        }
        this.addInventoryItemInstance(player, player.equippedArmorItem);
        player.equippedArmorItem = null;
        player.equippedArmorTypeId = null;
        player.armorReduction = 0;
        return { success: true };
      }
      const armorItem = player.inventory.items.find(item => item.iid === iid) ??
        (typeId ? player.inventory.items.find(item => item.typeId === typeId) : undefined);
      if (!armorItem) {
        return { success: false, message: 'Armor not in inventory' };
      }
      try {
        const armorDef = getArmorDef(armorItem.typeId);
        const oldArmor = player.equippedArmorItem;
        // 修复：护甲只移除1个，不是全部数量
        const removed = player.removeItem(armorItem.iid, 1);
        if (!removed) {
          return { success: false, message: 'Failed to remove item' };
        }
        player.armorReduction = armorDef.damageReduction;
        player.equippedArmorTypeId = armorDef.typeId;
        // 修复：装备的护甲数量应该是1
        player.equippedArmorItem = { ...armorItem, qty: 1 };
        if (oldArmor && !this.addInventoryItemInstance(player, oldArmor)) {
          this.dropItemAtPlayer(player, oldArmor);
        }
        return { success: true };
      } catch {
        return { success: false, message: 'Invalid armor type' };
      }
    }

    return { success: false, message: 'Unknown slot' };
  }

  // 新增: 丢弃背包物品到地面
  public handleDropItem(playerId: string, iid: string, qty: number): { success: boolean; message?: string } {
    const player = this.players.get(playerId);
    if (!player || player.status !== 'ALIVE') {
      return { success: false, message: 'Player not alive' };
    }

    const item = player.inventory.items.find(entry => entry.iid === iid);
    if (!item) {
      return { success: false, message: 'Item not found' };
    }

    const dropQty = Math.min(item.qty, qty);
    if (dropQty <= 0) {
      return { success: false, message: 'Invalid quantity' };
    }

    if (player.equippedWeaponItem?.iid === item.iid) {
      return { success: false, message: 'Cannot drop equipped weapon' };
    }
    if (player.equippedBagItem?.iid === item.iid) {
      return { success: false, message: 'Cannot drop equipped bag' };
    }
    if (player.equippedArmorItem?.iid === item.iid) {
      return { success: false, message: 'Cannot drop equipped armor' };
    }

    const removed = player.removeItem(iid, dropQty);
    if (!removed) {
      return { success: false, message: 'Failed to remove item' };
    }

    const wid = `wid_${this.seed}_${this.worldItemIdCounter++}_${Date.now().toString(36)}`;
    this.worldItems.set(wid, {
      wid,
      typeId: item.typeId,
      qty: dropQty,
      x: player.x,
      y: player.y,
    });

    let itemName = item.typeId;
    try {
      itemName = getItemType(item.typeId).name;
    } catch {}
    this.pushEvent(`Player ${playerId} dropped ${itemName} x${dropQty}`);

    return { success: true };
  }

  // 节流日志：每200ms打印一次
  private lastProcessLog = new Map<string, number>();

  // 新增: 发射子弹的公共方法（修复：weaponDef使用强类型而非any）
  private spawnBullet(
    playerId: string,
    player: Player,
    aimRad: number,
    weaponDef: WeaponDef,
    shotId: number | undefined,
    originX?: number,
    originY?: number,
    spreadSeed?: number
  ): string {
    const pelletCount = weaponDef.pelletCount ?? 1; // 默认1颗子弹
    const spawnX = originX ?? player.x;
    const spawnY = originY ?? player.y;
    
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
        // 优先使用客户端提供的 spreadSeed（保证散布一致），否则使用服务端生成
        const bulletRng = spreadSeed !== undefined
          ? createRng(spreadSeed + i)
          : createRng(this.seed + this.tick + this.bulletIdCounter + i);
        
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
          x: spawnX,
          y: spawnY,
          vx,
          vy,
          ownerId: playerId,
          clientShotId: i === 0 ? shotId : undefined, // 只有第一颗子弹使用shotId
          spawnAt: now, // 记录生成时间，用于TTL检查
          damage: weaponDef.damage, // 记录伤害值，用于命中扣血
          bulletLifeMs: weaponDef.bulletLifeMs, // 子弹生命周期（毫秒）
          weaponTypeId: weaponDef.typeId,
          spawnX,
          spawnY,
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
      // 优先使用客户端提供的 spreadSeed（保证散布一致），否则使用服务端生成
      const bulletRng = spreadSeed !== undefined
        ? createRng(spreadSeed)
        : createRng(this.seed + this.tick + this.bulletIdCounter);
      const actualAimRad = applySpread(aimRad, weaponDef.spreadDeg, bulletRng);
      
      // 生成子弹
      const vx = Math.cos(actualAimRad) * weaponDef.bulletSpeed;
      const vy = Math.sin(actualAimRad) * weaponDef.bulletSpeed;
      const bulletId = `b${this.bulletIdCounter++}_${Math.floor(bulletRng() * 1000000).toString(36)}`;
      firstBulletId = bulletId;
      
        this.bullets.push({
          id: bulletId,
          x: spawnX,
          y: spawnY,
          vx,
          vy,
          ownerId: playerId,
          clientShotId: shotId, // 客户端发射ID（用于预测子弹对齐，连发时为undefined）
          spawnAt: now, // 记录生成时间，用于TTL检查
          damage: weaponDef.damage, // 记录伤害值，用于命中扣血
          bulletLifeMs: weaponDef.bulletLifeMs, // 子弹生命周期（毫秒）
          weaponTypeId: weaponDef.typeId,
          spawnX,
          spawnY,
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
    const shootNow = !!input.shoot;
    const wasShooting = player.lastShoot;
    player.lastShoot = shootNow;

    // 更新玩家位置（20Hz tick = 50ms = 0.05s）
    // P0-1 修复: 传入 obstacles 参数，使碰撞检测生效
    // 新增: 支持冲刺
    const deltaTime = 0.05;
    const wantsSprint = !!input.sprint; // 新增: 获取冲刺输入
    player.processInput(input.keys, deltaTime, this.mapConfig.width, this.mapConfig.height, this.obstacles, wantsSprint);

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
            wr.reloadingUntilTick = this.tick + msToTicks(weaponDef.reloadMs);
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
    
    // 新增: 处理开火（使用武器参数）
    if (shootNow && player.status === 'ALIVE') {
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
      // 检查是否可以开火
      if (!canFireTick(wr, this.tick)) {
        return;
      }
      
      try {
        const weaponDef = getWeaponDef(wr.weaponTypeId);
        
        // 检查是否是 FISTS（近战武器）
        if (wr.weaponTypeId === 'w_fists') {
          // 近战攻击：检测范围内是否有敌人
          const baseRange = weaponDef.meleeRange ?? 35; // 近战范围（像素）
          const baseArcRad = ((weaponDef.meleeArcDeg ?? 60) * Math.PI) / 180; // 扇形角度（弧度）
          const hitRadius = PLAYER_HIT_RADIUS; // 目标半径（用于边缘命中修正）
          const meleeRange = baseRange;
          const meleeArcRad = baseArcRad;
          const visualRange = baseRange + hitRadius;
          const visualExtraAngle = Math.asin(Math.min(1, hitRadius / Math.max(visualRange, 0.001)));
          const visualArcRad = baseArcRad + visualExtraAngle * 2;
          let hitTarget: Player | null = null;
          let minDist = meleeRange + 1;

          // 广播近战挥击（用于客户端显示其他玩家挥击）
          this.meleeSwings.push({
            playerId,
            x: player.x,
            y: player.y,
            aimRad: input.aim,
            range: visualRange,
            arcRad: visualArcRad,
          });
          
          for (const [targetId, target] of this.players.entries()) {
            if (targetId === playerId || target.status !== 'ALIVE') continue;
            
            const dx = target.x - player.x;
            const dy = target.y - player.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            if (dist <= meleeRange + hitRadius && dist < minDist) {
              // 检查是否在瞄准方向（简化：检查角度差）
              const aimDir = Math.atan2(dy, dx);
              const aimDiff = Math.abs(aimDir - input.aim);
              const normalizedDiff = Math.min(aimDiff, Math.PI * 2 - aimDiff);
              const extraAngle = dist > 0.001 ? Math.asin(Math.min(1, hitRadius / dist)) : 0;
              if (normalizedDiff < meleeArcRad / 2 + extraAngle) {
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
              hitTarget.killedBy = player.name || playerId;
              hitTarget.killedByWeaponName = weaponDef.name;
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
          wr.nextFireTick = this.tick + msToTicks(weaponDef.fireIntervalMs);
          return;
        }
        
        // 远程武器：检查弹药
        const schedule = getFireSchedule(weaponDef);
        const burstShotCount = input.burstShots ? input.burstShots.length : 1;
        
        // 检查弹药是否足够
        if (wr.ammoInMag < burstShotCount) {
          // 弹匣空了或弹药不足
          // 触发自动换弹（兜底）
          if (weaponDef.reloadMs > 0 && wr.reloadingUntilTick === 0) {
            wr.reloadingUntilTick = this.tick + msToTicks(weaponDef.reloadMs);
          }
          // 发送干火事件
          if (!this.combatEvents.has(playerId)) {
            this.combatEvents.set(playerId, []);
          }
          this.combatEvents.get(playerId)!.push({ kind: 'DRY_FIRE' });
          return;
        }
        
        // 检查是否是连发武器且客户端发送了连发数据
        if (input.burstShots && input.burstShots.length > 0) {
          // 客户端推送的连发模式：发射所有子弹
          for (const shot of input.burstShots) {
            if (wr.ammoInMag <= 0) break; // 弹药不足，停止发射
            
            wr.ammoInMag -= 1;
            this.spawnBullet(
              playerId,
              player,
              input.aim,
              weaponDef,
              shot.shotId,
              shot.originX,
              shot.originY,
              shot.spreadSeed
            );
          }
          
          log('SPAWN_BULLET_BURST', {
            room: this.id,
            player: playerId,
            tick: this.tick,
            weapon: wr.weaponTypeId,
            shotCount: input.burstShots.length,
            ammo: wr.ammoInMag,
          });
        } else {
          // 单发模式或第一发
          wr.ammoInMag -= 1;
          const shotOriginX = input.shootOriginX ?? player.x;
          const shotOriginY = input.shootOriginY ?? player.y;
          player.lastShotOriginX = shotOriginX;
          player.lastShotOriginY = shotOriginY;
          const bulletId = this.spawnBullet(playerId, player, input.aim, weaponDef, input.shotId, shotOriginX, shotOriginY, input.spreadSeed);
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
            pelletCount: pelletCount,
            totalBullets: this.bullets.length,
          });
        }
        
        // 更新射击冷却时间
        advanceFireCooldown(wr, weaponDef, this.tick, burstShotCount);
        
        // 修复: 开火后立即返回，防止同一 tick 内处理后续输入导致绕过冷却限制
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
  private applyExplosion(bullet: Bullet, x: number, y: number): void {
    let weaponDef: WeaponDef;
    try {
      weaponDef = getWeaponDef(bullet.weaponTypeId);
    } catch {
      return;
    }
    const radius = weaponDef.explosionRadius ?? 0;
    if (radius <= 0) {
      return;
    }
    this.explosions.push({ x, y, radius });

    const explosionDamage = weaponDef.explosionDamage ?? 0;
    if (explosionDamage <= 0) {
      return;
    }

    for (const [playerId, player] of this.players.entries()) {
      if (player.status !== 'ALIVE') continue;
      const dx = player.x - x;
      const dy = player.y - y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > radius) continue;

      const scaledDamage = Math.floor(explosionDamage * (1 - dist / radius));
      if (scaledDamage <= 0) continue;
      const finalDamage = Math.floor(scaledDamage * (1 - player.armorReduction));
      if (finalDamage <= 0) continue;

      const oldHp = player.hp;
      player.takeDamage(finalDamage);
      const isDead = player.hp <= 0;

      if (isDead) {
        this.handlePlayerDeath(player.id);
      }

      // 发送战斗事件
      if (!this.combatEvents.has(bullet.ownerId)) {
        this.combatEvents.set(bullet.ownerId, []);
      }
      this.combatEvents.get(bullet.ownerId)!.push({ kind: 'HIT' });

      if (!this.combatEvents.has(playerId)) {
        this.combatEvents.set(playerId, []);
      }
      const direction = Math.atan2(y - player.y, x - player.x);
      this.combatEvents.get(playerId)!.push({ kind: 'DAMAGE_TAKEN', direction });

      log('EXPLOSION_HIT', {
        room: this.id,
        bullet: bullet.id,
        owner: bullet.ownerId,
        target: playerId,
        tick: this.tick,
        baseDamage: explosionDamage,
        scaledDamage,
        armorReduction: player.armorReduction,
        finalDamage,
        hp: `${oldHp}->${player.hp}`,
      });

      if (isDead) {
        const attacker = this.players.get(bullet.ownerId);
        if (attacker) {
          player.killedBy = attacker.name || bullet.ownerId;
          player.killedByWeaponName = weaponDef.name;
        }
      }
    }
  }

  // 新增: 创建手雷爆炸（不依赖武器定义）
  private createExplosion(x: number, y: number, radius: number, damage: number = 80, ownerId?: string): void {
    // 添加视觉效果
    this.explosions.push({ x, y, radius });

    // 对范围内的玩家造成伤害
    for (const [playerId, player] of this.players.entries()) {
      if (player.status !== 'ALIVE') continue;
      
      const dx = player.x - x;
      const dy = player.y - y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > radius) continue;

      // 距离越近伤害越高
      const scaledDamage = Math.floor(damage * (1 - dist / radius));
      if (scaledDamage <= 0) continue;
      
      // 应用防具减伤
      const finalDamage = Math.floor(scaledDamage * (1 - player.armorReduction));
      if (finalDamage <= 0) continue;

      const oldHp = player.hp;
      player.takeDamage(finalDamage);
      const isDead = player.hp <= 0;

      if (isDead) {
        this.handlePlayerDeath(player.id);
      }

      // 发送战斗事件（如果有投掷者）
      if (ownerId) {
        if (!this.combatEvents.has(ownerId)) {
          this.combatEvents.set(ownerId, []);
        }
        this.combatEvents.get(ownerId)!.push({ kind: 'HIT' });
      }

      if (!this.combatEvents.has(playerId)) {
        this.combatEvents.set(playerId, []);
      }
      const direction = Math.atan2(y - player.y, x - player.x);
      this.combatEvents.get(playerId)!.push({ kind: 'DAMAGE_TAKEN', direction });

      log('GRENADE_EXPLOSION_HIT', {
        room: this.id,
        owner: ownerId || 'unknown',
        target: playerId,
        tick: this.tick,
        baseDamage: damage,
        scaledDamage,
        armorReduction: player.armorReduction,
        finalDamage,
        hp: `${oldHp}->${player.hp}`,
        distance: Math.round(dist),
      });

      if (isDead && ownerId) {
        const attacker = this.players.get(ownerId);
        if (attacker) {
          player.killedBy = attacker.name || ownerId;
          player.killedByWeaponName = '破片手雷';
        }
      }
    }

    // 记录爆炸事件
    this.pushEvent(`Grenade exploded at (${Math.round(x)}, ${Math.round(y)})`);
    log('GRENADE_EXPLOSION', {
      room: this.id,
      x: Math.round(x),
      y: Math.round(y),
      radius,
      damage,
      owner: ownerId || 'unknown',
      tick: this.tick,
    });
  }

  updateBullets(deltaTime: number, playerLatencies: Map<string, number> = new Map()): void {
    const now = Date.now();
    const bulletsToRemove = new Set<string>(); // Step4: 用Set代替O(n^2)

    // 延迟补偿配置
    const SAFETY_MARGIN_MS = 50;
    const MAX_REWIND_MS = 500;
    
    for (const bullet of this.bullets) {
      // 新增: 手雷特殊处理
      if (bullet.isGrenade) {
        // 检查是否到达爆炸时间
        if (this.tick >= (bullet.explodeTick ?? 0)) {
          // 爆炸！
          this.createExplosion(bullet.x, bullet.y, 100, 80, bullet.ownerId); // 100像素爆炸半径，80伤害
          bulletsToRemove.add(bullet.id);
          continue;
        }

        // 检查手雷是否已经落地（到达目标位置）
        if (bullet.targetX !== undefined && bullet.targetY !== undefined) {
          const dx = bullet.targetX - bullet.x;
          const dy = bullet.targetY - bullet.y;
          const distToTarget = Math.sqrt(dx * dx + dy * dy);

          // 如果距离目标小于速度*时间（即下一帧会超过目标），则停在目标位置
          const speed = Math.sqrt(bullet.vx * bullet.vx + bullet.vy * bullet.vy);
          const deltaTime = 1 / 50; // 50Hz
          const moveDistance = speed * deltaTime;

          if (distToTarget <= moveDistance || speed === 0) {
            // 手雷落地，停在目标位置
            bullet.x = bullet.targetX;
            bullet.y = bullet.targetY;
            bullet.vx = 0;
            bullet.vy = 0;
            // 继续等待爆炸
          } else {
            // 继续飞行
            bullet.x += bullet.vx * deltaTime;
            bullet.y += bullet.vy * deltaTime;
          }
        } else {
          // 没有目标位置，继续飞行（兼容旧版本）
          const deltaTime = 1 / 50; // 50Hz
          bullet.x += bullet.vx * deltaTime;
          bullet.y += bullet.vy * deltaTime;
        }

        // 边界检查（手雷碰到边界就爆炸）
        if (bullet.x < 0 || bullet.x > this.mapConfig.width ||
            bullet.y < 0 || bullet.y > this.mapConfig.height) {
          this.createExplosion(bullet.x, bullet.y, 100, 80, bullet.ownerId);
          bulletsToRemove.add(bullet.id);
          continue;
        }

        // 手雷不进行玩家碰撞检测，继续下一个子弹
        continue;
      }
      
      // Step4: 子弹TTL检查（使用武器特定的bulletLifeMs）
      if (now - bullet.spawnAt > bullet.bulletLifeMs) {
        this.applyExplosion(bullet, bullet.x, bullet.y);
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
      let impactX = newX;
      let impactY = newY;
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
              impactX = stepX;
              impactY = stepY;
              break;
            }
          }
          if (hitObstacle) {
            break;
          }
        }
        
        if (hitObstacle) {
          // 命中障碍物，删除子弹
          this.applyExplosion(bullet, impactX, impactY);
          bulletsToRemove.add(bullet.id);
          continue;
        }
      
      // 移动子弹
      bullet.x = newX;
      bullet.y = newY;
      
      // 边界检查
        if (bullet.x < 0 || bullet.x > this.mapConfig.width || 
            bullet.y < 0 || bullet.y > this.mapConfig.height) {
          this.applyExplosion(bullet, bullet.x, bullet.y);
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

        // 延迟补偿: 根据射击者延迟回溯目标位置
        const shooterLatency = playerLatencies.get(bullet.ownerId) ?? 0;
        const rewindTimeMs = Math.min(
          Math.max(0, shooterLatency / 2 + SAFETY_MARGIN_MS),
          MAX_REWIND_MS
        );

        const targetTimestamp = now - rewindTimeMs;
        const historicalPos = player.positionHistory.getPositionAt(targetTimestamp);

        // 使用历史位置（如果可用，否则使用当前位置）
        const targetX = historicalPos?.x ?? player.x;
        const targetY = historicalPos?.y ?? player.y;
        const currentHit = segmentIntersectsCircle(oldX, oldY, bullet.x, bullet.y, player.x, player.y, PLAYER_HIT_RADIUS);
        const rewindHit = segmentIntersectsCircle(oldX, oldY, bullet.x, bullet.y, targetX, targetY, PLAYER_HIT_RADIUS);

        if (!rewindHit && currentHit) {
          log('BULLET_REWIND_MISS', {
            room: this.id,
            bullet: bullet.id,
            target: playerId,
            owner: bullet.ownerId,
            rewound: `${targetX.toFixed(1)},${targetY.toFixed(1)}`,
            current: `${player.x.toFixed(1)},${player.y.toFixed(1)}`,
            rewindTimeMs,
            shooterLatency,
            playerHp: player.hp,
          });
        }

        if (rewindHit) {
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
          
          this.applyExplosion(bullet, targetX, targetY);
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
      .map((p) => p.toState(this.tick));
    
    const snapshotBullets = this.bullets.map(({ spawnAt, damage, isGrenade, explodeTick, targetX, targetY, ...b }) => ({
      ...b,
      clientShotId: b.clientShotId, // 传递客户端发射ID
      weaponTypeId: b.weaponTypeId, // 传递武器类型ID（用于客户端渲染样式）
      bulletLifeMs: b.bulletLifeMs, // 传递子弹生命周期（用于客户端TTL判断）
      targetX,
      targetY,
    }));

    // 日志：记录快照中的手雷
    const grenadeCount = snapshotBullets.filter(b => b.weaponTypeId === 'frag_grenade' || b.weaponTypeId === 'w_grenade_launcher').length;
    if (grenadeCount > 0) {
      console.log('[Room] Snapshot包含手雷:', grenadeCount, '总子弹数:', snapshotBullets.length);
    }

    return {
      players: visiblePlayers,
      // Step4: 映射内部Bullet类型到BULLET_STATE（去掉spawnAt和damage字段，保留clientShotId和weaponTypeId）
      bullets: snapshotBullets,
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
      const autoEquipItem = player.createItemInstance(nearestWorldItem.typeId, nearestWorldItem.qty);
      if (this.tryAutoEquipItem(playerId, player, autoEquipItem)) {
        this.worldItems.delete(nearestWid);
        log('PICKUP_WORLD_ITEM', {
          room: this.id,
          player: playerId,
          wid: nearestWid,
          typeId: nearestWorldItem.typeId,
          qty: nearestWorldItem.qty,
          tick: this.tick,
        });
        return true;
      }

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
        if (this.tryAutoEquipItem(playerId, player, item)) {
          pickedAny = true;
          continue;
        }

        const result = player.addItem(item.typeId, item.qty);
        if (result.success && result.added === item.qty) {
          pickedAny = true;
        } else if (result.success && result.added > 0) {
          const remainingQty = item.qty - result.added;
          if (remainingQty > 0) {
            remainingItems.push({
              iid: item.iid,
              typeId: item.typeId,
              qty: remainingQty,
            });
          }
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

    // ✅ 关键：只有在玩家 phase 为 'RAID' 时才处理死亡（防止旧实体误触发）
    const profile = this.profileManager.getProfileData(accountId);
    if (profile.phase !== 'RAID') {
      log('DEATH_SKIP_NOT_IN_RAID', {
        room: this.id,
        player: playerId,
        accountId,
        phase: profile.phase,
        tick: this.tick,
      });
      return { success: false };
    }

    // 计算损失的金钱（prep 物品的价值，但 prep 已经在进入战局时移到 inventory 了）
    // 所以这里计算的是 inventory 中物品的价值
    let moneyLost = 0;
    const droppedItems = player.clearInventory();
    if (player.equippedWeaponItem) droppedItems.push(player.equippedWeaponItem);
    if (player.equippedBagItem) droppedItems.push(player.equippedBagItem);
    if (player.equippedArmorItem) droppedItems.push(player.equippedArmorItem);
    player.equippedWeaponItem = null;
    player.equippedBagItem = null;
    player.equippedArmorItem = null;
    player.equippedBagTypeId = null;
    player.equippedArmorTypeId = null;
    player.armorReduction = 0;
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
    // profile 已在上面定义，直接使用
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

    const accountId = this.playerToAccount.get(playerId) ?? playerId;

    // ✅ 关键：只有在玩家 phase 为 'RAID' 时才处理撤离（防止旧实体误触发）
    const profile = this.profileManager.getProfileData(accountId);
    if (profile.phase !== 'RAID') {
      log('EXTRACT_SKIP_NOT_IN_RAID', {
        room: this.id,
        player: playerId,
        accountId,
        phase: profile.phase,
        tick: this.tick,
      });
      return { success: false };
    }

    const items = [...player.inventory.items];
    let moneyGained = 0;

    if (items.length > 0) {
      // profile 已在上面定义，直接使用
      const existingIids = new Set([
        ...profile.stash.map(item => item.iid),
        ...profile.prep.map(item => item.iid),
      ]);
      const itemsToStash = items.filter(item => !existingIids.has(item.iid));
      if (itemsToStash.length > 0) {
        // 使用 accountId 保存到正确的 Profile
        this.profileManager.addToStash(accountId, itemsToStash);
      }
      
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

    // 同步局内装备到档案（装备不占背包格）
    // profile 已在上面定义，直接使用
    const equippedItems: ItemInstance[] = [];
    if (player.equippedWeaponItem) equippedItems.push(player.equippedWeaponItem);
    if (player.equippedBagItem) equippedItems.push(player.equippedBagItem);
    if (player.equippedArmorItem) equippedItems.push(player.equippedArmorItem);

    if (equippedItems.length > 0) {
      const missing = equippedItems.filter(
        (item) => !profile.stash.some((s) => s.iid === item.iid) && !profile.prep.some((p) => p.iid === item.iid)
      );
      if (missing.length > 0) {
        this.profileManager.addToStash(accountId, missing);
      }
    }

    this.profileManager.equipItem(accountId, 'weapon', player.equippedWeaponItem?.iid ?? null);
    this.profileManager.equipItem(accountId, 'bag', player.equippedBagItem?.iid ?? null);
    this.profileManager.equipItem(accountId, 'armor', player.equippedArmorItem?.iid ?? null);

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
    
    const autoEquipItem = player.createItemInstance(worldItem.typeId, worldItem.qty);
    if (this.tryAutoEquipItem(playerId, player, autoEquipItem)) {
      this.worldItems.delete(wid);
      return { success: true };
    }

    const result = player.addItem(worldItem.typeId, worldItem.qty);
    if (result.success) {
      this.worldItems.delete(wid);
      const itemType = getItemType(worldItem.typeId);
      this.pushEvent(`Player ${playerId} picked up ${itemType.name} x${result.added}`);
      return { success: true };
    }
    return { success: false, message: 'Inventory full' };
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
      if (this.tryAutoEquipItem(playerId, player, item)) {
        pickedAny = true;
        continue;
      }

      const result = player.addItem(item.typeId, item.qty);
      if (result.success && result.added === item.qty) {
        pickedAny = true;
      } else if (result.success && result.added > 0) {
        const remainingQty = item.qty - result.added;
        if (remainingQty > 0) {
          remainingItems.push({
            iid: item.iid,
            typeId: item.typeId,
            qty: remainingQty,
          });
        }
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
    const bags: LootBag[] = [];
    for (const [bid, bag] of this.lootBags.entries()) {
      const filteredItems = bag.items.filter((item) => item.qty > 0);
      if (filteredItems.length === 0) {
        this.lootBags.delete(bid);
        continue;
      }
      if (filteredItems.length !== bag.items.length) {
        bag.items = filteredItems;
      }
      bags.push(bag);
    }
    return bags;
  }
  
  // 新增: 获取并清空战斗事件队列（供 server 广播使用）
  drainCombatEvents(): Map<string, Array<{ kind: 'DRY_FIRE' | 'HIT' | 'DAMAGE_TAKEN'; direction?: number }>> {
    const events = new Map(this.combatEvents);
    this.combatEvents.clear();
    return events;
  }

  // 新增: 获取并清空近战挥击事件（广播用）
  drainMeleeSwings(): Array<{ playerId: string; x: number; y: number; aimRad: number; range: number; arcRad: number }> {
    const swings = [...this.meleeSwings];
    this.meleeSwings = [];
    return swings;
  }

  // 新增: 获取并清空爆炸事件（广播用）
  drainExplosions(): Array<{ x: number; y: number; radius: number }> {
    const explosions = [...this.explosions];
    this.explosions = [];
    return explosions;
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
      const autoEquipItem = player.createItemInstance(nearestWorldItem.typeId, nearestWorldItem.qty);
      if (this.tryAutoEquipItem(playerId, player, autoEquipItem)) {
        this.worldItems.delete(nearestWid);
        log('AUTO_PICKUP_WORLD', {
          room: this.id,
          player: playerId,
          wid: nearestWid,
          typeId: nearestWorldItem.typeId,
          qty: nearestWorldItem.qty,
          dist: nearestWorldDist.toFixed(1),
          tick: this.tick,
        });
        return { success: true, target: `world:${nearestWid}` };
      }

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
      }
      return { success: false, message: 'Inventory full' };
    }
    
    // 拾取掉落包
    if (nearestBag && nearestBid) {
      const remainingItems: typeof nearestBag.items = [];
      let pickedAny = false;
      
      for (const item of nearestBag.items) {
        if (this.tryAutoEquipItem(playerId, player, item)) {
          pickedAny = true;
          continue;
        }

        const result = player.addItem(item.typeId, item.qty);
        if (result.success && result.added === item.qty) {
          pickedAny = true;
        } else if (result.success && result.added > 0) {
          const remainingQty = item.qty - result.added;
          if (remainingQty > 0) {
            remainingItems.push({
              iid: item.iid,
              typeId: item.typeId,
              qty: remainingQty,
            });
          }
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

  // 新增: 使用物品（快捷栏1-5键）
  handleUseItem(playerId: string, slot: number): { success: boolean; message?: string; itemType?: string } {
    const player = this.players.get(playerId);
    if (!player || player.status !== 'ALIVE') {
      return { success: false, message: 'Player not alive' };
    }

    // 获取可使用的物品列表（医疗包和投掷物）
    const usableItems = player.inventory.items.filter(item => {
      try {
        const itemType = getItemType(item.typeId);
        return item.typeId === 'medkit' || item.typeId === 'frag_grenade';
      } catch {
        return false;
      }
    });

    // 检查槽位是否有效
    if (slot < 1 || slot > 5 || slot > usableItems.length) {
      return { success: false, message: 'Invalid slot or no item' };
    }

    const item = usableItems[slot - 1];
    
    try {
      const itemType = getItemType(item.typeId);
      
      if (item.typeId === 'medkit') {
        // 使用医疗包：恢复生命值
        if (player.hp >= 100) {
          return { success: false, message: 'Already at full health' };
        }
        
        const healAmount = Math.min(50, 100 - player.hp); // 恢复50点生命值，但不超过100
        player.hp += healAmount;
        
        // 消耗一个医疗包
        const removed = player.removeItem(item.iid, 1);
        if (!removed) {
          return { success: false, message: 'Failed to consume item' };
        }
        
        // 清理背包中可能的无效物品
        player.cleanupInventory();
        
        this.pushEvent(`Player ${playerId} used medkit (+${healAmount} HP)`);
        log('USE_MEDKIT', {
          room: this.id,
          player: playerId,
          healAmount,
          newHp: player.hp,
          tick: this.tick,
        });
        
        return { success: true, itemType: 'medkit' };
        
      } else if (item.typeId === 'frag_grenade') {
        // 手雷不能通过快捷栏直接使用，需要通过投掷系统
        return { success: false, message: 'Use number key to aim and throw grenade' };
      }
      
      return { success: false, message: 'Item not usable' };
      
    } catch (err) {
      return { success: false, message: 'Unknown item type' };
    }
  }

  // 新增: 投掷物品（手雷等）
  handleThrow(playerId: string, targetX: number, targetY: number, itemType: string): { success: boolean; message?: string } {
    const player = this.players.get(playerId);
    if (!player || player.status !== 'ALIVE') {
      return { success: false, message: 'Player not alive' };
    }

    // 检查是否有对应的投掷物
    const grenadeItem = player.inventory.items.find(item => item.typeId === itemType);
    if (!grenadeItem) {
      return { success: false, message: 'No grenade available' };
    }

    // 检查投掷距离（最大350像素，比客户端稍宽松）
    const dx = targetX - player.x;
    const dy = targetY - player.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance > 350) { // 增加50像素容错
      return { success: false, message: 'Target too far' };
    }

    // 消耗一个手雷
    const removed = player.removeItem(grenadeItem.iid, 1);
    if (!removed) {
      return { success: false, message: 'Failed to consume grenade' };
    }

    // 清理背包中可能的无效物品
    player.cleanupInventory();

    // 创建投掷物轨迹（类似子弹，但有抛物线轨迹和延时爆炸）
    const grenadeId = `grenade_${this.tick}_${Math.random().toString(36).substr(2, 9)}`;
    
    // 计算投掷速度（基于距离和重力，确保1秒后到达目标）
    const flightTime = 1.0; // 1秒飞行时间
    const vx = dx / flightTime;
    const vy = dy / flightTime;
    
    // 创建手雷子弹（使用特殊的手雷子弹类型）
    const grenadeBullet: Bullet = {
      id: grenadeId,
      x: player.x,
      y: player.y,
      vx: vx,
      vy: vy,
      ownerId: playerId,
      spawnAt: Date.now(),
      damage: 80, // 手雷基础伤害
      bulletLifeMs: 3000, // 3秒后爆炸
      weaponTypeId: 'frag_grenade', // 用于客户端渲染识别
      isGrenade: true, // 标记为手雷
      explodeTick: this.tick + msToTicks(3000), // 3秒后爆炸
      targetX: targetX,
      targetY: targetY,
      spawnX: player.x,
      spawnY: player.y,
    };

    // 添加到子弹列表（复用子弹系统）
    this.bullets.push(grenadeBullet);

    this.pushEvent(`Player ${playerId} threw grenade`);
    log('THROW_GRENADE', {
      room: this.id,
      player: playerId,
      targetX,
      targetY,
      distance: Math.round(distance),
      tick: this.tick,
    });

    return { success: true };
  }
}
