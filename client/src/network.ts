import {
  C2S_HELLO_SCHEMA,
  C2S_INPUT_SCHEMA,
  C2S_PING_SCHEMA, // Day5: Ping 消息
  C2S_PICKUP_WORLD_ITEM_SCHEMA, // 保留兼容（deprecated）
  C2S_PICKUP_LOOT_BAG_SCHEMA, // 保留兼容（deprecated）
  C2S_SELL_FROM_STASH_SCHEMA, // 新增: 从仓库卖出
  C2S_INTERACT_SCHEMA, // 新增: 通用交互
  C2S_USE_ITEM_SCHEMA, // 新增: 使用物品
  C2S_THROW_SCHEMA, // 新增: 投掷物品
  C2S_ADMIN_SCHEMA, // 管理员命令
  C2S_SET_NAME_SCHEMA, // 新增: 设置昵称
  C2S_MOVE_STASH_TO_PREP_SCHEMA, // 新增: 从仓库移动到整备区
  C2S_MOVE_PREP_TO_STASH_SCHEMA, // 新增: 从整备区移动回仓库
  C2S_BUY_SCHEMA, // 新增: 商店购买物品
  C2S_ENTER_RAID_SCHEMA, // 新增: 进入战局
  C2S_EXIT_RESULT_SCHEMA, // 新增: 退出结果页面
  C2S_EQUIP_SCHEMA, // 新增: 装备/卸下装备
  C2S_DROP_ITEM_SCHEMA, // 新增: 局内丢弃物品
  C2S_RAID_EQUIP_SCHEMA, // 新增: 局内装备切换
  C2S_LOCAL_BULLET_HIT_SCHEMA, // 新增: 本地命中上报
  S2C_MESSAGE_SCHEMA,
  type S2C_MESSAGE,
  type S2C_SNAPSHOT,
  type S2C_WORLD_INIT, // 新增: 世界初始化消息类型
  type S2C_RAID_RESULT, // 新增: 战局结果消息类型
  type S2C_COMBAT_EVENT, // 新增: 战斗事件消息类型
  type S2C_MELEE_SWING, // 新增: 近战挥击事件类型
  type S2C_EXPLOSION, // 新增: 爆炸事件类型
  type S2C_SMOKE, // 新增: 烟雾事件类型
  type MAP_CONFIG, // P0-1 修复: 使用 shared 的 MAP_CONFIG 类型，避免类型漂移
  type OBSTACLE_STATE, // 修复: 静态世界初始化
  type ITEM_STATE, // 修复: 静态世界初始化
} from '@jerkie-man/shared';
import { SnapshotBuffer } from './snapshot.js';

// 生成或获取 accountId（用于持久化 Profile）
function getOrCreateAccountId(): string {
  const key = 'jerkie_man_account_id';
  let accountId = localStorage.getItem(key);
  if (!accountId) {
    // 生成 UUID v4
    accountId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
    localStorage.setItem(key, accountId);
    console.log('[Account] Created new accountId:', accountId);
  } else {
    console.log('[Account] Loaded existing accountId:', accountId);
  }
  return accountId;
}

// P0-1 修复: 使用 shared 的 MAP_CONFIG 类型，避免类型漂移
// 如果 shared 的 MAP_CONFIG 未来加字段/改字段，这里会自动同步
export interface RoomInfo {
  seed?: number;
  mapConfig?: MAP_CONFIG;
}

