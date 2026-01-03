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
  onSnapshot: (snapshot: S2C_SNAPSHOT) => {
    // 从第一个snapshot中确定本地玩家ID（简单策略：第一个玩家）
    if (localPlayerId === null && snapshot.players.length > 0) {
      // 找到我们自己的玩家（通过比较输入seq）
      // Day1简化：假设第一个玩家是我们
      localPlayerId = snapshot.players[0]?.id ?? null;
      if (localPlayerId) {
        hud.addEvent(`Local player ID: ${localPlayerId}`);
      }
    }

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
