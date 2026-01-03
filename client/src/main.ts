import { Renderer } from './renderer.js';
import { Network } from './network.js';
import { InputManager } from './input.js';
import { HUD } from './hud.js';
import { DebugLog } from './debugLog.js'; // 修复: 添加 debug log 系统
import { loadMapConfig, type MAP_CONFIG, simulatePlayerMove } from '@jerkie-man/shared'; // 修复: 导入共享模拟函数
import type { S2C_SNAPSHOT, PLAYER_STATE, OBSTACLE_STATE, ITEM_STATE, WorldItem, LootBag, PlayerInventory, ItemInstance } from '@jerkie-man/shared';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
if (!canvas) {
  throw new Error('Canvas not found');
}

// 初始化渲染器（必须先初始化，才能调用resize）
const renderer = new Renderer(canvas);

// 初始化Canvas（全屏）- 只设置CSS尺寸，由Renderer负责backing store
// Step1: 彻底修复Canvas宽度/布局问题
// - 使用HUD实际宽度 + 上限保护，避免HUD变宽导致canvas被挤到最小
// - 使用rAF防抖，避免resize时频繁读写DOM导致抖动
// - 使用ResizeObserver监听HUD宽度变化，自动更新canvas
// 修复: 添加阈值，避免频繁 resize 导致卡顿/重影
let lastCanvasW = 0;
let lastCanvasH = 0;
const RESIZE_THRESHOLD = 3; // 只有尺寸变化超过 3px 才真正 resize

function updateCanvasSize(): void {
  const hudEl = document.getElementById('hud');
  const hudWidthMeasured = hudEl?.getBoundingClientRect().width ?? 300;

  // 计算可用canvas宽度时，增加上限保护
  const minCanvasW = 320;
  const minCanvasH = 240;
  const maxHudW = Math.max(0, window.innerWidth - minCanvasW);
  
  // HUD宽度上限保护：避免测量异常（0或超大值）导致canvas计算不合理
  const hudWidth = Math.min(Math.ceil(hudWidthMeasured), maxHudW);
  const cssWidth = Math.max(minCanvasW, window.innerWidth - hudWidth);
  const cssHeight = Math.max(minCanvasH, window.innerHeight);

  // 修复: 只有当尺寸变化超过阈值时才真正 resize（避免频繁 resize 导致卡顿/重影）
  if (Math.abs(cssWidth - lastCanvasW) < RESIZE_THRESHOLD && 
      Math.abs(cssHeight - lastCanvasH) < RESIZE_THRESHOLD) {
    return; // 尺寸变化太小，不触发 resize
  }
  
  lastCanvasW = cssWidth;
  lastCanvasH = cssHeight;
  
  // Debug: 计数 resize 次数（确认移动时不会频繁触发）
  // 修复: 使用可选的方式检查 isDebug，避免初始化顺序问题
  const debugMode = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug') === '1';
  if (debugMode) {
    console.count('renderer.resize');
  }
  
  renderer.resize(cssWidth, cssHeight);
}

// rAF防抖：避免resize时频繁读写DOM导致抖动
let resizeRafId: number | null = null;
function scheduleResize(): void {
  if (resizeRafId !== null) {
    return; // 已经排队了，不重复排队
  }
  resizeRafId = requestAnimationFrame(() => {
    resizeRafId = null;
    updateCanvasSize();
  });
}

// 初始resize
updateCanvasSize();

// 窗口resize监听：使用rAF防抖
window.addEventListener('resize', scheduleResize);

// ResizeObserver监听HUD宽度变化：当HUD表格变宽/变窄时，也触发resize
// 修复: 保存 resizeObserver 引用，用于 cleanup
let resizeObserver: ResizeObserver | null = null;
const hudEl = document.getElementById('hud');
if (hudEl) {
  resizeObserver = new ResizeObserver(() => {
    scheduleResize(); // HUD宽度变化时，也触发canvas resize
  });
  resizeObserver.observe(hudEl);
}

