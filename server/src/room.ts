import { Player } from './player.js';
import type { PLAYER_STATE, BULLET_STATE, ITEM_STATE, C2S_INPUT, MAP_CONFIG, OBSTACLE_STATE } from '@jerkie-man/shared';
import { loadMapConfig, loadItemTypes, circleVsAABB, createRng, rectIntersects, segmentIntersectsCircle } from '@jerkie-man/shared';
import { log } from './logger.js';

// Step4: 内部子弹类型，包含spawnAt用于TTL检测（不改变协议）
type Bullet = BULLET_STATE & { spawnAt: number };

export class Room {
  public id: string;
  public players: Map<string, Player>;
  public bullets: Bullet[]; // Step4: 使用内部类型，包含spawnAt
  public items: ITEM_STATE[]; // Day1占位
  public obstacles: OBSTACLE_STATE[]; // Day4-2: 障碍物列表
  // Day4-1: Room 持有世界配置（seed + mapConfig），作为单一真相来源
  public readonly seed: number;
  public readonly mapConfig: MAP_CONFIG;
  public tick: number;
  // 修复: 可复现 ID 生成（使用 rng 计数器而非 Date.now()）
  private itemIdCounter = 0; // items ID 计数器
  private bulletIdCounter = 0; // bullets ID 计数器
  // 游戏化增强: 事件队列（ring buffer，最多保留 50 条）
  private events: Array<{ tick: number; timestamp: number; message: string }> = [];
  private readonly MAX_EVENTS = 50;

  constructor(id: string, seed?: number) {
    this.id = id;
    this.players = new Map();
    this.bullets = [];
    this.items = [];
    this.obstacles = []; // Day4-2: 初始化障碍物列表
    
    // P1-1 修复: 支持 seed 可注入（优先级：参数 > 环境变量 > 随机）
    // 用于调试/测试时稳定复现同一个世界
    if (seed !== undefined) {
      this.seed = seed;
    } else if (process.env.SEED !== undefined) {
      const envSeed = parseInt(process.env.SEED, 10);
      if (isNaN(envSeed)) {
        throw new Error(`Invalid SEED environment variable: ${process.env.SEED}`);
      }
      this.seed = envSeed;
    } else {
      // Day4-1: 生成随机 seed（int，范围 0 到 2^31-1）
      this.seed = Math.floor(Math.random() * 2**31);
    }
    
    // P1-1 修复: 使用 this.seed 加载 mapConfig，确保 seed 与 mapConfig.seed 一致
    this.mapConfig = loadMapConfig(this.seed);
    
    this.tick = 0;
    
    // Day4-2: 初始化时生成障碍物（基于 seed）
    this.generateObstacles();
    
    // Day3: 初始化时生成物品
    this.generateItems(30);
  }
  