export interface NetworkCallbacks {
  onSnapshot?: (snapshot: S2C_SNAPSHOT) => void;
  onError?: (error: string) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onWelcome?: (playerId: string, accountId: string, roomInfo?: RoomInfo) => void;
  onEvent?: (message: string) => void; // 游戏化增强: 服务端事件回调
  onWorldInit?: (world: S2C_WORLD_INIT) => void; // 新增: 世界初始化回调（使用协议类型）
  onProfile?: (profile: { accountId: string; displayName: string | null; phase: 'NAME' | 'HIDEOUT' | 'RAID' | 'RESULT'; money: number; stash: any[]; prep?: any[]; bagCap: number; equipment: { weaponIid: string | null; bagIid: string | null; armorIid: string | null } }) => void; // P1-1: Profile 回调
  onRaidResult?: (result: S2C_RAID_RESULT) => void; // 新增: 战局结果回调
  onCombatEvent?: (event: { kind: 'DRY_FIRE' | 'HIT' | 'DAMAGE_TAKEN'; direction?: number }) => void; // 新增: 战斗事件回调
  onMeleeSwing?: (event: S2C_MELEE_SWING) => void; // 新增: 近战挥击事件回调
  onExplosion?: (event: S2C_EXPLOSION) => void; // 新增: 爆炸事件回调
  onSmoke?: (event: S2C_SMOKE) => void; // 新增: 烟雾事件回调
}

export class Network {
  private ws: WebSocket | null = null;
  private url: string;
  private room: string;
  private accountId: string; // 账号身份
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 10;
  private reconnectDelay = 1000; // 初始1秒
  private reconnectTimer: number | null = null;
  private callbacks: NetworkCallbacks;
  private snapshotBuffer: SnapshotBuffer;
  private isConnected = false;
  private lastServerTick = 0;
  private isDebug: boolean = false;
  private lastParseWarnTime = 0; // 节流：5秒最多一次
  
  // P0-2: 控制是否应该自动重连的标志
  // 当调用disconnect()时设为false，阻止自动重连
  private shouldReconnect = true;
  
  // P1-2 修复: 记录下次重连的绝对时间（用于计算真实剩余时间）
  private nextReconnectAt: number | null = null;
  
  // Day5: Ping/Pong 相关
  private pingTimer: number | null = null;
  private currentPing: number | null = null; // 当前 ping 值（毫秒）
  private readonly PING_INTERVAL_MS = 2000; // 每 2 秒发送一次 ping

  constructor(url: string, room: string, callbacks: NetworkCallbacks = {}, isDebug: boolean = false) {
    this.url = url;
    this.room = room;
    this.accountId = getOrCreateAccountId();
    this.callbacks = callbacks;
    this.snapshotBuffer = new SnapshotBuffer();
    this.isDebug = isDebug;
    this.connect();
  }
  
  // 暴露 accountId 给外部（用于 HUD debug 显示）
  getAccountId(): string {
    return this.accountId;
  }