// P1-2 修复: 监听页面滚动和 viewport 变化，刷新 canvas rect 缓存
// 避免 layout shift 导致 screenToWorld/worldToScreen 错位
window.addEventListener('scroll', () => renderer.refreshRect(), { passive: true });

// 兼容移动端/缩放等导致的 viewport 变化（桌面也可能触发）
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', () => renderer.refreshRect());
}

// Step3: 输入管理器接收canvas，开火输入只在canvas上监听
const inputManager = new InputManager(canvas);

// 初始化HUD
const hud = new HUD('hud');
hud.addEvent('Client started');

// Day4-1: 使用 server 下发的 mapConfig（单一真相来源）
// 如果 server 未下发，fallback 到本地配置（兼容模式）
let serverMapConfig: MAP_CONFIG | null = null;
let serverSeed: number | null = null;
const fallbackMapConfig = loadMapConfig(); // 仅用于兼容

// 修复: 缓存静态世界数据（从 WORLD_INIT 接收）
let cachedObstacles: OBSTACLE_STATE[] = [];
let cachedItems: ITEM_STATE[] = [];
// 新增: 缓存世界物品（从 WORLD_INIT 接收）
let cachedWorldItems: WorldItem[] = [];
// P1-1 新增: 玩家 Profile（从 S2C_PROFILE 接收）
let playerProfile: { money: number; stash: ItemInstance[]; bagCap: number } | null = null;

// 修复: 客户端预测相关状态
interface PendingInput {
  seq: number;
  keys: { up: boolean; down: boolean; left: boolean; right: boolean };
  deltaTime: number; // 固定为 0.05（与 server tick 一致）
}
let pendingInputs: PendingInput[] = [];
let predictedLocalPlayer: PLAYER_STATE | null = null; // 预测的本地玩家状态
// 修复: 渲染平滑 - 每帧平滑追向预测位置，避免 20Hz 步进卡顿
let renderLocalPlayer: PLAYER_STATE | null = null;
let lastRenderNow = performance.now();

// 指数平滑：halfLife 越小，追得越快；0.06~0.10 秒通常手感不错
function smoothTo(current: number, target: number, dtSec: number, halfLifeSec = 0.08): number {
  const a = 1 - Math.pow(0.5, dtSec / halfLifeSec);
  return current + (target - current) * a;
}

// 修复: 客户端 tick 对齐（严格 20Hz，与 server 同步）
const CLIENT_TICK_MS = 50; // 与 server tick 间隔一致
let clientAccMs = 0; // 客户端 tick 累积器（毫秒）
let lastClientTickTime = 0; // 上次客户端 tick 的时间戳

// Debug开关：从URL参数读取（生产环境也可通过?debug=1启用）
const urlParams = new URLSearchParams(window.location.search);
const isDebug = urlParams.get('debug') === '1';

// 修复: 初始化 debug log 系统（必须在所有使用 dbg 的地方之前）
const dbg = new DebugLog(600);
(window as any).__dbgDump = (n = 200) => dbg.dump(n);

// 修复: 快捷键复制日志（debug 模式才启用）
if (isDebug) {
  window.addEventListener('keydown', async (e) => {
    if (e.key === '`') { // 按 ` 打印最近日志
      const text = dbg.dump(220);
      console.log(text);
      try {
        await navigator.clipboard.writeText(text);
        console.log('[DBG] copied to clipboard');
      } catch {}
    }
  });
}

// 初始化网络
let localPlayerId: string | null = null;
let inputSeq = 0;
let selectedEntity: PLAYER_STATE | null = null;

