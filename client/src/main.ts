import { Renderer } from './renderer.js';
import { Network } from './network.js';
import { InputManager } from './input.js';
import { HUD } from './hud.js';
import { loadMapConfig, type MAP_CONFIG, simulatePlayerMove } from '@jerkie-man/shared'; // 修复: 导入共享模拟函数
import type { S2C_SNAPSHOT, PLAYER_STATE, OBSTACLE_STATE, ITEM_STATE } from '@jerkie-man/shared';

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
const hudEl = document.getElementById('hud');
if (hudEl) {
  const resizeObserver = new ResizeObserver(() => {
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

// 修复: 客户端预测相关状态
interface PendingInput {
  seq: number;
  keys: { up: boolean; down: boolean; left: boolean; right: boolean };
  deltaTime: number; // 固定为 0.05（与 server tick 一致）
}
let pendingInputs: PendingInput[] = [];
let predictedLocalPlayer: PLAYER_STATE | null = null; // 预测的本地玩家状态
// 修复: 客户端 tick 对齐（严格 20Hz，与 server 同步）
const CLIENT_TICK_MS = 50; // 与 server tick 间隔一致
let clientAccMs = 0; // 客户端 tick 累积器（毫秒）
let lastClientTickTime = 0; // 上次客户端 tick 的时间戳

// Debug开关：从URL参数读取（生产环境也可通过?debug=1启用）
const urlParams = new URLSearchParams(window.location.search);
const isDebug = urlParams.get('debug') === '1';

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
    pendingInteract = false;
    // 修复: pendingExtract 不再使用
    // pendingExtract = false;
    // 修复: 重连后清空预测状态
    pendingInputs = [];
    predictedLocalPlayer = null;
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
        // 移除已确认的输入（seq <= serverPlayer.lastInputSeq）
        pendingInputs = pendingInputs.filter((input) => input.seq > serverPlayer.lastInputSeq);
        
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
        
        // 更新预测的本地玩家状态
        predictedLocalPlayer = {
          ...serverPlayer,
          x: predictedPos.x,
          y: predictedPos.y,
        };
        
        // 修复: debug 日志（验证抖动是否消失）
        if (isDebug) {
          const distance = Math.sqrt(
            Math.pow(predictedLocalPlayer.x - serverPlayer.x, 2) +
            Math.pow(predictedLocalPlayer.y - serverPlayer.y, 2)
          );
          console.log(`[RECONCILE] serverPos=(${serverPlayer.x.toFixed(2)},${serverPlayer.y.toFixed(2)}) predictedPos=(${predictedLocalPlayer.x.toFixed(2)},${predictedLocalPlayer.y.toFixed(2)}) distance=${distance.toFixed(2)}px pendingInputs=${pendingInputs.length}`);
        }
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
    cachedItems = world.items;
    serverMapConfig = world.mapConfig;
    serverSeed = world.seed;
    console.log(`Received world init: seed=${world.seed}, obstacles=${world.obstacles.length}, items=${world.items.length}`);
    hud.addEvent(`World initialized: ${world.obstacles.length} obstacles, ${world.items.length} items`);
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
// Day3 修复A: 脉冲事件 pending latch（直到成功发送才清零，防止节流窗口内丢失）
let pendingInteract = false;
// 修复: pendingExtract 已废弃（不再发送 extract 脉冲，只使用 extractHeld）
// let pendingExtract = false;

// 渲染循环
let lastLogTime = 0;
let lastHudUpdateTime = 0; // 修复: HUD 更新节流（10Hz）
const HUD_UPDATE_INTERVAL_MS = 100; // 10Hz
function renderLoop(): void {
  // 获取插值后的状态
  const state = network.getSnapshotBuffer().getInterpolatedState(120);
  
  // 修复: 客户端预测 - 本地玩家使用预测位置，其他玩家使用插值位置
  let playersToRender = state.players;
  if (localPlayerId) {
    // 如果还没有预测状态，从 snapshot 获取
    if (!predictedLocalPlayer) {
      const serverPlayer = state.players.find((p) => p.id === localPlayerId);
      if (serverPlayer) {
        predictedLocalPlayer = { ...serverPlayer };
      }
    }
    
    // 如果有预测状态，使用预测位置
    if (predictedLocalPlayer) {
      playersToRender = state.players.map((p) => 
        p.id === localPlayerId ? predictedLocalPlayer! : p
      );
    }
  }

      // Day4-1: 使用 server 下发的 mapConfig（优先），fallback 到本地配置
      const extractZone = serverMapConfig?.extractZone ?? fallbackMapConfig.extractZone;
      
      // 修复: 使用缓存的静态世界数据（obstacles 从 WORLD_INIT 接收，不再从 snapshot 获取）
      // items 仍然从 snapshot 获取（因为会被拾取，是动态的）
      renderer.render(playersToRender, localPlayerId, isDebug, state.bullets, state.items, extractZone, cachedObstacles);

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
      
      // 合并 pendingInteract（脉冲事件）
      pendingInteract = pendingInteract || inputManager.consumeInteract();
      
      // 2. 本地预测推进一步（0.05s）
      // 修复: 使用 fallback mapConfig，确保 fallback 模式也能工作
      const mapConfig = serverMapConfig ?? fallbackMapConfig;
      if (predictedLocalPlayer && mapConfig) {
        const newPredictedPos = simulatePlayerMove(
          { x: predictedLocalPlayer.x, y: predictedLocalPlayer.y },
          tickKeys,
          0.05, // 固定为 server tick 间隔
          mapConfig.width,
          mapConfig.height,
          cachedObstacles
        );
        predictedLocalPlayer.x = newPredictedPos.x;
        predictedLocalPlayer.y = newPredictedPos.y;
      }
      
      // 3. 如果 ws 可发，发送输入并 push 到 pendingInputs
      const connState = network.getConnectionState();
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
        const shouldSend = mustStream || pendingInteract || keysChanged || aimChanged || shootChanged || extractHeldChanged;
        
        if (shouldSend) {
          const nextSeq = inputSeq + 1;
          const sent = network.sendInput(nextSeq, tickKeys, tickAim, tickShoot, pendingInteract, false, tickExtractHeld);
          
          if (sent) {
            inputSeq = nextSeq;
            // 同时写入 pendingInputs（同一份快照）
            pendingInputs.push({
              seq: nextSeq,
              keys: { ...tickKeys },
              deltaTime: 0.05,
            });
            
            lastSentKeys = { ...tickKeys };
            lastSentAim = tickAim;
            lastSentShoot = tickShoot;
            lastSentExtractHeld = tickExtractHeld;
            pendingInteract = false;
          }
          // 如果 sent === false（ws 未连接），不递增 seq，不 push pendingInputs
        }
      }
    }
    
    clientAccMs -= CLIENT_TICK_MS;
  }

  // Debug日志：每200ms打印一次（仅在debug模式下）
  if (isDebug) {
    if (now - lastLogTime >= 200) {
      const connState = network.getConnectionState();
      const currentKeys = inputManager.getKeys();
      console.log(`[CLIENT] seq=${inputSeq} tick=${connState.lastServerTick} pendingInputs=${pendingInputs.length} keys=${JSON.stringify(currentKeys)}`);
      lastLogTime = now;
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
        items: state.items.length,
      },
      selectedEntity: selectedEntity,
      events: [], // events由HUD内部管理
    });
  }

  requestAnimationFrame(renderLoop);
}

renderLoop();

// P0-2: 将network暴露到window，方便调试时手动调用disconnect()
// 例如在控制台执行：window.net.disconnect() 后不会再自动重连
(window as any).net = network;

console.log('Client initialized');