  private connect(): void {
    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        // 修复: 如果用户已手动断开，立即关闭连接
        if (!this.shouldReconnect) {
          if (this.ws) {
            this.ws.close();
            this.ws = null;
          }
          return;
        }
        
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.reconnectDelay = 1000;
        
        // P0-2: 连接成功时重置shouldReconnect，确保正常断线仍会自动重连
        this.shouldReconnect = true;
        
        // P1-2 修复: 连接成功时清除重连倒计时
        this.nextReconnectAt = null;
        
        // 重置插值相关状态
        this.lastServerTick = 0;
        this.snapshotBuffer.clear();
        
        // Day5: 重置 ping
        this.currentPing = null;

        console.log('Connected to server');

        // 发送HELLO
        this.sendHello();
        
        // Day5: 启动 ping 定时器
        this.startPingTimer();

        if (this.callbacks.onConnect) {
          this.callbacks.onConnect();
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const raw = JSON.parse(event.data.toString());
          const message = S2C_MESSAGE_SCHEMA.parse(raw) as S2C_MESSAGE;

          // 统一通过schema解析，未知类型会被zod拒绝
          if (message.type === 'S2C_WELCOME') {
            if (this.callbacks.onWelcome) {
              // Day4-1: 传递 roomInfo（seed + mapConfig）
              this.callbacks.onWelcome(message.playerId, message.accountId, {
                seed: message.seed,
                mapConfig: message.mapConfig,
              });
            }
          } else if (message.type === 'S2C_SNAPSHOT') {
            this.lastServerTick = message.tick;
            this.snapshotBuffer.add(message);
            if (this.callbacks.onSnapshot) {
              this.callbacks.onSnapshot(message);
            }
          } else if (message.type === 'S2C_WORLD_INIT') {
            // 修复: 处理静态世界初始化消息
            if (this.callbacks.onWorldInit) {
              this.callbacks.onWorldInit(message);
            }
          } else if (message.type === 'S2C_EVENT') {
            // 游戏化增强: 处理服务端事件
            if (this.callbacks.onEvent) {
              this.callbacks.onEvent(message.message);
            }
          } else if (message.type === 'S2C_PONG') {
            // Day5: 处理 Pong 消息，计算 RTT
            const now = Date.now();
            const rtt = now - message.clientTimestamp;
            this.currentPing = rtt;
          } else if (message.type === 'S2C_PROFILE') {
            // P1-1: 处理 Profile 消息
            if (this.callbacks.onProfile) {
              this.callbacks.onProfile({
                accountId: message.accountId,
                displayName: message.displayName,
                phase: message.phase,
                money: message.money,
                stash: message.stash,
                prep: message.prep,
                bagCap: message.bagCap,
                equipment: message.equipment,
              });
            }
          } else if (message.type === 'S2C_RAID_RESULT') {
            // 新增: 处理战局结果消息
            // 记录日志：记录是否收到 S2C_RAID_RESULT，直接打印到控制台
            console.log('[S2C_RAID_RESULT] 收到战局结果消息', {
              result: message.result,
              extracted: message.result === 'EXTRACTED',
              lootCount: message.loot.length,
              moneyGained: message.moneyGained,
              moneyLost: message.moneyLost,
            });
            if (this.callbacks.onRaidResult) {
              this.callbacks.onRaidResult(message);
            }
          } else if (message.type === 'S2C_COMBAT_EVENT') {
            // 新增: 处理战斗事件消息
            if (this.callbacks.onCombatEvent) {
              this.callbacks.onCombatEvent(message);
            }
          } else if (message.type === 'S2C_MELEE_SWING') {
            // 新增: 处理近战挥击事件
            if (this.callbacks.onMeleeSwing) {
              this.callbacks.onMeleeSwing(message);
            }
          } else if (message.type === 'S2C_EXPLOSION') {
            if (this.callbacks.onExplosion) {
              this.callbacks.onExplosion(message);
            }
          } else if (message.type === 'S2C_SMOKE') {
            if (this.callbacks.onSmoke) {
              this.callbacks.onSmoke(message);
            }
          } else if (message.type === 'S2C_ERROR') {
            console.error('Server error:', message.message);
            if (this.callbacks.onError) {
              this.callbacks.onError(message.message);
            }
          }
        } catch (error) {
          // 解析失败：静默忽略（策略：只在debug模式下或节流打印）
          if (this.isDebug) {
            console.warn('Failed to parse message (ignored):', error);
          } else {
            // 非debug模式：节流警告（5秒最多一次）
            const now = Date.now();
            if (now - this.lastParseWarnTime >= 5000) {
              console.warn('Failed to parse message (ignored, throttled):', error);
              this.lastParseWarnTime = now;
            }
          }
        }
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        console.log('Disconnected from server');

        // P0-2 修复: 断线时清理 snapshot buffer，避免显示旧世界
        this.snapshotBuffer.clear();
        
        // Day5: 停止 ping 定时器
        this.stopPingTimer();
        this.currentPing = null;

        if (this.callbacks.onDisconnect) {
          this.callbacks.onDisconnect();
        }

        // P0-2: 只有shouldReconnect为true时才自动重连
        // 当用户主动调用disconnect()时，shouldReconnect=false，不会重连
        if (this.shouldReconnect) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        if (this.callbacks.onError) {
          this.callbacks.onError('WebSocket error');
        }
      };
    } catch (error) {
      console.error('Failed to connect:', error);
      // 修复: 手动断开后不应再重连
      if (this.shouldReconnect) {
        this.scheduleReconnect();
      }
    }
  }

  private scheduleReconnect(): void {
    // 修复: 手动断开后不应再重连
    if (!this.shouldReconnect) {
      return;
    }
    
    if (this.reconnectTimer !== null) {
      return; // 已经安排了重连
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnect attempts reached');
      this.nextReconnectAt = null; // P1-2 修复: 不再重连时清除倒计时
      this.shouldReconnect = false; // 修复: 达到上限时停止重连，避免 HUD 一直显示 reconnecting
      return;
    }

    this.reconnectAttempts++;
    // P1-2 修复: 记录下次重连的绝对时间
    this.nextReconnectAt = Date.now() + this.reconnectDelay;
    console.log(`Reconnecting in ${this.reconnectDelay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.nextReconnectAt = null; // P1-2 修复: 重连开始前清除倒计时
      this.connect();
      // 指数退避，最多10秒
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 10000);
    }, this.reconnectDelay);
  }

  private sendHello(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const message = C2S_HELLO_SCHEMA.parse({
      type: 'C2S_HELLO',
      room: this.room,
      accountId: this.accountId,
    });

    this.ws.send(JSON.stringify(message));
  }

  // 新增: 发送拾取世界物品动作
  sendPickupWorldItem(wid: string): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    try {
      const message = C2S_PICKUP_WORLD_ITEM_SCHEMA.parse({
        type: 'C2S_PICKUP_WORLD_ITEM',
        wid,
      });
      this.ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('Failed to send pickup world item:', error);
      return false;
    }
  }

  // 新增: 发送拾取掉落包动作
  sendPickupLootBag(bid: string): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    try {
      const message = C2S_PICKUP_LOOT_BAG_SCHEMA.parse({
        type: 'C2S_PICKUP_LOOT_BAG',
        bid,
      });
      this.ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('Failed to send pickup loot bag:', error);
      return false;
    }
  }

  // 新增: 发送从仓库卖出物品动作
  sendSellFromStash(iid: string, qty: number): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    try {
      const message = C2S_SELL_FROM_STASH_SCHEMA.parse({
        type: 'C2S_SELL_FROM_STASH',
        iid,
        qty,
      });
      this.ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('Failed to send sell from stash:', error);
      return false;
    }
  }

  // 新增: 发送通用交互（服务端选最近目标）
  sendInteract(): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    try {
      const message = C2S_INTERACT_SCHEMA.parse({
        type: 'C2S_INTERACT',
      });
      this.ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('Failed to send interact:', error);
      return false;
    }
  }

  // 新增: 发送使用物品（快捷栏1-5键）
  sendUseItem(slot: number): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    try {
      const message = C2S_USE_ITEM_SCHEMA.parse({
        type: 'C2S_USE_ITEM',
        slot,
      });
      this.ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('Failed to send use item:', error);
      return false;
    }
  }

  // 新增: 发送投掷物品
  sendThrow(targetX: number, targetY: number, itemType: string): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    try {
      const message = C2S_THROW_SCHEMA.parse({
        type: 'C2S_THROW',
        targetX,
        targetY,
        itemType,
      });
      this.ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('Failed to send throw:', error);
      return false;
    }
  }

  // 新增: 发送管理员命令
  sendAdminCommand(command: 'show_status' | 'reset_world'): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    try {
      const message = C2S_ADMIN_SCHEMA.parse({
        type: 'C2S_ADMIN',
        command,
      });
      this.ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('Failed to send admin command:', error);
      return false;
    }
  }

  // 新增: 发送设置昵称
  sendSetName(name: string): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    try {
      const message = C2S_SET_NAME_SCHEMA.parse({
        type: 'C2S_SET_NAME',
        name,
      });
      this.ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('Failed to send set name:', error);
      return false;
    }
  }

  // 新增: 发送从仓库移动到整备区
  sendMoveStashToPrep(iid: string, qty: number): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    try {
      const message = C2S_MOVE_STASH_TO_PREP_SCHEMA.parse({
        type: 'C2S_MOVE_STASH_TO_PREP',
        iid,
        qty,
      });
      this.ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('Failed to send move stash to prep:', error);
      return false;
    }
  }

  // 新增: 发送从整备区移动回仓库
  sendMovePrepToStash(iid: string, qty: number): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    try {
      const message = C2S_MOVE_PREP_TO_STASH_SCHEMA.parse({
        type: 'C2S_MOVE_PREP_TO_STASH',
        iid,
        qty,
      });
      this.ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('Failed to send move prep to stash:', error);
      return false;
    }
  }

  // 新增: 发送商店购买物品
  sendBuy(typeId: string, qty: number): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    try {
      const message = C2S_BUY_SCHEMA.parse({
        type: 'C2S_BUY',
        typeId,
        qty,
      });
      this.ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('Failed to send buy:', error);
      return false;
    }
  }

  // 新增: 发送装备/卸下消息
  sendEquip(slot: 'weapon' | 'bag' | 'armor', iid: string | null): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    try {
      const message = C2S_EQUIP_SCHEMA.parse({
        type: 'C2S_EQUIP',
        slot,
        iid,
      });
      this.ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('Failed to send equip:', error);
      return false;
    }
  }

  // 新增: 发送局内装备切换消息
  sendRaidEquip(slot: 'weapon' | 'bag' | 'armor', iid: string | null): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    try {
      const message = C2S_RAID_EQUIP_SCHEMA.parse({
        type: 'C2S_RAID_EQUIP',
        slot,
        iid,
      });
      this.ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('Failed to send raid equip:', error);
      return false;
    }
  }

  // 新增: 局内丢弃物品
  sendDropItem(iid: string, qty: number): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    try {
      const message = C2S_DROP_ITEM_SCHEMA.parse({
        type: 'C2S_DROP_ITEM',
        iid,
        qty,
      });
      this.ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('Failed to send drop item:', error);
      return false;
    }
  }

  // 新增: 发送退出结果页面（从 RESULT 阶段返回 HIDEOUT）
  sendExitResult(): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    try {
      const message = C2S_EXIT_RESULT_SCHEMA.parse({
        type: 'C2S_EXIT_RESULT',
      });
      this.ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('Failed to send exit result:', error);
      return false;
    }
  }

  // 新增: 发送进入战局
  sendEnterRaid(): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    try {
      const message = C2S_ENTER_RAID_SCHEMA.parse({
        type: 'C2S_ENTER_RAID',
      });
      this.ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('Failed to send enter raid:', error);
      return false;
    }
  }

  // P0-1 修复: 返回 boolean 表示是否真的发送成功
  sendInput(
    seq: number,
    keys: { up: boolean; down: boolean; left: boolean; right: boolean },
    aim: number,
    shoot: boolean = false,
    reload: boolean = false, // 新增: 换弹标志
    interact: boolean = false,
    extract: boolean = false,
    extractHeld: boolean = false, // 游戏化增强: 撤离持续状态
    sprint: boolean = false, // 新增: 冲刺状态
    shotId?: number, // 本次发射的唯一ID（用于客户端预测子弹对齐）
    shootOriginX?: number,
    shootOriginY?: number,
    spreadSeed?: number, // 散布随机种子（客户端生成，服务端使用相同种子保证散布一致）
    burstShots?: Array<{ shotId: number; originX: number; originY: number; spreadSeed: number }> // 新增: 三连发时客户端推送的所有子弹信息
  ): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false; // P0-1: 发送失败，返回 false
    }

    const message = C2S_INPUT_SCHEMA.parse({
      type: 'C2S_INPUT',
      seq,
      tick: this.lastServerTick, // 使用最后收到的server tick
      keys,
      aim,
      shoot, // Day2: 传递开火标志
      reload, // 新增: 传递换弹标志
      interact, // Day3: 传递拾取脉冲事件
      extract, // Day3: 传递撤离脉冲事件（已废弃，保留兼容）
      extractHeld, // 游戏化增强: 传递撤离持续状态
      sprint, // 新增: 传递冲刺状态
      shotId, // 本次发射的唯一ID（用于客户端预测子弹对齐）
      shootOriginX,
      shootOriginY,
      spreadSeed, // 散布随机种子（客户端生成，服务端使用相同种子保证散布一致）
      burstShots, // 新增: 三连发时客户端推送的所有子弹信息
    });

    this.ws.send(JSON.stringify(message));
    return true; // P0-1: 发送成功，返回 true
  }

  sendLocalBulletHit(data: {
    bulletId: string;
    clientShotId?: number;
    targetId: string;
    targetX: number;
    targetY: number;
    hitX: number;
    hitY: number;
    spawnX: number;
    spawnY: number;
    timestamp: number;
  }): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    try {
      const message = C2S_LOCAL_BULLET_HIT_SCHEMA.parse({
        type: 'C2S_LOCAL_BULLET_HIT',
        ...data,
      });
      this.ws.send(JSON.stringify(message));
      console.log('[network] sent LOCAL_BULLET_HIT', data.bulletId);
      return true;
    } catch (error) {
      console.error('Failed to send local bullet hit report:', error);
      return false;
    }
  }

  getSnapshotBuffer(): SnapshotBuffer {
    return this.snapshotBuffer;
  }

  // P1-2 修复: 暴露重连状态，供 HUD 显示（返回真实剩余时间）
  public getReconnectState(): { attempts: number; nextReconnectInMs: number | null } {
    let nextReconnectInMs: number | null = null;
    if (this.nextReconnectAt !== null) {
      // 计算真实剩余时间（至少为0，避免负数）
      nextReconnectInMs = Math.max(0, this.nextReconnectAt - Date.now());
    }
    return {
      attempts: this.reconnectAttempts,
      nextReconnectInMs,
    };
  }

  getConnectionState(): {
    connected: boolean;
    reconnecting: boolean; // P1-2 修复: 暴露重连状态
    reconnectAttempts: number; // P1-2 修复: 暴露重连尝试次数
    nextReconnectInMs: number | null; // P1-2 修复: 暴露下次重连倒计时
    lastServerTick: number;
    ping: number | null; // Day5: 暴露 ping 值
  } {
    const reconnectState = this.getReconnectState();
    return {
      connected: this.isConnected,
      reconnecting: !this.isConnected && this.shouldReconnect && reconnectState.attempts > 0, // P1-2 修复
      reconnectAttempts: reconnectState.attempts, // P1-2 修复
      nextReconnectInMs: reconnectState.nextReconnectInMs, // P1-2 修复
      lastServerTick: this.lastServerTick,
      ping: this.currentPing, // Day5: 暴露 ping 值
    };
  }

  disconnect(): void {
    // P0-2: 设置shouldReconnect=false，阻止onclose时自动重连
    this.shouldReconnect = false;
    
    // 清理重连定时器
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    // P1-2 修复: 清除重连倒计时
    this.nextReconnectAt = null;
    
    // Day5: 停止 ping 定时器
    this.stopPingTimer();
    this.currentPing = null;

    // 关闭WebSocket连接
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
  
  // Day5: 启动 ping 定时器
  private startPingTimer(): void {
    this.stopPingTimer(); // 先清理旧的定时器
    
    const sendPing = () => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return;
      }
      
      const timestamp = Date.now();
      const message = C2S_PING_SCHEMA.parse({
        type: 'C2S_PING',
        timestamp,
      });
      
      this.ws.send(JSON.stringify(message));
    };
    
    // 立即发送一次
    sendPing();
    
    // 然后每 2 秒发送一次
    this.pingTimer = window.setInterval(sendPing, this.PING_INTERVAL_MS);
  }
  
  // Day5: 停止 ping 定时器
  private stopPingTimer(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }
}