const network = new Network('ws://localhost:8080', 'local', {
  onConnect: () => {
    console.log('Connected to server');
    hud.addEvent('Connected to server');
  },
  onDisconnect: () => {
    console.log('Disconnected from server');
    hud.addEvent('Disconnected from server');
    hud.addEvent('World cleared'); // P0-2 修复: 提示世界已清空
    // 清理重连状态
    localPlayerId = null;
    selectedEntity = null;
    // 修复: 断开连接时清空预测状态
    pendingInputs = [];
    predictedLocalPlayer = null;
    renderLocalPlayer = null; // 修复: 同时清空渲染平滑状态
    clientAccMs = 0;
    lastClientTickTime = 0;
    // P0-2 修复: snapshotBuffer 已在 Network.onclose 中清理，这里不需要再清理
  },
  onWelcome: (playerId: string, roomInfo?: { seed?: number; mapConfig?: MAP_CONFIG }) => {
    localPlayerId = playerId;
    console.log(`Received welcome, local player ID: ${localPlayerId}`);
    hud.addEvent(`Local player ID: ${localPlayerId}`);
    
    // Day4-1: 接收并保存 server 下发的世界配置
    if (roomInfo?.mapConfig) {
      serverMapConfig = roomInfo.mapConfig;
      serverSeed = roomInfo.seed ?? null;
      hud.addEvent(`Server mapConfig received (seed: ${serverSeed ?? 'N/A'})`);
    } else {
      // Day4-1: 兼容模式：server 未下发 mapConfig，使用 fallback 并警告
      hud.addEvent('WARN: mapConfig missing from server, fallback to local');
      serverMapConfig = null;
      serverSeed = null;
    }
    
    // P0-2 修复: 重连后重置发送状态缓存，避免重连后不再发送输入
    // 如果不重置，重连后如果 keys/aim 状态和断线前一致，keysChanged/aimChanged 会一直 false
    // 导致 shouldSend 一直 false，长时间不发 input
    lastSentKeys = null;
    lastSentAim = NaN;
    lastSentShoot = false;
    lastSentExtractHeld = null; // 游戏化增强: 重置撤离持续状态
    interactUntil = 0; // P2-2: 重置 interact TTL
    // 修复: pendingExtract 不再使用
    // pendingExtract = false;
    // 修复: 重连后清空预测状态
    pendingInputs = [];
    predictedLocalPlayer = null;
    renderLocalPlayer = null; // 修复: 同时清空渲染平滑状态
    clientAccMs = 0;
    lastClientTickTime = 0;
    // inputSeq 不重置（保持递增，避免 server 端 seq 冲突）
  },
  onSnapshot: (snapshot: S2C_SNAPSHOT) => {
    // 更新选中实体的数据（如果已选中）
    if (selectedEntity) {
      const updated = snapshot.players.find((p) => p.id === selectedEntity!.id);
      if (updated) {
        selectedEntity = updated;
      } else {
        // 玩家已断线/被移除，清空选中状态
        selectedEntity = null;
      }
    }
    
    // 修复: 客户端预测 reconciliation（回滚重放）
    if (localPlayerId) {
      const serverPlayer = snapshot.players.find((p) => p.id === localPlayerId);
      if (serverPlayer) {
        // 修复: 记录回滚前的状态
        const before = predictedLocalPlayer ? { x: predictedLocalPlayer.x, y: predictedLocalPlayer.y } : null;
        const pendingBefore = pendingInputs.length;
        
        const ackSeq = serverPlayer.lastInputSeq;
        // 移除已确认的输入（seq <= serverPlayer.lastInputSeq）
        pendingInputs = pendingInputs.filter((input) => input.seq > ackSeq);
        const removed = pendingBefore - pendingInputs.length;
        
        // 从 server 状态开始，重放剩余的 pendingInputs
        let predictedPos = { x: serverPlayer.x, y: serverPlayer.y };
        const mapConfig = serverMapConfig ?? fallbackMapConfig;
        
        for (const input of pendingInputs) {
          predictedPos = simulatePlayerMove(
            predictedPos,
            input.keys,
            input.deltaTime,
            mapConfig.width,
            mapConfig.height,
            cachedObstacles
          );
        }
        
        const after = predictedPos;
        const err = before
          ? Math.hypot(after.x - before.x, after.y - before.y)
          : 0;
        
        // 修复: debug log - 记录回滚重放关键数据
        dbg.push('RECON', {
          tick: snapshot.tick,
          ackSeq,
          removed,
          remain: pendingInputs.length,
          server: { x: +serverPlayer.x.toFixed(2), y: +serverPlayer.y.toFixed(2) },
          before: before ? { x: +before.x.toFixed(2), y: +before.y.toFixed(2) } : null,
          after: { x: +after.x.toFixed(2), y: +after.y.toFixed(2) },
          err: +err.toFixed(2),
          hasObstacles: cachedObstacles.length,
        });
        
        // 更新预测的本地玩家状态
        predictedLocalPlayer = {
          ...serverPlayer,
          x: predictedPos.x,
          y: predictedPos.y,
        };
      }
    }
  },
  onError: (error: string) => {
    console.error('Network error:', error);
    hud.addEvent(`Error: ${error}`);
  },
  // 游戏化增强: 接收服务端事件并显示在 HUD
  onEvent: (message: string) => {
    hud.addEvent(message);
  },
  onWorldInit: (world) => {
    // 修复: 接收并缓存静态世界数据
    cachedObstacles = world.obstacles;
    cachedItems = world.items ?? []; // 修复: 处理可选字段
    cachedWorldItems = world.worldItems ?? []; // 新增: 缓存世界物品
    serverMapConfig = world.mapConfig;
    serverSeed = world.seed;
    
    // P0-3 修复: 设置 Renderer 的世界边界（用于 camera clamp）
    renderer.setWorldBounds(world.mapConfig.width, world.mapConfig.height);
    
    const itemsCount = world.items?.length ?? 0;
    const worldItemsCount = world.worldItems?.length ?? 0;
    console.log(`Received world init: seed=${world.seed}, obstacles=${world.obstacles.length}, items=${itemsCount}, worldItems=${worldItemsCount}`);
    hud.addEvent(`World initialized: ${world.obstacles.length} obstacles, ${itemsCount} items, ${worldItemsCount} worldItems`);
  },
  // P1-1 新增: 接收 Profile 消息并更新 HUD
  onProfile: (profile) => {
    playerProfile = profile;
    console.log(`Received profile: money=${profile.money}, stash=${profile.stash.length} items, bagCap=${profile.bagCap}`);
  },
}, isDebug);

