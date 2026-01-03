import { Player } from './player.js';
import { ProfileManager } from './profile.js';
import type { PLAYER_STATE, BULLET_STATE, ITEM_STATE, C2S_INPUT, MAP_CONFIG, OBSTACLE_STATE, WorldItem, LootBag } from '@jerkie-man/shared';
import { loadMapConfig, loadItemTypes, circleVsAABB, createRng, rectIntersects, segmentIntersectsCircle, getItemType, getAllItemTypes, getItemTypesByRarity } from '@jerkie-man/shared';
import { log } from './logger.js';

// Step4: 内部子弹类型（包含spawnAt用于TTL检查，不改变协议）
type Bullet = BULLET_STATE & { spawnAt: number };

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
  private findSpawnPoint(): { x: number; y: number } {
    const PLAYER_RADIUS = 10; // 和 Player.processInput 一致
    const MIN_SPAWN_PLAYER_DISTANCE = 120; // 修复: 和其他玩家的最小距离
    const MAX_ATTEMPTS = 80;
    
    // 使用 seed + 玩家数量偏移初始化 RNG（保证可复现，每次调用用不同的偏移）
    const spawnRng = createRng(this.seed + this.players.size * 1000);
    
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

  addPlayer(playerId: string): Player {
    // P0-2 修复: 使用 findSpawnPoint 计算安全出生点
    const spawn = this.findSpawnPoint();
    // 新增: 从 profile 获取 bagCap
    const bagCap = this.profileManager.getBagCap(playerId);
    const player = new Player(playerId, spawn.x, spawn.y, bagCap);
    this.players.set(playerId, player);
    log('PLAYER_JOIN', {
      room: this.id,
      player: playerId,
      pos: `(${spawn.x.toFixed(1)},${spawn.y.toFixed(1)})`,
      tick: this.tick,
    });
    return player;
  }

  removePlayer(playerId: string): void {
    if (this.players.has(playerId)) {
      this.players.delete(playerId);
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

  // 节流日志：每200ms打印一次
  private lastProcessLog = new Map<string, number>();

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
    
    // 游戏化增强: 处理撤离持续（extractHeld）
    if (input.extractHeld && player.status === 'ALIVE') {
      if (this.isInExtractZone(player.x, player.y)) {
        // 在撤离区内并按住F，增加进度
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
      // 未按住F，重置撤离进度（松开就归零）
      player.extractProgress = 0;
    }
    
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
    
    // Day2: 处理开火；Day3: EXTRACTED 玩家不能开火
    const now = Date.now();
    if (input.shoot && player.canFire(now) && player.status === 'ALIVE') {
      // 生成子弹
      const bulletSpeed = 800; // 800px/s
      const vx = Math.cos(input.aim) * bulletSpeed;
      const vy = Math.sin(input.aim) * bulletSpeed;
      
      // 修复: 使用 rng + 计数器生成可复现的 ID（代替 Date.now() + Math.random()）
      // 使用 seed + tick 作为子弹 RNG 的偏移，确保同 tick 下可复现
      const bulletRng = createRng(this.seed + this.tick + this.bulletIdCounter);
      const bulletId = `b${this.bulletIdCounter++}_${Math.floor(bulletRng() * 1000000).toString(36)}`;
      // Step4: 添加内部Bullet类型，包含spawnAt用于TTL检查
      this.bullets.push({
        id: bulletId,
        x: player.x,
        y: player.y,
        vx,
        vy,
        ownerId: playerId,
        spawnAt: now, // Step4: 记录生成时间，用于TTL检查
      });
      
      player.recordFire(now);
      
      log('SPAWN_BULLET', {
        room: this.id,
        player: playerId,
        tick: this.tick,
        bullet: bulletId,
        pos: `(${player.x.toFixed(1)},${player.y.toFixed(1)})`,
        aim: input.aim.toFixed(2),
      });
    }

    // 节流日志：每200ms打印一次
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
      // Step4: 子弹TTL检查（防止穿墙或者子弹无限存在）
      if (now - bullet.spawnAt > 2000) { // 2秒TTL
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
          player.takeDamage(10);
          const isDead = player.hp <= 0;
          
          // 新增: 玩家死亡时生成掉落包
          if (isDead) {
            this.handlePlayerDeath(player.id);
          }
          
          log('HIT', {
            room: this.id,
            bullet: bullet.id,
            owner: bullet.ownerId,
            target: playerId,
            tick: this.tick,
            damage: 10,
            hp: `${oldHp}->${player.hp}`,
          });
          
          // 游戏化增强: 推送命中事件
          this.pushEvent(`${bullet.ownerId} hit ${playerId} (-10)`);
          
          // 如果玩家死了，推送击杀事件和日志
          if (wasAlive && isDead) {
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
  getSnapshot(): {
    players: PLAYER_STATE[];
    bullets: BULLET_STATE[];
    items: ITEM_STATE[];
    worldItems: WorldItem[];
    lootBags: LootBag[];
  } {
    return {
      players: Array.from(this.players.values()).map((p) => p.toState()),
      // Step4: 映射内部Bullet类型到BULLET_STATE（去掉spawnAt字段）
      bullets: this.bullets.map(({ spawnAt, ...b }) => b),
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
  handlePlayerDeath(playerId: string): void {
    const player = this.players.get(playerId);
    if (!player || player.status !== 'DEAD') return;
    
    const droppedItems = player.clearInventory();
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
        bid,
        itemCount: droppedItems.length,
        tick: this.tick,
      });
    }
  }

  // 新增: 处理玩家撤离（inventory -> stash）
  // 返回是否成功，用于控制 Profile 发送
  handlePlayerExtract(playerId: string): boolean {
    const player = this.players.get(playerId);
    if (!player || player.status !== 'EXTRACTED') return false;
    
    const items = [...player.inventory.items];
    if (items.length > 0) {
      this.profileManager.addToStash(playerId, items);
      player.clearInventory();
      
      this.pushEvent(`Player ${playerId} extracted with ${items.length} items`);
      log('PLAYER_EXTRACT', {
        room: this.id,
        player: playerId,
        itemCount: items.length,
        tick: this.tick,
      });
      return true; // P1-1: 返回 true 表示需要发送 Profile
    }
    return false;
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
}
