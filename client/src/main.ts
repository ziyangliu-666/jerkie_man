import { Renderer } from './renderer.js';
import { Network } from './network.js';
import { InputManager } from './input.js';
import { HUD } from './hud.js';
import type { S2C_SNAPSHOT, PLAYER_STATE } from '@jerkie-man/shared';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
if (!canvas) {
  throw new Error('Canvas not found');
}

// 初始化Canvas（全屏）
function initCanvas(): void {
  canvas.width = window.innerWidth - 300; // 留出HUD空间
  canvas.height = window.innerHeight;
}

initCanvas();
window.addEventListener('resize', initCanvas);

// 初始化渲染器
const renderer = new Renderer(canvas);

// 初始化输入管理器
const inputManager = new InputManager();

// 初始化HUD
const hud = new HUD('hud');
hud.addEvent('Client started');

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
  },
  onWelcome: (playerId: string) => {
    localPlayerId = playerId;
    console.log(`Received welcome, local player ID: ${localPlayerId}`);
    hud.addEvent(`Local player ID: ${localPlayerId}`);
  },
  onSnapshot: (snapshot: S2C_SNAPSHOT) => {
    // 更新选中实体的数据（如果已选中）
    if (selectedEntity) {
      const updated = snapshot.players.find((p) => p.id === selectedEntity!.id);
      if (updated) {
        selectedEntity = updated;
      }
    }
  },
  onError: (error: string) => {
    console.error('Network error:', error);
    hud.addEvent(`Error: ${error}`);
  },
});

// Canvas点击选中实体
canvas.addEventListener('click', (e) => {
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

// 渲染循环
let lastLogTime = 0;
function renderLoop(): void {
  // 获取插值后的状态
  const state = network.getSnapshotBuffer().getInterpolatedState(120);

  // 渲染玩家
  renderer.render(state.players, localPlayerId);

  // 发送输入（每帧）
  const keys = inputManager.getKeys();
  const aim = inputManager.getAimAngle(canvas);
  inputSeq++;
  network.sendInput(inputSeq, keys, aim);

  // 节流日志：每200ms打印一次
  const now = Date.now();
  if (now - lastLogTime >= 200) {
    const connState = network.getConnectionState();
    console.log(`[CLIENT] seq=${inputSeq} tick=${connState.lastServerTick} keys=${JSON.stringify(keys)}`);
    lastLogTime = now;
  }

  // 更新HUD
  const connState = network.getConnectionState();
  hud.update({
    connection: {
      status: connState.connected ? 'connected' : 'disconnected',
      clientTime: Date.now(),
      lastServerTick: connState.lastServerTick,
    },
    players: state.players,
    counts: {
      bullets: state.bullets.length,
      items: state.items.length,
    },
    selectedEntity: selectedEntity,
    events: [], // events由HUD内部管理
  });

  requestAnimationFrame(renderLoop);
}

renderLoop();

console.log('Client initialized');