// Step3: 右键选中实体（避免与左键开火冲突）
// 左键：开火（按住连发）
// 右键：选中/取消选中
canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault(); // 阻止右键菜单
  const world = renderer.screenToWorld(e.clientX, e.clientY);
  const state = network.getSnapshotBuffer().getInterpolatedState(120);
  const hit = renderer.hitTest(world.x, world.y, state.players, 30);

  if (hit) {
    selectedEntity = hit;
    hud.addEvent(`Selected entity: ${hit.id}`);
  } else {
    selectedEntity = null;
    hud.addEvent('Deselected entity');
  }
});

// 修复: 输入发送已整合到 clientTick 中，不再需要单独的节流逻辑
let lastSentKeys: { up: boolean; down: boolean; left: boolean; right: boolean } | null = null;
let lastSentAim = NaN;
let lastSentShoot = false; // Day2: 上次发送的开火状态
let lastSentExtractHeld: boolean | null = null; // 游戏化增强: 上次发送的撤离持续状态
// P2-2: pendingInteract 改成 TTL 脉冲（不再无限期粘住）
// interactUntil 是 performance.now() 时间戳，超过这个时间就清零
let interactUntil = 0;
const INTERACT_TTL_MS = 200; // 200ms 后自动失效
// 修复: pendingExtract 已废弃（不再发送 extract 脉冲，只使用 extractHeld）
// let pendingExtract = false;