  // Day3: 生成物品（简单策略：随机分布，避免重叠）
  private generateItems(count: number): void {
    const itemTypes = loadItemTypes();
    const minDistance = 32; // 物品之间最小距离
    // 使用 seed + 常数偏移作为 items 的 RNG seed，避免和 obstacles 完全相关
    const itemsRng = createRng(this.seed + 1000000);
    
    for (let i = 0; i < count; i++) {
      let attempts = 0;
      let x: number, y: number;
      let valid = false;
      
      // 尝试生成位置，避免重叠
      while (!valid && attempts < 50) {
        x = itemsRng() * this.mapConfig.width;
        y = itemsRng() * this.mapConfig.height;
        
        // 修复: 检查是否在撤离区内
        if (this.isInExtractZone(x, y)) {
          attempts++;
          continue;
        }
        
        // 修复: 检查是否与障碍物碰撞（物品视作半径8的圆）
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
        
        // 检查是否与现有物品太近
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
        // 修复: 使用 rng + 计数器生成可复现的 ID（而非 Date.now()）
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
  
  // Day4-2: 生成障碍物（基于 seed，确保可复现）
  private generateObstacles(): void {
    // 使用 shared 的 createRng，确保可复现
    const rng = createRng(this.seed);
    
    const count = 10 + Math.floor(rng() * 11); // 10-20 个障碍物
    const minSize = 40;
    const maxSize = 120;
    const minDistance = 60; // 障碍物之间最小距离
    const playerSpawnRadius = 100; // 玩家出生点周围不生成障碍物
    
    for (let i = 0; i < count; i++) {
      let attempts = 0;
      let x: number, y: number, w: number, h: number;
      let valid = false;
      
      // 尝试生成位置和大小，避免重叠和与玩家出生点重叠
      while (!valid && attempts < 100) {
        w = minSize + rng() * (maxSize - minSize);
        h = minSize + rng() * (maxSize - minSize);
        x = rng() * (this.mapConfig.width - w);
        y = rng() * (this.mapConfig.height - h);
        
        // 检查是否与现有障碍物太近
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
        
        // 检查是否与玩家出生点（地图中心）太近
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
        
        // 修复: 检查是否与撤离区相交（含 padding）
        if (valid) {
          const zone = this.mapConfig.extractZone;
          const padding = 30; // 撤离区缓冲边距
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
  
  // Day3: 检查玩家是否在撤离区内（矩形碰撞检测）
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

  // P0-2 修复: 寻找安全的出生点（避障 + 避撤离区 + 避边界 + 避其他玩家）
  private findSpawnPoint(): { x: number; y: number } {
    const PLAYER_RADIUS = 10; // 与 Player.processInput 一致
    const MIN_SPAWN_PLAYER_DISTANCE = 120; // 修复: 与其他玩家的最小距离
    const MAX_ATTEMPTS = 80;
    
    // 使用 seed + 玩家数量偏移初始化 RNG（保证可复现，每个玩家用不同的偏移）
    const spawnRng = createRng(this.seed + this.players.size * 1000);
    
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      // 随机点，但距离边界至少 PLAYER_RADIUS
      const x = PLAYER_RADIUS + spawnRng() * (this.mapConfig.width - 2 * PLAYER_RADIUS);
      const y = PLAYER_RADIUS + spawnRng() * (this.mapConfig.height - 2 * PLAYER_RADIUS);
      
      // 检查是否在撤离区内
      if (this.isInExtractZone(x, y)) {
        continue;
      }
      
      // 检查是否与障碍物碰撞
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
      
      // 修复: 检查与其他玩家的距离
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
      
      // 所有检查通过，返回安全出生点
      return { x, y };
    }
    
    // Fallback: 地图中心附近的安全点
    const centerX = this.mapConfig.width / 2;
    const centerY = this.mapConfig.height / 2;
    const fallbackRadius = 200; // 在中心附近 200px 范围内搜索
    
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
        
        // 修复: 检查与其他玩家的距离（fallback 搜索也需避开玩家）
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
        
        // 所有检查通过，返回安全出生点
        return { x, y };
      }
    }
    
    // 最后的 fallback：地图中心（可能不安全，但至少能出生）
    log('SPAWN_FALLBACK', {
      room: this.id,
      reason: 'no safe spawn found',
      tick: this.tick,
    });
    return { x: centerX, y: centerY };
  }

  addPlayer(playerId: string): Player {
    // P0-2 修复: 使用 findSpawnPoint 而不是随机撒点
    const spawn = this.findSpawnPoint();
    const player = new Player(playerId, spawn.x, spawn.y);
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

  // 处理输入（由tick循环调用）
  // Day2: 增加开火逻辑
  processInput(playerId: string, input: C2S_INPUT): void {
    const player = this.players.get(playerId);
    if (!player) return;

    // 只使用seq去重，不检查tick（简化策略）
    if (input.seq <= player.lastInputSeq) {
      return;
    }

    const oldX = player.x;
    const oldY = player.y;

    player.lastInputSeq = input.seq;
    player.lastInputTick = input.tick;

    // 更新玩家位置（20Hz tick = 50ms = 0.05s）
    // P0-1 修复: 传递 obstacles 参数，使碰撞检测生效
    const deltaTime = 0.05;
    player.processInput(input.keys, deltaTime, this.mapConfig.width, this.mapConfig.height, this.obstacles);

    // Day3: 处理拾取（interact）
    // Day3 修复C: 并发拾取保护（使用 findIndex + splice 原子操作）
    if (input.interact && player.status === 'ALIVE') {
      const pickupRadius = 28;
      let nearestItem: ITEM_STATE | null = null;
      let nearestItemIndex = -1;
      let nearestDist = pickupRadius + 1;
      
      // 找距离玩家最近且距离 <= pickupRadius 的物品
      for (let i = 0; i < this.items.length; i++) {
        const item = this.items[i];
        const dx = item.x - player.x;
        const dy = item.y - player.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist <= pickupRadius && dist < nearestDist) {
          nearestItem = item;
          nearestItemIndex = i;
          nearestDist = dist;
        }
      }
      
      // Day3 修复C: 如果找到物品，使用原子操作移除（防止并发拾取）
      if (nearestItem && nearestItemIndex >= 0) {
        // 原子操作：先移除，再增加 lootCount（即使并发，也只有一个玩家能成功移除）
        this.items.splice(nearestItemIndex, 1);
        player.lootCount += 1; // MVP: 每个物品 +1，后续可按 rarity 加不同分
        
        log('PICKUP', {
          room: this.id,
          player: playerId,
          item: nearestItem.id,
          type: nearestItem.type,
          pos: `(${player.x.toFixed(1)},${player.y.toFixed(1)})`,
          loot: player.lootCount,
          tick: this.tick,
        });
        // 游戏化增强: 推送拾取事件
        this.pushEvent(`${playerId} picked ${nearestItem.type} (+1 loot)`);
      }
    }
    
    // 游戏化增强: 处理撤离读条（extractHeld）
    if (input.extractHeld && player.status === 'ALIVE') {
      if (this.isInExtractZone(player.x, player.y)) {
        // 在撤离区内且按住F：增加进度
        player.extractProgress += 50; // 每 tick 50ms（20Hz = 50ms/tick）
        if (player.extractProgress >= 2000) {
          // 读条完成，撤离成功
          player.status = 'EXTRACTED';
          player.extractProgress = 0;
          
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
        // 不在撤离区内：进度清零
        player.extractProgress = 0;
      }
    } else {
      // 未按住F或已死亡：进度清零
      player.extractProgress = 0;
    }
    
    // Day3: 处理撤离（extract 脉冲事件，已废弃，保留兼容）
    if (input.extract && player.status === 'ALIVE') {
      if (this.isInExtractZone(player.x, player.y)) {
        // 兼容旧客户端：直接撤离（不推荐）
        player.status = 'EXTRACTED';
        player.extractProgress = 0;
        
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
    
    // Day2: 处理开火（Day3: EXTRACTED 玩家不能开火）
    const now = Date.now();
    if (input.shoot && player.canFire(now) && player.status === 'ALIVE') {
      // 生成子弹
      const bulletSpeed = 800; // 800px/s
      const vx = Math.cos(input.aim) * bulletSpeed;
      const vy = Math.sin(input.aim) * bulletSpeed;
      
      // 修复: 使用 rng + 计数器生成可复现的 ID（而非 Date.now() + Math.random()）
      // 使用 seed + tick 作为子弹 RNG 的偏移，确保同 tick 下可复现
      const bulletRng = createRng(this.seed + this.tick + this.bulletIdCounter);
      const bulletId = `b${this.bulletIdCounter++}_${Math.floor(bulletRng() * 1000000).toString(36)}`;
      // Step4: 创建内部Bullet类型，包含spawnAt用于TTL检测
      this.bullets.push({
        id: bulletId,
        x: player.x,
        y: player.y,
        vx,
        vy,
        ownerId: playerId,
        spawnAt: now, // Step4: 记录生成时间，用于TTL检测
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
    const bulletsToRemove = new Set<string>(); // Step4: 用Set避免O(n^2)
    
    for (const bullet of this.bullets) {
      // Step4: 子弹TTL检测（防止极端情况下子弹无限存在）
      if (now - bullet.spawnAt > 2000) { // 2秒TTL
        bulletsToRemove.add(bullet.id);
        continue;
      }
      
      // 修复: 子弹与障碍物碰撞检测（使用简化步进方法）
      const oldX = bullet.x;
      const oldY = bullet.y;
      const newX = bullet.x + bullet.vx * deltaTime;
      const newY = bullet.y + bullet.vy * deltaTime;
      
      // 将移动拆成 4 子步，每步检测障碍物碰撞
      const steps = 4;
      let hitObstacle = false;
      for (let step = 1; step <= steps; step++) {
        const t = step / steps;
        const stepX = oldX + (newX - oldX) * t;
        const stepY = oldY + (newY - oldY) * t;
        
        // 检查是否与障碍物碰撞（子弹视作点）
        for (const obstacle of this.obstacles) {
          // 点是否在矩形内（AABB 包含检测）
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
      
      // 检查出界
      if (bullet.x < 0 || bullet.x > this.mapConfig.width || 
          bullet.y < 0 || bullet.y > this.mapConfig.height) {
        bulletsToRemove.add(bullet.id);
        continue;
      }
      
      // 修复: 使用连续碰撞检测（CCD）检查命中玩家
      // 检测 oldPos -> newPos 的线段是否与玩家圆相交，避免高速子弹穿人
      const PLAYER_HIT_RADIUS = 16;
      for (const [playerId, player] of this.players.entries()) {
        // 不命中自己，不命中已死亡玩家
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
          
          // 如果玩家死亡，记录日志
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
    
    // Step4: 移除出界或命中的子弹（用Set.has，O(1)查找）
    this.bullets = this.bullets.filter(b => !bulletsToRemove.has(b.id));
  }

  // 获取当前状态快照
  // Step4: 输出时只返回BULLET_STATE字段（不包含spawnAt），保证协议兼容
  // 修复: obstacles 已移至 WORLD_INIT，不再在 snapshot 中发送
  getSnapshot(): {
    players: PLAYER_STATE[];
    bullets: BULLET_STATE[];
    items: ITEM_STATE[];
  } {
    return {
      players: Array.from(this.players.values()).map((p) => p.toState()),
      // Step4: 映射内部Bullet类型到BULLET_STATE（去掉spawnAt字段）
      bullets: this.bullets.map(({ spawnAt, ...b }) => b),
      items: this.items,
      // 修复: obstacles 已移至 S2C_WORLD_INIT，不再在 snapshot 中发送（减少带宽）
    };
  }
  
  // 修复: 获取静态障碍物列表（用于 WORLD_INIT）
  getObstacles(): OBSTACLE_STATE[] {
    return [...this.obstacles];
  }
  
  // 修复: 获取当前物品列表（用于 WORLD_INIT）
  getItems(): ITEM_STATE[] {
    return [...this.items];
  }
}

