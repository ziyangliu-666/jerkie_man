import { Player } from './player.js';
import { ProfileManager } from './profile.js';
import type { PLAYER_STATE, BULLET_STATE, ITEM_STATE, C2S_INPUT, MAP_CONFIG, OBSTACLE_STATE, WorldItem, LootBag, ItemInstance, WeaponRuntime, WeaponDef, MapTemplate, SpawnPoint, AI_STATE, AISpawn } from '@jerkie-man/shared';
import { loadMapConfig, loadItemTypes, circleVsAABB, createRng, rectIntersects, segmentIntersectsCircle, getItemType, getAllItemTypes, getItemTypesByRarity, getWeaponDef, getArmorDef, getBagDef, applySpread, msToTicks, getFireSchedule, shouldStartBurst, canFireTick, advanceFireCooldown, PLAYER_HIT_RADIUS, getBulletPenetration, isObstacleDestructible, isUsableItem, doesObstacleBlockPlayer, AI_ROLE_PRESETS } from '@jerkie-man/shared';
import { log } from './logger.js';
import { AI, type PatrolConfig, type GuardConfig } from './ai.js';
import { NavigationGrid, Pathfinder } from './pathfinding.js';
import { AIBehaviorController } from './aiBehavior.js';

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
  private aiIdCounter = 0;
  private worldItemIdCounter = 0;
  private smokeIdCounter = 0; // 新增: 烟雾ID计数器
  private lootBagIdCounter = 0;
  private events: Array<{ tick: number; timestamp: number; message: string }> = [];
  private readonly MAX_EVENTS = 50;
  private readonly PICKUP_RADIUS = 40;
  public raidResults: Map<string, { result: 'EXTRACTED' | 'DIED'; accountId: string; loot?: ItemInstance[]; moneyGained?: number; moneyLost?: number }> = new Map();
  public combatEvents: Map<string, Array<{ kind: 'DRY_FIRE' | 'HIT' | 'DAMAGE_TAKEN'; direction?: number }>> = new Map();
  public meleeSwings: Array<{ playerId: string; x: number; y: number; aimRad: number; range: number; arcRad: number }> = [];
  public explosions: Array<{ x: number; y: number; radius: number }> = [];
  private smokes: Array<{ id: string; x: number; y: number; radius: number; durationMs: number; createdAt: number }> = [];
  private newSmokes: Array<{ id: string; x: number; y: number; radius: number; durationMs: number }> = []; // 新生成的烟雾（用于广播）

  // AI系统字段
  public ais: Map<string, AI> = new Map();
  private navGrid!: NavigationGrid;
  private pathfinder!: Pathfinder;
  private aiBehaviorController!: AIBehaviorController;

  // 重刷系统字段
  private mapTemplate?: MapTemplate; // 保存地图模板引用
  private lastItemRespawnTick: number = 0; // 上次物品重刷的tick
  private lastAIRespawnTick: number = 0; // 上次AI重刷的tick
  private aiSpawnMap: Map<string, AISpawn> = new Map(); // AI spawn点映射（用于重刷）

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
    this.mapTemplate = mapTemplate; // 保存模板引用用于重刷
    this.spawnPoints = mapTemplate?.spawns ? mapTemplate.spawns.map((s) => ({ ...s })) : [];

    this.tick = 0;

    if (mapTemplate) {
      this.obstacles = mapTemplate.obstacles.map((obs, idx) => ({ 
        ...obs,
        id: obs.id || `obs_${idx}` // 防御性逻辑：确保从模板加载的障碍物也有唯一ID
      }));
    } else {
      this.generateObstacles();
    }

    this.generateWorldItems(30);

    // 初始化AI系统
    this.navGrid = new NavigationGrid(
      this.mapConfig.width,
      this.mapConfig.height,
      this.obstacles,
      20
    );
    this.pathfinder = new Pathfinder(this.navGrid);
    this.aiBehaviorController = new AIBehaviorController(this, this.pathfinder);

    // 从地图模板生成AI（如果有）
    if (mapTemplate?.aiSpawns) {
      // 建立AI spawn点映射（用于重刷时查找）
      for (let i = 0; i < mapTemplate.aiSpawns.length; i++) {
        const aiSpawn = mapTemplate.aiSpawns[i];
        // 为每个spawn点生成唯一ID（如果没有的话）
        const spawnId = `spawn_${i}`;
        this.aiSpawnMap.set(spawnId, aiSpawn);
      }
      this.spawnAIsFromTemplate(mapTemplate);
    }
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

  // 根据配置选择一个物品类型（支持 itemIds 白名单和稀有度权重）
  private pickItemTypeForSpawn(
    rng: () => number,
    allItemTypes = getAllItemTypes(),
    config?: { itemIds?: string[]; rarityWeights?: { COMMON?: number; RARE?: number; EPIC?: number } }
  ) {
    let pool = allItemTypes;

    // 如果有 itemIds 白名单，先过滤
    if (config?.itemIds && config.itemIds.length > 0) {
      const idSet = new Set(config.itemIds);
      pool = allItemTypes.filter((it) => idSet.has(it.id));
    }

    if (pool.length === 0) {
      // 兜底：回退到所有物品
      pool = allItemTypes;
    }

    const commonItems = pool.filter((it) => it.rarity === 'COMMON');
    const rareItems = pool.filter((it) => it.rarity === 'RARE');
    const epicItems = pool.filter((it) => it.rarity === 'EPIC');

    // 默认权重：60/30/10
    const wCommon = config?.rarityWeights?.COMMON ?? 60;
    const wRare = config?.rarityWeights?.RARE ?? 30;
    const wEpic = config?.rarityWeights?.EPIC ?? 10;
    const totalW = wCommon + wRare + wEpic;

    if (totalW <= 0) {
      // 权重非法时，回退到均匀随机
      return pool[Math.floor(rng() * pool.length)];
    }

    const roll = rng() * totalW;
    let acc = 0;

    acc += wCommon;
    if (roll < acc && commonItems.length > 0) {
      return commonItems[Math.floor(rng() * commonItems.length)];
    }

    acc += wRare;
    if (roll < acc && rareItems.length > 0) {
      return rareItems[Math.floor(rng() * rareItems.length)];
    }

    if (epicItems.length > 0) {
      return epicItems[Math.floor(rng() * epicItems.length)];
    }

    // 如果某个稀有度池子是空的，回退到整体池子
    return pool[Math.floor(rng() * pool.length)];
  }

  // 使用单条物资规则在地图上尝试生成一个物资
  private spawnOneWorldItemWithConfig(
    rng: () => number,
    config: {
      zoneId?: string;
      itemIds?: string[];
      rarityWeights?: { COMMON?: number; RARE?: number; EPIC?: number };
      maxItems?: number;
      ruleId?: string;
    }
  ): void {
    const minDistance = 32;

    let zoneBounds: { x: number; y: number; w: number; h: number } | undefined;
    if (config.zoneId && this.mapTemplate?.zones) {
      const zone = this.mapTemplate.zones.find((z) => z.id === config.zoneId);
      if (zone) {
        zoneBounds = { x: zone.x, y: zone.y, w: zone.w, h: zone.h };
      }
    }

    // 计算当前该规则“作用区域”内已经存在的物资数量（有 zoneId 则按区域统计，没 zoneId 则全图统计）
    if (config.maxItems && config.maxItems > 0) {
      let currentInRegion = 0;
      if (zoneBounds) {
        for (const existing of this.worldItems.values()) {
          if (
            existing.x >= zoneBounds.x &&
            existing.x <= zoneBounds.x + zoneBounds.w &&
            existing.y >= zoneBounds.y &&
            existing.y <= zoneBounds.y + zoneBounds.h
          ) {
            currentInRegion++;
          }
        }
      } else {
        currentInRegion = this.worldItems.size;
      }
      if (currentInRegion >= config.maxItems) {
        return;
      }
    }

    let attempts = 0;
    let x: number, y: number;
    let valid = false;

    while (!valid && attempts < 50) {
      if (zoneBounds) {
        x = zoneBounds.x + rng() * zoneBounds.w;
        y = zoneBounds.y + rng() * zoneBounds.h;
      } else {
        x = rng() * this.mapConfig.width;
        y = rng() * this.mapConfig.height;
      }

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

    if (!valid) return;

    const itemType = this.pickItemTypeForSpawn(rng, undefined, {
      itemIds: config.itemIds,
      rarityWeights: config.rarityWeights,
    });

    const wid = `wid_${this.seed}_${this.worldItemIdCounter++}_${rng()
      .toString(36)
      .substring(2, 11)}`;
    const maxSpawnQty = Math.min(3, itemType.stackMax);
    const qty = maxSpawnQty > 1 ? Math.floor(rng() * maxSpawnQty) + 1 : 1;

    this.worldItems.set(wid, {
      wid,
      typeId: itemType.id,
      qty,
      x: x!,
      y: y!,
    });

    // 调试日志：记录每次刷新的位置与规则
    log('WORLD_ITEM_SPAWNED', {
      room: this.id,
      ruleId: config.ruleId ?? 'unknown',
      zoneId: config.zoneId ?? 'global',
      typeId: itemType.id,
      x: x!,
      y: y!,
      totalWorldItems: this.worldItems.size,
      tick: this.tick,
    });
  }

  // 新增: 生成世界物品（使用新的物品系统，支持多条地图配置）
  private generateWorldItems(count: number): void {
    const itemsRng = createRng(this.seed + 2000000);

    const configs = this.mapTemplate?.itemRespawns ?? [];
    // 仅用于初始生成的规则：mode=initial 或 both
    const initialConfigs = configs.filter((c) => c.mode === 'initial' || c.mode === 'both');

    // 如果地图没写规则，回退到一个默认规则，等价于旧行为
    const effectiveConfigs =
      initialConfigs.length > 0
        ? initialConfigs
        : [
            {
              ruleId: 'default_initial',
              zoneId: undefined,
              itemIds: undefined,
              rarityWeights: undefined,
              maxItems: undefined,
            },
          ];

    for (let i = 0; i < count; i++) {
      const cfg =
        effectiveConfigs[Math.floor(itemsRng() * effectiveConfigs.length)];
      this.spawnOneWorldItemWithConfig(itemsRng, cfg);
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

    // 障碍物类型权重（根据游戏平衡调整）
    const obstacleTypes = [
      { type: 'wall', weight: 20, minSize: 60, maxSize: 150 },      // 石墙：适中，大型
      { type: 'crate', weight: 30, minSize: 30, maxSize: 60 },      // 木箱：常见，小型
      { type: 'bush', weight: 35, minSize: 50, maxSize: 120 },      // 草丛：很多，中型
      { type: 'water', weight: 10, minSize: 80, maxSize: 200 },     // 水域：少量，大型
    ];

    const totalWeight = obstacleTypes.reduce((sum, t) => sum + t.weight, 0);
    const count = 20 + Math.floor(rng() * 21); // 20-40 个障碍物
    const minDistance = 50; // 障碍物之间最小距离
    const playerSpawnRadius = 100; // 玩家出生区域范围，避免障碍物

    let obstacleIdCounter = 0;
    
    for (let i = 0; i < count; i++) {
      let attempts = 0;
      let x: number, y: number, w: number, h: number;
      let selectedType: typeof obstacleTypes[0];
      let valid = false;

      // 随机选择障碍物类型（基于权重）
      const randomWeight = rng() * totalWeight;
      let weightSum = 0;
      selectedType = obstacleTypes[0]; // fallback
      for (const obsType of obstacleTypes) {
        weightSum += obsType.weight;
        if (randomWeight <= weightSum) {
          selectedType = obsType;
          break;
        }
      }

      // 随机生成位置和大小，避免重叠、避开玩家出生点和撤离区
      while (!valid && attempts < 100) {
        w = selectedType.minSize + rng() * (selectedType.maxSize - selectedType.minSize);
        h = selectedType.minSize + rng() * (selectedType.maxSize - selectedType.minSize);
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
        const obstacleId = `obs_${this.seed}_${obstacleIdCounter++}`;
        const obstacle: any = {
          id: obstacleId,
          x: x!,
          y: y!,
          w: w!,
          h: h!,
          type: selectedType.type,
        };

        // 为可破坏物体添加HP
        if (selectedType.type === 'crate') {
          obstacle.hp = 100;
          obstacle.maxHp = 100;
        }

        this.obstacles.push(obstacle);
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
          if (player.extractProgress >= 10000) {
            // 进度满了，撤离成功（10秒）
            const accountId = this.playerToAccount.get(playerId) ?? playerId;
            const profile = this.profileManager.getProfileData(accountId);

            log('EXTRACT_START', {
              room: this.id,
              player: playerId,
              accountId,
              phase: profile.phase,
              inventoryItems: player.inventory.items.length,
              loot: player.lootCount,
              pos: `(${player.x.toFixed(1)},${player.y.toFixed(1)})`,
              tick: this.tick,
            });

            player.status = 'EXTRACTED';
            player.extractProgress = 0;

            // 新增: 处理玩家撤离（inventory -> stash）
            const extractResult = this.handlePlayerExtract(playerId);

            log('EXTRACT_COMPLETE', {
              room: this.id,
              player: playerId,
              accountId,
              success: extractResult.success ? 'true' : 'false',
              lootItems: extractResult.loot?.length ?? 0,
              moneyGained: extractResult.moneyGained ?? 0,
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

  // 修改: 检查玩家是否在草丛内，并返回草丛ID
  private isPlayerInBush(x: number, y: number): string | null {
    const PLAYER_RADIUS = 10;
    for (const obstacle of this.obstacles) {
      const obsType = (obstacle as any).type || 'wall';
      if (obsType === 'bush') {
        // 使用圆形与AABB碰撞检测
        if (circleVsAABB(x, y, PLAYER_RADIUS, obstacle)) {
          return (obstacle as any).id || 'bush_unknown';
        }
      }
    }
    return null;
  }

  // 修改: 检查某个点是否在烟雾内，并返回烟雾ID
  public isPointInSmoke(x: number, y: number): string | null {
    for (const smoke of this.smokes) {
      // 检查玩家是否在烟雾圆形区域内
      const dx = x - smoke.x;
      const dy = y - smoke.y;
      const distSq = dx * dx + dy * dy;
      if (distSq < smoke.radius * smoke.radius) {
        return smoke.id;
      }
    }
    return null;
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

    // 新增: 如果正在读条使用道具（例如急救包），本 tick 不处理任何行动
    if (player.isUsingItem(this.tick)) {
      return;
    }

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
        
        // 近战武器统一使用近战判定逻辑（拳头、链锯等）
        if (weaponDef.weaponKind === 'melee') {
          // 近战攻击：检测范围内是否有敌人/AI/可破坏障碍物
          const baseRange = weaponDef.meleeRange ?? 35; // 近战范围（像素）
          const baseArcRad = ((weaponDef.meleeArcDeg ?? 60) * Math.PI) / 180; // 扇形角度（弧度）
          const hitRadius = PLAYER_HIT_RADIUS; // 目标半径（用于边缘命中修正）
          const meleeRange = baseRange;
          const meleeArcRad = baseArcRad;
          const visualRange = baseRange;
          const visualArcRad = baseArcRad;
          let hitPlayer: Player | null = null;
          let hitAI: AI | null = null;
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
          
          // 先检测玩家
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
                hitPlayer = target;
                minDist = dist;
              }
            }
          }
          
          // 再检测AI（如果还没命中玩家）
          if (!hitPlayer) {
            for (const [aiId, ai] of this.ais.entries()) {
              if (ai.status !== 'ALIVE') continue;
              
              const dx = ai.x - player.x;
              const dy = ai.y - player.y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              
              if (dist <= meleeRange + hitRadius && dist < minDist) {
                // 检查是否在瞄准方向
                const aimDir = Math.atan2(dy, dx);
                const aimDiff = Math.abs(aimDir - input.aim);
                const normalizedDiff = Math.min(aimDiff, Math.PI * 2 - aimDiff);
                const extraAngle = dist > 0.001 ? Math.asin(Math.min(1, hitRadius / dist)) : 0;
                if (normalizedDiff < meleeArcRad / 2 + extraAngle) {
                  hitAI = ai;
                  minDist = dist;
                }
              }
            }
          }
          
          if (hitPlayer || hitAI) {
            // 命中！造成伤害
            const damage = weaponDef.damage;
            
            if (hitPlayer) {
              // 攻击玩家
              hitPlayer.takeDamage(damage);
              const isDead = hitPlayer.hp <= 0;
              
              if (isDead) {
                hitPlayer.killedBy = player.name || playerId;
                hitPlayer.killedByWeaponName = weaponDef.name;
                this.handlePlayerDeath(hitPlayer.id);
              }
              
              // 给被攻击者发送受伤事件
              if (!this.combatEvents.has(hitPlayer.id)) {
                this.combatEvents.set(hitPlayer.id, []);
              }
              const dx = hitPlayer.x - player.x;
              const dy = hitPlayer.y - player.y;
              const direction = Math.atan2(dy, dx);
              this.combatEvents.get(hitPlayer.id)!.push({ kind: 'DAMAGE_TAKEN', direction });
              
              // 推送命中事件
              this.pushEvent(`${playerId} melee hit ${hitPlayer.id} (-${damage})`);
            } else if (hitAI) {
              // 攻击AI
              hitAI.takeDamage(damage, player.x, player.y);
              const isDead = hitAI.hp <= 0;
              
              if (isDead) {
                this.handleAIDeath(hitAI.id);
              }
              
              // 推送命中事件
              this.pushEvent(`${playerId} melee hit AI ${hitAI.id} (-${damage})`);
              
              log('AI_MELEE_HIT', {
                room: this.id,
                ai: hitAI.id,
                attacker: playerId,
                damage: damage,
                aiHpRemaining: hitAI.hp,
                tick: this.tick,
              });
            }
            
            // 给攻击者发送命中事件
            if (!this.combatEvents.has(playerId)) {
              this.combatEvents.set(playerId, []);
            }
            this.combatEvents.get(playerId)!.push({ kind: 'HIT' });
          } else {
            // 没有命中玩家，检查是否命中可破坏障碍物
            for (const obstacle of this.obstacles) {
              const obsType = (obstacle as any).type || 'wall';
              if (!isObstacleDestructible(obsType)) continue;
              
              // 检查障碍物是否在攻击范围内
              const obsCenterX = obstacle.x + obstacle.w / 2;
              const obsCenterY = obstacle.y + obstacle.h / 2;
              const dx = obsCenterX - player.x;
              const dy = obsCenterY - player.y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              
              if (dist <= meleeRange + Math.max(obstacle.w, obstacle.h) / 2) {
                // 检查是否在瞄准方向
                const aimDir = Math.atan2(dy, dx);
                const aimDiff = Math.abs(aimDir - input.aim);
                const normalizedDiff = Math.min(aimDiff, Math.PI * 2 - aimDiff);
                
                if (normalizedDiff < meleeArcRad / 2) {
                  // 命中障碍物！造成伤害
                  const obstacleHp = (obstacle as any).hp ?? Infinity;
                  const damage = weaponDef.damage;
                  const newHp = Math.max(0, obstacleHp - damage);
                  (obstacle as any).hp = newHp;
                  
                  log('MELEE_OBSTACLE_DAMAGE', {
                    room: this.id,
                    playerId,
                    obstacleId: (obstacle as any).id ?? 'unknown',
                    obstacleType: obsType,
                    damage,
                    oldHp: obstacleHp,
                    newHp,
                    destroyed: newHp <= 0 ? 'true' : 'false',
                    tick: this.tick,
                  });
                  
                  // 给攻击者发送命中事件
                  if (!this.combatEvents.has(playerId)) {
                    this.combatEvents.set(playerId, []);
                  }
                  this.combatEvents.get(playerId)!.push({ kind: 'HIT' });
                  
                  break; // 只命中一个障碍物
                }
              }
            }
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

      if (isDead) {
        const attacker = this.players.get(bullet.ownerId);
        if (attacker) {
          player.killedBy = attacker.name || bullet.ownerId;
          player.killedByWeaponName = weaponDef.name;
        }
      }
    }

    // 对范围内的AI造成伤害
    for (const [aiId, ai] of this.ais.entries()) {
      if (ai.status !== 'ALIVE') continue;
      const dx = ai.x - x;
      const dy = ai.y - y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > radius) continue;

      const scaledDamage = Math.floor(explosionDamage * (1 - dist / radius));
      if (scaledDamage <= 0) continue;
      const finalDamage = Math.floor(scaledDamage * (1 - ai.armorReduction));
      if (finalDamage <= 0) continue;

      const oldHp = ai.hp;
      // 传递爆炸位置作为攻击者位置，让AI能够响应
      const attacker = this.players.get(bullet.ownerId);
      ai.takeDamage(finalDamage, attacker ? attacker.x : x, attacker ? attacker.y : y);
      const isDead = ai.hp <= 0;

      if (isDead) {
        this.handleAIDeath(aiId);
      }

      // 发送战斗事件
      if (bullet.ownerId) {
        if (!this.combatEvents.has(bullet.ownerId)) {
          this.combatEvents.set(bullet.ownerId, []);
        }
        this.combatEvents.get(bullet.ownerId)!.push({ kind: 'HIT' });
      }

      log('AI_EXPLOSION_HIT', {
        room: this.id,
        ai: aiId,
        shooter: bullet.ownerId || 'unknown',
        damage: finalDamage,
        aiHpRemaining: ai.hp,
        distance: Math.round(dist),
        tick: this.tick,
      });
    }
  }

  // 新增: 创建手雷爆炸（不依赖武器定义）
  private createExplosion(x: number, y: number, radius: number, damage: number = 500, ownerId?: string): void {
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

    // 对范围内的可破坏障碍物造成伤害
    for (const obstacle of this.obstacles) {
      const obsType = (obstacle as any).type || 'wall';
      if (!isObstacleDestructible(obsType)) continue;

      // 检查障碍物中心点是否在爆炸范围内
      const obsCenterX = obstacle.x + obstacle.w / 2;
      const obsCenterY = obstacle.y + obstacle.h / 2;
      const dx = obsCenterX - x;
      const dy = obsCenterY - y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > radius) continue;

      // 距离越近伤害越高
      const scaledDamage = Math.floor(damage * (1 - dist / radius));
      if (scaledDamage <= 0) continue;

      const obstacleHp = (obstacle as any).hp ?? Infinity;
      const obstacleMaxHp = (obstacle as any).maxHp ?? Infinity;
      const newHp = Math.max(0, obstacleHp - scaledDamage);
      (obstacle as any).hp = newHp;

      log('EXPLOSION_OBSTACLE_DAMAGE', {
        room: this.id,
        obstacleId: (obstacle as any).id ?? 'unknown',
        obstacleType: obsType,
        scaledDamage,
        oldHp: obstacleHp,
        newHp,
        maxHp: obstacleMaxHp,
        destroyed: newHp <= 0 ? 'true' : 'false',
        distance: Math.round(dist),
        tick: this.tick,
      });

      // HP为0时会在 updateBullets 结束时清理
    }

    // 对范围内的AI造成伤害
    for (const [aiId, ai] of this.ais.entries()) {
      if (ai.status !== 'ALIVE') continue;
      
      const dx = ai.x - x;
      const dy = ai.y - y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > radius) continue;

      // 距离越近伤害越高
      const scaledDamage = Math.floor(damage * (1 - dist / radius));
      if (scaledDamage <= 0) continue;
      
      // 应用防具减伤
      const finalDamage = Math.floor(scaledDamage * (1 - ai.armorReduction));
      if (finalDamage <= 0) continue;

      const oldHp = ai.hp;
      // 传递爆炸位置作为攻击者位置，让AI能够响应
      const attacker = ownerId ? this.players.get(ownerId) : null;
      ai.takeDamage(finalDamage, attacker ? attacker.x : x, attacker ? attacker.y : y);
      const isDead = ai.hp <= 0;

      if (isDead) {
        this.handleAIDeath(aiId);
      }

      // 发送战斗事件（如果有投掷者）
      if (ownerId) {
        if (!this.combatEvents.has(ownerId)) {
          this.combatEvents.set(ownerId, []);
        }
        this.combatEvents.get(ownerId)!.push({ kind: 'HIT' });
      }

      log('AI_GRENADE_EXPLOSION_HIT', {
        room: this.id,
        owner: ownerId || 'unknown',
        target: aiId,
        tick: this.tick,
        baseDamage: damage,
        scaledDamage,
        armorReduction: ai.armorReduction,
        finalDamage,
        hp: `${oldHp}->${ai.hp}`,
        distance: Math.round(dist),
      });
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

  // 辅助函数：获取手雷属性
  private getGrenadeProps(weaponTypeId: string): {
    explosionRadius?: number;
    damage?: number;
    smokeRadius?: number;
    smokeDurationMs?: number;
    flashRadius?: number;
    flashDurationMs?: number;
  } {
    try {
      const itemType = getItemType(weaponTypeId);
      return itemType.consumableProps ?? {};
    } catch {
      return {};
    }
  }

  // 新增: 闪光弹爆炸（致盲范围内玩家）
  private createFlashbang(x: number, y: number, radius: number, durationMs: number, ownerId?: string): void {
    const now = Date.now();
    const flashEndTime = now + durationMs;

    // 对范围内所有存活玩家施加致盲效果
    for (const [playerId, player] of this.players.entries()) {
      if (player.status !== 'ALIVE') continue;

      const dx = player.x - x;
      const dy = player.y - y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= radius) {
        // 在范围内，设置致盲时间
        player.flashedUntil = flashEndTime;

        log('FLASHBANG_HIT', {
          room: this.id,
          owner: ownerId || 'unknown',
          target: playerId,
          distance: Math.round(dist),
          durationMs,
          tick: this.tick,
        });
      }
    }

    // 对范围内所有存活的AI施加致盲效果
    for (const [aiId, ai] of this.ais.entries()) {
      if (ai.status !== 'ALIVE') continue;

      const dx = ai.x - x;
      const dy = ai.y - y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= radius) {
        // 在范围内，设置致盲时间
        ai.flashedUntil = flashEndTime;

        log('FLASHBANG_HIT_AI', {
          room: this.id,
          owner: ownerId || 'unknown',
          target: aiId,
          distance: Math.round(dist),
          durationMs,
          tick: this.tick,
        });
      }
    }

    this.pushEvent(`Flashbang exploded at (${Math.round(x)}, ${Math.round(y)})`);
    log('FLASHBANG_EXPLOSION', {
      room: this.id,
      x: Math.round(x),
      y: Math.round(y),
      radius,
      durationMs,
      owner: ownerId || 'unknown',
      tick: this.tick,
    });
  }

  updateBullets(deltaTime: number, playerLatencies: Map<string, number> = new Map()): void {
    const now = Date.now();
    const bulletsToRemove = new Set<string>(); // Step4: 用Set代替O(n^2)

    // 延迟补偿配置
    // 修复: 客户端插值延迟 120ms（getInterpolatedState(180) - 60ms buffer）
    // 服务端必须回溯到"客户端看到的时间点"才能与视觉一致
    const CLIENT_INTERPOLATION_DELAY_MS = 120;
    const MAX_REWIND_MS = 500;
    
    for (const bullet of this.bullets) {
      // 新增: 手雷特殊处理
      if (bullet.isGrenade) {
        // 检查是否到达爆炸时间
        if (this.tick >= (bullet.explodeTick ?? 0)) {
          // 爆炸/生成烟雾！
          if (bullet.weaponTypeId === 'smoke_grenade') {
            // 烟雾弹：不造成伤害，只生成烟雾区域
            const logMsg = `[烟雾弹] 实际爆点（时间到）: (${bullet.x.toFixed(2)}, ${bullet.y.toFixed(2)}), 目标落点: (${bullet.targetX?.toFixed(2) ?? 'N/A'}, ${bullet.targetY?.toFixed(2) ?? 'N/A'})`;
            console.log(logMsg);
            log('SMOKE_GRENADE_EXPLODE_TIMEOUT', {
              room: this.id,
              bulletId: bullet.id,
              actualX: bullet.x.toFixed(2),
              actualY: bullet.y.toFixed(2),
              targetX: bullet.targetX?.toFixed(2) ?? 'N/A',
              targetY: bullet.targetY?.toFixed(2) ?? 'N/A',
              tick: this.tick,
            });
            const props = this.getGrenadeProps(bullet.weaponTypeId);
            const smokeId = `smoke_${this.seed}_${this.smokeIdCounter++}`;
            const smoke = { 
              id: smokeId,
              x: bullet.x, 
              y: bullet.y, 
              radius: props.smokeRadius ?? 140, 
              durationMs: props.smokeDurationMs ?? 15000 
            };
            this.smokes.push({ ...smoke, createdAt: now });
            this.newSmokes.push(smoke);
          } else if (bullet.weaponTypeId === 'flash_grenade') {
            // 闪光弹：致盲范围内玩家
            const props = this.getGrenadeProps(bullet.weaponTypeId);
            const flashRadius = props.flashRadius ?? 150;
            const flashDurationMs = props.flashDurationMs ?? 3000;
            const explosionRadius = props.explosionRadius ?? 150;
            this.createFlashbang(bullet.x, bullet.y, flashRadius, flashDurationMs, bullet.ownerId);
            this.explosions.push({ x: bullet.x, y: bullet.y, radius: explosionRadius });
          } else {
            // 其他手雷：正常爆炸
            const props = this.getGrenadeProps(bullet.weaponTypeId);
            const explosionRadius = props.explosionRadius ?? 100;
            const damage = props.damage ?? 500;
            this.createExplosion(bullet.x, bullet.y, explosionRadius, damage, bullet.ownerId);
          }
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
          const moveDistance = speed * deltaTime;

          if (distToTarget <= moveDistance || speed === 0) {
            // 手雷落地，停在目标位置
            bullet.x = bullet.targetX;
            bullet.y = bullet.targetY;
            bullet.vx = 0;
            bullet.vy = 0;

            // 修复: 烟雾弹/闪光弹一到达目标位置就立即生效
            if (bullet.weaponTypeId === 'smoke_grenade') {
              const logMsg = `[烟雾弹] 实际爆点（到达落点）: (${bullet.x.toFixed(2)}, ${bullet.y.toFixed(2)}), 目标落点: (${bullet.targetX?.toFixed(2) ?? 'N/A'}, ${bullet.targetY?.toFixed(2) ?? 'N/A'})`;
              console.log(logMsg);
              log('SMOKE_GRENADE_EXPLODE_TARGET', {
                room: this.id,
                bulletId: bullet.id,
                actualX: bullet.x.toFixed(2),
                actualY: bullet.y.toFixed(2),
                targetX: bullet.targetX?.toFixed(2) ?? 'N/A',
                targetY: bullet.targetY?.toFixed(2) ?? 'N/A',
                tick: this.tick,
              });
              const props = this.getGrenadeProps(bullet.weaponTypeId);
              const smokeId = `smoke_${this.seed}_${this.smokeIdCounter++}`;
              const smoke = { 
                id: smokeId,
                x: bullet.x, 
                y: bullet.y, 
                radius: props.smokeRadius ?? 140, 
                durationMs: props.smokeDurationMs ?? 15000 
              };
              this.smokes.push({ ...smoke, createdAt: now });
              this.newSmokes.push(smoke);
              bulletsToRemove.add(bullet.id);
              continue;
            } else if (bullet.weaponTypeId === 'flash_grenade') {
              const props = this.getGrenadeProps(bullet.weaponTypeId);
              const flashRadius = props.flashRadius ?? 150;
              const flashDurationMs = props.flashDurationMs ?? 3000;
              const explosionRadius = props.explosionRadius ?? 150;
              this.createFlashbang(bullet.x, bullet.y, flashRadius, flashDurationMs, bullet.ownerId);
              this.explosions.push({ x: bullet.x, y: bullet.y, radius: explosionRadius });
              bulletsToRemove.add(bullet.id);
              continue;
            }
            // 其他手雷继续等待 TTL 爆炸
          } else {
            // 继续飞行
            bullet.x += bullet.vx * deltaTime;
            bullet.y += bullet.vy * deltaTime;
          }
        } else {
          // 没有目标位置，继续飞行（兼容旧版本）
          bullet.x += bullet.vx * deltaTime;
          bullet.y += bullet.vy * deltaTime;
        }

        // 边界检查（手雷碰到边界就爆炸/生成烟雾）
        if (bullet.x < 0 || bullet.x > this.mapConfig.width ||
            bullet.y < 0 || bullet.y > this.mapConfig.height) {
          if (bullet.weaponTypeId === 'smoke_grenade') {
            const logMsg = `[烟雾弹] 实际爆点（边界碰撞）: (${bullet.x.toFixed(2)}, ${bullet.y.toFixed(2)}), 目标落点: (${bullet.targetX?.toFixed(2) ?? 'N/A'}, ${bullet.targetY?.toFixed(2) ?? 'N/A'})`;
            console.log(logMsg);
            log('SMOKE_GRENADE_EXPLODE_BOUNDARY', {
              room: this.id,
              bulletId: bullet.id,
              actualX: bullet.x.toFixed(2),
              actualY: bullet.y.toFixed(2),
              targetX: bullet.targetX?.toFixed(2) ?? 'N/A',
              targetY: bullet.targetY?.toFixed(2) ?? 'N/A',
              tick: this.tick,
            });
            const props = this.getGrenadeProps(bullet.weaponTypeId);
            const smokeId = `smoke_${this.seed}_${this.smokeIdCounter++}`; // Assign unique ID
            const smoke = { 
              id: smokeId, // Add ID property
              x: bullet.x, 
              y: bullet.y, 
              radius: props.smokeRadius ?? 140, 
              durationMs: props.smokeDurationMs ?? 15000 
            };
            this.smokes.push({ ...smoke, createdAt: now });
            this.newSmokes.push(smoke);
          } else if (bullet.weaponTypeId === 'flash_grenade') {
            const props = this.getGrenadeProps(bullet.weaponTypeId);
            const flashRadius = props.flashRadius ?? 150;
            const flashDurationMs = props.flashDurationMs ?? 3000;
            const explosionRadius = props.explosionRadius ?? 150;
            this.createFlashbang(bullet.x, bullet.y, flashRadius, flashDurationMs, bullet.ownerId);
            this.explosions.push({ x: bullet.x, y: bullet.y, radius: explosionRadius });
          } else {
            const props = this.getGrenadeProps(bullet.weaponTypeId);
            const explosionRadius = props.explosionRadius ?? 100;
            const damage = props.damage ?? 500;
            this.createExplosion(bullet.x, bullet.y, explosionRadius, damage, bullet.ownerId);
          }
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
      let shouldRemoveBullet = false;
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
              // 获取障碍物类型和穿透系数
              const obsType = (obstacle as any).type || 'wall';
              const penetration = getBulletPenetration(obsType);

              // 检查是否可破坏，如果是则造成伤害
              if (isObstacleDestructible(obsType)) {
                const obstacleHp = (obstacle as any).hp ?? Infinity;
                const obstacleMaxHp = (obstacle as any).maxHp ?? Infinity;
                const damage = bullet.damage;
                const newHp = Math.max(0, obstacleHp - damage);
                (obstacle as any).hp = newHp;

                log('OBSTACLE_DAMAGE', {
                  room: this.id,
                  obstacleId: (obstacle as any).id ?? 'unknown',
                  obstacleType: obsType,
                  damage,
                  oldHp: obstacleHp,
                  newHp,
                  maxHp: obstacleMaxHp,
                  destroyed: newHp <= 0 ? 'true' : 'false',
                  tick: this.tick,
                });

                // HP为0时会在 updateBullets 结束时清理
              }

              if (penetration > 0) {
                // 子弹可以穿透，但伤害降低
                const oldDamage = bullet.damage;
                bullet.damage = Math.floor(bullet.damage * penetration);
                log('BULLET_PENETRATE', {
                  room: this.id,
                  bullet: bullet.id,
                  obstacle: obsType,
                  penetration,
                  oldDamage,
                  newDamage: bullet.damage,
                  tick: this.tick,
                });
                // 继续检测下一个障碍物（可能穿透多个）
              } else {
                // 子弹被完全阻挡
                shouldRemoveBullet = true;
                impactX = stepX;
                impactY = stepY;
                break;
              }
            }
          }
          if (shouldRemoveBullet) {
            break;
          }
        }

        if (shouldRemoveBullet) {
          // 命中不可穿透障碍物，删除子弹
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
        // 修复: 回溯时间 = RTT/2 + 客户端插值延迟（120ms）
        // 这样才能回溯到"客户端看到的时间点"
        const shooterLatency = playerLatencies.get(bullet.ownerId) ?? 0;
        const rewindTimeMs = Math.min(
          Math.max(0, shooterLatency / 2 + CLIENT_INTERPOLATION_DELAY_MS),
          MAX_REWIND_MS
        );

        // 改进: 多点采样检测，避免漏掉玩家在时间窗口内穿越子弹轨迹的情况
        // 在回溯时间窗口内均匀采样 3 个点：当前位置、中间位置、回溯位置
        const SAMPLE_COUNT = 3;
        let rewindHit = false;
        let hitPosition = { x: player.x, y: player.y }; // 记录命中位置（用于日志）

        for (let i = 0; i < SAMPLE_COUNT; i++) {
          const t = i / (SAMPLE_COUNT - 1); // 0, 0.5, 1
          const sampleTime = now - rewindTimeMs * t;
          const pos = player.positionHistory.getPositionAt(sampleTime);
          const sampleX = pos?.x ?? player.x;
          const sampleY = pos?.y ?? player.y;

          if (segmentIntersectsCircle(oldX, oldY, bullet.x, bullet.y, sampleX, sampleY, PLAYER_HIT_RADIUS)) {
            rewindHit = true;
            hitPosition = { x: sampleX, y: sampleY };
            break;
          }
        }

        // 调试日志：记录未命中的情况（用于分析延迟补偿效果）
        const currentHit = segmentIntersectsCircle(oldX, oldY, bullet.x, bullet.y, player.x, player.y, PLAYER_HIT_RADIUS);
        if (!rewindHit && currentHit) {
          const targetTimestamp = now - rewindTimeMs;
          const historicalPos = player.positionHistory.getPositionAt(targetTimestamp);
          const targetX = historicalPos?.x ?? player.x;
          const targetY = historicalPos?.y ?? player.y;
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
          
          this.applyExplosion(bullet, hitPosition.x, hitPosition.y);
          bulletsToRemove.add(bullet.id); // Step4: 用Set.add
          break; // 一颗子弹只能命中一个目标
        }
      }

      // AI碰撞检测（类似玩家碰撞检测）
      // 修复：AI子弹不应该伤害其他AI，只伤害玩家
      // 只有玩家的子弹才会检测AI碰撞
      const isPlayerBullet = this.players.has(bullet.ownerId);
      if (isPlayerBullet) {
        for (const [aiId, ai] of this.ais.entries()) {
          // 跳过死亡的AI
          if (ai.status !== 'ALIVE') {
            continue;
          }

          // 延迟补偿（对AI也使用延迟补偿，公平性）
          const shooterLatency = playerLatencies.get(bullet.ownerId) ?? 0;
          const rewindTimeMs = Math.min(
            Math.max(0, shooterLatency / 2 + CLIENT_INTERPOLATION_DELAY_MS),
            MAX_REWIND_MS
          );

          const SAMPLE_COUNT = 3;
          let rewindHit = false;
          let hitPosition = { x: ai.x, y: ai.y };

          for (let i = 0; i < SAMPLE_COUNT; i++) {
            const t = i / (SAMPLE_COUNT - 1);
            const sampleTime = now - rewindTimeMs * t;
            const pos = ai.positionHistory.getPositionAt(sampleTime);
            const sampleX = pos?.x ?? ai.x;
            const sampleY = pos?.y ?? ai.y;

            if (segmentIntersectsCircle(oldX, oldY, bullet.x, bullet.y, sampleX, sampleY, PLAYER_HIT_RADIUS)) {
              rewindHit = true;
              hitPosition = { x: sampleX, y: sampleY };
              break;
            }
          }

          if (rewindHit) {
            // 命中AI！
            const baseDamage = bullet.damage;
            const armorReduction = ai.armorReduction;
            const finalDamage = Math.floor(baseDamage * (1 - armorReduction));
            // 传递攻击者位置（子弹发射位置），让AI能够响应攻击
            ai.takeDamage(finalDamage, bullet.spawnX, bullet.spawnY);

            if (ai.hp <= 0) {
              this.handleAIDeath(aiId);
            }

            // 发送命中事件给射击者
            if (!this.combatEvents.has(bullet.ownerId)) {
              this.combatEvents.set(bullet.ownerId, []);
            }
            this.combatEvents.get(bullet.ownerId)!.push({ kind: 'HIT' });

            this.pushEvent(`${bullet.ownerId} hit AI ${aiId} (-${finalDamage})`);

            log('AI_HIT', {
              room: this.id,
              ai: aiId,
              shooter: bullet.ownerId,
              damage: finalDamage,
              aiHpRemaining: ai.hp,
              tick: this.tick,
            });

            this.applyExplosion(bullet, hitPosition.x, hitPosition.y);
            bulletsToRemove.add(bullet.id);
            break; // 一颗子弹只能命中一个目标
          }
        }
      }
    }

    // Step4: 移除所有标记的子弹（用Set.has，O(1)查找）
    this.bullets = this.bullets.filter(b => !bulletsToRemove.has(b.id));

    // 清理被摧毁的障碍物（HP <= 0）
    const beforeCount = this.obstacles.length;
    this.obstacles = this.obstacles.filter((obs: any) => {
      const obsType = obs.type || 'wall';
      if (!isObstacleDestructible(obsType)) return true; // 不可破坏的永久保留
      const isDestroyed = (obs.hp ?? Infinity) <= 0;
      if (isDestroyed) {
        log('OBSTACLE_DESTROYED', {
          room: this.id,
          obstacleId: obs.id ?? 'unknown',
          obstacleType: obsType,
          tick: this.tick,
        });
      }
      return !isDestroyed; // 可破坏的检查HP
    });
    const destroyedCount = beforeCount - this.obstacles.length;

    if (destroyedCount > 0) {
      log('OBSTACLES_DESTROYED', {
        room: this.id,
        count: destroyedCount,
        remaining: this.obstacles.length,
        tick: this.tick,
      });
    }
  }

  // ===== AI系统方法 =====

  private spawnAIsFromTemplate(mapTemplate: MapTemplate): void {
    if (!mapTemplate.aiSpawns) return;

    for (let spawnIdx = 0; spawnIdx < mapTemplate.aiSpawns.length; spawnIdx++) {
      const aiSpawn = mapTemplate.aiSpawns[spawnIdx];
      const spawnId = `spawn_${spawnIdx}`;

      for (let i = 0; i < aiSpawn.count; i++) {
        const aiId = `ai_${this.aiIdCounter++}`;

        // 获取角色预设（默认为'basic'）
        const role = aiSpawn.role || 'basic';
        const rolePreset = AI_ROLE_PRESETS[role];

        // 构建巡逻配置
        let patrolConfig: PatrolConfig | undefined;
        if (aiSpawn.type === 'patrol' && aiSpawn.patrolPointIds) {
          const points = aiSpawn.patrolPointIds
            .map(id => mapTemplate.pois?.find(p => p.id === id))
            .filter(poi => poi !== undefined)
            .map(poi => ({ x: poi!.x, y: poi!.y }));

          if (points.length > 0) {
            patrolConfig = {
              points,
              currentIndex: 0,
              waitTimeMs: 2000,
              waitUntil: 0,
            };
          }
        }

        // 构建防守配置
        let guardConfig: GuardConfig | undefined;
        if (aiSpawn.type === 'guard') {
          guardConfig = {
            centerX: aiSpawn.x,
            centerY: aiSpawn.y,
            radius: aiSpawn.guardRadius ?? rolePreset.visionRange / 4,
          };
        }

        // 应用角色预设，允许地图配置覆盖
        const ai = new AI({
          id: aiId,
          x: aiSpawn.x,
          y: aiSpawn.y,
          behaviorType: aiSpawn.type === 'patrol' ? 'PATROL' : 'GUARD',
          weaponTypeId: aiSpawn.weaponTypeId ?? rolePreset.weaponTypeId, // 优先使用地图指定的武器
          visionRange: aiSpawn.visionRange ?? rolePreset.visionRange,
          visionAngleDeg: aiSpawn.visionAngleDeg ?? rolePreset.visionAngleDeg,
          patrolConfig,
          guardConfig,
          currentTick: this.tick,
          // 角色属性（使用预设或地图覆盖）
          role: role,
          hp: aiSpawn.hp ?? rolePreset.hp,
          maxHp: aiSpawn.hp ?? rolePreset.maxHp,
          armorReduction: aiSpawn.armorReduction ?? rolePreset.armorReduction,
          moveSpeed: aiSpawn.moveSpeed ?? rolePreset.moveSpeed,
          aimErrorDeg: rolePreset.aimErrorDeg,
          fireRateMultiplier: rolePreset.fireRateMultiplier,
          aggroRange: rolePreset.aggroRange,
          chaseRange: rolePreset.chaseRange,
          // 槽位信息
          spawnId: spawnId,
          spawnIndex: i,
        });

        this.ais.set(aiId, ai);
        log('AI_SPAWNED', { room: this.id, aiId, type: aiSpawn.type, role, weapon: ai.weaponRuntime.weaponTypeId, spawnId, spawnIndex: i });
      }
    }
  }

  public updateAIs(currentTick: number): void {
    if (!this.aiBehaviorController) return;

    // 临时调整：每tick更新所有AI（更快响应，但CPU占用更高）
    const aisArray = Array.from(this.ais.values());

    for (const ai of aisArray) {
      if (ai.status !== 'ALIVE') continue;
      this.aiBehaviorController.updateAI(ai, currentTick);
      ai.positionHistory.add(currentTick, Date.now(), ai.x, ai.y);
    }
  }

  public aiFireWeapon(ai: AI, aimRad: number, currentTick: number): void {
    if (!ai.weaponRuntime) return;

    const wr = ai.weaponRuntime;
    const weaponDef = getWeaponDef(wr.weaponTypeId);

    wr.ammoInMag--;

    // 应用射速倍率（fireRateMultiplier）
    advanceFireCooldown(wr, weaponDef, currentTick);
    if (ai.fireRateMultiplier !== 1.0) {
      // 调整nextFireTick以应用射速倍率
      // 倍率越高，冷却时间越短（射速越快）
      const baseCooldown = wr.nextFireTick - currentTick;
      const adjustedCooldown = Math.ceil(baseCooldown / ai.fireRateMultiplier);
      wr.nextFireTick = currentTick + adjustedCooldown;
    }

    // 复用现有子弹生成逻辑（需要转换AI为兼容格式）
    const aiAsPlayer: any = { id: ai.id, x: ai.x, y: ai.y };
    this.spawnBullet(ai.id, aiAsPlayer, aimRad, weaponDef, undefined);
  }

  // ===== 重刷系统方法 =====

  // 检查并执行物品重刷
  public checkAndRespawnItems(): void {
    const configs = this.mapTemplate?.itemRespawns ?? [];
    if (configs.length === 0) return;

    // 如果还没有初始化 per-config 计时器，初始化为房间创建 tick
    if (!Array.isArray((this as any).lastItemRespawnTicks)) {
      (this as any).lastItemRespawnTicks = configs.map(() => this.tick);
    }
    const lastTicks: number[] = (this as any).lastItemRespawnTicks;

    configs.forEach((cfg, idx) => {
      // 仅对 mode 为 respawn 或 both 的规则进行重刷
      if (cfg.mode === 'initial') {
        return;
      }

      const lastTick = lastTicks[idx] ?? this.tick;
      const ticksSinceLastRespawn = this.tick - lastTick;

      if (ticksSinceLastRespawn < cfg.intervalTicks) {
        return;
      }

      // 计算该规则作用区域当前已有物资数量（用于 maxItems 判定）
      let currentInRegion = 0;
      let zoneBounds: { x: number; y: number; w: number; h: number } | undefined;
      if (cfg.zoneId && this.mapTemplate?.zones) {
        const zone = this.mapTemplate.zones.find((z) => z.id === cfg.zoneId);
        if (zone) {
          zoneBounds = { x: zone.x, y: zone.y, w: zone.w, h: zone.h };
        }
      }
      if (zoneBounds) {
        for (const existing of this.worldItems.values()) {
          if (
            existing.x >= zoneBounds.x &&
            existing.x <= zoneBounds.x + zoneBounds.w &&
            existing.y >= zoneBounds.y &&
            existing.y <= zoneBounds.y + zoneBounds.h
          ) {
            currentInRegion++;
          }
        }
      } else {
        currentInRegion = this.worldItems.size;
      }

      // 如果已经达到该规则的区域上限，则不再生成
      if (cfg.maxItems && currentInRegion >= cfg.maxItems) {
        return;
      }

      // 这次最多还能补多少（基于规则自己的 maxItems）
      const targetCount = cfg.maxItems || Infinity;
      const toSpawn = Math.min(cfg.count, targetCount - currentInRegion);

      if (toSpawn <= 0) {
        return;
      }

      this.respawnWorldItems(toSpawn, idx);
      lastTicks[idx] = this.tick;

      log('ITEMS_RESPAWNED', {
        room: this.id,
        ruleId: cfg.id ?? `rule_${idx}`,
        count: toSpawn,
        totalItems: this.worldItems.size,
        tick: this.tick,
      });
    });
  }

  // 执行物品重刷（生成新物品），按单条配置执行
  private respawnWorldItems(count: number, configIndex: number): void {
    const configs = this.mapTemplate?.itemRespawns ?? [];
    const cfg = configs[configIndex];
    if (!cfg) return;

    // 使用 tick 作为随机种子的一部分，确保每次重刷位置不同
    const itemsRng = createRng(
      this.seed + 2000000 + this.tick + configIndex * 1000
    );

    for (let i = 0; i < count; i++) {
      this.spawnOneWorldItemWithConfig(itemsRng, {
        zoneId: cfg.zoneId,
        itemIds: cfg.itemIds,
        rarityWeights: cfg.rarityWeights,
        maxItems: cfg.maxItems,
        ruleId: cfg.id ?? `rule_${configIndex}`,
      });
    }
  }

  // 检查并执行AI重刷
  public checkAndRespawnAIs(): void {
    if (!this.mapTemplate?.aiRespawn) return;

    const respawnConfig = this.mapTemplate.aiRespawn;
    const ticksSinceLastRespawn = this.tick - this.lastAIRespawnTick;

    if (ticksSinceLastRespawn >= respawnConfig.intervalTicks) {
      // 检查最大AI数量限制
      const aliveAICount = Array.from(this.ais.values()).filter(ai => ai.status === 'ALIVE').length;
      if (respawnConfig.maxAIs && aliveAICount >= respawnConfig.maxAIs) {
        return; // 已达到最大AI数量
      }

      // 计算需要生成的数量
      const targetCount = respawnConfig.maxAIs || Infinity;
      const toSpawn = Math.min(1, targetCount - aliveAICount); // 每次重刷1个AI

      if (toSpawn > 0) {
        this.respawnAIs(toSpawn, respawnConfig.spawnId);
        this.lastAIRespawnTick = this.tick;
        
        log('AIS_RESPAWNED', {
          room: this.id,
          count: toSpawn,
          totalAIs: aliveAICount + toSpawn,
          tick: this.tick,
        });
      }
    }
  }

  // 执行AI重刷（生成新AI）
  private respawnAIs(count: number, spawnId?: string): void {
    if (!this.mapTemplate?.aiSpawns || this.mapTemplate.aiSpawns.length === 0) return;

    // 1. 整理出所有可用的空闲槽位
    // 每个 AISpawn.count 代表该点位有多少个槽位
    const allAis = Array.from(this.ais.values());
    const occupiedSlots = new Set<string>(); // "spawnId:slotIndex"
    for (const ai of allAis) {
      if (ai.status === 'ALIVE' && ai.spawnId !== undefined && ai.spawnIndex !== undefined) {
        occupiedSlots.add(`${ai.spawnId}:${ai.spawnIndex}`);
      }
    }

    const freeSlots: Array<{ spawn: AISpawn; spawnId: string; index: number }> = [];
    
    // 如果指定了 spawnId，只在那个点找，否则全图找
    const spawnsToIterate = spawnId ? [spawnId] : Array.from(this.aiSpawnMap.keys());

    for (const sid of spawnsToIterate) {
      const spawn = this.aiSpawnMap.get(sid);
      if (!spawn) continue;

      for (let i = 0; i < spawn.count; i++) {
        if (!occupiedSlots.has(`${sid}:${i}`)) {
          freeSlots.push({ spawn, spawnId: sid, index: i });
        }
      }
    }

    if (freeSlots.length === 0) {
      log('AI_RESPAWN_FAILED', { room: this.id, reason: 'no_free_slots', spawnId });
      return;
    }

    // 2. 随机排序空闲槽位，从中抽取 count 个
    const rng = createRng(this.seed + 3000000 + this.tick);
    const shuffledSlots = [...freeSlots];
    for (let i = shuffledSlots.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffledSlots[i], shuffledSlots[j]] = [shuffledSlots[j], shuffledSlots[i]];
    }

    const numToSpawn = Math.min(count, shuffledSlots.length);

    for (let i = 0; i < numToSpawn; i++) {
      const slot = shuffledSlots[i];
      const selectedSpawn = slot.spawn;
      const aiId = `ai_${this.aiIdCounter++}`;

      // 构建巡逻配置
      let patrolConfig: PatrolConfig | undefined;
      if (selectedSpawn.type === 'patrol' && selectedSpawn.patrolPointIds) {
        const points = selectedSpawn.patrolPointIds
          .map(id => this.mapTemplate!.pois?.find(p => p.id === id))
          .filter(poi => poi !== undefined)
          .map(poi => ({ x: poi!.x, y: poi!.y }));

        if (points.length > 0) {
          patrolConfig = {
            points,
            currentIndex: 0,
            waitTimeMs: 2000,
            waitUntil: 0,
          };
        }
      }

      // 构建防守配置
      let guardConfig: GuardConfig | undefined;
      if (selectedSpawn.type === 'guard') {
        guardConfig = {
          centerX: selectedSpawn.x,
          centerY: selectedSpawn.y,
          radius: selectedSpawn.guardRadius ?? 150,
        };
      }

      // 获取角色预设（重刷系统也使用角色系统）
      const role = selectedSpawn.role || 'basic';
      const rolePreset = AI_ROLE_PRESETS[role];

      // 应用角色预设，允许地图配置覆盖
      const ai = new AI({
        id: aiId,
        x: selectedSpawn.x,
        y: selectedSpawn.y,
        behaviorType: selectedSpawn.type === 'patrol' ? 'PATROL' : 'GUARD',
        weaponTypeId: selectedSpawn.weaponTypeId ?? rolePreset.weaponTypeId,
        visionRange: selectedSpawn.visionRange ?? rolePreset.visionRange,
        visionAngleDeg: selectedSpawn.visionAngleDeg ?? rolePreset.visionAngleDeg,
        patrolConfig,
        guardConfig,
        currentTick: this.tick,
        // 角色属性
        role: role,
        hp: selectedSpawn.hp ?? rolePreset.hp,
        maxHp: selectedSpawn.hp ?? rolePreset.maxHp,
        armorReduction: selectedSpawn.armorReduction ?? rolePreset.armorReduction,
        moveSpeed: selectedSpawn.moveSpeed ?? rolePreset.moveSpeed,
        aimErrorDeg: rolePreset.aimErrorDeg,
        fireRateMultiplier: rolePreset.fireRateMultiplier,
        aggroRange: rolePreset.aggroRange,
        chaseRange: rolePreset.chaseRange,
        // 槽位信息
        spawnId: slot.spawnId,
        spawnIndex: slot.index,
      });

      this.ais.set(aiId, ai);
      log('AI_RESPAWNED', { room: this.id, aiId, type: selectedSpawn.type, weapon: ai.weaponRuntime.weaponTypeId, spawnId: slot.spawnId, spawnIndex: slot.index });
    }
  }

  private handleAIDeath(aiId: string): void {
    const ai = this.ais.get(aiId);
    if (!ai || !ai.weaponRuntime) return;

    ai.status = 'DEAD';

    // 掉落武器
    const weaponItem: ItemInstance = {
      iid: `loot_${Date.now()}_${Math.random().toString(36).substring(2)}`,
      typeId: ai.weaponRuntime.weaponTypeId,
      qty: 1,
    };

    const bid = `bid_${this.lootBagIdCounter++}`;
    this.lootBags.set(bid, {
      bid,
      x: ai.x,
      y: ai.y,
      items: [weaponItem],
    });

    log('AI_DEATH', { room: this.id, aiId, position: `${ai.x},${ai.y}` });
  }

  // 获取当前状态快照
  // Step4: 导出时只包含BULLET_STATE字段，不包含spawnAt，保证协议兼容
  // 新增: 只包含 inWorld=true 的玩家（未来会实现 inWorld 字段，现在先包含所有玩家）
  getSnapshot(): {
    players: PLAYER_STATE[];
    bullets: BULLET_STATE[];
    items: ITEM_STATE[];
    worldItems: WorldItem[];
    lootBags: LootBag[];
    obstacles: OBSTACLE_STATE[];
    ais: AI_STATE[];
  } {
    // 新增: 只包含 ALIVE/DEAD 状态的玩家（EXTRACTED 玩家不再出现在 snapshot 中）
    // 未来会改为检查 inWorld 字段
    const visiblePlayers = Array.from(this.players.values())
      .filter(p => p.status !== 'EXTRACTED')
      .map((p) => {
        const state = p.toState(this.tick);
        // 计算玩家是否在草丛内
        const bushId = this.isPlayerInBush(p.x, p.y);
        state.inBush = !!bushId;
        state.inBushId = bushId;
        // 计算玩家是否在烟雾内
        const smokeId = this.isPointInSmoke(p.x, p.y);
        state.inSmoke = !!smokeId;
        state.inSmokeId = smokeId;
        // 计算玩家是否被闪光弹致盲
        const now = Date.now();
        state.isFlashed = p.flashedUntil > now;
        state.flashEndTime = p.flashedUntil;
        return state;
      });
    
    const snapshotBullets = this.bullets.map(({ spawnAt, damage, isGrenade, explodeTick, targetX, targetY, ...b }) => ({
      ...b,
      clientShotId: b.clientShotId, // 传递客户端发射ID
      weaponTypeId: b.weaponTypeId, // 传递武器类型ID（用于客户端渲染样式）
      bulletLifeMs: b.bulletLifeMs, // 传递子弹生命周期（用于客户端TTL判断）
      targetX,
      targetY,
    }));

    const aiStates = Array.from(this.ais.values())
      .filter(ai => ai.status === 'ALIVE')
      .map(ai => {
        const state = ai.toState(this.tick);
        // 计算AI是否在草丛内
        const bushId = this.isPlayerInBush(ai.x, ai.y);
        state.inBush = !!bushId;
        state.inBushId = bushId;
        // 计算AI是否在烟雾内
        const smokeId = this.isPointInSmoke(ai.x, ai.y);
        state.inSmoke = !!smokeId;
        state.inSmokeId = smokeId;
        return state;
      });

    return {
      players: visiblePlayers,
      // Step4: 映射内部Bullet类型到BULLET_STATE（去掉spawnAt和damage字段，保留clientShotId和weaponTypeId）
      bullets: snapshotBullets,
      items: [], // P2-1: 旧 items 系统已停用，返回空数组
      worldItems: this.getWorldItems(), // 新增: 世界物品
      lootBags: this.getLootBags(), // 新增: 掉落包
      obstacles: this.getObstacles(), // 新增: 障碍物（可破坏，需要同步）
      ais: aiStates, // 新增: AI实体
    };
  }

  /**
   * 新增: 每 tick 更新需要读条的道具效果（例如急救包）
   * 当读条结束时才真正应用效果并消耗物品
   */
  updateItemUsages(): void {
    for (const [playerId, player] of this.players.entries()) {
      if (!player.usingItemTypeId) continue;

      // 如果玩家已经死亡或撤离，直接取消读条
      if (player.status !== 'ALIVE') {
        player.cancelUsingItem();
        continue;
      }

      // 尚未读条完成
      if (this.tick < player.usingItemEndTick) {
        continue;
      }

      const typeId = player.usingItemTypeId;
      const iid = player.usingItemIid;

      // 先清理读条状态，避免重复触发
      player.cancelUsingItem();

      if (!typeId || !iid) {
        continue;
      }

      try {
        const itemType = getItemType(typeId);

        if (typeId === 'medkit' || typeId === 'advanced_medkit') {
          // 读条结束时应用治疗效果
          if (player.hp <= 0 || player.status !== 'ALIVE') {
            // 已死亡则不再治疗
            return;
          }

          const healAmount = Math.min(itemType.consumableProps?.healAmount ?? 50, 100 - player.hp);

          // 如果已经是满血，允许读条结束但不再加血，只消耗道具
          if (healAmount > 0) {
            player.hp += healAmount;
          }

          // 消耗一个对应实例的医疗包
          const removed = player.removeItem(iid, 1);
          if (!removed) {
            // 找不到该实例，记录日志但不中断游戏
            log('USE_MEDKIT_CONSUME_FAILED', {
              room: this.id,
              player: playerId,
              itemType: typeId,
              iid,
              tick: this.tick,
            });
            continue;
          }

          // 清理背包中可能的无效物品
          player.cleanupInventory();

          this.pushEvent(`Player ${playerId} used ${itemType.name} (+${healAmount} HP)`);
          log('USE_MEDKIT_FINISH', {
            room: this.id,
            player: playerId,
            itemType: typeId,
            healAmount,
            newHp: player.hp,
            tick: this.tick,
          });
        }
      } catch (err) {
        log('USE_ITEM_FINISH_ERROR', {
          room: this.id,
          player: playerId,
          typeId,
          tick: this.tick,
          error: (err as Error).message,
        });
      }
    }
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

  // 新增: 更新烟雾生命周期（清理过期烟雾）
  updateSmokes(): void {
    const now = Date.now();
    this.smokes = this.smokes.filter(smoke => {
      const age = now - smoke.createdAt;
      return age < smoke.durationMs;
    });
  }

  // 新增: 获取并清空新烟雾事件（广播用）
  drainSmokes(): Array<{ x: number; y: number; radius: number; durationMs: number }> {
    const smokes = [...this.newSmokes];
    this.newSmokes = [];
    return smokes;
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

    // 如果正在读条使用道具，则本次请求直接失败，避免叠加
    if (player.isUsingItem(this.tick)) {
      return { success: false, message: 'Already using item' };
    }

    // 获取可使用的物品列表（使用统一的定义）
    const usableItems = player.inventory.items.filter(item => {
      return isUsableItem(item.typeId);
    });

    // 检查槽位是否有效
    if (slot < 1 || slot > 5 || slot > usableItems.length) {
      return { success: false, message: 'Invalid slot or no item' };
    }

    const item = usableItems[slot - 1];
    
    try {
      const itemType = getItemType(item.typeId);
      
      if (item.typeId === 'medkit' || item.typeId === 'advanced_medkit') {
        // 使用医疗包：先启动 1 秒读条，期间禁止一切行动，读条结束时再真正回复生命并消耗道具
        if (player.hp >= 100) {
          return { success: false, message: 'Already at full health' };
        }

        // 1 秒使用时间
        const DURATION_MS = 1000;
        player.startUsingItem(item.typeId, item.iid, DURATION_MS, this.tick);

        this.pushEvent(`Player ${playerId} started using ${itemType.name}`);
        log('USE_MEDKIT_START', {
          room: this.id,
          player: playerId,
          itemType: item.typeId,
          durationMs: DURATION_MS,
          tick: this.tick,
        });

        return { success: true, itemType: item.typeId };
        
      } else if (item.typeId === 'combat_stim') {
        // 战斗兴奋剂：在一段时间内提升移动速度
        const itemType = getItemType(item.typeId);
        const DURATION_MS = itemType.consumableProps?.buffDurationMs ?? 15000;
        const SPEED_MULTIPLIER = itemType.consumableProps?.speedMultiplier ?? 2.0;

        // 添加/刷新 Buff
        player.addOrRefreshBuff(
          {
            id: 'combat_stim',
            name: '战斗兴奋剂',
            kind: 'speed',
            durationMs: DURATION_MS,
            speedMultiplier: SPEED_MULTIPLIER,
          },
          this.tick
        );

        // 消耗一个战斗兴奋剂
        const removed = player.removeItem(item.iid, 1);
        if (!removed) {
          return { success: false, message: 'Failed to consume item' };
        }

        player.cleanupInventory();

        this.pushEvent(`Player ${playerId} used combat stim (+40% speed for 15s)`);
        log('USE_COMBAT_STIM', {
          room: this.id,
          player: playerId,
          durationMs: DURATION_MS,
          speedMultiplier: SPEED_MULTIPLIER,
          tick: this.tick,
        });

        return { success: true, itemType: 'combat_stim' };
        
      } else if (item.typeId === 'regeneration_serum') {
        // 再生血清：在一段时间内持续回复生命值
        const itemType = getItemType(item.typeId);
        const DURATION_MS = itemType.consumableProps?.buffDurationMs ?? 20000;
        const HP_PER_SECOND = itemType.consumableProps?.hpPerSecond ?? 5;

        // 添加/刷新 Buff
        player.addOrRefreshBuff(
          {
            id: 'regeneration_serum',
            name: '再生血清',
            kind: 'regeneration',
            durationMs: DURATION_MS,
            hpPerSecond: HP_PER_SECOND,
          },
          this.tick
        );

        // 消耗一个再生血清
        const removed = player.removeItem(item.iid, 1);
        if (!removed) {
          return { success: false, message: 'Failed to consume item' };
        }

        player.cleanupInventory();

        this.pushEvent(`Player ${playerId} used regeneration serum (+${HP_PER_SECOND} HP/s for ${DURATION_MS / 1000}s)`);
        log('USE_REGENERATION_SERUM', {
          room: this.id,
          player: playerId,
          durationMs: DURATION_MS,
          hpPerSecond: HP_PER_SECOND,
          tick: this.tick,
        });

        return { success: true, itemType: 'regeneration_serum' };
        
      } else if (item.typeId === 'frag_grenade' || item.typeId === 'smoke_grenade') {
        // 手雷/烟雾弹不能通过快捷栏直接使用，需要通过投掷系统
        return { success: false, message: 'Use number key to aim and throw grenade' };
      }
      
      return { success: false, message: 'Item not usable' };
      
    } catch (err) {
      return { success: false, message: 'Unknown item type' };
    }
  }

  // 新增: 投掷物品（手雷等）
  handleThrow(playerId: string, targetX: number, targetY: number, itemType: string): { success: boolean; message?: string } {
    // 调试：打印所有投掷请求（详细版本）
    console.log(`[handleThrow] 收到投掷请求: playerId=${playerId}, itemType="${itemType}" (类型: ${typeof itemType}, 长度: ${itemType.length}), targetX=${targetX.toFixed(2)}, targetY=${targetY.toFixed(2)}`);
    console.log(`[handleThrow] itemType === 'smoke_grenade' 结果: ${itemType === 'smoke_grenade'}, JSON: ${JSON.stringify(itemType)}`);
    
    const player = this.players.get(playerId);
    if (!player || player.status !== 'ALIVE') {
      console.log(`[handleThrow] 失败: 玩家不存在或已死亡`);
      return { success: false, message: 'Player not alive' };
    }

    // 检查是否有对应的投掷物
    const grenadeItem = player.inventory.items.find(item => item.typeId === itemType);
    if (!grenadeItem) {
      console.log(`[handleThrow] 失败: 找不到物品, itemType="${itemType}", 背包物品: ${player.inventory.items.map(i => i.typeId).join(', ')}`);
      return { success: false, message: 'No grenade available' };
    }

    // 检查投掷距离（最大350像素，比客户端稍宽松）
    const dx = targetX - player.x;
    const dy = targetY - player.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance > 350) { // 增加50像素容错
      console.log(`[handleThrow] 失败: 距离太远, distance=${distance.toFixed(2)}`);
      return { success: false, message: 'Target too far' };
    }

    // 消耗一个手雷
    const removed = player.removeItem(grenadeItem.iid, 1);
    if (!removed) {
      console.log(`[handleThrow] 失败: 无法消耗物品`);
      return { success: false, message: 'Failed to consume grenade' };
    }

    // 清理背包中可能的无效物品
    player.cleanupInventory();

    // 创建投掷物轨迹（类似子弹，但有抛物线轨迹和延时爆炸）
    const grenadeId = `grenade_${this.tick}_${Math.random().toString(36).substr(2, 9)}`;
    
    // 判断投掷物类型
    const isSmoke = itemType === 'smoke_grenade';
    const isFlash = itemType === 'flash_grenade';
    const isFrag = itemType === 'frag_grenade';
    console.log(`[handleThrow] 投掷物类型判断: isSmoke=${isSmoke}, isFlash=${isFlash}, isFrag=${isFrag}, itemType="${itemType}"`);
    
    // 烟雾弹：打印落点（使用 console.log 和 log 双重输出）
    if (isSmoke) {
      const logMsg = `[烟雾弹] 落点: (${targetX.toFixed(2)}, ${targetY.toFixed(2)}), 玩家位置: (${player.x.toFixed(2)}, ${player.y.toFixed(2)}), 距离: ${distance.toFixed(2)}`;
      console.log(logMsg);
      log('SMOKE_GRENADE_THROW', {
        room: this.id,
        player: playerId,
        targetX: targetX.toFixed(2),
        targetY: targetY.toFixed(2),
        playerX: player.x.toFixed(2),
        playerY: player.y.toFixed(2),
        distance: distance.toFixed(2),
        tick: this.tick,
      });
    }
    
    // 计算投掷速度（基于距离和重力，速度3倍）
    const flightTime = isSmoke ? 1.0 : 1.0 / 3; // 烟雾弹飞行1秒，其他手雷0.75秒
    const vx = dx / flightTime;
    const vy = dy / flightTime;
    
    // 根据类型设置伤害和爆炸时间
    const damage = isSmoke ? 0 : (isFlash ? 0 : 500); // 烟雾弹和闪光弹不造成直接伤害
    const bulletLifeMs = isSmoke ? 1000 : 750; // 烟雾弹1秒后生效，其他手雷0.75秒后爆炸
    const explodeTickOffset = isSmoke ? 1000 : 750;
    
    // 创建手雷子弹（使用特殊的手雷子弹类型）
    const grenadeBullet: Bullet = {
      id: grenadeId,
      x: player.x,
      y: player.y,
      vx: vx,
      vy: vy,
      ownerId: playerId,
      spawnAt: Date.now(),
      damage: damage,
      bulletLifeMs: bulletLifeMs,
      weaponTypeId: itemType, // 使用实际的 itemType，支持所有类型
      isGrenade: true, // 标记为手雷
      explodeTick: this.tick + msToTicks(explodeTickOffset),
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