// 渲染循环
let lastLogTime = 0;
let lastHudUpdateTime = 0; // 修复: HUD 更新节流（10Hz）
const HUD_UPDATE_INTERVAL_MS = 100; // 10Hz
function renderLoop(): void {
  // 修复: 计算帧 dt（用于渲染平滑）
  const nowPerf = performance.now();
  const dtSec = Math.min(0.05, (nowPerf - lastRenderNow) / 1000); // cap 50ms 防止切后台后爆炸
  lastRenderNow = nowPerf;
  
  // 获取插值后的状态
  const state = network.getSnapshotBuffer().getInterpolatedState(120);
  
  // 修复: 客户端预测 - 本地玩家使用平滑渲染位置，其他玩家使用插值位置
  let playersToRender = state.players;
  if (localPlayerId) {
    // 确保 predictedLocalPlayer 存在（沿用你现在的逻辑）
    if (!predictedLocalPlayer) {
      const serverPlayer = state.players.find((p) => p.id === localPlayerId);
      if (serverPlayer) {
        predictedLocalPlayer = { ...serverPlayer };
      }
    }
    
    // 修复: 每帧把 renderLocalPlayer 平滑追向 predictedLocalPlayer
    if (predictedLocalPlayer) {
      if (!renderLocalPlayer) {
        renderLocalPlayer = { ...predictedLocalPlayer };
      } else {
        const dx = predictedLocalPlayer.x - renderLocalPlayer.x;
        const dy = predictedLocalPlayer.y - renderLocalPlayer.y;
        const dist = Math.hypot(dx, dy);
        
        // 大回滚直接瞬移，避免慢慢"飘回去"
        if (dist > 80) {
          renderLocalPlayer.x = predictedLocalPlayer.x;
          renderLocalPlayer.y = predictedLocalPlayer.y;
        } else {
          renderLocalPlayer.x = smoothTo(renderLocalPlayer.x, predictedLocalPlayer.x, dtSec, 0.08);
          renderLocalPlayer.y = smoothTo(renderLocalPlayer.y, predictedLocalPlayer.y, dtSec, 0.08);
        }
        
        // 其他字段保持最新（别让血量/状态落后一拍）
        renderLocalPlayer.hp = predictedLocalPlayer.hp;
        renderLocalPlayer.status = predictedLocalPlayer.status;
        renderLocalPlayer.lootCount = predictedLocalPlayer.lootCount;
        renderLocalPlayer.lastInputSeq = predictedLocalPlayer.lastInputSeq;
        renderLocalPlayer.lastInputTick = predictedLocalPlayer.lastInputTick;
        renderLocalPlayer.extractProgress = predictedLocalPlayer.extractProgress;
      }
      
      // 使用平滑后的 renderLocalPlayer 渲染本地玩家
      playersToRender = state.players.map((p) =>
        p.id === localPlayerId ? (renderLocalPlayer as PLAYER_STATE) : p
      );
    }
  }

      // Day4-1: 使用 server 下发的 mapConfig（优先），fallback 到本地配置
      const extractZone = serverMapConfig?.extractZone ?? fallbackMapConfig.extractZone;
      
      // 修复: 使用缓存的静态世界数据（obstacles 从 WORLD_INIT 接收，不再从 snapshot 获取）
      // items 仍然从 snapshot 获取（因为会被拾取，是动态的）
      // 新增: 渲染 worldItems 和 lootBags
      renderer.render(
        playersToRender,
        localPlayerId,
        isDebug,
        state.bullets,
        state.items,
        extractZone,
        cachedObstacles,
        state.worldItems, // 新增: 世界物品
        state.lootBags // 新增: 掉落包
      );

  // 修复: 客户端 tick 对齐（严格 20Hz，与 server 同步）
  const now = Date.now();
  // 累积帧时间，按 50ms 切片执行 clientTick
  if (lastClientTickTime === 0) {
    lastClientTickTime = performance.now();
  }
  
  const frameDeltaMs = performance.now() - lastClientTickTime;
  lastClientTickTime = performance.now();
  clientAccMs += frameDeltaMs;
  
  // 按 50ms 切片执行 clientTick（可能一次执行多个 tick）
  while (clientAccMs >= CLIENT_TICK_MS) {
    // 执行一次客户端 tick
    if (localPlayerId) {
      // 1. 读取输入
      const tickKeys = inputManager.getKeys();
      const tickAim = (() => {
        if (localPlayerId) {
          const localPlayer = predictedLocalPlayer ?? state.players.find((p) => p.id === localPlayerId);
          if (localPlayer) {
            const playerScreenPos = renderer.worldToScreen(localPlayer.x, localPlayer.y);
            return inputManager.getAimAngleFromPoint(playerScreenPos.x, playerScreenPos.y);
          }
        }
        return inputManager.getAimAngle(canvas);
      })();
      const tickShoot = inputManager.getShoot();
      const tickExtractHeld = inputManager.getExtractHeld();
      
      // P2-2: 合并 interact 脉冲（使用 TTL，不再无限期保留）
      if (inputManager.consumeInteract()) {
        interactUntil = performance.now() + INTERACT_TTL_MS;
        dbg.push('INTERACT_PRESS', { until: interactUntil });
      }
      
      // 修复: 使用 fallback mapConfig，确保 fallback 模式也能工作
      const mapConfig = serverMapConfig ?? fallbackMapConfig;
      
      // 修复: 只在 input "成功发送并入 pendingInputs"后，再做那一步预测
      // 核心原则：预测推进必须和你写进 pendingInputs 的那一步一一对应
      let committed = false;
      let commitSeq = 0;
      const commitKeys = { ...tickKeys };
      
      // 3. 如果 ws 可发，发送输入并 push 到 pendingInputs
      const connState = network.getConnectionState();
      
      // P2-2: 处理拾取动作（E键按下时，尝试拾取最近的世界物品或掉落包）
      // 使用 TTL 脉冲，不再无限期保留
      const interactActive = performance.now() <= interactUntil;
      if (interactActive && connState.connected) {
        // P2-2: 使用 fallback 获取本地玩家位置（覆盖预测未就绪阶段）
        const lp = predictedLocalPlayer ?? state.players.find(p => p.id === localPlayerId);
        
        if (lp) {
          dbg.push('PICKUP_TRY', { x: lp.x, y: lp.y, worldItems: state.worldItems.length, lootBags: state.lootBags.length });
          
          // 查找最近的世界物品或掉落包
          let nearestTarget: { kind: 'world'; wid: string } | { kind: 'bag'; bid: string } | null = null;
          let nearestDist = 40; // 拾取半径
          
          for (const worldItem of state.worldItems) {
            const dx = worldItem.x - lp.x;
            const dy = worldItem.y - lp.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < nearestDist) {
              nearestTarget = { kind: 'world', wid: worldItem.wid };
              nearestDist = dist;
            }
          }
          
          for (const bag of state.lootBags) {
            if (bag.items.length === 0) continue;
            const dx = bag.x - lp.x;
            const dy = bag.y - lp.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < nearestDist) {
              nearestTarget = { kind: 'bag', bid: bag.bid };
              nearestDist = dist;
            }
          }
          
          if (nearestTarget) {
            // 发送拾取消息
            const sent = nearestTarget.kind === 'world'
              ? network.sendPickupWorldItem(nearestTarget.wid)
              : network.sendPickupLootBag(nearestTarget.bid);
            
            // P2-2: 无论 sent 成功与否，都清零（不再无限期保留）
            interactUntil = 0;
            dbg.push('PICKUP_SENT', { kind: nearestTarget.kind, sent, dist: nearestDist });
          } else {
            // P2-2: 没找到目标也要清零
            interactUntil = 0;
            dbg.push('PICKUP_NO_TARGET', { x: lp.x, y: lp.y });
          }
        } else {
          // P2-2: lp 为空也要清零
          interactUntil = 0;
          dbg.push('PICKUP_NO_PLAYER', {});
        }
      } else if (interactUntil > 0 && performance.now() > interactUntil) {
        // P2-2: TTL 过期，清零
        dbg.push('PICKUP_EXPIRE', { was: interactUntil });
        interactUntil = 0;
      }
      if (connState.connected) {
        // 修复: 持续输入流式发送逻辑
        // 检查是否有持续态输入（移动/射击/撤离）
        const keysAny = tickKeys.up || tickKeys.down || tickKeys.left || tickKeys.right;
        const mustStream = keysAny || tickShoot || tickExtractHeld;
        
        // 检查变化（用于 idle 时的省包逻辑）
        const keysChanged = !lastSentKeys || 
          tickKeys.up !== lastSentKeys.up || tickKeys.down !== lastSentKeys.down ||
          tickKeys.left !== lastSentKeys.left || tickKeys.right !== lastSentKeys.right;
        const aimChanged = isNaN(lastSentAim) || Math.abs(tickAim - lastSentAim) > 0.01;
        const shootChanged = tickShoot !== lastSentShoot;
        const extractHeldChanged = tickExtractHeld !== (lastSentExtractHeld ?? false);
        
        // 只要在"持续态"（移动/射击/撤离），每 tick 都发；idle 时才用 change-based
        // P0-1 修复: interact 不再通过 input 发送（拾取走独立的 C2S_PICKUP_* 消息）
        const shouldSend = mustStream || keysChanged || aimChanged || shootChanged || extractHeldChanged;
        
        if (shouldSend) {
          const nextSeq = inputSeq + 1;
          // P0-1 修复: interact 参数设为 false，不再触发服务端旧拾取逻辑
          const sent = network.sendInput(nextSeq, tickKeys, tickAim, tickShoot, false, false, tickExtractHeld);
          
          if (sent) {
            inputSeq = nextSeq;
            // 同时写入 pendingInputs（同一份快照）
            pendingInputs.push({
              seq: nextSeq,
              keys: commitKeys,
              deltaTime: 0.05,
            });
            committed = true;
            commitSeq = nextSeq;
            
            // 修复: debug log - 记录发送输入关键数据
            dbg.push('SEND', {
              seq: nextSeq,
              tick: connState.lastServerTick,
              keys: tickKeys,
              shoot: tickShoot,
              eh: tickExtractHeld,
              pi: pendingInputs.length,
            });
            
            lastSentKeys = { ...tickKeys };
            lastSentAim = tickAim;
            lastSentShoot = tickShoot;
            lastSentExtractHeld = tickExtractHeld;
            // P2-2: interact 已改为 TTL 脉冲，不再在这里处理
          } else {
            // 修复: 记录发送失败，便于诊断
            dbg.push('SEND_FAIL', { seq: nextSeq, connected: connState.connected });
          }
          // 如果 sent === false（ws 未连接），不递增 seq，不 push pendingInputs
        }
      }
      
      // 修复: 只有 committed 才推进预测（保证 pendingInputs 可重放）
      // 这样即使某个 tick 发包失败/服务端没吃到，也不会"白走一步"
      if (committed && predictedLocalPlayer && mapConfig) {
        const newPredictedPos = simulatePlayerMove(
          { x: predictedLocalPlayer.x, y: predictedLocalPlayer.y },
          commitKeys,
          0.05, // 固定为 server tick 间隔
          mapConfig.width,
          mapConfig.height,
          cachedObstacles
        );
        predictedLocalPlayer.x = newPredictedPos.x;
        predictedLocalPlayer.y = newPredictedPos.y;
      }
    }
    
    clientAccMs -= CLIENT_TICK_MS;
  }

  // P0-2 修复: Debug日志使用 performance.now()（仅在显示给用户时才用 Date.now()）
  if (isDebug) {
    const nowPerf = performance.now();
    if (nowPerf - lastLogTime >= 200) {
      const connState = network.getConnectionState();
      const currentKeys = inputManager.getKeys();
      console.log(`[CLIENT] seq=${inputSeq} tick=${connState.lastServerTick} pendingInputs=${pendingInputs.length} keys=${JSON.stringify(currentKeys)}`);
      lastLogTime = nowPerf;
    }
  }

  // 修复: HUD 更新节流（10Hz，避免每帧重建表格导致性能问题）
  if (now - lastHudUpdateTime >= HUD_UPDATE_INTERVAL_MS) {
    lastHudUpdateTime = now;
    
    // 更新HUD
    const connState = network.getConnectionState();
    // P1-2 修复: 支持 reconnecting 状态
    let connectionStatus: 'connected' | 'reconnecting' | 'disconnected';
    if (connState.connected) {
      connectionStatus = 'connected';
    } else if (connState.reconnecting) {
      connectionStatus = 'reconnecting';
    } else {
      connectionStatus = 'disconnected';
    }
    
    // 游戏化增强: 获取本地玩家的撤离进度
    let localPlayerExtractProgress: number | undefined = undefined;
    if (localPlayerId) {
      const localPlayer = state.players.find((p) => p.id === localPlayerId);
      if (localPlayer && localPlayer.extractProgress !== undefined) {
        localPlayerExtractProgress = localPlayer.extractProgress;
      }
    }
    
    hud.update({
      connection: {
        status: connectionStatus,
        ping: connState.ping ?? undefined, // Day5: 显示 ping 值
        clientTime: Date.now(),
        lastServerTick: connState.lastServerTick,
        // P1-2 修复: 显示重连信息（可选）
        reconnectAttempts: connState.reconnecting ? connState.reconnectAttempts : undefined,
        nextReconnectInMs: connState.reconnecting ? connState.nextReconnectInMs : undefined,
        // 游戏化增强: 显示本地玩家撤离进度
        extractProgress: localPlayerExtractProgress,
      },
      players: state.players,
      counts: {
        bullets: state.bullets.length,
        worldItems: state.worldItems.length, // P2-1: 改用 worldItems
        lootBags: state.lootBags.length, // P2-1: 新增掉落包计数
      },
      selectedEntity: selectedEntity,
      events: [], // events由HUD内部管理
      // P1-1 新增: 物品系统数据（从 Profile 获取）
      inventory: localPlayerId ? (state.players.find(p => p.id === localPlayerId)?.inventory) : undefined,
      stash: playerProfile?.stash, // 从 Profile 获取
      money: playerProfile?.money, // 从 Profile 获取
    });
  }

  rafId = requestAnimationFrame(renderLoop);
}

// 修复: HMR/多实例防护 - 防止多个 renderLoop 同时运行导致重影
const g = window as any;

if (g.__jerkieCleanup) {
  try { g.__jerkieCleanup(); } catch {}
}

let rafId = 0;

function cleanup() {
  if (rafId) cancelAnimationFrame(rafId);
  if (resizeRafId !== null) cancelAnimationFrame(resizeRafId);
  resizeObserver?.disconnect();
  // 断网，避免旧实例还在收包/发包
  network.disconnect();
  console.log('[CLEANUP] old instance stopped');
}

g.__jerkieCleanup = cleanup;

// Vite HMR：模块被替换时调用 cleanup（没有也不影响）
const meta: any = import.meta as any;
if (meta.hot) {
  meta.hot.dispose(() => cleanup());
}

// 启动 renderLoop
rafId = requestAnimationFrame(renderLoop);

// P0-2: 将network暴露到window，方便调试时手动调用disconnect()
// 例如在控制台执行：window.net.disconnect() 后不会再自动重连
(window as any).net = network;

console.log('Client initialized');
