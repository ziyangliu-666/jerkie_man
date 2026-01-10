import { QUALITY_CONFIG } from './config.js';
import { Renderer } from './renderer.js';
import { Network } from './network.js';
import { InputManager } from './input.js';
import { HUD } from './hud.js';
import { DebugLog } from './debugLog.js'; // 修复: 添加 debug log 系统
import { BulletTrackManager } from './bulletTracks.js'; // 子弹轨迹管理器（dead-reckoning + 本地预测）
import { UIOverlay } from './uiOverlay.js'; // 新增: 屏幕 HUD 层
import { ThrowingAim } from './throwingAim.js'; // 新增: 投掷瞄准系统
import { AudioManager } from './audioManager.js'; // 新增: BGM 系统
import type {
  S2C_SNAPSHOT,
  PLAYER_STATE,
  OBSTACLE_STATE,
  ITEM_STATE,
  WorldItem,
  LootBag,
  PlayerInventory,
  ItemInstance,
  MAP_CONFIG,
  PlayerProfile,
  S2C_KILL_FEED, // 新增: 导入 Kill Feed 类型
} from '@jerkie-man/shared';
import {
  loadMapConfig,
  simulatePlayerMove,
  getItemType,
  getAllItemTypes,
  getWeaponDef,
  getBagDef,
  getArmorDef,
  rarityToZh,
  msToTicks,
  getEquippedWeaponDef,
  getFireSchedule,
  shouldStartBurst,
  DEFAULT_FIRE_INTERVAL_MS,
  DEFAULT_BULLET_SPEED,
  calculateStaminaChange,
  canSprint,
  getSprintSpeedMultiplier,
  getUsableItemTypeIds,
  isUsableItem,
  isThrowableItem,
  PLAYER_HIT_RADIUS,
  EXTRACT_DURATION_MS,
} from '@jerkie-man/shared';

// 本地发射 ID 计数器（用于客户端预测子弹对齐）
let localShotIdCounter = 0;
// 上次开火冷却时间（与服务端保持一致）
let lastLocalFireMs = 0;
let lastLocalShoot = false;
let lastLocalMeleeMs = 0;
// 本地弹药预测计数（防止快速点击绕过服务端快照延迟）
let localPredictedAmmo: number | null = null;
let localFireCredit: number | null = null;
let localNextFireTick: number | null = null;
let lastLocalShotServerTick = 0;
let localBurstPendingShots = 0;
let localBurstNextShotAtMs = 0;
let localBurstIntervalMs = 0;
let localBurstWeaponTypeId: string | null = null;

function resetLocalBurst(): void {
  localBurstPendingShots = 0;
  localBurstNextShotAtMs = 0;
  localBurstIntervalMs = 0;
  localBurstWeaponTypeId = null;
}

type MeleeSwing = {
  x: number;
  y: number;
  aimRad: number;
  range: number;
  arcRad: number;
  spawnTimeMs: number;
  side?: number; // 挥砍方向 (1 或 -1)
  weaponTypeId?: string; // 武器类型ID
};

const DEFAULT_MELEE_RANGE = 35;
const DEFAULT_MELEE_ARC_DEG = 60;
const MELEE_SWING_TTL_MS = 160;
let meleeSwings: MeleeSwing[] = [];
let localMeleeSide = 1; // 1 或 -1，用于交替挥砍方向

// 闪光弹致盲总时长（从共享物品配置读取，避免写死）
const FLASH_GRENADE_DURATION_MS: number = (() => {
  try {
    const flashItem = getItemType('flash_grenade');
    const props = (flashItem as any).consumableProps;
    if (props && typeof props.flashDurationMs === 'number') {
      return props.flashDurationMs;
    }
  } catch {
    // 忽略配置读取错误，回退到 3000ms 以保证不崩溃
  }
  return 3000;
})();

type ExplosionEffect = {
  x: number;
  y: number;
  radius: number;
  spawnTimeMs: number;
};

// 新增: 烟雾效果（用于在客户端渲染持续烟雾）
type SmokeEffect = {
  x: number;
  y: number;
  radius: number;
  spawnTimeMs: number;
  durationMs: number;
};

const EXPLOSION_EFFECT_TTL_MS = 500;
let explosionEffects: ExplosionEffect[] = [];
let smokeEffects: SmokeEffect[] = [];

// 新增: 燃烧效果
type FireEffect = {
  x: number;
  y: number;
  radius: number;
  spawnTimeMs: number;
  durationMs: number;
};
let fireEffects: FireEffect[] = [];

// 全局网络实例，允许在UI事件中访问
let network: Network;

/**
 * 获取本地开火冷却时间（毫秒）
 * 优先使用局内武器运行时状态，回退到 playerProfile
 */
function getLocalFireCooldownMs(): number {
  // 修复：优先使用局内武器运行时状态
  if (raidLocalPlayer?.weaponRuntime?.weaponTypeId) {
    try {
      const weaponDef = getWeaponDef(raidLocalPlayer.weaponRuntime.weaponTypeId);
      return weaponDef.fireIntervalMs;
    } catch (e) {
      console.warn('[getLocalFireCooldownMs] Failed to get weapon def from runtime:', e);
    }
  }

  // 回退到 playerProfile（用于非局内场景）
  if (!playerProfile) {
    console.warn('[getLocalFireCooldownMs] playerProfile is null, using default');
    return DEFAULT_FIRE_INTERVAL_MS;
  }

  const weaponDef = getEquippedWeaponDef(playerProfile);
  if (!weaponDef) {
    console.warn('[getLocalFireCooldownMs] No weapon equipped, using default');
    return DEFAULT_FIRE_INTERVAL_MS;
  }

  return weaponDef.fireIntervalMs;
}

/**
 * 计算玩家的速度倍数（基于局内装备 buff）
 * 用于客户端预测移动
 */
function getLocalSpeedMultiplier(): number {
  if (!raidLocalPlayer) {
    return 1.0;
  }
  
  let multiplier = 1.0;
  
  // 检查武器 buff
  if (raidLocalPlayer.weaponRuntime?.weaponTypeId) {
    try {
      const weaponDef = getWeaponDef(raidLocalPlayer.weaponRuntime.weaponTypeId);
      if (weaponDef.buffs?.speedMultiplier) {
        multiplier *= weaponDef.buffs.speedMultiplier;
      }
    } catch {
      // 忽略无效武器类型
    }
  }
  
  // 检查防具 buff
  if (raidLocalPlayer.raidEquipment?.armorTypeId) {
    try {
      const armorDef = getArmorDef(raidLocalPlayer.raidEquipment.armorTypeId);
      if (armorDef.buffs?.speedMultiplier) {
        multiplier *= armorDef.buffs.speedMultiplier;
      }
    } catch {
      // 忽略无效防具类型
    }
  }
  
  // 检查背包 buff
  if (raidLocalPlayer.raidEquipment?.bagTypeId) {
    try {
      const bagDef = getBagDef(raidLocalPlayer.raidEquipment.bagTypeId);
      if (bagDef.buffs?.speedMultiplier) {
        multiplier *= bagDef.buffs.speedMultiplier;
      }
    } catch {
      // 忽略无效背包类型
    }
  }

  // 新增: 叠加局内短效 Buff（例如战斗兴奋剂）
  if (raidLocalPlayer.buffs && Array.isArray(raidLocalPlayer.buffs)) {
    for (const buff of raidLocalPlayer.buffs) {
      if (buff.kind === 'speed' && typeof buff.speedMultiplier === 'number') {
        multiplier *= buff.speedMultiplier;
      }
    }
  }
  
  return multiplier;
}

/**
 * 获取本地子弹速度（px/s）
 * 优先使用局内武器运行时状态，回退到 playerProfile
 */
function getLocalBulletSpeed(): number {
  // 修复：优先使用局内武器运行时状态
  if (raidLocalPlayer?.weaponRuntime?.weaponTypeId) {
    try {
      const weaponDef = getWeaponDef(raidLocalPlayer.weaponRuntime.weaponTypeId);
      return weaponDef.bulletSpeed;
    } catch (e) {
      console.warn('[getLocalBulletSpeed] Failed to get weapon def from runtime:', e);
    }
  }

  // 回退到 playerProfile（用于非局内场景）
  if (!playerProfile) {
    console.warn('[getLocalBulletSpeed] playerProfile is null, using default');
    return DEFAULT_BULLET_SPEED;
  }

  const weaponDef = getEquippedWeaponDef(playerProfile);
  if (!weaponDef) {
    console.warn('[getLocalBulletSpeed] No weapon equipped, using default');
    return DEFAULT_BULLET_SPEED;
  }

  return weaponDef.bulletSpeed;
}

// 三层结构：worldCanvas（世界层）+ uiCanvas（屏幕HUD层）+ DOM overlay（面板层）
const worldCanvas = document.getElementById('worldCanvas') as HTMLCanvasElement;
const uiCanvas = document.getElementById('uiCanvas') as HTMLCanvasElement;
if (!worldCanvas || !uiCanvas) {
  throw new Error('Canvas not found');
}

// 初始化渲染器（必须先初始化，才能调用resize）
const renderer = new Renderer(worldCanvas);
renderer.setQuality(QUALITY_CONFIG.world);

// 初始化 UI 覆盖层（屏幕 HUD：准星、受伤红边等）
const uiOverlay = new UIOverlay(uiCanvas);
uiOverlay.setMaxDpr(QUALITY_CONFIG.ui.maxDpr);

// 初始化投掷瞄准系统
const throwingAim = new ThrowingAim(uiCanvas);

// 新增: 投掷瞄准状态
let isThrowingMode = false;
let throwingItemType: string | null = null;

// 初始化子弹轨迹管理器（dead-reckoning，解决子弹"忽快忽慢"）
const bulletTracks = new BulletTrackManager();
// 新增: 监听本地子弹命中，立即触发命中反馈
bulletTracks.onLocalHit(() => {
  uiOverlay.triggerHitMarker();
});

// ===== Canvas 尺寸计算（考虑 HUD 宽度，与 HUD 并列显示）=====
// 修复: 添加阈值，避免频繁 resize 导致卡顿/重影
let lastCanvasW = 0;
let lastCanvasH = 0;
const RESIZE_THRESHOLD = 3; // 只有尺寸变化超过 3px 才真正 resize

function updateCanvasSize(): void {
  // 计算 canvas 容器的实际尺寸（减去 HUD 宽度）
  const hudContainer = document.getElementById('hudContainer');
  const hudWidth = hudContainer ? (hudContainer.classList.contains('collapsed') ? 24 : 300) : 0;
  const cssWidth = window.innerWidth - hudWidth;
  const cssHeight = window.innerHeight;

  // 修复: 只有当尺寸变化超过阈值时才真正 resize（避免频繁 resize 导致卡顿/重影）
  if (Math.abs(cssWidth - lastCanvasW) < RESIZE_THRESHOLD && 
      Math.abs(cssHeight - lastCanvasH) < RESIZE_THRESHOLD) {
    return; // 尺寸变化太小，不触发 resize
  }
  
  lastCanvasW = cssWidth;
  lastCanvasH = cssHeight;
  
  renderer.resize(cssWidth, cssHeight);
  uiOverlay.resize(cssWidth, cssHeight); // 同步更新 UI Canvas
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

// 窗口resize监听：使用rAF防抖
window.addEventListener('resize', scheduleResize);

// 初始 resize（必须在 uiOverlay 和 renderer 创建后）
updateCanvasSize();

// P1-2 修复: 监听页面滚动和 viewport 变化，刷新 canvas rect 缓存
// 避免 layout shift 导致 screenToWorld/worldToScreen 错位
window.addEventListener('scroll', () => renderer.refreshRect(), { passive: true });

// 兼容移动端/缩放等导致的 viewport 变化（桌面也可能触发）
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', () => renderer.refreshRect());
}

// Step3: 输入管理器接收 worldCanvas，开火输入只在 worldCanvas 上监听
const inputManager = new InputManager(worldCanvas);

// 新增: 设置耐力检查回调（用于UI限制）
inputManager.setStaminaCheckCallback(() => getCurrentStaminaPercent());
inputManager.setStaminaShakeCallback(() => shakeStaminaHud());

// 初始化HUD（使用 debugPanel 作为容器，右侧调试面板）
const hud = new HUD('debugPanel');
hud.addEvent('客户端已启动');

// 初始化 BGM 系统
const audioManager = AudioManager.getInstance();
audioManager.init();

// BGM UI 元素
const bgmToggleBtn = document.getElementById('bgmToggleBtn') as HTMLButtonElement;
const bgmVolumeSlider = document.getElementById('bgmVolumeSlider') as HTMLInputElement;
const bgmNextBtn = document.getElementById('bgmNextBtn') as HTMLButtonElement;
const bgmTrackSelect = document.getElementById('bgmTrackSelect') as HTMLSelectElement;
const bgmPanelToggle = document.getElementById('bgmPanelToggle') as HTMLButtonElement;
const bgmControl = document.getElementById('bgmControl') as HTMLElement;

if (bgmToggleBtn && bgmVolumeSlider && bgmNextBtn && bgmTrackSelect && bgmPanelToggle && bgmControl) {
  // 初始化 UI 状态
  bgmVolumeSlider.value = audioManager.getVolume().toString();
  bgmTrackSelect.value = audioManager.getCurrentTrack().toString();

  // 面板展开/收起逻辑
  const togglePanel = () => {
    bgmControl.classList.toggle('expanded');
    // 如果展开了，添加一次性点击监听来关闭（当点击外部时）
    if (bgmControl.classList.contains('expanded')) {
      document.addEventListener('click', closePanelOutside);
    } else {
      document.removeEventListener('click', closePanelOutside);
    }
  };

  const closePanelOutside = (e: MouseEvent) => {
    if (!bgmControl.contains(e.target as Node)) {
      bgmControl.classList.remove('expanded');
      document.removeEventListener('click', closePanelOutside);
    }
  };

  bgmPanelToggle.addEventListener('click', (e) => {
    e.stopPropagation(); // 防止立即触发 external click
    togglePanel();
  });

  if (audioManager.getMuted()) {
    bgmToggleBtn.classList.add('muted');
    bgmToggleBtn.textContent = '🔇';
  }

  // 监听静音切换
  bgmToggleBtn.addEventListener('click', () => {
    const isMuted = audioManager.toggleMute();
    bgmToggleBtn.classList.toggle('muted', isMuted);
    bgmToggleBtn.textContent = isMuted ? '🔇' : '🔊';
  });

  // 监听音量调节
  bgmVolumeSlider.addEventListener('input', () => {
    audioManager.setVolume(parseFloat(bgmVolumeSlider.value));
  });

  // 监听音乐切换
  // 监听下一首切换
  // 监听下一首切换
  bgmNextBtn.addEventListener('click', () => {
    const current = audioManager.getCurrentTrack();
    const next = current >= 10 ? 1 : current + 1;
    audioManager.setTrack(next);
    bgmTrackSelect.value = next.toString(); // 同步下拉框
  });

  // 监听下拉框可选择
  bgmTrackSelect.addEventListener('change', () => {
    audioManager.setTrack(parseInt(bgmTrackSelect.value));
  });
}

// 监听首次交互以触发 BGM 播放

// Start Screen Logic
const startScreen = document.getElementById('startScreen');
const startGameBtn = document.getElementById('startGameBtn');

if (startScreen && startGameBtn) {
  // Enhanced "Scanner" & Tilt Logic
  const updatePerspective = (e: MouseEvent) => {
    if (startScreen.style.display === 'none') return;
    
    // 1. Calculate Mouse Position for Spotlight (CSS determines look)
    const x = e.clientX;
    const y = e.clientY;
    
    // Update CSS variables for the scanner mask
    startScreen.style.setProperty('--mouse-x', `${x}px`);
    startScreen.style.setProperty('--mouse-y', `${y}px`);
    
    // 2. Calculate Tilt (from center of screen)
    // Range: -1 to 1
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    
    const dx = (x - cx) / cx;
    const dy = (y - cy) / cy;
    
    // Max tilt angles
    const MAX_TILT = 5; // degrees around center
    
    // Invert X/Y for natural tilt (mouse left -> rotate Y negative)
    const tiltX = dx * MAX_TILT; 
    const tiltY = dy * MAX_TILT * -1;
    
    startScreen.style.setProperty('--tilt-x', `${tiltX}deg`);
    startScreen.style.setProperty('--tilt-y', `${tiltY}deg`);
  };

  window.addEventListener('mousemove', updatePerspective);
  
  // Initialize Server Input from storage or default
  const serverInput = document.getElementById('serverUrlInput') as HTMLInputElement;
  if (serverInput) {
    const savedUrl = localStorage.getItem('jerkie_man_server_url');
    const defaultUrl = getDefaultWebSocketUrl();
    
    // If user has manually set a URL, show it. Otherwise show placeholder.
    if (savedUrl && savedUrl.trim().length > 0) {
      serverInput.value = savedUrl;
    } else {
      serverInput.value = '';
      serverInput.placeholder = `Default: ${defaultUrl}`;
    }
    
    serverInput.addEventListener('input', () => {
       const rawVal = serverInput.value.trim();
       let targetUrl = rawVal;
       
       if (rawVal.length > 0) {
         localStorage.setItem('jerkie_man_server_url', rawVal);
       } else {
         localStorage.removeItem('jerkie_man_server_url');
         targetUrl = defaultUrl;
       }
       
       // Update network connection in real-time
       if (network) {
          // Check if URL actually changed to avoid unnecessary reconnects
          // (Requires tracking current url in network or comparing)
          network.setUrl(targetUrl);
          network.disconnect();
          network.connect();
       }
    });
  }

  // Start Game Button Logic
  startGameBtn.addEventListener('click', () => {
    // 1. Play BGM and init audio
    audioManager.play();

    // 2. Visual Transition
    startScreen.classList.add('fade-out');
    // Stop tracking mouse to save perf after exit
    window.removeEventListener('mousemove', updatePerspective);

    // 3. Remove from DOM after transition
    setTimeout(() => {
      startScreen.style.display = 'none';
      scheduleResize();
      updatePhaseUI(); 
    }, 800);
  });
} else {
  // Fallback if start screen elements missing
  const startBGM = () => {
    audioManager.play();
    window.removeEventListener('click', startBGM);
    window.removeEventListener('keydown', startBGM);
  };
  window.addEventListener('click', startBGM);
  window.addEventListener('keydown', startBGM);
}



// Debug 面板折叠功能（F1 切换）
const hudContainer = document.getElementById('hudContainer');
const debugToggle = document.getElementById('debugToggle');
let debugPanelCollapsed = true; // 默认折叠状态

// 初始化时设置为折叠状态
hudContainer?.classList.add('collapsed');
if (debugToggle) {
  debugToggle.textContent = '▶';
}
// 初始化后需要计算 canvas 尺寸（考虑折叠状态）
scheduleResize();

function toggleDebugPanel(): void {
  debugPanelCollapsed = !debugPanelCollapsed;
  hudContainer?.classList.toggle('collapsed', debugPanelCollapsed);
  if (debugToggle) {
    debugToggle.textContent = debugPanelCollapsed ? '▶' : '◀';
  }
  // 折叠/展开后需要重新计算 canvas 尺寸
  scheduleResize();
}

debugToggle?.addEventListener('click', toggleDebugPanel);
window.addEventListener('keydown', (e) => {
  if (e.key === 'F1') {
    e.preventDefault();
    toggleDebugPanel();
  }

  // 忽略输入框内的按键
  const target = e.target as HTMLElement;
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
    return;
  }

  // BGM 快捷键
  if (e.key.toLowerCase() === 'm') {
    bgmToggleBtn?.click();
  } else if (e.key.toLowerCase() === 'n') {
    bgmNextBtn?.click();
  }
});

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
// 新增: 缓存房间列表（从 WORLD_INIT 接收，用于地板渲染）
let cachedRooms: any[] = [];
// P1-1 新增: 玩家 Profile（从 S2C_PROFILE 接收）
let playerProfile: (PlayerProfile & { accountId: string }) | null = null;
// 新增: 本地 accountId（从 WELCOME 消息确认）
let localAccountId: string | null = null;
// 新增: 游戏阶段状态机
type Phase = 'NAME' | 'HIDEOUT' | 'RAID' | 'RESULT';
let currentPhase: Phase | null = null; // 修复: 初始化为 null，等待服务端下发 phase

// 新增: NAME Modal DOM 元素（延迟获取，确保 DOM 已加载）
let nameModal: HTMLElement | null = null;
let nameInput: HTMLInputElement | null = null;
let nameSubmit: HTMLButtonElement | null = null;

// 新增: 改名 Modal DOM 元素
let renameModal: HTMLElement | null = null;
let renameInput: HTMLInputElement | null = null;
let renameSubmit: HTMLButtonElement | null = null;
let renameCancel: HTMLButtonElement | null = null;

// 获取 DOM 元素的辅助函数
function getModalElements(): void {
  if (!nameModal) {
    nameModal = document.getElementById('nameModal');
  }
  if (!nameInput) {
    nameInput = document.getElementById('nameInput') as HTMLInputElement;
  }
  if (!nameSubmit) {
    nameSubmit = document.getElementById('nameSubmit') as HTMLButtonElement;
  }
  // 改名弹窗元素
  if (!renameModal) {
    renameModal = document.getElementById('renameModal');
  }
  if (!renameInput) {
    renameInput = document.getElementById('renameInput') as HTMLInputElement;
  }
  if (!renameSubmit) {
    renameSubmit = document.getElementById('renameSubmit') as HTMLButtonElement;
  }
  if (!renameCancel) {
    renameCancel = document.getElementById('renameCancel') as HTMLButtonElement;
  }
}

// 新增: Hideout UI DOM 元素
let hideoutUI: HTMLElement | null = null;
let hideoutName: HTMLElement | null = null;
let hideoutMoney: HTMLElement | null = null;
let hideoutStatus: HTMLElement | null = null;
let hideoutTabs: HTMLElement | null = null;
let hideoutStash: HTMLElement | null = null;
let hideoutShop: HTMLElement | null = null;
let hideoutEquipment: HTMLElement | null = null;
let prepList: HTMLElement | null = null;
let stashList: HTMLElement | null = null;
let shopList: HTMLElement | null = null;
let shopTabs: HTMLElement | null = null;
let currentShopCategory: string = 'weapon';
// 跟踪每个物品的购买数量（key: itemType.id, value: 购买数量）
const shopBuyCounts = new Map<string, number>();
let stashTabs: HTMLElement | null = null;
let currentStashCategory: string = 'weapon';
let prepCapacity: HTMLElement | null = null;
let enterRaidBtn: HTMLButtonElement | null = null;
let equipmentWeapon: HTMLElement | null = null;
let equipmentBag: HTMLElement | null = null;
let equipmentArmor: HTMLElement | null = null;
let equipSelectModal: HTMLElement | null = null;
let equipSelectList: HTMLElement | null = null;
let equipSelectTitle: HTMLElement | null = null;
let equipSelectCancel: HTMLButtonElement | null = null;
let currentSelectSlot: 'weapon' | 'bag' | 'armor' | null = null;

// 新增: RAID 局内装备 UI
let raidEquipment: HTMLElement | null = null;
let raidWeaponName: HTMLElement | null = null;
let raidWeaponMeta: HTMLElement | null = null;
let raidWeaponSwap: HTMLButtonElement | null = null;
let raidWeaponUnequip: HTMLButtonElement | null = null;
let raidBagName: HTMLElement | null = null;
let raidBagMeta: HTMLElement | null = null;
let raidBagToggle: HTMLButtonElement | null = null;
let raidBagList: HTMLElement | null = null;
let raidArmorName: HTMLElement | null = null;
let raidArmorMeta: HTMLElement | null = null;
let raidArmorUnequip: HTMLButtonElement | null = null;
let weaponHud: HTMLElement | null = null;
let weaponHudName: HTMLElement | null = null;
let weaponHudAmmo: HTMLElement | null = null;
let weaponHudMag: HTMLElement | null = null;
let weaponHudState: HTMLElement | null = null;
let healthHud: HTMLElement | null = null;
let healthHudValue: HTMLElement | null = null;
let healthHudFill: HTMLElement | null = null;
let staminaHud: HTMLElement | null = null;
let staminaHudValue: HTMLElement | null = null;
let staminaHudFill: HTMLElement | null = null;
let staminaHudState: HTMLElement | null = null;
// 新增: Buff HUD 元素
let buffHud: HTMLElement | null = null;
let buffHudList: HTMLElement | null = null;

// 新增: 快捷栏 HUD 元素
let hotbarHud: HTMLElement | null = null;
let hotbarSlots: HTMLElement[] = [];

// 获取 Hideout UI DOM 元素的辅助函数
function getHideoutElements(): void {
  if (!hideoutUI) hideoutUI = document.getElementById('hideoutUI');
  if (!hideoutName) hideoutName = document.getElementById('hideoutName');
  if (!hideoutMoney) hideoutMoney = document.getElementById('hideoutMoney');
  if (!hideoutStatus) hideoutStatus = document.getElementById('hideoutStatus');
  if (!hideoutTabs) hideoutTabs = document.getElementById('hideoutTabs');
  if (!hideoutStash) hideoutStash = document.getElementById('hideoutStash');
  if (!hideoutShop) hideoutShop = document.getElementById('hideoutShop');
  if (!hideoutEquipment) hideoutEquipment = document.getElementById('hideoutEquipment');
  if (!prepList) prepList = document.getElementById('prepList');
  if (!stashList) stashList = document.getElementById('stashList');
  if (!shopList) shopList = document.getElementById('shopList');
  if (!shopTabs) shopTabs = document.getElementById('shopTabs');
  if (!stashTabs) stashTabs = document.getElementById('stashTabs');
  if (!prepCapacity) prepCapacity = document.getElementById('prepCapacity');
  if (!enterRaidBtn) enterRaidBtn = document.getElementById('enterRaidBtn') as HTMLButtonElement;
  if (!equipmentWeapon) equipmentWeapon = document.getElementById('equipmentWeapon');
  if (!equipmentBag) equipmentBag = document.getElementById('equipmentBag');
  if (!equipmentArmor) equipmentArmor = document.getElementById('equipmentArmor');
  if (!equipSelectModal) equipSelectModal = document.getElementById('equipSelectModal');
  if (!equipSelectList) equipSelectList = document.getElementById('equipSelectList');
  if (!equipSelectTitle) equipSelectTitle = document.getElementById('equipSelectTitle');
  if (!equipSelectCancel) equipSelectCancel = document.getElementById('equipSelectCancel') as HTMLButtonElement;
}

// 新增: 获取 RAID UI DOM 元素
function getRaidElements(): void {
  if (!raidEquipment) raidEquipment = document.getElementById('raidEquipment');
  if (!raidWeaponName) raidWeaponName = document.getElementById('raidWeaponName');
  if (!raidWeaponMeta) raidWeaponMeta = document.getElementById('raidWeaponMeta');
  if (!raidWeaponSwap) raidWeaponSwap = document.getElementById('raidWeaponSwap') as HTMLButtonElement;
  if (!raidWeaponUnequip) raidWeaponUnequip = document.getElementById('raidWeaponUnequip') as HTMLButtonElement;
  if (!raidBagName) raidBagName = document.getElementById('raidBagName');
  if (!raidBagMeta) raidBagMeta = document.getElementById('raidBagMeta');
  if (!raidBagToggle) raidBagToggle = document.getElementById('raidBagToggle') as HTMLButtonElement;
  if (!raidBagList) raidBagList = document.getElementById('raidBagList');
  if (!raidArmorName) raidArmorName = document.getElementById('raidArmorName');
  if (!raidArmorMeta) raidArmorMeta = document.getElementById('raidArmorMeta');
  if (!raidArmorUnequip) raidArmorUnequip = document.getElementById('raidArmorUnequip') as HTMLButtonElement;
  
  // 获取快捷栏元素
  if (!hotbarHud) hotbarHud = document.getElementById('hotbarHud');
  if (hotbarSlots.length === 0) {
    for (let i = 1; i <= 5; i++) {
      const slot = document.getElementById(`hotbarSlot${i}`);
      if (slot) hotbarSlots.push(slot);
    }
  }
}

function getWeaponHudElements(): void {
  if (!weaponHud) weaponHud = document.getElementById('weaponHud');
  if (!weaponHudName) weaponHudName = document.getElementById('weaponHudName');
  if (!weaponHudAmmo) weaponHudAmmo = document.getElementById('weaponHudAmmo');
  if (!weaponHudMag) weaponHudMag = document.getElementById('weaponHudMag');
  if (!weaponHudState) weaponHudState = document.getElementById('weaponHudState');
}

function getHealthHudElements(): void {
  if (!healthHud) healthHud = document.getElementById('healthHud');
  if (!healthHudValue) healthHudValue = document.getElementById('healthHudValue');
  if (!healthHudFill) healthHudFill = document.getElementById('healthHudFill');
}

function getStaminaHudElements(): void {
  if (!staminaHud) staminaHud = document.getElementById('staminaHud');
  if (!staminaHudValue) staminaHudValue = document.getElementById('staminaHudValue');
  if (!staminaHudFill) staminaHudFill = document.getElementById('staminaHudFill');
  if (!staminaHudState) staminaHudState = document.getElementById('staminaHudState');
}

function getBuffHudElements(): void {
  if (!buffHud) buffHud = document.getElementById('buffHud');
  if (!buffHudList) buffHudList = document.getElementById('buffHudList');
}

// 修复: 客户端预测相关状态（必须在 updatePhaseUI 之前定义）
let predictedLocalPlayer: PLAYER_STATE | null = null; // 预测的本地玩家状态
let renderLocalPlayer: PLAYER_STATE | null = null; // 渲染平滑 - 每帧平滑追向预测位置，避免 20Hz 步进卡顿
let raidLocalPlayer: PLAYER_STATE | null = null; // 局内装备 HUD 使用
let raidBagExpanded = false;
let lastRaidBagSignature = '';
let lastRaidBagExpanded = false;

// 新增: 更新 phase UI（显示/隐藏 modal，控制世界渲染等）
function updatePhaseUI(): void {
  // 修复: 如果 phase 还未从服务端接收，不做任何操作
  if (currentPhase === null) {
    console.log('[updatePhaseUI] Phase not yet received from server, skipping UI update');
    return;
  }

  // 确保 DOM 元素已获取
  getModalElements();
  getHideoutElements();
  getRaidElements();

  // 修复: 如果关键 DOM 元素未准备好，延迟到 DOMContentLoaded
  if (!nameModal || !hideoutUI) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => updatePhaseUI(), { once: true });
    }
    return;
  }

  console.log('[updatePhaseUI] currentPhase:', currentPhase, 'nameModal:', nameModal);

  if (currentPhase === 'NAME') {
    // 显示 NAME modal
    if (nameModal) {
      nameModal.style.display = 'flex';
      console.log('[updatePhaseUI] Showing NAME modal');
    } else {
      console.warn('[updatePhaseUI] nameModal is null, cannot show');
    }
    // 隐藏 Hideout UI
    if (hideoutUI) {
      hideoutUI.style.display = 'none';
    }
    if (raidEquipment) {
      raidEquipment.style.display = 'none';
    }
    // 非 RAID 时清理预测/子弹轨迹并停止渲染世界
    predictedLocalPlayer = null;
    renderLocalPlayer = null;
    bulletTracks.clear();
  } else if (currentPhase === 'HIDEOUT') {
    // 隐藏 NAME modal
    if (nameModal) {
      nameModal.style.display = 'none';
    }
    // 显示 Hideout UI
    if (hideoutUI) {
      hideoutUI.style.display = 'flex';
      // 确保元素已准备好后再更新
      setTimeout(() => {
        updateHideoutUI();
      }, 0);
    }
    if (raidEquipment) {
      raidEquipment.style.display = 'none';
    }
    // 非 RAID 时清理预测/子弹轨迹并停止渲染世界
    predictedLocalPlayer = null;
    renderLocalPlayer = null;
    bulletTracks.clear();
  } else if (currentPhase === 'RAID') {
    // 隐藏 NAME modal 和 Hideout UI
    if (nameModal) {
      nameModal.style.display = 'none';
      console.log('[updatePhaseUI] Hiding NAME modal');
    }
    // if (hideoutUI) {
    //   hideoutUI.style.display = 'none';
    //   console.log('[updatePhaseUI] Hiding Hideout UI, computed display:', window.getComputedStyle(hideoutUI).display);
    // } else {
    //   console.warn('[updatePhaseUI] hideoutUI is null, cannot hide');
    // }
    if (raidEquipment) {
      raidEquipment.style.display = 'block';
    }
    
    // 播放 Hideout 退出动画（UI 分裂移除）
    // 只有当 hideoutUI 可见时才播放（避免刷新页面直接进入 RAID 时闪烁）
    if (hideoutUI && hideoutUI.style.display !== 'none' && hideoutUI.style.opacity !== '0') {
      playHideoutExitAnimation();
    } else {
      // 如果本来就不可见（例如直接进Raid调试），确保隐藏
      if (hideoutUI) {
        hideoutUI.style.display = 'none';
        hideoutUI.style.opacity = '1'; // 重置
      }
    }
    
  } else if (currentPhase === 'RESULT') {
    // 隐藏 NAME modal 和 Hideout UI，显示结果页面
    if (nameModal) {
      nameModal.style.display = 'none';
    }
    if (hideoutUI) {
      hideoutUI.style.display = 'none';
    }
    if (raidEquipment) {
      raidEquipment.style.display = 'none';
    }
    // 结果页面会在 onRaidResult 回调中显示
    updateResultUI();
  } else {
    // 其他 phase（不应该出现），隐藏所有 UI
    if (nameModal) {
      nameModal.style.display = 'none';
    }
    if (hideoutUI) {
      hideoutUI.style.display = 'none';
    }
    if (raidEquipment) {
      raidEquipment.style.display = 'none';
    }
    getResultElements();
    if (resultUI) {
      resultUI.style.display = 'none';
    }
  }
}

// 新增: 播放 Hideout 退出动画
function playHideoutExitAnimation(): void {
  const hideoutUI = document.getElementById('hideoutUI');
  const topBar = document.getElementById('hideoutTopBar');
  const tabs = document.getElementById('hideoutTabs');
  const main = document.getElementById('hideoutMain');
  
  if (!hideoutUI) return;

  // 1. 添加动画类
  hideoutUI.classList.add('anim-fade-out');
  if (topBar) topBar.classList.add('anim-exit-up');
  if (tabs) tabs.classList.add('anim-exit-left');
  if (main) main.classList.add('anim-exit-right');
  
  // 2. 动画结束清理
  setTimeout(() => {
    hideoutUI.style.display = 'none';
    hideoutUI.style.opacity = '1'; // 重置，确保下次进入 Hideout 时可见（因为动画已经结束了）
    
    // 移除动画类，确保下次显示时位置正常
    hideoutUI.classList.remove('anim-fade-out');
    if (topBar) topBar.classList.remove('anim-exit-up');
    if (tabs) tabs.classList.remove('anim-exit-left');
    if (main) main.classList.remove('anim-exit-right');
  }, 1000);
}

// 新增: 战局结果数据
let raidResult: { result: 'EXTRACTED' | 'DIED'; loot: ItemInstance[]; moneyGained: number; moneyLost: number; killedBy?: string; killedByWeaponName?: string } | null = null;

// 新增: 结果页面 DOM 元素
// 新增: 结果页面 DOM 元素
let resultUI: HTMLElement | null = null;
let resultTitle: HTMLElement | null = null;
let resultStatusBadge: HTMLElement | null = null;
let resultStatusText: HTMLElement | null = null;
let resultContinueBtn: HTMLButtonElement | null = null;
let resultMoney: HTMLElement | null = null;
let resultMoneyDetail: HTMLElement | null = null;
let resultDeathInfo: HTMLElement | null = null;
let resultKiller: HTMLElement | null = null;
let resultKillerWeapon: HTMLElement | null = null;
let resultLootGrid: HTMLElement | null = null;
let resultNoLoot: HTMLElement | null = null;

// 获取结果页面 DOM 元素的辅助函数
function getResultElements(): void {
  if (resultUI) return; // cache check
  resultUI = document.getElementById('resultUI');
  resultTitle = document.getElementById('resultTitle');
  resultStatusBadge = document.getElementById('resultStatusBadge');
  resultStatusText = document.getElementById('resultStatusText');
  resultContinueBtn = document.getElementById('resultContinueBtn') as HTMLButtonElement;
  resultMoney = document.getElementById('resultMoney');
  resultMoneyDetail = document.getElementById('resultMoneyDetail');
  resultDeathInfo = document.getElementById('resultDeathInfo');
  resultKiller = document.getElementById('resultKiller');
  resultKillerWeapon = document.getElementById('resultKillerWeapon');
  resultLootGrid = document.getElementById('resultLootGrid');
  resultNoLoot = document.getElementById('resultNoLoot');
}

// 新增: 更新结果页面 UI (Refined)
function updateResultUI(): void {
  getResultElements();
  
  if (!resultUI) {
    console.warn('[Result UI] DOM elements not found');
    return;
  }
  
  if (!raidResult) {
    resultUI.style.display = 'none';
    return;
  }
  
  // Show Result UI
  resultUI.style.display = 'flex';
  const container = resultUI.querySelector('.result-container');
  
  // Reset classes
  if (container) {
    container.classList.remove('result-success', 'result-fail');
  }
  
  // 1. Basic Status & Styling
  const isSuccess = raidResult.result === 'EXTRACTED';
  if (container) {
    container.classList.add(isSuccess ? 'result-success' : 'result-fail');
  }

  if (resultTitle) resultTitle.textContent = isSuccess ? 'OPERATION SUCCESS' : 'OPERATION FAILED';
  if (resultStatusBadge) resultStatusBadge.textContent = isSuccess ? 'EXTRACTED' : 'K.I.A';
  if (resultStatusText) resultStatusText.textContent = isSuccess ? 'Evacuation Complete' : 'Killed in Action';
  
  // 2. Money & Value Calculation
  let lootValue = 0;
  for (const item of raidResult.loot) {
    try {
      const type = getItemType(item.typeId);
      lootValue += (type.value || 0) * item.qty;
    } catch {}
  }
  
  const totalValue = (raidResult.moneyGained || 0) + lootValue - (raidResult.moneyLost || 0);
  
  if (resultMoney) resultMoney.textContent = totalValue.toLocaleString();
  if (resultMoneyDetail) {
    const cashTxt = raidResult.moneyGained > 0 ? `+${raidResult.moneyGained}` : `-${raidResult.moneyLost}`;
    resultMoneyDetail.textContent = `Loot: $${lootValue.toLocaleString()} | Cash: ${cashTxt}`;
  }

  // 3. Killer Info (Only if failed)
  if (resultDeathInfo) {
    if (!isSuccess && (raidResult.killedBy || raidResult.killedByWeaponName)) {
      resultDeathInfo.style.display = 'flex';
      if (resultKiller) resultKiller.textContent = raidResult.killedBy || 'Unknown';
      if (resultKillerWeapon) resultKillerWeapon.textContent = raidResult.killedByWeaponName || '-';
    } else {
      resultDeathInfo.style.display = 'none';
    }
  }

  // 4. Loot Grid Render
  if (resultLootGrid) {
    resultLootGrid.innerHTML = '';
    const hasLoot = raidResult.loot.length > 0;
    
    if (resultNoLoot) resultNoLoot.style.display = hasLoot ? 'none' : 'block';
    if (resultLootGrid) resultLootGrid.style.display = hasLoot ? 'grid' : 'none'; // Grid vs None

    if (hasLoot) {
      for (const item of raidResult.loot) {
        try {
          const type = getItemType(item.typeId);
          const el = document.createElement('div');
          el.className = 'result-item';
          // Determine simple icon
          let icon = '📦';
          if (item.typeId.startsWith('w_')) icon = '🔫';
          else if (item.typeId.startsWith('a_')) icon = '🛡️'; // armor
          else if (item.typeId.includes('med')) icon = '💊';
          else if (item.typeId.includes('bag')) icon = '🎒';
          else if (type.name.includes('Key')) icon = '🔑';
          
          el.innerHTML = `
            <div class="result-item-icon">${icon}</div>
            <div class="result-item-name" title="${type.name}">${type.name}</div>
            <div class="result-item-qty">x${item.qty}</div>
            <div class="result-item-val">$${(type.value * item.qty).toLocaleString()}</div>
          `;
          resultLootGrid.appendChild(el);
        } catch (e) {
          console.warn('Error rendering result loot item:', item, e);
        }
      }
    }
  }
  
  // 5. Continue Button
  if (resultContinueBtn) {
    resultContinueBtn.onclick = () => {
      // Hide & Reset
      if (resultUI) resultUI.style.display = 'none';
      const oldPhase = currentPhase;
      currentPhase = 'HIDEOUT';
      console.log(`[Result Continue] Phase changed: ${oldPhase} -> ${currentPhase}`);
      updatePhaseUI();
    };
  }
}

// HTML 转义函数（用于结果页面）
function escapeHtml(text: string | number): string {
  const str = String(text);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// 新增: 更新 Hideout UI 显示
function updateHideoutUI(): void {
  getHideoutElements();
  
  if (!playerProfile || !hideoutUI) return;
  
  // 更新顶部栏
  if (hideoutName) {
    hideoutName.textContent = playerProfile.displayName || '未设置';
    // 新增: 添加点击改名功能（只在第一次设置）
    if (!hideoutName.dataset.clickHandlerAdded) {
      hideoutName.style.cursor = 'pointer';
      hideoutName.style.textDecoration = 'underline';
      hideoutName.style.color = '#4CAF50';
      hideoutName.title = '点击改名';
      hideoutName.style.pointerEvents = 'auto'; // 确保可以点击
      hideoutName.style.userSelect = 'none'; // 防止选中文本
      hideoutName.style.position = 'relative'; // 确保元素在层级上
      hideoutName.style.zIndex = '1000'; // 确保在最上层
      
      // 确保父元素也可以接收事件
      if (hideoutName.parentElement) {
        hideoutName.parentElement.style.pointerEvents = 'auto';
      }
      
      const clickHandler = (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        console.log('[hideoutName] 点击事件触发', e);
        
        // 显示改名弹窗
        getModalElements();
        if (!renameModal || !renameInput || !renameSubmit || !renameCancel) {
          console.error('[hideoutName] 改名弹窗元素未找到');
          return;
        }
        
        const currentName = playerProfile?.displayName || '';
        renameInput.value = currentName;
        renameInput.select(); // 选中现有文本，方便修改
        renameModal.style.display = 'flex';
        
        // 处理确认按钮
        const handleSubmit = () => {
          if (!renameInput || !renameModal || !renameSubmit || !renameCancel) return;
          const trimmedName = renameInput.value.trim();
          if (trimmedName.length === 0) {
            alert('昵称不能为空');
            return;
          }
          if (trimmedName.length > 32) {
            alert('昵称不能超过 32 字符');
            return;
          }
          // 发送设置昵称消息
          network.sendSetName(trimmedName);
          hud.addEvent(`改名: ${trimmedName}`);
          // 关闭弹窗
          renameModal.style.display = 'none';
          // 移除事件监听器（避免重复添加）
          renameSubmit.removeEventListener('click', handleSubmit);
          renameCancel.removeEventListener('click', handleCancel);
          renameInput.removeEventListener('keydown', handleKeyDown);
        };
        
        // 处理取消按钮
        const handleCancel = () => {
          if (!renameModal || !renameSubmit || !renameCancel || !renameInput) return;
          renameModal.style.display = 'none';
          // 移除事件监听器
          renameSubmit.removeEventListener('click', handleSubmit);
          renameCancel.removeEventListener('click', handleCancel);
          renameInput.removeEventListener('keydown', handleKeyDown);
        };
        
        // 处理回车键
        const handleKeyDown = (e: KeyboardEvent) => {
          if (e.key === 'Enter') {
            handleSubmit();
          } else if (e.key === 'Escape') {
            handleCancel();
          }
        };
        
        // 添加事件监听器
        renameSubmit.addEventListener('click', handleSubmit);
        renameCancel.addEventListener('click', handleCancel);
        renameInput.addEventListener('keydown', handleKeyDown);
        
        // 聚焦输入框
        setTimeout(() => {
          if (renameInput) {
            renameInput.focus();
          }
        }, 0);
      };
      
      // 同时监听 click 和 mousedown 事件，确保能触发
      hideoutName.addEventListener('click', clickHandler, true); // 使用捕获阶段
      hideoutName.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        clickHandler(e as MouseEvent);
      }, true);
      hideoutName.dataset.clickHandlerAdded = 'true';
      console.log('[updateHideoutUI] 已添加名字点击事件监听器', hideoutName);
    }
  }
  if (hideoutMoney) {
    hideoutMoney.textContent = playerProfile.money.toString();
  }
  if (hideoutStatus) {
    const connState = network.getConnectionState();
    hideoutStatus.textContent = connState.connected ? '已连接' : '未连接';
    hideoutStatus.style.color = connState.connected ? '#0ff' : '#f44';
  }
  
  // 更新整备区容量显示（修复: 使用 slot 数而不是 qty 总和）
  if (prepCapacity && playerProfile.prep) {
    const prepSlotCount = playerProfile.prep.length;
    prepCapacity.textContent = `${prepSlotCount}/${playerProfile.bagCap}`;
  }
  
  // 更新"进入战局"按钮状态（修复: 使用 slot 数而不是 qty 总和，允许空整备进入）
  if (enterRaidBtn) {
    const prepSlotCount = playerProfile.prep?.length ?? 0;
    enterRaidBtn.disabled = prepSlotCount > (playerProfile.bagCap ?? 8);
  }
  
  // 更新物品列表
  updateItemLists();
  
  // 更新装备槽位显示
  updateEquipmentSlots();
  
  // 更新仓库列表（如果装备tab是激活的）
  if (hideoutEquipment && hideoutEquipment.classList.contains('active')) {
    updateStashList();
  }
}

// 新增: 在stash和prep中查找物品实例
function findItemByIid(profile: PlayerProfile, iid: string): ItemInstance | null {
  const pool = [...(profile.prep ?? []), ...(profile.stash ?? [])];
  return pool.find(item => item.iid === iid) ?? null;
}

// 新增: 从仓库自动查找并装备对应类型的物品
// 新增: 显示装备选择列表
function showEquipSelectModal(slot: 'weapon' | 'bag' | 'armor'): void {
  getHideoutElements();
  
  if (!playerProfile || !equipSelectModal || !equipSelectList || !equipSelectTitle) {
    return;
  }
  
  currentSelectSlot = slot;
  const slotName = slot === 'weapon' ? '武器' : slot === 'bag' ? '背包' : '防具';
  equipSelectTitle.textContent = `选择要装备的${slotName}`;
  equipSelectList.innerHTML = '';
  
  // 收集所有对应类型的物品
  const availableItems: Array<{ item: ItemInstance; source: 'stash' | 'prep' }> = [];
  
  // 从仓库查找（过滤已装备的物品）
  if (playerProfile.stash && playerProfile.stash.length > 0) {
    for (const item of playerProfile.stash) {
      // 跳过已装备的物品
      if (isItemEquipped(item)) continue;
      const itemSlot = getItemSlot(item.typeId);
      if (itemSlot === slot) {
        availableItems.push({ item, source: 'stash' });
      }
    }
  }
  
  // 从整备区查找（过滤已装备的物品）
  if (playerProfile.prep && playerProfile.prep.length > 0) {
    for (const item of playerProfile.prep) {
      // 跳过已装备的物品
      if (isItemEquipped(item)) continue;
      const itemSlot = getItemSlot(item.typeId);
      if (itemSlot === slot) {
        availableItems.push({ item, source: 'prep' });
      }
    }
  }
  
  if (availableItems.length === 0) {
    equipSelectList.innerHTML = `<div style="color: #666; padding: 20px; text-align: center;">仓库和整备区中都没有可装备的${slotName}</div>`;
  } else {
    for (const { item, source } of availableItems) {
      const itemType = getItemType(item.typeId);
      const itemEl = document.createElement('div');
      itemEl.className = 'equip-select-item';
      
      let metaText = '';
      if (slot === 'weapon') {
        try {
          const weaponDef = getWeaponDef(item.typeId);
          metaText = `弹匣: ${weaponDef.magSize} | 伤害: ${weaponDef.damage}`;
        } catch {}
      } else if (slot === 'bag') {
        try {
          const bagDef = getBagDef(item.typeId);
          metaText = `容量: ${bagDef.bagCap}`;
        } catch {}
      } else if (slot === 'armor') {
        try {
          const armorDef = getArmorDef(item.typeId);
          metaText = `减伤: ${Math.floor(armorDef.damageReduction * 100)}%`;
        } catch {}
      }
      
      itemEl.innerHTML = `
        <div class="equip-select-item-info">
          <div class="equip-select-item-name">${itemType.name}</div>
          <div class="equip-select-item-meta">${metaText} | 价值: ${itemType.value}</div>
        </div>
        <div class="equip-select-item-source">${source === 'stash' ? '仓库' : '整备区'}</div>
      `;
      
      itemEl.onclick = () => {
        network.sendEquip(slot, item.iid);
        hud.addEvent(`装备: ${itemType.name}`);
        closeEquipSelectModal();
      };
      
      equipSelectList.appendChild(itemEl);
    }
  }
  
  equipSelectModal.classList.add('active');
}

// 新增: 判断是否为武器类型
function isWeaponTypeId(typeId: string): boolean {
  try {
    getWeaponDef(typeId);
    return true;
  } catch {
    return false;
  }
}

// 新增: 显示局内武器切换列表
function showRaidWeaponSelectModal(): void {
  getHideoutElements();

  if (!equipSelectModal || !equipSelectList || !equipSelectTitle) {
    return;
  }

  equipSelectTitle.textContent = '选择要切换的武器';
  equipSelectList.innerHTML = '';

  const localPlayer = raidLocalPlayer;
  const inventoryItems = localPlayer?.inventory?.items ?? [];
  const currentWeaponTypeId = localPlayer?.weaponRuntime?.weaponTypeId ?? 'w_fists';

  const weaponItems = inventoryItems.filter((item: ItemInstance) => isWeaponTypeId(item.typeId));
  const availableItems = weaponItems.filter((item: ItemInstance) => currentWeaponTypeId === 'w_fists' || item.typeId !== currentWeaponTypeId);

  if (availableItems.length === 0) {
    equipSelectList.innerHTML = '<div style="color: #666; padding: 20px; text-align: center;">背包里没有可切换的武器</div>';
  } else {
    for (const item of availableItems) {
      const itemType = getItemType(item.typeId);
      const itemEl = document.createElement('div');
      itemEl.className = 'equip-select-item';

      let metaText = '';
      try {
        const weaponDef = getWeaponDef(item.typeId);
        metaText = `弹匣: ${weaponDef.magSize} | 伤害: ${weaponDef.damage}`;
      } catch {}

      itemEl.innerHTML = `
        <div class="equip-select-item-info">
          <div class="equip-select-item-name">${itemType.name}</div>
          <div class="equip-select-item-meta">${metaText}</div>
        </div>
      `;

      itemEl.onclick = () => {
        network.sendRaidEquip('weapon', item.iid);
        hud.addEvent(`切换武器: ${itemType.name}`);
        closeEquipSelectModal();
      };

      equipSelectList.appendChild(itemEl);
    }
  }

  equipSelectModal.classList.add('active');
}

// 新增: 关闭装备选择弹窗
function closeEquipSelectModal(): void {
  getHideoutElements();
  if (equipSelectModal) {
    equipSelectModal.classList.remove('active');
  }
  currentSelectSlot = null;
}

// 新增: 按钮点击反馈
function addButtonFeedback(btn: HTMLButtonElement, success: boolean, message?: string): void {
  // 保存原始文本和样式
  const originalText = btn.textContent;
  const originalClasses = btn.className;
  
  // 添加反馈类
  btn.classList.add(success ? 'success' : 'error');
  
  // 如果有消息，更新文本
  if (message) {
    btn.textContent = message;
  }
  
  // 添加成功图标（可选）
  if (success && !message) {
    const icon = document.createElement('span');
    icon.textContent = ' ✓';
    icon.style.marginLeft = '4px';
    btn.appendChild(icon);
  }
  
  // 恢复原始状态
  const duration = message ? 1500 : 800;
  setTimeout(() => {
    btn.classList.remove('success', 'error');
    if (message) {
      btn.textContent = originalText;
    } else {
      // 移除添加的图标
      const icon = btn.querySelector('span');
      if (icon) {
        icon.remove();
      }
    }
    // 确保恢复原始类名（移除可能残留的类）
    btn.className = originalClasses;
  }, duration);
}

// 新增: 更新装备槽位显示
function updateEquipmentSlots(): void {
  getHideoutElements();
  
  if (!playerProfile) return;
  
  // 更新武器槽位
  if (equipmentWeapon) {
    equipmentWeapon.innerHTML = '';
    if (playerProfile!.equipment.weaponIid) {
      const weaponItem = findItemByIid(playerProfile!, playerProfile!.equipment.weaponIid);
      if (weaponItem) {
        try {
          const weaponDef = getWeaponDef(weaponItem.typeId);
          const itemType = getItemType(weaponItem.typeId);
          const slotItem = document.createElement('div');
          slotItem.className = 'slot-item';
          slotItem.innerHTML = `
            <div class="slot-item-info">
              <div class="slot-item-name">${itemType.name}</div>
              <div class="slot-item-meta">弹匣: ${weaponDef.magSize} | 伤害: ${weaponDef.damage}</div>
            </div>
            <div class="slot-item-actions">
              <button class="item-btn unequip-weapon">卸下</button>
            </div>
          `;
          const unequipBtn = slotItem.querySelector('.unequip-weapon') as HTMLButtonElement;
          if (unequipBtn) {
            unequipBtn.onclick = () => {
              unequipBtn.classList.add('loading');
              network.sendEquip('weapon', null);
              hud.addEvent('卸下武器');
              setTimeout(() => {
                unequipBtn.classList.remove('loading');
                addButtonFeedback(unequipBtn, true, '已卸下');
              }, 300);
            };
          }
          equipmentWeapon.appendChild(slotItem);
        } catch {
          equipmentWeapon.innerHTML = '<div class="slot-empty">无效武器</div>';
        }
      } else {
        equipmentWeapon.innerHTML = '<div class="slot-empty">未装备</div>';
      }
    } else {
      equipmentWeapon.innerHTML = '<div class="slot-empty">未装备</div>';
    }
  }
  
  // 更新背包槽位
  if (equipmentBag) {
    equipmentBag.innerHTML = '';
    if (playerProfile!.equipment.bagIid) {
      const bagItem = findItemByIid(playerProfile!, playerProfile!.equipment.bagIid);
      if (bagItem) {
        try {
          const bagDef = getBagDef(bagItem.typeId);
          const itemType = getItemType(bagItem.typeId);
          const slotItem = document.createElement('div');
          slotItem.className = 'slot-item';
          slotItem.innerHTML = `
            <div class="slot-item-info">
              <div class="slot-item-name">${itemType.name}</div>
              <div class="slot-item-meta">容量: ${bagDef.bagCap}</div>
            </div>
            <div class="slot-item-actions">
              <button class="item-btn unequip-bag">卸下</button>
            </div>
          `;
          const unequipBtn = slotItem.querySelector('.unequip-bag') as HTMLButtonElement;
          if (unequipBtn) {
            unequipBtn.onclick = () => {
              unequipBtn.classList.add('loading');
              network.sendEquip('bag', null);
              hud.addEvent('卸下背包');
              setTimeout(() => {
                unequipBtn.classList.remove('loading');
                addButtonFeedback(unequipBtn, true, '已卸下');
              }, 300);
            };
          }
          equipmentBag.appendChild(slotItem);
        } catch {
          equipmentBag.innerHTML = '<div class="slot-empty">无效背包</div>';
        }
      } else {
        equipmentBag.innerHTML = '<div class="slot-empty">未装备</div>';
      }
    } else {
      equipmentBag.innerHTML = '<div class="slot-empty">未装备</div>';
    }
  }
  
  // 更新防具槽位
  if (equipmentArmor) {
    equipmentArmor.innerHTML = '';
    if (playerProfile!.equipment.armorIid) {
      const armorItem = findItemByIid(playerProfile!, playerProfile!.equipment.armorIid);
      if (armorItem) {
        try {
          const armorDef = getArmorDef(armorItem.typeId);
          const itemType = getItemType(armorItem.typeId);
          const slotItem = document.createElement('div');
          slotItem.className = 'slot-item';
          slotItem.innerHTML = `
            <div class="slot-item-info">
              <div class="slot-item-name">${itemType.name}</div>
              <div class="slot-item-meta">减伤: ${Math.floor(armorDef.damageReduction * 100)}%</div>
            </div>
            <div class="slot-item-actions">
              <button class="item-btn unequip-armor">卸下</button>
            </div>
          `;
          const unequipBtn = slotItem.querySelector('.unequip-armor') as HTMLButtonElement;
          if (unequipBtn) {
            unequipBtn.onclick = () => {
              unequipBtn.classList.add('loading');
              network.sendEquip('armor', null);
              hud.addEvent('卸下防具');
              setTimeout(() => {
                unequipBtn.classList.remove('loading');
                addButtonFeedback(unequipBtn, true, '已卸下');
              }, 300);
            };
          }
          equipmentArmor.appendChild(slotItem);
        } catch {
          equipmentArmor.innerHTML = '<div class="slot-empty">无效防具</div>';
        }
      } else {
        equipmentArmor.innerHTML = '<div class="slot-empty">未装备</div>';
      }
    } else {
      equipmentArmor.innerHTML = '<div class="slot-empty">未装备</div>';
    }
  }
}

// 新增: 更新快捷栏 HUD
function updateHotbarHud(localPlayer: PLAYER_STATE | null): void {
  getRaidElements();
  
  if (!hotbarHud) {
    console.warn('[updateHotbarHud] hotbarHud element not found');
    return;
  }
  
  if (currentPhase !== 'RAID' || !localPlayer || localPlayer.status !== 'ALIVE') {
    hotbarHud.style.display = 'none';
    return;
  }
  
  hotbarHud.style.display = 'flex';
  
  // 获取可使用的物品（使用统一的定义）
  const usableItemTypeIds = getUsableItemTypeIds();
  const usableItems = localPlayer.inventory?.items?.filter((item: ItemInstance) => {
    return isUsableItem(item.typeId);
  }) || [];
  
  // 更新每个槽位
  for (let i = 0; i < 5; i++) {
    const slot = hotbarSlots[i];
    if (!slot) continue;
    
    const item = usableItems[i];
    const iconEl = slot.querySelector('.hotbar-slot-icon') as HTMLElement;
    const countEl = slot.querySelector('.hotbar-slot-count') as HTMLElement;
    
    if (item) {
      // 有物品
      slot.className = 'hotbar-slot has-item';
      
      // 获取物品类型定义
      const itemType = getItemType(item.typeId);
      const shortName = itemType.shortName || itemType.name;
      
      // 根据物品类型添加样式类
      if (item.typeId === 'medkit' || item.typeId === 'advanced_medkit') {
        slot.classList.add('medkit');
      } else if (item.typeId === 'combat_stim') {
        slot.classList.add('stim');
      } else if (item.typeId === 'regeneration_serum') {
        slot.classList.add('regen');
      } else if (isThrowableItem(item.typeId)) {
        slot.classList.add('grenade');
      }
      
      iconEl.textContent = shortName;
      countEl.textContent = `x${item.qty}`;
    } else {
      // 空槽位
      slot.className = 'hotbar-slot empty';
      iconEl.textContent = '-';
      countEl.textContent = '';
    }
  }
}

// 新增: 更新局内装备 HUD
function updateRaidEquipmentUI(localPlayer: PLAYER_STATE | null): void {
  getRaidElements();

  const showRaidHUD = (): void => {
    if (!raidEquipment) return;
    raidEquipment.style.display = 'block';
    raidEquipment.style.opacity = '1';
    raidEquipment.style.pointerEvents = 'auto';
    raidEquipment.classList.add('visible');
  };

  const hideRaidHUD = (): void => {
    if (!raidEquipment) return;
    raidEquipment.style.display = 'none';
    raidEquipment.style.opacity = '0';
    raidEquipment.style.pointerEvents = 'none';
    raidEquipment.classList.remove('visible');
  };

  if (!raidEquipment) {
    return;
  }

  if (currentPhase !== 'RAID') {
    hideRaidHUD();
    if (raidBagList) {
      raidBagList.classList.remove('expanded');
      raidBagList.innerHTML = '';
    }
    lastRaidBagSignature = '';
    lastRaidBagExpanded = false;
    return;
  }

  showRaidHUD();

  if (!localPlayer || localPlayer.status !== 'ALIVE') {
    if (raidWeaponName) raidWeaponName.textContent = '未就绪';
    if (raidWeaponMeta) raidWeaponMeta.textContent = '-';
    if (raidBagName) raidBagName.textContent = '-';
    if (raidBagMeta) raidBagMeta.textContent = '-';
    if (raidArmorName) raidArmorName.textContent = '-';
    if (raidArmorMeta) raidArmorMeta.textContent = '-';
    if (raidWeaponSwap) raidWeaponSwap.disabled = true;
    if (raidWeaponUnequip) raidWeaponUnequip.disabled = true;
    if (raidArmorUnequip) raidArmorUnequip.disabled = true;
    if (raidBagList) {
      raidBagList.classList.remove('expanded');
      raidBagList.innerHTML = '';
    }
    lastRaidBagSignature = '';
    lastRaidBagExpanded = false;
    return;
  }

  const weaponTypeId = localPlayer.weaponRuntime?.weaponTypeId ?? 'w_fists';
  let weaponName = weaponTypeId;
  let weaponMeta = '-';
  try {
    const weaponDef = getWeaponDef(weaponTypeId);
    weaponName = weaponDef.name;
    if (weaponDef.magSize > 0 && localPlayer.weaponRuntime) {
      weaponMeta = `弹匣 ${localPlayer.weaponRuntime.ammoInMag}/${weaponDef.magSize} | 伤害 ${weaponDef.damage}`;
    } else {
      weaponMeta = `伤害 ${weaponDef.damage}`;
    }
  } catch {}

  if (raidWeaponName) raidWeaponName.textContent = weaponName;
  if (raidWeaponMeta) raidWeaponMeta.textContent = weaponMeta;

  const inventoryItems = localPlayer.inventory?.items ?? [];
  const bagCap = localPlayer.inventory?.bagCap ?? 0;
  const bagUsed = inventoryItems.length;
  const totalQty = inventoryItems.reduce((sum: number, entry: ItemInstance) => sum + entry.qty, 0);
  const equippedWeaponIid = localPlayer.raidEquipment?.weaponIid ?? null;
  const equippedBagIid = localPlayer.raidEquipment?.bagIid ?? null;
  const equippedArmorIid = localPlayer.raidEquipment?.armorIid ?? null;
  const bagTypeId = localPlayer.raidEquipment?.bagTypeId ?? null;
  let bagName = bagTypeId ? bagTypeId : '基础背包';
  if (bagTypeId) {
    try {
      bagName = getBagDef(bagTypeId).name;
    } catch {}
  }
  if (raidBagName) raidBagName.textContent = bagName;
  if (raidBagMeta) raidBagMeta.textContent = `容量 ${bagUsed}/${bagCap} | 总数 ${totalQty}`;

  const armorTypeId = localPlayer.raidEquipment?.armorTypeId ?? null;
  let armorName = armorTypeId ? armorTypeId : '无防具';
  let armorMeta = '减伤 0%';
  if (armorTypeId) {
    try {
      const armorDef = getArmorDef(armorTypeId);
      armorName = armorDef.name;
      armorMeta = `减伤 ${Math.floor(armorDef.damageReduction * 100)}%`;
    } catch {}
  }
  if (raidArmorName) raidArmorName.textContent = armorName;
  if (raidArmorMeta) raidArmorMeta.textContent = armorMeta;

  const weaponItems = inventoryItems.filter((item: ItemInstance) => isWeaponTypeId(item.typeId));
  const canSwap =
    weaponTypeId === 'w_fists'
      ? weaponItems.length > 0
      : weaponItems.some((item: ItemInstance) => item.typeId !== weaponTypeId);

  if (raidWeaponSwap) raidWeaponSwap.disabled = !canSwap;
  if (raidWeaponUnequip) {
    const canUnequip = weaponTypeId !== 'w_fists' && inventoryItems.length < bagCap;
    raidWeaponUnequip.disabled = !canUnequip;
  }
  if (raidArmorUnequip) {
    const canUnequipArmor = armorTypeId !== null && inventoryItems.length < bagCap;
    raidArmorUnequip.disabled = !canUnequipArmor;
  }

  if (raidBagToggle) {
    raidBagToggle.textContent = raidBagExpanded ? '收起' : '展开';
  }

  if (raidBagList) {
    if (!raidBagExpanded) {
      raidBagList.classList.remove('expanded');
      raidBagList.innerHTML = '';
      lastRaidBagSignature = '';
      lastRaidBagExpanded = false;
    } else {
      const bagSignature = [
        bagCap,
        equippedWeaponIid ?? '',
        equippedBagIid ?? '',
        equippedArmorIid ?? '',
        inventoryItems.map((item: ItemInstance) => `${item.iid}:${item.typeId}:${item.qty}`).join(','),
      ].join('|');
      const needsRebuild = !lastRaidBagExpanded || bagSignature !== lastRaidBagSignature;
      if (needsRebuild) {
        raidBagList.classList.add('expanded');
        if (inventoryItems.length === 0) {
          raidBagList.innerHTML = '<div class="raid-bag-empty">空</div>';
        } else {
          raidBagList.innerHTML = '';
          for (const item of inventoryItems) {
            let itemName = item.typeId;
            let rarityLabel = '';
            let rarityColor = '#888';
            let itemValue = 0;
            try {
              const itemType = getItemType(item.typeId);
              itemName = itemType.name;
              itemValue = itemType.value * item.qty;
              if (itemType.rarity === 'COMMON') {
                rarityLabel = '常见';
                rarityColor = '#aaa';
              } else if (itemType.rarity === 'RARE') {
                rarityLabel = '稀有';
                rarityColor = '#4CAF50';
              } else if (itemType.rarity === 'EPIC') {
                rarityLabel = '史诗';
                rarityColor = '#9d4edd';
              } else if (itemType.rarity === 'LEGENDARY') {
                rarityLabel = '传说';
                rarityColor = '#ffaa00';
              }
            } catch {}
            const isEquipped =
              item.iid === equippedWeaponIid ||
              item.iid === equippedBagIid ||
              item.iid === equippedArmorIid;

            const row = document.createElement('div');
            row.className = 'raid-bag-item';
            row.innerHTML = `
              <div>
                <div class="raid-bag-item-name">${itemName}</div>
                <div class="raid-bag-item-meta">x${item.qty}${isEquipped ? ' | 已装备' : ''} | <span style="color: ${rarityColor};">${rarityLabel}</span> | <span style="color: #ffd700;">$${itemValue}</span></div>
              </div>
              <button class="item-btn raid-bag-drop" data-iid="${item.iid}" data-qty="${item.qty}" ${isEquipped ? 'disabled' : ''}>丢弃</button>
            `;
            raidBagList.appendChild(row);
          }
        }
      }
      lastRaidBagSignature = bagSignature;
      lastRaidBagExpanded = true;
    }
  }
}

function updateWeaponHud(localPlayer: PLAYER_STATE | null): void {
  getWeaponHudElements();

  if (!weaponHud) {
    return;
  }

  if (currentPhase !== 'RAID' || !localPlayer || localPlayer.status !== 'ALIVE' || !localPlayer.weaponRuntime) {
    weaponHud.style.display = 'none';
    if (weaponHudState) weaponHudState.textContent = '';
    return;
  }

  let weaponName = localPlayer.weaponRuntime.weaponTypeId;
  let ammoInMag = localPlayer.weaponRuntime.ammoInMag;
  let magSize = 0;
  let reloadMs = 0;
  try {
    const weaponDef = getWeaponDef(localPlayer.weaponRuntime.weaponTypeId);
    weaponName = weaponDef.name;
    magSize = weaponDef.magSize;
    reloadMs = weaponDef.reloadMs;
  } catch {}

  const currentTick = network.getConnectionState().lastServerTick;
  const reloading =
    localPlayer.weaponRuntime.reloadingUntilTick > 0 &&
    currentTick < localPlayer.weaponRuntime.reloadingUntilTick;
  const reloadTicks = msToTicks(reloadMs);
  const reloadProgress = reloading && reloadTicks > 0
    ? Math.min(1, (currentTick - (localPlayer.weaponRuntime.reloadingUntilTick - reloadTicks)) / reloadTicks)
    : 0;

  weaponHud.style.display = 'block';
  if (weaponHudName) weaponHudName.textContent = weaponName;
  if (weaponHudAmmo) weaponHudAmmo.textContent = magSize > 0 ? String(ammoInMag) : '-';
  if (weaponHudMag) weaponHudMag.textContent = magSize > 0 ? String(magSize) : '-';
  if (weaponHudState) weaponHudState.textContent = reloading ? '换弹中' : '';
  
  // 设置换弹进度（整个block从左到右填充）
  const reloadProgressPercent = reloading ? `${Math.floor(reloadProgress * 100)}%` : '0%';
  weaponHud.style.setProperty('--reload-progress', reloadProgressPercent);
}

// 新增: 更新Canvas UI的武器状态（已禁用武器信息显示）
function updateCanvasUI(localPlayer: PLAYER_STATE | null): void {
  // 1. 投掷瞄准状态同步（用于解决共享 canvas 的清屏逻辑）
  uiOverlay.updateState({
    throwingAim: { enabled: isThrowingMode }
  });

  // 武器状态显示已禁用，不再更新
  // if (currentPhase !== 'RAID' || !localPlayer || localPlayer.status !== 'ALIVE') {
  //   // 禁用所有Canvas UI状态
  //   uiOverlay.updateState({
  //     weaponStatus: { enabled: false, weaponName: '', ammoInMag: 0, magSize: 0, reloading: false, reloadProgress: 0 },
  //   });
  //   return;
  // }

  // // 更新武器状态
  // let weaponEnabled = false;
  // let weaponName = '';
  // let ammoInMag = 0;
  // let magSize = 0;
  // let reloading = false;
  // let reloadProgress = 0;

  // if (localPlayer.weaponRuntime) {
  //   weaponEnabled = true;
  //   weaponName = localPlayer.weaponRuntime.weaponTypeId;
  //   ammoInMag = localPlayer.weaponRuntime.ammoInMag;
  //   
  //   try {
  //     const weaponDef = getWeaponDef(localPlayer.weaponRuntime.weaponTypeId);
  //     weaponName = weaponDef.name;
  //     magSize = weaponDef.magSize;
  //     
  //     const currentTick = network.getConnectionState().lastServerTick;
  //     reloading = localPlayer.weaponRuntime.reloadingUntilTick > 0 && currentTick < localPlayer.weaponRuntime.reloadingUntilTick;
  //     
  //     if (reloading) {
  //       const reloadTicks = msToTicks(weaponDef.reloadMs);
  //       reloadProgress = reloadTicks > 0
  //         ? Math.min(1, (currentTick - (localPlayer.weaponRuntime.reloadingUntilTick - reloadTicks)) / reloadTicks)
  //         : 0;
  //     }
  //   } catch {}
  // }

  // uiOverlay.updateState({
  //   weaponStatus: {
  //     enabled: weaponEnabled,
  //     weaponName,
  //     ammoInMag,
  //     magSize,
  //     reloading,
  //     reloadProgress,
  //   },
  // });
}

function updateHealthHud(localPlayer: PLAYER_STATE | null): void {
  getHealthHudElements();

  if (!healthHud) {
    return;
  }

  if (currentPhase !== 'RAID' || !localPlayer || localPlayer.status !== 'ALIVE') {
    healthHud.style.display = 'none';
    return;
  }

  const hp = Math.max(0, Math.min(100, localPlayer.hp));
  const hpPercent = Math.round(hp);
  const fillPercent = Math.max(0, Math.min(100, hp));
  let fillColor = '#57d957';
  if (hp <= 25) {
    fillColor = '#ff5b5b';
  } else if (hp <= 60) {
    fillColor = '#f5c542';
  }

  healthHud.style.display = 'block';
  if (healthHudValue) healthHudValue.textContent = String(hpPercent);
  if (healthHudFill) {
    healthHudFill.style.width = `${fillPercent}%`;
    healthHudFill.style.background = fillColor;
  }
}

function updateStaminaHud(localPlayer: PLAYER_STATE | null): void {
  getStaminaHudElements();

  if (!staminaHud) {
    return;
  }

  if (currentPhase !== 'RAID' || !localPlayer || localPlayer.status !== 'ALIVE') {
    staminaHud.style.display = 'none';
    return;
  }

  const stamina = Math.max(0, Math.min(localPlayer.maxStamina ?? 100, localPlayer.stamina ?? 100));
  const maxStamina = localPlayer.maxStamina ?? 100;
  const isSprinting = localPlayer.isSprinting ?? false;
  const staminaPercent = (stamina / maxStamina) * 100;
  
  // 新增: 更新InputManager的耐力耗尽状态
  inputManager.updateStaminaExhaustedState(staminaPercent);
  
  // 设置颜色类
  let colorClass = '';
  if (staminaPercent < 30) {
    colorClass = 'low';
  } else if (staminaPercent < 60) {
    colorClass = 'medium';
  }

  staminaHud.style.display = 'block';
  
  // 更新数值显示
  if (staminaHudValue) {
    staminaHudValue.textContent = `${Math.floor(stamina)}/${maxStamina}`;
  }
  
  // 更新状态显示
  if (staminaHudState) {
    staminaHudState.textContent = isSprinting ? 'SPRINTING' : '';
  }
  
  // 更新进度条
  if (staminaHudFill) {
    staminaHudFill.style.width = `${staminaPercent}%`;
    staminaHudFill.className = `stamina-hud-bar-fill ${colorClass}`;
  }
  
  // 添加/移除冲刺动画类
  if (isSprinting) {
    staminaHud.classList.add('sprinting');
  } else {
    staminaHud.classList.remove('sprinting');
  }
}

// 新增: 触发耐力UI摇晃效果
function shakeStaminaHud(): void {
  getStaminaHudElements();
  if (!staminaHud) {
    return;
  }
  
  // 添加摇晃类
  staminaHud.classList.add('shake');
  
  // 300ms后移除摇晃类
  setTimeout(() => {
    if (staminaHud) {
      staminaHud.classList.remove('shake');
    }
  }, 300);
}

// 新增: 获取当前耐力百分比（用于InputManager检查）
function getCurrentStaminaPercent(): number {
  if (!predictedLocalPlayer || currentPhase !== 'RAID') {
    return 100; // 默认返回100%，允许冲刺
  }
  
  const stamina = Math.max(0, Math.min(predictedLocalPlayer.maxStamina ?? 100, predictedLocalPlayer.stamina ?? 100));
  const maxStamina = predictedLocalPlayer.maxStamina ?? 100;
  return (stamina / maxStamina) * 100;
}

// 新增: 更新左下角 Buff HUD
function updateBuffHud(localPlayer: PLAYER_STATE | null): void {
  getBuffHudElements();

  if (!buffHud) {
    return;
  }

  // 禁用左侧 HUD 显示，改为在 Entity 上方渲染
  buffHud.style.display = 'none';
}

// 新增: 检查物品是否已装备
function isItemEquipped(item: ItemInstance): boolean {
  if (!playerProfile) return false;
  const equipment = playerProfile.equipment;
  return item.iid === equipment.weaponIid || 
         item.iid === equipment.bagIid || 
         item.iid === equipment.armorIid;
}

// 新增: 更新物品列表显示
function updateItemLists(): void {
  if (!playerProfile) return;
  
  // 更新整备区列表（过滤已装备的物品）
      // 更新整备区列表（过滤已装备的物品）
    if (prepList && playerProfile.prep) {
      const availablePrepItems = playerProfile.prep.filter((item: ItemInstance) => !isItemEquipped(item));
      
      if (availablePrepItems.length === 0) {
        if (prepList.innerHTML.indexOf('整备区为空') === -1) {
             prepList.innerHTML = '<div style="color: #666; padding: 20px; text-align: center;">整备区为空</div>';
        }
      } else {
         // Clear empty message if present
         if (prepList.firstChild && (prepList.firstChild as HTMLElement).innerText === '整备区为空') {
             prepList.innerHTML = '';
         }

        // 合并相同typeId的物品
        const mergedItems = mergeItemsByTypeId(availablePrepItems);
        // 按typeId排序
        mergedItems.sort((a, b) => a.typeId.localeCompare(b.typeId));
        
        reconcileItemList(prepList, mergedItems, 'prep');
      }
    }
  
  // 更新仓库列表（按分类和稀有度组织，过滤已装备的物品）
  updateStashList();
}

// 更新商店列表（按当前选中的分类和稀有度组织）
function updateShopList(): void {
    if (shopList) {
      shopList.innerHTML = '';
      // 重置购买计数（切换分类或刷新时重置）
      shopBuyCounts.clear();
      const allItemTypes = getAllItemTypes();
      
      // 按分类分组
      const categories: Record<string, Array<{ id: string; name: string; rarity: string; value: number; stackMax: number }>> = {
        weapon: [],
        armor: [],
        bag: [],
        consumable: [],
        material: [],
      };
      
      for (const itemType of allItemTypes) {
        const category = getItemCategory(itemType.id);
        if (categories[category]) {
          categories[category].push(itemType);
        }
      }
      
      // 只显示当前选中的分类
      const items = categories[currentShopCategory] || [];
      if (items.length === 0) {
        shopList.innerHTML = '<div style="color: #666; padding: 20px; text-align: center;">该分类暂无物品</div>';
        return;
      }
      
      // 按稀有度分组
      const rarityGroups: Record<string, typeof items> = {
        COMMON: [],
        RARE: [],
        EPIC: [],
        LEGENDARY: [],
      };
      
      for (const item of items) {
        const rarity = item.rarity || 'COMMON';
        if (rarityGroups[rarity]) {
          rarityGroups[rarity].push(item);
        }
      }
      
      // 为每个稀有度创建区域
      const rarityOrder = ['COMMON', 'RARE', 'EPIC', 'LEGENDARY'];
      for (const rarity of rarityOrder) {
        const rarityItems = rarityGroups[rarity];
        if (rarityItems.length === 0) continue;
        
        // 稀有度区域
        const raritySection = document.createElement('div');
        raritySection.className = 'shop-rarity-section';
        
        // 稀有度标题
        const rarityHeader = document.createElement('div');
        rarityHeader.className = `shop-rarity-header ${rarity.toLowerCase()}`;
        rarityHeader.textContent = rarity === 'COMMON' ? '普通' : rarity === 'RARE' ? '稀有' : rarity === 'EPIC' ? '史诗' : '传说';
        raritySection.appendChild(rarityHeader);
        
        // 物品列表
        const rarityItemsDiv = document.createElement('div');
        rarityItemsDiv.className = 'shop-rarity-items shop-rarity-items-wide';
        
        // 按名称排序
        rarityItems.sort((a, b) => a.name.localeCompare(b.name));
        
        for (const itemType of rarityItems) {
          const row = createShopRow(itemType);
          rarityItemsDiv.appendChild(row);
        }
        
        raritySection.appendChild(rarityItemsDiv);
        shopList.appendChild(raritySection);
      }
    }
  }

// 初始化商店 Tab 切换
function initShopTabs(): void {
    if (!shopTabs) return;
    
    const tabButtons = shopTabs.querySelectorAll('.shop-tab-btn');
    tabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const category = btn.getAttribute('data-shop-category');
        if (category) {
          // 移除所有 active 类
          tabButtons.forEach(b => b.classList.remove('active'));
          // 添加 active 类到当前按钮
          btn.classList.add('active');
          // 更新当前分类
          currentShopCategory = category;
          // 更新商店列表
          updateShopList();
        }
      });
    });
  }

// 更新仓库列表（按当前选中的分类和稀有度组织）
// 更新仓库列表（按当前选中的分类和稀有度组织）
function updateStashList(): void {
  if (!stashList || !playerProfile || !playerProfile.stash) return;
  
  const availableStashItems = playerProfile.stash.filter(item => !isItemEquipped(item));
  
  if (availableStashItems.length === 0) {
    if (stashList.innerHTML.indexOf('仓库为空') === -1) {
       stashList.innerHTML = '<div style="color: #666; padding: 20px; text-align: center;">仓库为空</div>';
    }
    return;
  }
  
  // Clear empty message if present
  if (stashList.firstChild && (stashList.firstChild as HTMLElement).innerText === '仓库为空') {
     stashList.innerHTML = '';
  }

  // 按分类分组
  const categories: Record<string, ItemInstance[]> = {
    weapon: [],
    armor: [],
    bag: [],
    consumable: [],
    material: [],
  };
  
  for (const item of availableStashItems) {
    const category = getItemCategory(item.typeId);
    if (categories[category]) {
      categories[category].push(item);
    }
  }
  
  // 只显示当前选中的分类
  const selectedCategory = (typeof currentStashCategory !== 'undefined' ? currentStashCategory : 'weapon');
  const items = categories[selectedCategory] || [];
  if (items.length === 0) {
      // 检查当前是否已经显示了"暂无物品"
      const currentContent = stashList.textContent || '';
      if (currentContent.includes('暂无物品') && stashList.children.length === 1) {
          return; 
      }
    stashList.innerHTML = '<div style="color: #666; padding: 20px; text-align: center;">该分类暂无物品</div>';
    return;
  } else {
     // Clear empty category message
     if (stashList.firstChild && (stashList.firstChild as HTMLElement).innerText === '该分类暂无物品') {
         stashList.innerHTML = '';
     }
  }
  
  // 按稀有度分组
  const rarityGroups: Record<string, ItemInstance[]> = {
    COMMON: [],
    RARE: [],
    EPIC: [],
    LEGENDARY: [],
  };
  
  for (const item of items) {
    try {
      const itemType = getItemType(item.typeId);
      const rarity = itemType.rarity || 'COMMON';
      if (rarityGroups[rarity]) {
        rarityGroups[rarity].push(item);
      }
    } catch {
      // 如果无法获取物品类型，归类为 COMMON
      rarityGroups['COMMON'].push(item);
    }
  }
  
  const rarityOrder = ['COMMON', 'RARE', 'EPIC', 'LEGENDARY'];
  
  // 按照稀有度顺序管理 DOM 结构
  // 注意：这里我们假设稀有度分区的顺序不会变，只需管理内容
  
  // 首先确保所有需要的 rarity section 都存在，不需要的移除（或者隐藏）
  // 为了简单，我们只从上到下渲染存在的 rarity section
  
  // 使用一个简单的 diff 策略：遍历 rarityOrder，如果该稀有度有物品，则查找或创建 section 并 reconcile 列表
  
    rarityOrder.forEach(rarity => {
        const rarityItems = rarityGroups[rarity];
        const sectionId = `stash-section-${rarity}`;
        let raritySection = document.getElementById(sectionId);

        if (rarityItems.length === 0) {
            if (raritySection) {
                raritySection.style.display = 'none';
            }
            return;
        }

        // Create section if not exists
        if (!raritySection) {
            raritySection = document.createElement('div');
            raritySection.id = sectionId;
            raritySection.className = 'shop-rarity-section';
            
            const rarityHeader = document.createElement('div');
            rarityHeader.className = `shop-rarity-header ${rarity.toLowerCase()}`;
            rarityHeader.textContent = rarity === 'COMMON' ? '普通' : rarity === 'RARE' ? '稀有' : rarity === 'EPIC' ? '史诗' : '传说';
            raritySection.appendChild(rarityHeader);
            
            const listDiv = document.createElement('div');
            listDiv.className = 'shop-rarity-items stash-rarity-items';
            raritySection.appendChild(listDiv);
            
            // Insert in correct order? For simplicity append, or check siblings.
            // Since we iterate in order, appending usually works if we start empty.
            // But if we have dynamic updates, strict ordering is better.
            stashList?.appendChild(raritySection); 
        }

        raritySection.style.display = 'block';

        const listDiv = raritySection.querySelector('.stash-rarity-items') as HTMLElement;
        if (listDiv) {
             // 合并 + 排序
            const mergedItems = mergeItemsByTypeId(rarityItems);
            mergedItems.sort((a, b) => {
                try {
                    const aType = getItemType(a.typeId);
                    const bType = getItemType(b.typeId);
                    return aType.name.localeCompare(bType.name);
                } catch {
                    return a.typeId.localeCompare(b.typeId);
                }
            });
            
            reconcileItemList(listDiv, mergedItems, 'stash');
        }
    });

    // Cleanup: Remove sections that shouldn't exist? (Managed by display:none above)
}

// 初始化仓库 Tab 切换
function initStashTabs(): void {
  if (!stashTabs) return;
  
  const tabButtons = stashTabs.querySelectorAll('.shop-tab-btn');
  tabButtons.forEach((btn: Element) => {
    btn.addEventListener('click', () => {
      const category = btn.getAttribute('data-stash-category');
      if (category) {
        // 移除所有 active 类
        tabButtons.forEach((b: Element) => b.classList.remove('active'));
        // 添加 active 类到当前按钮
        btn.classList.add('active');
        // 更新当前分类
        currentStashCategory = category;
        // 更新仓库列表
        updateStashList();
      }
    });
  });
}

// 获取物品分类
function getItemCategory(typeId: string): string {
    try {
      const itemType = getItemType(typeId);
      return itemType.category;
    } catch {
      return 'material'; // fallback
    }
  }

  function getItemCategoryOrder(typeId: string): number {
    try {
      getWeaponDef(typeId);
      return 0;
    } catch {}
    try {
      getArmorDef(typeId);
      return 1;
    } catch {}
    try {
      getBagDef(typeId);
      return 2;
    } catch {}
    return 3;
  }

  function getRarityOrder(rarity?: string): number {
    if (rarity === 'COMMON') return 0;
    if (rarity === 'RARE') return 1;
    if (rarity === 'EPIC') return 2;
    return 3;
  }

  function sortItemInstances(items: ItemInstance[]): ItemInstance[] {
    return [...items].sort((a, b) => {
      const aCategory = getItemCategoryOrder(a.typeId);
      const bCategory = getItemCategoryOrder(b.typeId);
      if (aCategory !== bCategory) return aCategory - bCategory;

      const aType = safeGetItemType(a.typeId);
      const bType = safeGetItemType(b.typeId);
      const aRarity = getRarityOrder(aType?.rarity);
      const bRarity = getRarityOrder(bType?.rarity);
      if (aRarity !== bRarity) return aRarity - bRarity;

      const aName = aType?.name ?? a.typeId;
      const bName = bType?.name ?? b.typeId;
      if (aName !== bName) return aName.localeCompare(bName);

      const aStackable = (aType?.stackMax ?? 1) > 1;
      const bStackable = (bType?.stackMax ?? 1) > 1;
      if (aStackable && bStackable && a.qty !== b.qty) {
        return b.qty - a.qty;
      }
      return a.typeId.localeCompare(b.typeId);
    });
  }

  function sortItemTypes(items: Array<{ id: string; rarity?: string; name?: string; stackMax?: number }>): Array<{ id: string; rarity?: string; name?: string; stackMax?: number }> {
    return [...items].sort((a, b) => {
      const aCategory = getItemCategoryOrder(a.id);
      const bCategory = getItemCategoryOrder(b.id);
      if (aCategory !== bCategory) return aCategory - bCategory;

      const aRarity = getRarityOrder(a.rarity);
      const bRarity = getRarityOrder(b.rarity);
      if (aRarity !== bRarity) return aRarity - bRarity;

      const aName = a.name ?? a.id;
      const bName = b.name ?? b.id;
      return aName.localeCompare(bName);
    });
  }

  function safeGetItemType(typeId: string) {
    try {
      return getItemType(typeId);
    } catch {
      return null;
    }
  }

// 新增: 检查物品类型（武器/背包/防具）
function getItemSlot(typeId: string): 'weapon' | 'bag' | 'armor' | null {
  // 排除手雷等消耗品，它们不能装备
  if (typeId === 'frag_grenade' || typeId === 'medkit') {
    return null;
  }
  
  try {
    getWeaponDef(typeId);
    return 'weapon';
  } catch {
    try {
      getBagDef(typeId);
      return 'bag';
    } catch {
      try {
        getArmorDef(typeId);
        return 'armor';
      } catch {
        return null;
      }
    }
  }
}

// 新增: 合并相同物品的辅助类型
interface MergedItem {
  typeId: string;
  totalQty: number;
  items: ItemInstance[]; // 所有相同typeId的物品实例
}

// 新增: 合并相同typeId的物品
function mergeItemsByTypeId(items: ItemInstance[]): MergedItem[] {
  const mergedMap = new Map<string, MergedItem>();
  
  for (const item of items) {
    const existing = mergedMap.get(item.typeId);
    if (existing) {
      existing.totalQty += item.qty;
      existing.items.push(item);
    } else {
      mergedMap.set(item.typeId, {
        typeId: item.typeId,
        totalQty: item.qty,
        items: [item]
      });
    }
  }
  
  return Array.from(mergedMap.values());
}

// 新增: 智能更新物品列表 (Reconciliation)
function reconcileItemList(container: HTMLElement, mergedItems: MergedItem[], source: 'prep' | 'stash'): void {
    const existingCards = Array.from(container.children) as HTMLElement[];
    const existingMap = new Map<string, HTMLElement>();
    
    existingCards.forEach(card => {
        const typeId = card.getAttribute('data-type-id');
        if (typeId) {
            existingMap.set(typeId, card);
        } else {
            // Remove invalid/legacy cards
            card.remove();
        }
    });

    const activeTypeIds = new Set<string>();

    mergedItems.forEach((item, index) => {
        const typeId = item.typeId;
        activeTypeIds.add(typeId);
        
        // Try get Type Def
        let itemType;
        try { itemType = getItemType(typeId); } catch { return; }

        let card = existingMap.get(typeId);

        if (card) {
            // Update existing
            const countBadge = card.querySelector('.item-count-badge');
            if (countBadge) {
                const currentQty = parseInt(countBadge.textContent || '0');
                if (currentQty !== item.totalQty) {
                    countBadge.textContent = item.totalQty.toString();
                    countBadge.classList.remove('hidden');
                    if (item.totalQty <= 1 && itemType.stackMax <= 1) {
                         countBadge.classList.add('hidden');
                    } else {
                         // Animate update
                        countBadge.classList.remove('updated');
                        void (countBadge as HTMLElement).offsetWidth; // trigger reflow
                        countBadge.classList.add('updated');
                    }
                }
            }
            
            // Critical Fix: Update the current IID for actions
            // Even if the card exists, the "first item" (target of actions) might have changed
            // if the previous first item was moved/sold.
            card.setAttribute('data-current-iid', item.items[0].iid);
            
            // Move to correct position if order changed
            if (container.children[index] !== card) {
                container.insertBefore(card, container.children[index]);
            }

        } else {
            // Create new
             card = createItemCard(item, itemType, source);
             if (index < container.children.length) {
                 container.insertBefore(card, container.children[index]);
             } else {
                 container.appendChild(card);
             }
        }
    });

    // Remove redundant
    existingMap.forEach((card, typeId) => {
        if (!activeTypeIds.has(typeId)) {
            card.style.opacity = '0';
            card.style.transform = 'scale(0.9)';
            setTimeout(() => card.remove(), 250); // Animated removal
        }
    });
}

// 新增: 追踪正在处理的物品，防止重复操作，同时支持从堆叠中快速连续操作
const pendingActionItems = new Set<string>();

// 新增: 创建物品卡片 (Replacing Row)
function createItemCard(mergedItem: MergedItem, itemType: any, source: 'prep' | 'stash'): HTMLElement {
  const card = document.createElement('div');
  card.className = 'stash-card';
  card.setAttribute('data-type-id', mergedItem.typeId); // Important for reconciliation
  
  // Store the current IID on the card element itself (for dynamic retrieval)
  const firstItem = mergedItem.items[0];
  card.setAttribute('data-current-iid', firstItem.iid);
  
  const header = document.createElement('div');
  header.className = 'stash-card-header';
  
  const title = document.createElement('div');
  title.className = 'stash-card-title';
  title.textContent = itemType.name;
  
  const price = document.createElement('div');
  price.className = 'stash-card-price';
  price.textContent = `💰 ${itemType.value}`;
  
  header.appendChild(title);
  header.appendChild(price);
  
  // 先添加 header（标题和价格在最上面）
  card.appendChild(header);
  
  // Quantity Badge
  const countBadge = document.createElement('div');
  countBadge.className = 'item-count-badge';
  countBadge.textContent = mergedItem.totalQty.toString();
  if (mergedItem.totalQty <= 1 && (itemType.stackMax || 1) <= 1) {
      countBadge.classList.add('hidden');
  }
  // Attach badge to card (absolute positioned)
  card.appendChild(countBadge);
  
  // 获取并分割描述
  const description = getItemDescription(itemType);
  const descParts = description.split('\n');
  const descText = descParts[0] || ''; // 第一行是描述文本
  const statsText = descParts[1] || ''; // 第二行是数值统计
  
  // 创建描述文本元素（如果有）
  if (descText) {
    const descEl = document.createElement('div');
    descEl.className = 'stash-card-desc';
    descEl.style.color = '#999';
    descEl.style.fontSize = '11px';
    descEl.style.lineHeight = '1.4';
    descEl.style.marginBottom = '4px';
    descEl.textContent = descText;
    card.appendChild(descEl);
  }
  
  // 创建数值统计元素（如果有）
  if (statsText) {
    const statsEl = document.createElement('div');
    statsEl.className = 'stash-card-stats';
    statsEl.style.color = '#0ff';
    statsEl.style.fontSize = '11px';
    statsEl.style.fontWeight = 'bold';
    statsEl.style.fontFamily = "'Courier New', monospace";
    statsEl.style.letterSpacing = '0.5px';
    statsEl.style.textShadow = '0 0 8px rgba(0, 255, 255, 0.3)';
    statsEl.textContent = statsText;
    card.appendChild(statsEl);
  }

  const actions = document.createElement('div');
  actions.className = 'stash-card-actions';
  
  // 检查是否是装备（武器/背包/防具）
  const slot = getItemSlot(mergedItem.typeId);

  // Helper: Find the next available item IID for this type
  // This allows rapid clicking by picking the next item in the stack that isn't already being processed
  const getNextAvailableIID = (): string | null => {
      // Get FRESH list from profile
      let pool: ItemInstance[] = [];
      if (source === 'prep' && playerProfile?.prep) {
          pool = playerProfile.prep;
      } else if (source === 'stash' && playerProfile?.stash) {
          pool = playerProfile.stash;
      }
      
      // Find items of this type that are NOT pending
      const candidate = pool.find(item => 
          item.typeId === mergedItem.typeId && 
          !pendingActionItems.has(item.iid) &&
          !isItemEquipped(item)
      );
      
      return candidate ? candidate.iid : null;
  };
  
  const executeAction = (actionName: string, networkCall: (iid: string) => void) => {
      const iid = getNextAvailableIID();
      if (!iid) {
          console.log(`[DEBUG] No available item for ${actionName} (all pending or gone)`);
          return;
      }
      
      console.log(`[DEBUG] ${actionName}: ${itemType.name} (iid: ${iid})`);
      
      // Mark as pending
      pendingActionItems.add(iid);
      
      // Execute
      networkCall(iid);
      
      // Safety cleanup: remove from pending after 2s in case update never comes (packet loss)
      setTimeout(() => pendingActionItems.delete(iid), 2000);
  };

  if (source === 'prep') {
    // 整备区 -> 仓库
    const moveBtn = document.createElement('button');
    moveBtn.className = 'stash-btn';
    moveBtn.textContent = '移回仓库';
    moveBtn.onclick = () => {
        executeAction('Move Prep->Stash', (iid) => network.sendMovePrepToStash(iid, 1));
        // No disabled state!
    };
    actions.appendChild(moveBtn);
    
    if (slot) {
        const equipBtn = document.createElement('button');
        equipBtn.className = 'stash-btn primary';
        equipBtn.textContent = '装备';
        equipBtn.onclick = () => {
            executeAction('Equip from Prep', (iid) => network.sendEquip(slot, iid));
        };
        actions.appendChild(equipBtn);
    }

  } else {
    // 仓库 -> 整备区 / 卖出
    const moveBtn = document.createElement('button');
    moveBtn.className = 'stash-btn';
    moveBtn.textContent = '带入';
    moveBtn.onclick = () => {
        executeAction('Move Stash->Prep', (iid) => network.sendMoveStashToPrep(iid, 1));
        // No disabled state!
    };
    actions.appendChild(moveBtn);

    const sellBtn = document.createElement('button');
    sellBtn.className = 'stash-btn';
    sellBtn.textContent = '卖出';
    sellBtn.onclick = () => {
        executeAction('Sell Stash', (iid) => network.sendSellFromStash(iid, 1));
    };
    actions.appendChild(sellBtn);

      if (slot) {
        const equipBtn = document.createElement('button');
        equipBtn.className = 'stash-btn primary';
        equipBtn.textContent = '装备';
        equipBtn.onclick = () => {
             executeAction('Equip from Stash', (iid) => network.sendEquip(slot, iid));
        };
        actions.appendChild(equipBtn);
    }
  }

  card.appendChild(actions);

  return card;
}

// 新增: 获取物品简短描述
function getItemDescription(itemType: any): string {
  const typeId = itemType.id || itemType.typeId;
  const parts = [];
  
  // 添加物品目录中的描述（如果有）
  if (itemType.description) {
    parts.push(itemType.description);
  }
  
  // 武器 - 添加具体数值
  try {
    const weaponDef = getWeaponDef(typeId);
    const stats = [];
    stats.push(`伤害: ${weaponDef.damage}`);
    if (weaponDef.pelletCount && weaponDef.pelletCount > 1) {
      stats.push(`弹丸: ${weaponDef.pelletCount}`);
    }
    stats.push(`弹匣: ${weaponDef.magSize}`);
    // 计算射程（bulletSpeed * bulletLifeMs / 1000）
    const range = Math.floor(weaponDef.bulletSpeed * weaponDef.bulletLifeMs / 1000);
    if (range > 0) {
      stats.push(`射程: ${range}`);
    }
    const fireRatePerMin = Math.floor(60000 / weaponDef.fireIntervalMs);
    stats.push(`射速: ${fireRatePerMin}/分`);
    // 添加速度buff/debuff显示
    if (weaponDef.buffs?.speedMultiplier) {
      const speedChange = Math.floor((weaponDef.buffs.speedMultiplier - 1) * 100);
      if (speedChange > 0) {
        stats.push(`速度: +${speedChange}%`);
      } else if (speedChange < 0) {
        stats.push(`速度: ${speedChange}%`);
      }
    }
    parts.push(stats.join(' | '));
    return parts.join('\n');
  } catch {}
  
  // 防具 - 添加具体数值
  try {
    const armorDef = getArmorDef(typeId);
    const stats = [];
    stats.push(`减伤: ${Math.floor(armorDef.damageReduction * 100)}%`);
    if (armorDef.buffs?.speedMultiplier) {
      const speedChange = Math.floor((armorDef.buffs.speedMultiplier - 1) * 100);
      if (speedChange > 0) {
        stats.push(`速度: +${speedChange}%`);
      } else if (speedChange < 0) {
        stats.push(`速度: ${speedChange}%`);
      }
    }
    parts.push(stats.join(' | '));
    return parts.join('\n');
  } catch {}
  
  // 背包 - 添加具体数值
  try {
    const bagDef = getBagDef(typeId);
    parts.push(`容量: ${bagDef.bagCap} 格`);
    return parts.join('\n');
  } catch {}
  
  // 消耗品 - 添加具体数值
  if (itemType.consumableProps) {
    const props = itemType.consumableProps;
    const stats = [];
    
    if (props.healAmount) {
      stats.push(`恢复: ${props.healAmount}HP`);
    }
    if (props.damage) {
      stats.push(`伤害: ${props.damage}`);
    }
    if (props.explosionRadius) {
      stats.push(`爆炸半径: ${props.explosionRadius}像素`);
    }
    if (props.flashRadius && props.flashDurationMs) {
      stats.push(`致盲范围: ${props.flashRadius}像素`);
      stats.push(`致盲时长: ${Math.floor(props.flashDurationMs / 1000)}秒`);
    }
    if (props.smokeRadius && props.smokeDurationMs) {
      stats.push(`烟雾范围: ${props.smokeRadius}像素`);
      stats.push(`持续时间: ${Math.floor(props.smokeDurationMs / 1000)}秒`);
    }
    if (props.fireRadius && props.fireDurationMs && props.fireDamagePerSecond) {
      stats.push(`火焰范围: ${props.fireRadius}像素`);
      stats.push(`持续时间: ${Math.floor(props.fireDurationMs / 1000)}秒`);
      stats.push(`伤害: ${props.fireDamagePerSecond}HP/秒`);
    }
    if (props.buffDurationMs && props.speedMultiplier) {
      stats.push(`速度加成: +${Math.floor((props.speedMultiplier - 1) * 100)}%`);
      stats.push(`持续时间: ${Math.floor(props.buffDurationMs / 1000)}秒`);
    }
    if (props.buffDurationMs && props.hpPerSecond) {
      stats.push(`回复: ${props.hpPerSecond}HP/秒`);
      stats.push(`持续时间: ${Math.floor(props.buffDurationMs / 1000)}秒`);
    }
    if (props.disguiseDurationMs) {
      stats.push(`伪装时长: ${Math.floor(props.disguiseDurationMs / 1000)}秒`);
    }
    if (props.durationMs && itemType.id === 'i_sentry_turret') {
      stats.push(`持续时间: ${Math.floor(props.durationMs / 1000)}秒`);
    }
    
    if (stats.length > 0) {
      parts.push(stats.join(' | '));
    }
    
    return parts.join('\n');
  }
  
  // 材料或其他 - 显示堆叠上限
  if (itemType.stackMax && itemType.stackMax > 1) {
    parts.push(`最大堆叠: ${itemType.stackMax}`);
  }
  
  return parts.join('\n');
}

// 新增: 创建商店物品行
function createShopRow(itemType: any): HTMLElement {
  const row = document.createElement('div');
  row.className = 'item-row';
  
  const info = document.createElement('div');
  info.className = 'item-info';
  
  // 价格显示在标题后面，带金币图标
  const priceHtml = `<span style="color: #ffd700; margin-left: 8px;">💰 ${itemType.value}</span>`;
  const description = getItemDescription(itemType);
  
  // 分割描述和数值统计（通过换行符）
  const descParts = description.split('\n');
  const descText = descParts[0] || ''; // 第一行是描述文本
  const statsText = descParts[1] || ''; // 第二行是数值统计
  
  // 构建HTML
  let descHtml = '';
  if (descText) {
    descHtml += `<div class="item-desc" style="margin-top: 4px; color: #999; font-size: 11px; line-height: 1.4;">${descText}</div>`;
  }
  if (statsText) {
    descHtml += `<div class="item-stats" style="margin-top: 6px; color: #0ff; font-size: 12px; font-weight: bold; font-family: 'Courier New', monospace; letter-spacing: 0.5px; text-shadow: 0 0 8px rgba(0, 255, 255, 0.3);">${statsText}</div>`;
  }
  
  info.innerHTML = `
    <div class="item-name">${itemType.name}${priceHtml}</div>
    ${descHtml}
  `;
  
  const actions = document.createElement('div');
  actions.className = 'item-actions';
  
  const buyBtn = document.createElement('button');
  buyBtn.className = 'item-btn primary';
  buyBtn.style.flex = '1';

  const buyEquipBtn = document.createElement('button');
  buyEquipBtn.className = 'item-btn secondary';
  buyEquipBtn.textContent = '购买并装备';
  buyEquipBtn.style.flex = '1';

  const buyPrepBtn = document.createElement('button');
  buyPrepBtn.className = 'item-btn secondary';
  buyPrepBtn.textContent = '购买并带入';
  buyPrepBtn.style.flex = '1';

  // 获取当前购买数量
  const getBuyCount = (): number => shopBuyCounts.get(itemType.id) || 0;
  
  // 更新按钮文本
  const updateButtonText = (count: number, animate: boolean = false) => {
    if (count > 0) {
      buyBtn.textContent = `已购买 ${count} 个`;
      buyBtn.classList.add('success');
      buyBtn.classList.remove('primary');
      // 只有在需要时才播放动画
      if (animate) {
        buyBtn.style.animation = 'none';
        setTimeout(() => {
          buyBtn.style.animation = 'successPulse 0.4s ease-out';
        }, 10);
      } else {
        // 移除动画，保持静态样式
        buyBtn.style.animation = 'none';
      }
    } else {
      buyBtn.textContent = '购买'; // 不再包含金额
      buyBtn.classList.remove('success');
      buyBtn.classList.add('primary');
      buyBtn.style.animation = 'none';
    }
  };
  
  // 初始化按钮状态
  updateButtonText(getBuyCount());
  
  const handleBuy = (autoAction: 'none' | 'equip' | 'prep' = 'none') => {
    const currentCount = getBuyCount();
    const newCount = currentCount + 1;
    const totalCost = itemType.value; // 单个价格

    if (playerProfile && playerProfile.money >= totalCost) {
      console.log(`[DEBUG] Buy Item: ${itemType.name} (id: ${itemType.id}, action: ${autoAction})`);
      network.sendBuy(itemType.id, 1, autoAction);
      
      let actionLabel = '';
      if (autoAction === 'equip') actionLabel = '并装备';
      else if (autoAction === 'prep') actionLabel = '并带入';

      hud.addEvent(`购买${actionLabel}: ${itemType.name}`);
      
      // 更新购买计数
      shopBuyCounts.set(itemType.id, newCount);
      
      // 立即更新按钮状态
      updateButtonText(newCount, true); // 播放成功动画

      // 为快捷按钮提供反馈
      if (autoAction === 'equip') addButtonFeedback(buyEquipBtn, true, '已装备');
      else if (autoAction === 'prep') addButtonFeedback(buyPrepBtn, true, '已带入');
    } else {
      // 立即显示错误反馈
      const targetBtn = autoAction === 'equip' ? buyEquipBtn : (autoAction === 'prep' ? buyPrepBtn : buyBtn);
      addButtonFeedback(targetBtn, false, '金钱不足');
      hud.addEvent(`金钱不足: 需要 ${totalCost}，当前 ${playerProfile?.money ?? 0}`);
    }
  };

  buyBtn.onclick = () => handleBuy('none');
  buyEquipBtn.onclick = () => handleBuy('equip');
  buyPrepBtn.onclick = () => handleBuy('prep');

  actions.appendChild(buyBtn);
  // 只有可装备物品（武器/背包/防具）显示"购买并装备"，其它显示"购买并带入"
  const slot = getItemSlot(itemType.id);
  if (slot) {
    actions.appendChild(buyEquipBtn);
  } else {
    actions.appendChild(buyPrepBtn);
  }
  
  row.appendChild(info);
  row.appendChild(actions);
  return row;
}

// 新增: 初始化 Hideout UI（Tab 切换等）
function initHideoutUI(): void {
  getHideoutElements();
  
  // 初始化仓库 tabs（在装备tab中，所以一开始就初始化）
  initStashTabs();
  
  // Tab 切换
  if (hideoutTabs) {
    hideoutTabs.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const btn = target.closest('.tab-btn') as HTMLElement;
      if (btn) {
        const tabName = btn.getAttribute('data-tab');
        if (!tabName) return;
        
        // 更新 Tab 按钮状态
        hideoutTabs?.querySelectorAll('.tab-btn').forEach(b => {
          b.classList.remove('active');
        });
        btn.classList.add('active');
        
        // 更新面板显示
        if (hideoutEquipment) hideoutEquipment.classList.remove('active');
        if (hideoutShop) hideoutShop.classList.remove('active');
        
        if (tabName === 'equipment' && hideoutEquipment) {
          hideoutEquipment.classList.add('active');
          // 更新仓库列表
          updateStashList();
        } else if (tabName === 'shop' && hideoutShop) {
          hideoutShop.classList.add('active');
          // 初始化商店 tabs（如果还没初始化）
          initShopTabs();
          // 更新商店列表
          updateShopList();
        }
      }
    });
  }
  
  // 装备槽位点击事件（使用事件委托）
  if (hideoutEquipment) {
    hideoutEquipment.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      
      // 如果点击的是按钮，不触发槽位点击
      if (target.closest('.item-btn')) {
        return;
      }
      
      // 查找最近的装备槽位
      const slotEl = target.closest('.equipment-slot.clickable-slot') as HTMLElement;
      if (!slotEl) return;
      
      const slot = slotEl.getAttribute('data-slot') as 'weapon' | 'bag' | 'armor';
      if (!slot) return;
      
      // 检查是否已装备
      if (!playerProfile) {
        hud.addEvent('无法装备：未加载玩家数据');
        return;
      }
      
      const isEquipped = slot === 'weapon' ? !!playerProfile.equipment.weaponIid :
                         slot === 'bag' ? !!playerProfile.equipment.bagIid :
                         !!playerProfile.equipment.armorIid;
      
      if (!isEquipped) {
        slotEl.classList.add('clicking');
        showEquipSelectModal(slot);
        setTimeout(() => {
          slotEl.classList.remove('clicking');
        }, 300);
      }
    });
  }
  
  // 装备选择弹窗取消按钮
  if (equipSelectCancel) {
    equipSelectCancel.onclick = () => {
      closeEquipSelectModal();
    };
  }
  
  // 点击弹窗外部关闭
  if (equipSelectModal) {
    equipSelectModal.onclick = (e) => {
      if (e.target === equipSelectModal) {
        closeEquipSelectModal();
      }
    };
  }
  
  // "进入战局"按钮
  if (enterRaidBtn) {
    enterRaidBtn.onclick = () => {
      if (network.sendEnterRaid()) {
        hud.addEvent('正在进入战局...');
        // 直接显示 raid HUD，不播放动画
        getRaidElements();
        if (raidEquipment && currentPhase === 'RAID' && raidLocalPlayer) {
          updateRaidEquipmentUI(raidLocalPlayer);
        }
      } else {
        hud.addEvent('进入战局失败：连接未就绪');
      }
    };
  }

  // 背包丢弃（HUD）
  const inventoryEl = document.getElementById('hud-inventory');
  if (inventoryEl) {
    inventoryEl.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (!target.classList.contains('hud-drop-btn')) {
        return;
      }
      if (currentPhase !== 'RAID' || !raidLocalPlayer || raidLocalPlayer.status !== 'ALIVE') {
        hud.addEvent('当前无法丢弃物品');
        return;
      }
      const iid = target.getAttribute('data-iid');
      const qtyRaw = target.getAttribute('data-qty');
      if (!iid || !qtyRaw) {
        return;
      }
      const qty = Number(qtyRaw);
      if (!Number.isFinite(qty) || qty <= 0) {
        return;
      }
      if (network.sendDropItem(iid, qty)) {
        hud.addEvent('已丢弃物品');
      } else {
        hud.addEvent('丢弃失败：连接未就绪');
      }
    });
  }
}

// 新增: 装备飞向raid HUD的动画
function animateEquipmentToRaid(): void {
  getHideoutElements();
  getRaidElements();
  
  if (!equipmentWeapon || !equipmentBag || !equipmentArmor || !raidEquipment) {
    return;
  }
  
  // 获取装备槽位的父元素（整个槽位卡片）
  const weaponSlot = equipmentWeapon.closest('.equipment-slot') as HTMLElement;
  const bagSlot = equipmentBag.closest('.equipment-slot') as HTMLElement;
  const armorSlot = equipmentArmor.closest('.equipment-slot') as HTMLElement;
  
  if (!weaponSlot || !bagSlot || !armorSlot) {
    return;
  }
  
  // 先确保raid HUD已更新内容（如果phase已经是RAID）
  if (currentPhase === 'RAID' && raidLocalPlayer) {
    updateRaidEquipmentUI(raidLocalPlayer);
  }
  
  // 先显示raid HUD（但设为透明），确保能获取位置
  // 注意：不使用visibility: hidden，因为那会导致内容无法获取位置
  raidEquipment.style.display = 'block';
  raidEquipment.style.opacity = '0';
  raidEquipment.style.pointerEvents = 'none'; // 禁用交互，但不隐藏内容
  
  // 延迟一帧确保raid HUD已渲染
  requestAnimationFrame(() => {
    if (!raidEquipment) return;
    
    // 再次确保内容已更新
    if (currentPhase === 'RAID' && raidLocalPlayer) {
      updateRaidEquipmentUI(raidLocalPlayer);
    }
    
    // 获取raid HUD中对应的目标位置
    const raidWeaponSlot = raidEquipment.querySelector('.raid-slot:nth-child(2)') as HTMLElement; // 第一个是标题，第二个是武器
    const raidBagSlot = raidEquipment.querySelector('.raid-slot:nth-child(3)') as HTMLElement;
    const raidArmorSlot = raidEquipment.querySelector('.raid-slot:nth-child(4)') as HTMLElement;
    
    if (!raidWeaponSlot || !raidBagSlot || !raidArmorSlot) {
      // 如果获取不到，直接显示raid HUD
      raidEquipment.style.opacity = '1';
      raidEquipment.style.pointerEvents = 'auto';
      raidEquipment.classList.add('visible');
      return;
    }
    
    // 获取装备信息
    const slots = [
      { source: weaponSlot, target: raidWeaponSlot, label: '武器', slot: equipmentWeapon },
      { source: bagSlot, target: raidBagSlot, label: '背包', slot: equipmentBag },
      { source: armorSlot, target: raidArmorSlot, label: '防具', slot: equipmentArmor }
    ];
    let completed = 0;
    const total = slots.length;
    
    slots.forEach(({ source, target, label, slot: slotEl }, index) => {
      if (!slotEl) {
        completed++;
        if (completed === total) {
          finishAnimation();
        }
        return;
      }
      
      // 检查是否有装备
      const slotItem = slotEl.querySelector('.slot-item');
      if (!slotItem) {
        completed++;
        if (completed === total) {
          finishAnimation();
        }
        return;
      }
      
      // 获取位置
      const sourceRect = source.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      
      // 创建动画元素
      const flyEl = document.createElement('div');
      flyEl.className = 'equipment-fly-animation';
      
      // 复制内容
      const slotLabel = slotEl.querySelector('.slot-label')?.textContent || label;
      const slotItemName = slotItem.querySelector('.slot-item-name')?.textContent || '';
      const slotItemMeta = slotItem.querySelector('.slot-item-meta')?.textContent || '';
      
      flyEl.innerHTML = `
        <div class="slot-label">${slotLabel}</div>
        <div class="slot-item-name">${slotItemName}</div>
        <div class="slot-item-meta">${slotItemMeta}</div>
      `;
      
      // 设置初始位置和大小
      flyEl.style.left = `${sourceRect.left}px`;
      flyEl.style.top = `${sourceRect.top}px`;
      flyEl.style.width = `${sourceRect.width}px`;
      flyEl.style.height = `${sourceRect.height}px`;
      
      document.body.appendChild(flyEl);
      
      // 延迟启动动画（错开时间）
      setTimeout(() => {
        // 计算目标位置（目标元素的中心点）
        const targetX = targetRect.left + targetRect.width / 2 - sourceRect.width / 2;
        const targetY = targetRect.top + targetRect.height / 2 - sourceRect.height / 2;
        
        // 计算距离和角度
        const deltaX = targetX - sourceRect.left;
        const deltaY = targetY - sourceRect.top;
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        const angle = Math.atan2(deltaY, deltaX) * (180 / Math.PI);
        
        // 添加发光效果
        flyEl.style.boxShadow = `0 8px 32px rgba(0, 255, 255, 0.6), 0 0 60px rgba(0, 255, 255, 0.3)`;
        
        // 设置动画
        flyEl.style.transition = 'all 0.9s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
        flyEl.style.transform = `translate(${deltaX}px, ${deltaY}px) scale(0.6) rotate(${angle * 0.15}deg)`;
        flyEl.style.opacity = '0';
        flyEl.style.filter = 'blur(2px)';
        
        // 动画完成后移除元素
        setTimeout(() => {
          flyEl.remove();
          completed++;
          if (completed === total) {
            finishAnimation();
          }
        }, 900);
      }, index * 120); // 每个动画错开120ms
    });
    
    function finishAnimation() {
      // 显示raid HUD
      if (raidEquipment) {
        raidEquipment.style.opacity = '1';
        raidEquipment.style.pointerEvents = 'auto';
        raidEquipment.classList.add('visible');
        // 确保内容已更新（如果还没有的话）
        if (currentPhase === 'RAID' && raidLocalPlayer) {
          updateRaidEquipmentUI(raidLocalPlayer);
        }
      }
    }
  });
}

// 新增: 初始化 RAID UI
function initRaidUI(): void {
  getRaidElements();
  getHideoutElements(); // 复用装备选择弹窗

  if (raidWeaponSwap) {
    raidWeaponSwap.onclick = () => {
      showRaidWeaponSelectModal();
    };
  }

  if (raidWeaponUnequip) {
    raidWeaponUnequip.onclick = () => {
      network.sendRaidEquip('weapon', null);
    };
  }

  if (raidArmorUnequip) {
    raidArmorUnequip.onclick = () => {
      console.log('[RAID] 点击卸下防具按钮');
      const sent = network.sendRaidEquip('armor', null);
      if (sent) {
        hud.addEvent('卸下防具');
      } else {
        hud.addEvent('卸下防具失败：连接未就绪');
      }
    };
  }

  if (raidBagToggle) {
    raidBagToggle.onclick = () => {
      raidBagExpanded = !raidBagExpanded;
      updateRaidEquipmentUI(raidLocalPlayer);
    };
  }

  if (raidBagList) {
    raidBagList.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (!target.classList.contains('raid-bag-drop')) {
        return;
      }
      if (!raidLocalPlayer || raidLocalPlayer.status !== 'ALIVE') {
        hud.addEvent('当前无法丢弃物品');
        return;
      }
      const iid = target.getAttribute('data-iid');
      const qtyRaw = target.getAttribute('data-qty');
      if (!iid || !qtyRaw) {
        return;
      }
      const qty = Number(qtyRaw);
      if (!Number.isFinite(qty) || qty <= 0) {
        return;
      }
      if (network.sendDropItem(iid, qty)) {
        hud.addEvent('已丢弃物品');
      } else {
        hud.addEvent('丢弃失败：连接未就绪');
      }
    });
  }
}

// 新增: NAME Modal 交互逻辑（延迟初始化，确保 DOM 已加载）
function initNameModal(): void {
  getModalElements();
  if (nameSubmit && nameInput) {
    nameSubmit.addEventListener('click', () => {
      const name = nameInput!.value.trim();
      if (name.length === 0) {
        alert('昵称不能为空');
        return;
      }
      if (name.length > 32) {
        alert('昵称不能超过 32 字符');
        return;
      }
      // 发送设置昵称消息
      network.sendSetName(name);
      hud.addEvent(`设置昵称: ${name}`);
    });
    
    // 按 Enter 键提交
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        nameSubmit!.click();
      }
    });
  }
}

// 初始化 NAME Modal 和 Hideout UI（DOM 加载完成后）
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initNameModal();
    initHideoutUI();
    initRaidUI();
    updatePhaseUI(); // ✅ 启动时先把 NAME/Hideout UI 挂出来
  });
} else {
  initNameModal();
  initHideoutUI();
  initRaidUI();
  updatePhaseUI(); // ✅ 同上
}

// 修复: 客户端预测相关状态
interface PendingInput {
  seq: number;
  keys: { up: boolean; down: boolean; left: boolean; right: boolean };
  deltaTime: number; // 固定为 0.05（与 server tick 一致）
}
let pendingInputs: PendingInput[] = [];
let lastRenderNow = performance.now();

// 撞墙时不要"瞬移吸附"，只加速收敛到预测位置
let fastConvergeUntil = 0;
const FAST_CONVERGE_ON_BLOCK_MS = 120;
const HALF_LIFE_NORMAL = 0.08;
const HALF_LIFE_BLOCKED = 0.03;

// 指数平滑：halfLife 越小，追得越快；0.06~0.10 秒通常手感不错
function smoothTo(current: number, target: number, dtSec: number, halfLifeSec = 0.08): number {
  const a = 1 - Math.pow(0.5, dtSec / halfLifeSec);
  return current + (target - current) * a;
}

// 修复: 客户端 tick 对齐（严格 20Hz，与 server 同步）
const CLIENT_TICK_MS = 50; // 与 server tick 间隔一致
function getEstimatedServerTick(): number {
  const latest = network.getSnapshotBuffer().getLatest();
  if (!latest) return network.getConnectionState().lastServerTick;
  const serverNowMs = Date.now() + network.getSnapshotBuffer().getServerOffsetMs();
  const deltaMs = Math.max(0, serverNowMs - latest.timestamp);
  return latest.tick + Math.floor(deltaMs / CLIENT_TICK_MS);
}
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

// 管理员快捷键（总是启用）
window.addEventListener('keydown', (e) => {
  // Alt+Shift+R: 重置账号并重新连接
  if (e.altKey && e.shiftKey && e.key === 'R') {
    e.preventDefault();
    const confirm = window.confirm('重置账号并重新连接？这将清空当前账号的所有进度（金钱、仓库等）。');
    if (confirm) {
      console.log('[ADMIN] Resetting account via hotkey...');
      localStorage.removeItem('jerkie_man_account_id');
      location.reload();
    }
  }
  
  // Alt+Shift+D: 显示调试信息
  if (e.altKey && e.shiftKey && e.key === 'D') {
    e.preventDefault();
    console.log('=== Debug Info ===');
    console.log('Account ID:', localStorage.getItem('jerkie_man_account_id'));
    console.log('Player ID:', localPlayerId);
    console.log('Profile:', playerProfile);
    console.log('Type __admin.help() for more commands');
  }
  
  // Alt+Shift+S: 显示服务器状态（通过网络请求）
  if (e.altKey && e.shiftKey && e.key === 'S') {
    e.preventDefault();
    network.sendAdminCommand('show_status');
    hud.addEvent('[管理员] 正在请求服务器状态...');
  }
  
  // Alt+Shift+W: 重置世界（需要二次确认）
  if (e.altKey && e.shiftKey && e.key === 'W') {
    e.preventDefault();
    const confirm = window.confirm('重置服务端世界？这将断开所有玩家连接并重新生成地图。\n\n你的账号数据（金钱、仓库）不会丢失。');
    if (confirm) {
      network.sendAdminCommand('reset_world');
      hud.addEvent('[管理员] 正在重置世界...');
    }
  }
});

/**
 * 查找最近的可交互目标
 * @param playerX 玩家 X 坐标
 * @param playerY 玩家 Y 坐标
 * @param worldItems 世界物品列表
 * @param lootBags 掉落包列表
 * @param extractZone 撤离区
 * @returns 最近的可交互目标（距离 < 40px）
 */
function findNearestInteractable(
  playerX: number,
  playerY: number,
  worldItems: any[],
  lootBags: any[],
  extractZone: { x: number; y: number; w: number; h: number }
): { type: 'worldItem' | 'lootBag' | 'extractZone'; name: string; distance: number } | null {
  const INTERACT_DISTANCE = 40;
  let nearest: { type: 'worldItem' | 'lootBag' | 'extractZone'; name: string; distance: number } | null = null;
  let minDist = INTERACT_DISTANCE;

  // 检查世界物品
  for (const item of worldItems) {
    const dist = Math.hypot(item.x - playerX, item.y - playerY);
    if (dist < minDist) {
      try {
        const itemType = getItemType(item.typeId);
        nearest = { type: 'worldItem', name: `${itemType.name} x${item.qty}`, distance: dist };
        minDist = dist;
      } catch {
        nearest = { type: 'worldItem', name: `${item.typeId} x${item.qty}`, distance: dist };
        minDist = dist;
      }
    }
  }

  // 检查掉落包
  for (const bag of lootBags) {
    const dist = Math.hypot(bag.x - playerX, bag.y - playerY);
    if (dist < minDist) {
      const itemCount = bag.items?.length ?? 0;
      nearest = { type: 'lootBag', name: `${itemCount} items`, distance: dist };
      minDist = dist;
    }
  }

  // 检查撤离区（修复: 使用点到矩形的最短距离）
  // 计算点到矩形的最短距离（0 表示点在矩形内）
  const closestX = Math.max(extractZone.x, Math.min(playerX, extractZone.x + extractZone.w));
  const closestY = Math.max(extractZone.y, Math.min(playerY, extractZone.y + extractZone.h));
  const zoneDist = Math.hypot(closestX - playerX, closestY - playerY);
  if (zoneDist < minDist) {
    nearest = { type: 'extractZone', name: 'Extract Zone', distance: zoneDist };
    minDist = zoneDist;
  }

  return nearest;
}

// 初始化网络
let localPlayerId: string | null = null;
let inputSeq = 0;
let selectedEntity: PLAYER_STATE | null = null;

// 动态构建 WebSocket 服务器地址
// 总是根据当前页面访问的 Hostname 加上固定的 18723 端口
function getDefaultWebSocketUrl(): string {
  const hostname = window.location.hostname;
  // 如果是 HTTPS 页面则尝试 WSS（但在私有部署没有证书时可能需要回退到 WS，这里先保持协议跟随）
  // 注意：如果页面是 HTTP，这里就是 ws://
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  
  // 假设服务器始终在同一主机名的 18723 端口运行
  return `${protocol}//${hostname}:18723`;
}

// 动态构建 WebSocket 服务器地址（支持内网穿透）
// 根据当前访问的地址自动确定服务器地址
function getWebSocketUrl(): string {
  // 0. (New) Check localStorage for manual override
  const savedUrl = localStorage.getItem('jerkie_man_server_url');
  if (savedUrl && savedUrl.trim().length > 0) {
     console.log('[Network] Using manual server URL:', savedUrl);
     return savedUrl;
  }

  return getDefaultWebSocketUrl();
}

// 初始化网络实例 (赋值给全局 let network)
network = new Network(getWebSocketUrl(), 'local', {
  onConnect: () => {
    console.log('Connected to server');
    hud.addEvent('已连接到服务器');
  },
  onDisconnect: () => {
    console.log('Disconnected from server');
    hud.addEvent('已断开服务器连接');
    hud.addEvent('世界已清空'); // P0-2 修复: 提示世界已清空
    // 清理重连状态
    localPlayerId = null;
    selectedEntity = null;
    // 修复: 断开连接时清空预测状态
    pendingInputs = [];
    predictedLocalPlayer = null;
    renderLocalPlayer = null; // 修复: 同时清空渲染平滑状态
    clientAccMs = 0;
    lastClientTickTime = 0;
    resetLocalBurst();
    // P0-2 修复: snapshotBuffer 已在 Network.onclose 中清理，这里不需要再清理
  },
  onWelcome: (playerId: string, accountId: string, roomInfo?: { seed?: number; mapConfig?: MAP_CONFIG }) => {
    localPlayerId = playerId;
    localAccountId = accountId;
    // 设置子弹轨迹管理器的本地玩家 ID（用于本地预测对齐）
    bulletTracks.setLocalPlayerId(playerId);
    console.log(`Received welcome, local player ID: ${localPlayerId}, accountId: ${accountId}`);
    hud.addEvent(`玩家ID：${localPlayerId.substring(0, 12)}...`);
    hud.addEvent(`账号ID：${accountId.substring(0, 8)}...`);
    
    // 清空子弹轨迹（重连时）
    bulletTracks.clear();
    // 重置本地发射计数器
    localShotIdCounter = 0;
    lastLocalFireMs = 0;
    resetLocalBurst();
    
    // Day4-1: 接收并保存 server 下发的世界配置
    if (roomInfo?.mapConfig) {
      serverMapConfig = roomInfo.mapConfig;
      serverSeed = roomInfo.seed ?? null;
      hud.addEvent(`服务器地图配置已接收（种子：${serverSeed ?? 'N/A'}）`);
    } else {
      // Day4-1: 兼容模式：server 未下发 mapConfig，使用 fallback 并警告
      hud.addEvent('警告：服务器未提供地图配置，使用本地配置');
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
    lastSentSprint = null; // 新增: 重置冲刺状态
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
    // 调试：检查 snapshot 中的玩家名字
    if (snapshot.players.length > 0) {
      snapshot.players.forEach(p => {
        if (p.name) {
        } else {
        }
      });
    }
    
    // 修复: 只在 RAID 阶段更新子弹轨迹管理器
    if (currentPhase === 'RAID') {
      bulletTracks.onSnapshot(snapshot, snapshot.players);
    }
    
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
        // 修复: 非 ALIVE 状态时，立刻清理预测状态（避免撤离后还能动）
        if (serverPlayer.status !== 'ALIVE') {
          pendingInputs = [];
          predictedLocalPlayer = { ...serverPlayer };
          renderLocalPlayer = { ...serverPlayer }; // 直接对齐，避免还在 smooth "飘"
          localPredictedAmmo = null;
          localFireCredit = null;
          localNextFireTick = null;
          resetLocalBurst();
          
          // 重置发送缓存，避免还在 stream
          lastSentKeys = null;
          lastSentShoot = false;
          lastSentExtractHeld = null;
          lastSentSprint = null; // 新增: 重置冲刺状态
          return;
        }
        
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
        
        // 计算速度倍数（基于局内装备 buff）
        const speedMultiplier = getLocalSpeedMultiplier();
        
        for (const input of pendingInputs) {
          // 修复: 如果服务端状态显示被晕眩或正在使用道具，回滚预测时不应用移动
          if (serverPlayer.isStunned || serverPlayer.usingItemTypeId) {
            continue;
          }
          predictedPos = simulatePlayerMove(
            predictedPos,
            input.keys,
            input.deltaTime,
            mapConfig.width,
            mapConfig.height,
            cachedObstacles,
            speedMultiplier
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
          buffs: serverPlayer.buffs, // 🔧 修复: 保留服务端的 buffs 数据
        };

        // 同步本地弹药预测计数（使用服务端权威值）
        if (serverPlayer.weaponRuntime) {
          localPredictedAmmo = serverPlayer.weaponRuntime.ammoInMag;
          localFireCredit = serverPlayer.weaponRuntime.fireCredit ?? 0;
          localNextFireTick = serverPlayer.weaponRuntime.nextFireTick;
        } else {
          localPredictedAmmo = null;
          localFireCredit = null;
          localNextFireTick = null;
          resetLocalBurst();
        }
      }
    }
  },
  onError: (error: string) => {
    console.error('Network error:', error);
    hud.addEvent(`错误：${error}`);
    // 背包已满时显示红色提示
    if (error === 'Inventory full' || error.includes('Inventory full')) {
      uiOverlay.showText('背包已满', '255, 0, 0');
    }
  },
  // 游戏化增强: 接收服务端事件并显示在 HUD
  onEvent: (message: string) => {
    // Check for special messages (MAP_LIST for autocomplete)
    if (message.startsWith('MAP_LIST|')) {
      const maps = message.substring(9).split('|').filter(m => m.length > 0);
      console.log(`[onEvent] Received MAP_LIST with ${maps.length} maps`);
      if ((window as any).updateAvailableMaps) {
        (window as any).updateAvailableMaps(maps);
      }
      return; // Don't show this in chat
    }
    
    // Check for PLAYER_LIST for autocomplete
    if (message.startsWith('PLAYER_LIST|')) {
      const names = message.substring(12).split('|').filter(n => n.length > 0);
      console.log(`[onEvent] Received PLAYER_LIST with ${names.length} players`);
      if ((window as any).updateOnlinePlayers) {
        (window as any).updateOnlinePlayers(names.map(name => ({ name, status: 'ALIVE' })));
      }
      return; // Don't show this in chat
    }
    
    // Parse player list from /players response for autocomplete
    if (message.startsWith('在线玩家')) {
      const lines = message.split('\n');
      const playerNames = lines.slice(1)
        .map(line => {
          const match = line.match(/^[✅💀]\s+(.+?)\s+\(HP:/);
          return match ? match[1] : null;
        })
        .filter(name => name !== null) as string[];
      
      if ((window as any).updateOnlinePlayers && playerNames.length > 0) {
        (window as any).updateOnlinePlayers(playerNames.map(name => ({ name, status: 'ALIVE' })));
      }
    }
    
    // Detect admin authentication success
    if (message.includes('管理员权限已激活')) {
      if ((window as any).updateAdminStatus) {
        (window as any).updateAdminStatus(true);
      }
    }

    // Filter out internal messages that shouldn't be shown in chat
    const shouldShowInChat = (msg: string): boolean => {
      // Skip AUTO_EQUIP messages
      if (msg.startsWith('AUTO_EQUIP|')) return false;
      
      // Skip player action logs (picked up, hit, etc.)
      if (msg.includes('picked up')) return false;
      if (msg.includes('hit AI')) return false;
      if (msg.includes('hit player')) return false;
      
      // Show emoji messages (✅, ❌, etc.)
      if (msg.startsWith('✅') || msg.startsWith('❌')) return true;
      
      // Show command responses and server messages
      if (msg.startsWith('可用地图:')) return true;
      if (msg.startsWith('地图未找到:')) return true;
      if (msg.startsWith('用法:')) return true;
      if (msg.startsWith('命令:')) return true;
      if (msg.startsWith('未知命令:')) return true;
      if (msg.includes('需要管理员权限')) return true;
      if (msg.includes('管理员权限已激活')) return true;
      if (msg.includes('密码错误')) return true;
      if (msg === 'Pong!') return true;
      
      // Default: don't show in chat (it's probably a game log)
      return false;
    };

    // Add to Chat Log (only user-facing messages)
    if (shouldShowInChat(message) && (window as any).addChatMessage) {
       (window as any).addChatMessage(message);
    }

    if (message.startsWith('AUTO_EQUIP|')) {
      const parts = message.split('|');
      const targetId = parts[1] ?? '';
      const text = parts.slice(2).join('|') || message;

      if (localPlayerId && targetId === localPlayerId) {
        uiOverlay.showText(text);
        hud.addEvent(text);
      } else {
        hud.addEvent(`${targetId}: ${text}`);
      }
      return;
    }
    hud.addEvent(message);
  },
  onWorldInit: (world) => {
    // 修复: 接收并缓存静态世界数据
    cachedObstacles = world.obstacles;
    cachedItems = world.items ?? []; // 修复: 处理可选字段
    cachedWorldItems = world.worldItems ?? []; // 新增: 缓存世界物品
    cachedRooms = world.rooms ?? []; // 新增: 缓存房间列表
    serverMapConfig = world.mapConfig;
    serverSeed = world.seed;
    
    // P0-3 修复: 设置 Renderer 的世界边界（用于 camera clamp）
    renderer.setWorldBounds(world.mapConfig.width, world.mapConfig.height);
    
    // 设置子弹轨迹管理器的地图尺寸和障碍物（用于本地碰撞检测）
    bulletTracks.setMapSize(world.mapConfig.width, world.mapConfig.height);
    bulletTracks.setObstacles(world.obstacles);
    
    // 新增: 设置渲染器的房间列表（用于地板渲染）
    renderer.setRooms(cachedRooms);
    
    const itemsCount = world.items?.length ?? 0;
    const worldItemsCount = world.worldItems?.length ?? 0;
    const roomsCount = world.rooms?.length ?? 0;
    console.log(`Received world init: seed=${world.seed}, obstacles=${world.obstacles.length}, items=${itemsCount}, worldItems=${worldItemsCount}, rooms=${roomsCount}`);
    hud.addEvent(`世界已初始化：${world.obstacles.length} 个障碍物，${itemsCount} 个物品，${worldItemsCount} 个世界物品，${roomsCount} 个房间`);
  },
  // P1-1 新增: 接收 Profile 消息并更新 HUD
  onProfile: (profile) => {
    // 修复: 处理 prep 可能是 undefined 的情况
    playerProfile = {
      ...profile,
      prep: profile.prep ?? [],
    };
    
    // ✅ 同步管理员状态
    const wasAdmin = isCurrentUserAdmin;
    isCurrentUserAdmin = profile.isAdmin === true;
    if (isCurrentUserAdmin && (!wasAdmin || availableMaps.length === 0)) {
      console.log(`[onProfile] Admin status active (wasAdmin: ${wasAdmin}, maps count: ${availableMaps.length}), requesting maps and players...`);
      if (network && network.sendChat) {
        network.sendChat('/maplist');
        network.sendChat('/playerlist'); // ✅ Also sync players
      }
    }
    // ✅ 更新 phase（服务端总是提供 phase，使用服务端的权威状态）
    const oldPhase = currentPhase;
    let newPhase = profile.phase;
    
    // ✅ 修复：如果收到 RESULT phase 但没有 raidResult 数据（刷新后重连），自动切换到 HIDEOUT
    if (newPhase === 'RESULT' && !raidResult) {
      console.log('[onProfile] Received RESULT phase but no raidResult data, switching to HIDEOUT');
      newPhase = 'HIDEOUT';
    }
    
    currentPhase = newPhase;
    console.log(`[onProfile] Phase changed: ${oldPhase} -> ${currentPhase}, displayName=${profile.displayName}, money=${profile.money}, stash=${profile.stash.length} items, prep=${profile.prep?.length ?? 0} items, bagCap=${profile.bagCap}`);
    
    // 更新 UI（显示/隐藏 NAME modal / Hideout UI）
    updatePhaseUI();
  },
  onRaidResult: (result) => {
    // 新增: 处理战局结果
    console.log('Received raid result:', result);
    raidResult = {
      result: result.result,
      loot: result.loot,
      moneyGained: result.moneyGained,
      moneyLost: result.moneyLost,
      killedBy: result.killedBy,
      killedByWeaponName: result.killedByWeaponName,
    };
    hud.addEvent(`战局结束: ${result.result === 'EXTRACTED' ? '成功撤离' : '死亡'}`);

    // ✅ 关键：立刻切到 RESULT，不要等 onProfile
    currentPhase = 'RESULT';
    updatePhaseUI();

    // ✅ 关键：撤离环别再用 snapshot 的最后值卡住
    uiOverlay.updateState({
      extractProgress: { enabled: false, progress: 0 },
    });

    // 可选：把本地缓存也清一下，避免 HUD/渲染读到旧值
    if (predictedLocalPlayer) predictedLocalPlayer.extractProgress = 0;
    if (renderLocalPlayer) renderLocalPlayer.extractProgress = 0;

    updateResultUI();
  },
  onCombatEvent: (event) => {
    // 新增: 处理战斗事件
    if (event.kind === 'DRY_FIRE') {
      // 干火反馈：屏幕中央显示"没子弹"提示
      uiOverlay.showText('NO AMMO');
    } else if (event.kind === 'HIT') {
      // 命中反馈
      uiOverlay.triggerHitMarker();
    } else if (event.kind === 'DAMAGE_TAKEN') {
      // 受伤反馈
      uiOverlay.triggerDamage(event.direction);
    }
  },
  onMeleeSwing: (event) => {
    if (event.playerId === localPlayerId) {
      return; // 本地挥击已预测，避免重复
    }
    meleeSwings.push({
      x: event.x,
      y: event.y,
      aimRad: event.aimRad,
      range: event.range,
      arcRad: event.arcRad,
      spawnTimeMs: performance.now(),
      side: event.side || 1, // 使用服务端同步的方向
      weaponTypeId: event.weaponTypeId, // 传递武器类型
    });
  },
  onKillFeed: (feed) => {
    renderKillFeed(feed);
  },
  onExplosion: (event) => {
    explosionEffects.push({
      x: event.x,
      y: event.y,
      radius: event.radius,
      spawnTimeMs: performance.now(),
    });

    if (currentPhase === 'RAID') {
      const localPlayer = renderLocalPlayer ?? predictedLocalPlayer;
      if (localPlayer && localPlayer.status === 'ALIVE') {
        const dist = Math.hypot(localPlayer.x - event.x, localPlayer.y - event.y);
        if (dist <= event.radius) {
          const intensity = Math.max(0, 1 - dist / event.radius);
          renderer.triggerShake(intensity, 220);
        }
      }
    }
  },
  onSmoke: (event) => {
    smokeEffects.push({
      x: event.x,
      y: event.y,
      radius: event.radius,
      spawnTimeMs: performance.now(),
      durationMs: event.durationMs,
    });
  },
  // 新增: 接收燃烧效果
  onFire: (event) => {
    fireEffects.push({
      x: event.x,
      y: event.y,
      radius: event.radius,
      spawnTimeMs: performance.now(),
      durationMs: event.durationMs,
    });
  },
}, isDebug);

// Step3: 右键选中实体（避免与左键开火冲突）
// 左键：开火（按住连发）
// 右键：选中/取消选中
worldCanvas.addEventListener('contextmenu', (e) => {
  e.preventDefault(); // 阻止右键菜单
  const world = renderer.screenToWorld(e.clientX, e.clientY);
  const state = network.getSnapshotBuffer().getInterpolatedState(180);
  const hit = renderer.hitTest(world.x, world.y, state.players, 30);

  if (hit) {
    selectedEntity = hit;
    hud.addEvent(`已选中实体：${hit.id}`);
  } else {
    selectedEntity = null;
    hud.addEvent('已取消选中实体');
  }
});

bulletTracks.onLocalHit(info => {
  network.sendLocalBulletHit({
    bulletId: info.bulletId,
    clientShotId: info.clientShotId,
    targetId: info.targetId,
    targetX: info.targetX,
    targetY: info.targetY,
    hitX: info.hitX,
    hitY: info.hitY,
    spawnX: info.spawnX,
    spawnY: info.spawnY,
    timestamp: info.timestamp,
  });
  // 移除性能影响的日志输出
  // hud.addEvent(`[LOCAL HIT] bullet=${info.bulletId} target=${info.targetId} spawn=(${info.spawnX.toFixed(1)},${info.spawnY.toFixed(1)}) hit=(${info.hitX.toFixed(1)},${info.hitY.toFixed(1)})`);
});

// 修复: 输入发送已整合到 clientTick 中，不再需要单独的节流逻辑
let lastSentKeys: { up: boolean; down: boolean; left: boolean; right: boolean } | null = null;
let lastSentAim = NaN;
let lastSentShoot = false; // Day2: 上次发送的开火状态
let lastSentExtractHeld: boolean | null = null; // 游戏化增强: 上次发送的撤离持续状态
let lastSentSprint: boolean | null = null; // 新增: 上次发送的冲刺状态
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

  // 获取插值后的状态（必须在子弹更新之前，确保碰撞检测使用正确的玩家位置）
  // 获取插值后的状态（必须在子弹更新之前，确保碰撞检测使用正确的玩家位置）
  // 修复: 使用 120ms 渲染延迟以匹配服务端插值延迟 (CLIENT_INTERPOLATION_DELAY_MS = 120)
  const state = network.getSnapshotBuffer().getInterpolatedState(120);

  // 修复: 只在 RAID 阶段更新子弹轨迹，传入插值后的玩家位置和AI位置
  if (currentPhase === 'RAID') {
    bulletTracks.update(dtSec, state.players, state.ais);
  } else if (currentPhase === null) {
    // Phase 未接收时，仍然更新子弹轨迹（以防万一）
    bulletTracks.update(dtSec, state.players, state.ais);
  }

  // UI 覆盖层更新（衰减动画）
  uiOverlay.update(dtSec);
  
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
        // 初次创建时完整拷贝（包括 usingItem 等可选字段）
        renderLocalPlayer = { ...predictedLocalPlayer };
      } else {
        const dx = predictedLocalPlayer.x - renderLocalPlayer.x;
        const dy = predictedLocalPlayer.y - renderLocalPlayer.y;
        const dist = Math.hypot(dx, dy);
        
        // 只有"大回滚/死亡等状态切换"才允许瞬移
        const shouldSnap = predictedLocalPlayer.status !== 'ALIVE';
        
        // 撞墙后的短时间内，加速 smooth 收敛（避免"慢慢贴墙"但也不"吸附瞬移"）
        const halfLife = performance.now() < fastConvergeUntil ? HALF_LIFE_BLOCKED : HALF_LIFE_NORMAL;
        
        // 计算目标位置（平滑移动或瞬移）
        let nextX = renderLocalPlayer.x;
        let nextY = renderLocalPlayer.y;

        // 大回滚/需要snap时直接瞬移，避免慢慢"飘回去"
        if (dist > 80 || shouldSnap) {
          nextX = predictedLocalPlayer.x;
          nextY = predictedLocalPlayer.y;
        } else {
          nextX = smoothTo(renderLocalPlayer.x, predictedLocalPlayer.x, dtSec, halfLife);
          nextY = smoothTo(renderLocalPlayer.y, predictedLocalPlayer.y, dtSec, halfLife);
        }

        // 关键重构: 使用 Object.assign 自动同步所有字段（包括将来新增的字段）
        Object.assign(renderLocalPlayer, predictedLocalPlayer);

        // 恢复计算好的平滑坐标（覆盖掉 Object.assign 带来的瞬移坐标）
        renderLocalPlayer.x = nextX;
        renderLocalPlayer.y = nextY;
      }
      
      // 使用平滑后的 renderLocalPlayer 渲染本地玩家
      playersToRender = state.players.map((p) =>
        p.id === localPlayerId ? (renderLocalPlayer as PLAYER_STATE) : p
      );
    }
  }

      // 新增: 在 RAID phase 或 phase 未接收时渲染世界
      if (currentPhase === 'RAID' || currentPhase === null) {
        // Day4-1: 使用 server 下发的 mapConfig（优先），fallback 到本地配置
        const mapConfig = serverMapConfig ?? fallbackMapConfig;
        const extractZone = mapConfig.extractZone;
        
        // 修复: 使用 snapshot 中的障碍物（可破坏，需要实时同步）
        // 如果 snapshot 中没有 obstacles，则使用缓存的（向后兼容）
        const obstaclesForRender = state.obstacles ?? cachedObstacles;

        // 同步最新障碍物到缓存与子弹轨迹管理器：
        // - cachedObstacles：用于本地移动预测的 simulatePlayerMove
        // - bulletTracks：用于本地子弹 vs 障碍物碰撞（避免“看不见的旧木箱”）
        if (state.obstacles && state.obstacles.length > 0) {
          cachedObstacles = state.obstacles;
          bulletTracks.setObstacles(state.obstacles);
        }
        
        // 调试：检查障碍物数量
        if (obstaclesForRender.length === 0 && cachedObstacles.length > 0) {
          console.warn('[Render] No obstacles in snapshot, using cached:', cachedObstacles.length);
        }
        // items 仍然从 snapshot 获取（因为会被拾取，是动态的）
        // 新增: 渲染 worldItems 和 lootBags
        // 使用 BulletTrackManager 的 dead-reckoning + 本地预测渲染
        // 本地预测子弹会通过 shotId 自动对齐到服务端子弹（无接棒割裂）
        const bulletsToRender = bulletTracks.getBulletsForRender();

        const nowPerf2 = performance.now();
        const meleeSwingsToRender = meleeSwings
          .map((swing) => ({
            x: swing.x,
            y: swing.y,
            aimRad: swing.aimRad,
            range: swing.range,
            arcRad: swing.arcRad,
            side: swing.side,
            weaponTypeId: swing.weaponTypeId, // 传递武器类型
            age: (nowPerf2 - swing.spawnTimeMs) / MELEE_SWING_TTL_MS,
          }))
          .filter((swing) => swing.age >= 0 && swing.age <= 1);
        meleeSwings = meleeSwings.filter((swing) => nowPerf2 - swing.spawnTimeMs <= MELEE_SWING_TTL_MS);

        const explosionsToRender = explosionEffects
          .map((explosion) => ({
            x: explosion.x,
            y: explosion.y,
            radius: explosion.radius,
            age: (nowPerf2 - explosion.spawnTimeMs) / EXPLOSION_EFFECT_TTL_MS,
          }))
          .filter((explosion) => explosion.age >= 0 && explosion.age <= 1);
        explosionEffects = explosionEffects.filter(
          (explosion) => nowPerf2 - explosion.spawnTimeMs <= EXPLOSION_EFFECT_TTL_MS
        );

        // 清理过期效果
        const now = performance.now(); // Define 'now' for use in cleanup and fire effects
        explosionEffects = explosionEffects.filter((e) => now - e.spawnTimeMs < EXPLOSION_EFFECT_TTL_MS);
        smokeEffects = smokeEffects.filter((e) => now - e.spawnTimeMs < e.durationMs);
        fireEffects = fireEffects.filter((e) => now - e.spawnTimeMs < e.durationMs);

        // 新增: 计算需要渲染的烟雾（基于服务器下发的持续时间）
        const smokesToRender = smokeEffects
          .map((smoke) => ({
            x: smoke.x,
            y: smoke.y,
            radius: smoke.radius,
            age: (nowPerf2 - smoke.spawnTimeMs) / smoke.durationMs,
            durationMs: smoke.durationMs,
          }))
          .filter((smoke) => smoke.age >= 0 && smoke.age <= 1);
        smokeEffects = smokeEffects.filter(
          (smoke) => nowPerf2 - smoke.spawnTimeMs <= smoke.durationMs
        );
        
        // 获取本地玩家用于显示物品信息提示框
        const renderLocalPlayerForTooltip = renderLocalPlayer ?? predictedLocalPlayer ?? 
          (localPlayerId ? state.players.find((p) => p.id === localPlayerId) : null);
        
        // 本地计算玩家是否在草丛内（用于显示隐蔽提示和视野判定）
        let localBushId: string | null = null;
        let localSmokeId: string | null = null;
        if (renderLocalPlayerForTooltip && renderLocalPlayerForTooltip.status === 'ALIVE') {
          const PLAYER_RADIUS = 10;
          for (const obstacle of obstaclesForRender) {
            const obsType = (obstacle as any).type || 'wall';
            if (obsType === 'bush') {
              // 简单的圆形与AABB碰撞检测
              const closestX = Math.max(obstacle.x, Math.min(renderLocalPlayerForTooltip.x, obstacle.x + obstacle.w));
              const closestY = Math.max(obstacle.y, Math.min(renderLocalPlayerForTooltip.y, obstacle.y + obstacle.h));
              const distX = renderLocalPlayerForTooltip.x - closestX;
              const distY = renderLocalPlayerForTooltip.y - closestY;
              const distSq = distX * distX + distY * distY;
              if (distSq <= PLAYER_RADIUS * PLAYER_RADIUS) {
                localBushId = (obstacle as any).id || 'bush_unknown';
                break;
              }
            }
          }

          // 本地计算玩家是否在烟雾内
          for (const smoke of smokesToRender) {
            const dx = renderLocalPlayerForTooltip.x - smoke.x;
            const dy = renderLocalPlayerForTooltip.y - smoke.y;
            const distSq = dx * dx + dy * dy;
            if (distSq <= smoke.radius * smoke.radius) {
              localSmokeId = (smoke as any).id || 'smoke_unknown';
              break;
            }
          }
        }
        
        // 确保 renderLocalPlayerForTooltip (预测状态) 包含了本地计算的 bushId 和 smokeId，
        // 这样 renderer 内部比较 player.inBushId === localPlayer.inBushId 时能立即响应
        if (renderLocalPlayerForTooltip) {
          renderLocalPlayerForTooltip.inBushId = localBushId;
          renderLocalPlayerForTooltip.inBush = !!localBushId;
          renderLocalPlayerForTooltip.inSmokeId = localSmokeId;
          renderLocalPlayerForTooltip.inSmoke = !!localSmokeId;
        }
        
        // 计算最近可交互目标（用于在canvas中显示物品信息提示框）
        let nearbyInteractableForRender: { type: 'worldItem' | 'lootBag' | 'extractZone'; name: string; distance: number } | null = null;
        if (renderLocalPlayerForTooltip && renderLocalPlayerForTooltip.status === 'ALIVE') {
          nearbyInteractableForRender = findNearestInteractable(
            renderLocalPlayerForTooltip.x,
            renderLocalPlayerForTooltip.y,
            state.worldItems,
            state.lootBags,
            mapConfig.extractZone
          );
        }
        
        if (state.turrets && state.turrets.length > 0) {
           console.log('[Main] Rendering turrets:', state.turrets.length);
        }

        renderer.render(
          playersToRender,
          localPlayerId,
          isDebug,
          bulletsToRender,
          state.items,
          extractZone,
          obstaclesForRender,
          state.worldItems, // 新增: 世界物品
          state.lootBags, // 新增: 掉落包
          meleeSwingsToRender,
          bulletTracks.getHitEffects(), // 命中特效
          explosionsToRender,
          smokesToRender, // 新增: 烟雾效果
          fireEffects.map(f => {
            const age = (nowPerf2 - f.spawnTimeMs) / f.durationMs;
            return { ...f, age: Math.max(0, Math.min(1, age)) };
          }).filter(f => f.age >= 0 && f.age <= 1), // 新增: 燃烧效果
          network.getConnectionState().lastServerTick, // 新增: 当前服务器 tick（用于计算换弹进度）
          nearbyInteractableForRender, // 新增: 附近可交互目标
          renderLocalPlayerForTooltip, // 新增: 本地玩家（用于计算相对位置）
          renderLocalPlayerForTooltip?.inBush ?? false, // 新增: 本地玩家是否在草丛内
          state.ais ?? [], // 新增: AI实体列表
          state.decoys ?? [], // 新增: 诱饵列表
          state.turrets ?? [], // 新增: 炮台列表
          // 新增: 地图区域
          mapConfig.zones || [] 
        );
      } else {
        // 非 RAID phase: 只清屏（显示暗背景）
        renderer.clear();
      }
      
      // 更新 UI 覆盖层状态（撤离进度 + 闪光弹 + 武器状态）
      // ✅ 关键：只有 RAID 才允许显示撤离环
      if (currentPhase === 'RAID' && localPlayerId) {
        const localPlayer = renderLocalPlayer ?? predictedLocalPlayer ?? state.players.find((p) => p.id === localPlayerId);
        if (localPlayer && (localPlayer.extractProgress ?? 0) > 0) {
          uiOverlay.updateState({
            extractProgress: {
              enabled: true,
              progress: (localPlayer.extractProgress as number) / EXTRACT_DURATION_MS,
            },
          });
        } else {
          uiOverlay.updateState({ extractProgress: { enabled: false, progress: 0 } });
        }

        // 闪光弹效果
        if (localPlayer && localPlayer.isFlashed) {
          const now = Date.now();
          const flashEndTime = localPlayer.flashEndTime ?? 0;
          const remainingMs = Math.max(0, flashEndTime - now);
          const totalMs = FLASH_GRENADE_DURATION_MS || 3000;
          const progress = remainingMs / totalMs;
          uiOverlay.updateState({
            flash: {
              enabled: true,
              progress: Math.max(0, Math.min(1, progress)),
            },
          });
        } else {
          uiOverlay.updateState({ flash: { enabled: false, progress: 0 } });
        }
      } else {
        uiOverlay.updateState({ extractProgress: { enabled: false, progress: 0 } });
        uiOverlay.updateState({ flash: { enabled: false, progress: 0 } });
      }
      
      // 武器状态 / Buff（左下角 HUD）
      if (localPlayerId) {
        // authoritative: 来自服务端 snapshot 的玩家（一定包含 buffs）
        const snapshotPlayer = state.players.find((p) => p.id === localPlayerId) ?? null;
        // 用于移动/渲染的本地玩家（预测/平滑优先）
        const localPlayer = renderLocalPlayer ?? predictedLocalPlayer ?? snapshotPlayer;

        // 大部分 HUD 用本地平滑状态，Buff HUD 用 snapshot（带 buffs）
        updateWeaponHud(localPlayer ?? null);
        updateHealthHud(localPlayer ?? null);
        updateStaminaHud(localPlayer ?? null); // 新增: 更新耐力HUD
        updateBuffHud(snapshotPlayer ?? localPlayer ?? null); // 使用包含 buffs 的状态
        updateCanvasUI(localPlayer ?? null); // 新增: 更新Canvas UI状态
      } else {
        updateWeaponHud(null);
        updateHealthHud(null);
        updateStaminaHud(null); // 新增: 清空耐力HUD
        updateBuffHud(null); // 新增: 清空 Buff HUD
        updateCanvasUI(null); // 新增: 清空Canvas UI状态
      }
      
      // 绘制 UI 覆盖层（准星、受伤红边、撤离进度等）
      uiOverlay.draw();
      
      // 新增: 更新和渲染投掷瞄准
      if (currentPhase === 'RAID' && localPlayerId) {
        const localPlayer = renderLocalPlayer ?? predictedLocalPlayer ?? state.players.find((p) => p.id === localPlayerId);
        if (localPlayer && isThrowingMode) {
          // 修复: 在 renderLoop 中每帧更新目标位置，确保投掷环平滑跟随鼠标
          // 这样即使 updateTarget 原本只在 clientTick（20Hz）调用，现在在 renderLoop（60fps）中也会更新
          const mouseWorldPos = inputManager.getMouseWorldPos((x, y) => renderer.screenToWorld(x, y));
          throwingAim.updateTarget(mouseWorldPos.x, mouseWorldPos.y, localPlayer.x, localPlayer.y);
          // 渲染瞄准界面
          throwingAim.render((x, y) => renderer.worldToScreen(x, y));
        }
      }

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
      // 修复: 检查是否可控（非 ALIVE 时禁用输入发送和预测）
      const localPlayer = predictedLocalPlayer ?? state.players.find((p) => p.id === localPlayerId) ?? null;
      const canControl = !!localPlayer && localPlayer.status === 'ALIVE';
      // 新增: 如果正在使用需要读条的道具（例如急救包），客户端本地也禁止一切操作
      const isUsingItemNow =
        !!localPlayer &&
        (localPlayer as any).usingItemTypeId &&
        (localPlayer as any).usingItemRemainingMs !== undefined &&
        (localPlayer as any).usingItemRemainingMs > 0;
      // 新增: 如果被眩晕，客户端本地也禁止一切操作（类似读条）
      const isStunnedNow = !!localPlayer && (localPlayer as any).isStunned === true;
      const canControlInputs = canControl && !isUsingItemNow && !isStunnedNow;
      
      // 1. 读取输入（非 ALIVE 或正在读条时清零）
      const rawKeys = inputManager.getKeys();
      const tickKeys = canControlInputs ? rawKeys : { up: false, down: false, left: false, right: false };
      const tickAim = (() => {
        if (localPlayerId && localPlayer) {
          const playerScreenPos = renderer.worldToScreen(localPlayer.x, localPlayer.y);
          return inputManager.getAimAngleFromPoint(playerScreenPos.x, playerScreenPos.y);
        }
        return inputManager.getAimAngle(worldCanvas);
      })();
      // 投掷模式下禁用开火；读条中也禁用开火
      const rawShoot = canControlInputs && !isThrowingMode ? inputManager.getShoot() : false;
      const shootPressed = rawShoot && !lastLocalShoot;
      const weaponDef = (() => {
        if (localPlayer?.weaponRuntime?.weaponTypeId) {
          try {
            return getWeaponDef(localPlayer.weaponRuntime.weaponTypeId);
          } catch {
            // fallback to profile
          }
        }
        return playerProfile ? getEquippedWeaponDef(playerProfile) : undefined;
      })();
      const schedule = weaponDef ? getFireSchedule(weaponDef) : null;
      const isBurstWeapon = schedule ? schedule.burstCount > 1 : false;
      const justPressed = weaponDef
        ? shouldStartBurst(weaponDef, rawShoot, lastLocalShoot)
        : rawShoot;
      const tickShoot = isBurstWeapon ? justPressed : rawShoot;
      lastLocalShoot = rawShoot;
      const tickExtractHeld = canControlInputs ? inputManager.getExtractHeld() : false;
      const tickSprint = canControlInputs ? inputManager.getSprintHeld() : false; // 新增: 获取冲刺输入
      
      // 本地预测子弹已在发送 input 时由 BulletTrackManager 生成（通过 shotId 对齐）
      
      // P2-2: 合并 interact 脉冲（使用 TTL，不再无限期保留）
      // 非 ALIVE 或正在读条时清零 interact
      if (!canControlInputs) {
        interactUntil = 0;
      } else if (inputManager.consumeInteract()) {
        interactUntil = performance.now() + INTERACT_TTL_MS;
        dbg.push('INTERACT_PRESS', { until: interactUntil });
      }
      
      // 新增: 消费换弹脉冲事件（edge-trigger），读条中不允许手动换弹
      const manualReload = canControlInputs ? inputManager.consumeReload() : false;
      const weaponRuntime = localPlayer?.weaponRuntime;
      const ammoInMag = localPredictedAmmo ?? weaponRuntime?.ammoInMag ?? 0;
      const isReloadingNow =
        weaponRuntime &&
        weaponRuntime.reloadingUntilTick > 0 &&
        network.getConnectionState().lastServerTick < weaponRuntime.reloadingUntilTick;
      const serverTickEstimate = getEstimatedServerTick();
      const hasAmmoForFire = weaponDef?.weaponKind === 'melee' ? true : ammoInMag > 0;
      if (weaponRuntime && localNextFireTick !== null) {
        if (!isReloadingNow && hasAmmoForFire && serverTickEstimate >= localNextFireTick) {
          localFireCredit = 1;
        } else if (isReloadingNow || !hasAmmoForFire) {
          localFireCredit = 0;
        }
      }
      const autoReload = !!(
        shootPressed &&
        weaponRuntime &&
        weaponDef &&
        weaponDef.reloadMs > 0 &&
        ammoInMag <= 0 &&
        !isReloadingNow
      );
      const tickReload = manualReload || autoReload;
      
      // 新增: 只在 RAID phase 时发送输入和进行预测
      if (currentPhase === 'RAID') {
        // 修复: 使用 fallback mapConfig，确保 fallback 模式也能工作
        const mapConfig = serverMapConfig ?? fallbackMapConfig;
        
        // 修复: 只在 input "成功发送并入 pendingInputs"后，再做那一步预测
      // 核心原则：预测推进必须和你写进 pendingInputs 的那一步一一对应
      let committed = false;
      let commitSeq = 0;
      const commitKeys = { ...tickKeys };
      
      // 3. 如果 ws 可发，发送输入并 push 到 pendingInputs
      const connState = network.getConnectionState();
      
      // P2-2: 处理拾取动作（E键按下时，发送 C2S_INTERACT，服务端选最近目标）
      // 使用 TTL 脉冲，不再无限期保留
      const interactActive = performance.now() <= interactUntil;
      if (interactActive && connState.connected) {
        // 发送通用交互消息（服务端自动选最近目标）
        const sent = network.sendInteract();
        
        // P2-2: 无论 sent 成功与否，都清零（不再无限期保留）
        interactUntil = 0;
        dbg.push('INTERACT_SENT', { sent });
      } else if (interactUntil > 0 && performance.now() > interactUntil) {
        // P2-2: TTL 过期，清零
        dbg.push('INTERACT_EXPIRE', { was: interactUntil });
        interactUntil = 0;
      }
      
      // 新增: 处理快捷栏使用物品（1-5键）
      if (canControlInputs && connState.connected) {
        for (let slot = 1; slot <= 5; slot++) {
          // 正在读条期间，忽略新的使用物品输入
          if (!isUsingItemNow && inputManager.consumeUseItem(slot)) {
            // 检查是否是手雷
            const localPlayer = predictedLocalPlayer ?? state.players.find((p) => p.id === localPlayerId) ?? null;
            if (localPlayer) {
              const usableItems = localPlayer.inventory?.items?.filter(item => {
                return isUsableItem(item.typeId);
              }) || [];
              
              const item = usableItems[slot - 1];
              if (item && isThrowableItem(item.typeId)) {
                // 进入投掷瞄准模式
                isThrowingMode = true;
                throwingItemType = item.typeId;
                throwingAim.startAiming(); // 不再传入玩家位置，由更新时自动跟随
                dbg.push('THROWING_MODE_START', { slot, itemType: item.typeId });
              } else {
                // 其他物品直接使用
                const sent = network.sendUseItem(slot);
                dbg.push('USE_ITEM_SENT', { slot, sent });
              }
            }
          }
        }
      }
      
      // 新增: 处理投掷模式（读条期间也禁止投掷）
      if (isThrowingMode && canControlInputs) {
        const localPlayer = predictedLocalPlayer ?? state.players.find((p) => p.id === localPlayerId) ?? null;
        if (localPlayer) {
          // 更新瞄准目标（自动跟随玩家位置）
          const mouseWorldPos = inputManager.getMouseWorldPos((x, y) => renderer.screenToWorld(x, y));
          throwingAim.updateTarget(mouseWorldPos.x, mouseWorldPos.y, localPlayer.x, localPlayer.y);
          
          // 检查左键投掷
          if (inputManager.consumeShoot()) { // 修复：消费左键点击，防止触发开火
            const throwingState = throwingAim.getState();
            // 发送投掷消息到服务器
            const success = network.sendThrow(throwingState.targetX, throwingState.targetY, throwingItemType!);
            if (success) {
              dbg.push('THROWING_SENT', { x: throwingState.targetX, y: throwingState.targetY, itemType: throwingItemType });

              // 立即创建本地预测手雷（流畅渲染，不等服务器）
              bulletTracks.spawnLocalGrenade(
                localPlayer.x,
                localPlayer.y,
                throwingState.targetX,
                throwingState.targetY,
                throwingItemType!
              );
              console.log('本地预测手雷已创建:', throwingState.targetX, throwingState.targetY);
            } else {
              dbg.push('THROWING_SEND_FAILED', {});
            }
            console.log('Throwing grenade to:', throwingState.targetX, throwingState.targetY);
            
            // 退出投掷模式
            isThrowingMode = false;
            throwingItemType = null;
            throwingAim.stopAiming();
            dbg.push('THROWING_CONFIRMED', { x: throwingState.targetX, y: throwingState.targetY });
          }
          
          // 检查右键取消
          if (inputManager.getRightClick()) {
            isThrowingMode = false;
            throwingItemType = null;
            throwingAim.stopAiming();
            dbg.push('THROWING_CANCELLED', {});
          }
        }
      }
      
      // 读条期间不发送移动/开火等输入，完全交给服务器读条
      if (connState.connected && canControlInputs) {
        // 修复: 提前计算射击逻辑（边缘触发，只在实际射击时发送）
        const nowPerf2 = performance.now();
        let shotIdToSend: number | undefined = undefined;
        let spreadSeedToSend: number | undefined = undefined;
        let shotOriginX: number | undefined;
        let shotOriginY: number | undefined;
        let burstShotsToSend: Array<{ shotId: number; originX: number; originY: number; spreadSeed: number }> | undefined = undefined;
        let meleeAttackToSend: boolean = false; // 修复: 近战攻击标志（近战武器不需要shotId，但需要发送shoot=true）
        const fireCooldownMs = getLocalFireCooldownMs();
        // 修复: 防止快速连点绕过冷却限制 - 使用严格的时间检查
        // 注意: 即使在同一循环中执行多个 tick，每次检查都会使用最新的 nowPerf2
        // 但为了更严格，我们在通过检查后立即更新 lastLocalFireMs
        if (tickShoot) {
          const weaponRuntime = localPlayer?.weaponRuntime;
          const ammoCount =
            weaponDef?.weaponKind === 'melee'
              ? 1
              : localPredictedAmmo ?? weaponRuntime?.ammoInMag ?? 0;
          const hasAmmo = weaponDef?.weaponKind === 'melee' ? true : ammoCount > 0;
          const hasCredit = (localFireCredit ?? 0) > 0;
          // 修复: 添加冷却时间检查，防止一次点击射出多发子弹
          const isMelee = weaponDef?.weaponKind === 'melee';
          const timeSinceLastFire = nowPerf2 - (isMelee ? lastLocalMeleeMs : lastLocalFireMs);
          const cooldownOk = isMelee ? (timeSinceLastFire >= fireCooldownMs || lastLocalMeleeMs === 0) : (timeSinceLastFire >= fireCooldownMs || lastLocalFireMs === 0);
          const canShoot = !!(localPlayer && weaponRuntime && hasAmmo && !isReloadingNow && hasCredit && cooldownOk);
          const localP = renderLocalPlayer ?? predictedLocalPlayer ?? localPlayer;

          if (canShoot && weaponDef?.weaponKind === 'melee') {
            if (localP) {
              const baseRange = weaponDef.meleeRange ?? DEFAULT_MELEE_RANGE;
              const baseArcRad = ((weaponDef.meleeArcDeg ?? DEFAULT_MELEE_ARC_DEG) * Math.PI) / 180;
              const visualRange = baseRange;
              const visualArcRad = baseArcRad;

              meleeSwings.push({
                x: localP.x,
                y: localP.y,
                aimRad: tickAim,
                range: visualRange,
                arcRad: visualArcRad,
                spawnTimeMs: nowPerf2,
                side: localMeleeSide,
                weaponTypeId: weaponRuntime.weaponTypeId, // 传递武器类型
              });
              
              // 触发小型屏幕抖动增加击打感
              renderer.triggerShake(0.12, 120);
              
              // 切换下次挥砍方向
              localMeleeSide = -localMeleeSide;
              
              lastLocalMeleeMs = nowPerf2;
              meleeAttackToSend = true;
            }
          } else if (canShoot) {
            lastLocalFireMs = nowPerf2;
            
            // 检查是否是三连发武器
            if (schedule && schedule.burstCount > 1) {
              // 三连发模式：立即生成所有子弹信息
              burstShotsToSend = [];
              for (let i = 0; i < schedule.burstCount; i++) {
                localShotIdCounter++;
                const burstShotId = localShotIdCounter;
                const burstSpreadSeed = Math.floor(Math.random() * 1000000);
                
                if (localP && localP.weaponRuntime) {
                  burstShotsToSend.push({
                    shotId: burstShotId,
                    originX: localP.x,
                    originY: localP.y,
                    spreadSeed: burstSpreadSeed,
                  });
                  
                  // 立即生成本地预测子弹
                  bulletTracks.spawnLocalPrediction(
                    burstShotId,
                    localP.x,
                    localP.y,
                    tickAim,
                    getLocalBulletSpeed(),
                    localP.weaponRuntime.weaponTypeId,
                    burstSpreadSeed
                  );
                }
              }
              
              // 扣除弹药
              if (localPredictedAmmo !== null) {
                localPredictedAmmo = Math.max(0, localPredictedAmmo - schedule.burstCount);
              }
              
              resetLocalBurst(); // 清空旧的连发状态

              // 触发屏幕抖动
              const shakeIntensity = 0.08;
              const shakeDuration = 100;
              renderer.triggerShake(shakeIntensity, shakeDuration);
            } else {
              // 单发模式
              localShotIdCounter++;
              shotIdToSend = localShotIdCounter;
              spreadSeedToSend = Math.floor(Math.random() * 1000000);

              if (localP && localP.weaponRuntime) {
                shotOriginX = localP.x;
                shotOriginY = localP.y;
                bulletTracks.spawnLocalPrediction(
                  shotIdToSend,
                  localP.x,
                  localP.y,
                  tickAim,
                  getLocalBulletSpeed(),
                  localP.weaponRuntime.weaponTypeId,
                  spreadSeedToSend
                );

                if (localPredictedAmmo !== null) {
                  localPredictedAmmo = Math.max(0, localPredictedAmmo - 1);
                }
              } else {
                shotOriginX = undefined;
                shotOriginY = undefined;
              }
              resetLocalBurst();
              
              // 触发屏幕抖动 (根据武器类型调整强度)
              let shakeIntensity = 0.05;
              let shakeDuration = 80;
              
              if (weaponRuntime.weaponTypeId === 'w_sniper' || weaponRuntime.weaponTypeId === 'w_anti_material') {
                shakeIntensity = 0.25;
                shakeDuration = 200;
              } else if (weaponRuntime.weaponTypeId === 'w_shotgun' || weaponRuntime.weaponTypeId === 'w_double_barrel' || weaponRuntime.weaponTypeId === 'w_auto_shotgun') {
                shakeIntensity = 0.18;
                shakeDuration = 150;
              } else if (weaponRuntime.weaponTypeId === 'w_grenade_launcher' || weaponRuntime.weaponTypeId === 'w_burst_grenade_launcher') {
                shakeIntensity = 0.15;
                shakeDuration = 120;
              } else if (weaponRuntime.weaponTypeId === 'w_laser_rifle') {
                shakeIntensity = 0; // 激光步枪无后坐力
              } else if (weaponRuntime.weaponTypeId === 'w_minigun') {
                shakeIntensity = 0.03; // 射速极快，抖动幅度减小
                shakeDuration = 50;
              }
              
              if (shakeIntensity > 0) {
                renderer.triggerShake(shakeIntensity, shakeDuration);
              }
            }
          } else if (!hasAmmo && weaponDef?.weaponKind !== 'melee') {
            uiOverlay.showText('NO AMMO');
          }

          if (canShoot) {
            if (localFireCredit !== null) {
              localFireCredit = Math.max(0, localFireCredit - 1);
            }
            if (weaponDef) {
              const fireIntervalMs = weaponDef.fireIntervalMs ?? fireCooldownMs;
              const burstShotCount = burstShotsToSend ? burstShotsToSend.length : 1;
              const burstExtraTicks =
                schedule && schedule.burstCount > 1
                  ? msToTicks((burstShotCount - 1) * schedule.burstIntervalMs)
                  : 0;
              const baseTick = Math.max(serverTickEstimate, localNextFireTick ?? serverTickEstimate);
              localNextFireTick = baseTick + burstExtraTicks + msToTicks(fireIntervalMs);
              lastLocalShotServerTick = Math.max(lastLocalShotServerTick, serverTickEstimate);
            }
          }
        }

        // 修复: 只在实际射击时发送 shoot=true（边缘触发，防止持续发送导致服务器时机偏差）
        // 注意: 近战武器不需要shotId，但需要通过meleeAttackToSend标志发送shoot=true
        // 移除旧的连发处理逻辑，现在由burstShotsToSend统一处理
        resetLocalBurst();

        const shootToSend = shotIdToSend !== undefined || meleeAttackToSend || burstShotsToSend !== undefined;

        // 检查是否有持续态输入（移动/撤离/冲刺）
        // 注意：射击改为边缘触发，不再持续发送
        const keysAny = tickKeys.up || tickKeys.down || tickKeys.left || tickKeys.right;
        const mustStream = keysAny || tickExtractHeld || tickSprint; // 新增: 冲刺也需要持续发送

        // 检查变化（用于 idle 时的省包逻辑）
        const keysChanged = !lastSentKeys ||
          tickKeys.up !== lastSentKeys.up || tickKeys.down !== lastSentKeys.down ||
          tickKeys.left !== lastSentKeys.left || tickKeys.right !== lastSentKeys.right;
        const aimChanged = isNaN(lastSentAim) || Math.abs(tickAim - lastSentAim) > 0.01;
        const shootChanged = shootToSend !== (lastSentShoot ?? false);
        const extractHeldChanged = tickExtractHeld !== (lastSentExtractHeld ?? false);
        const sprintChanged = tickSprint !== (lastSentSprint ?? false); // 新增: 检查冲刺状态变化

        // 只要在"持续态"（移动/撤离/冲刺），或有任何变化，或实际射击，就发送
        const shouldSend = mustStream || keysChanged || aimChanged || shootChanged || extractHeldChanged || sprintChanged || tickReload;

        if (shouldSend) {
          const nextSeq = inputSeq + 1;
          const sent = network.sendInput(nextSeq, tickKeys, tickAim, shootToSend, tickReload, false, false, tickExtractHeld, tickSprint, shotIdToSend, shotOriginX, shotOriginY, spreadSeedToSend, burstShotsToSend);
          shotOriginX = undefined;
          shotOriginY = undefined;
          burstShotsToSend = undefined;

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
              shoot: shootToSend,
              eh: tickExtractHeld,
              pi: pendingInputs.length,
              shotId: shotIdToSend,
            });

            lastSentKeys = { ...tickKeys };
            lastSentAim = tickAim;
            lastSentShoot = shootToSend;
            lastSentExtractHeld = tickExtractHeld;
            lastSentSprint = tickSprint; // 新增: 更新上次发送的冲刺状态
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
        // 修复: 如果被晕眩或正在使用道具，停止客户端预测（包括移动和耐力更新），避免与服务器状态（early return）冲突导致的抖动
        if (predictedLocalPlayer.isStunned || predictedLocalPlayer.usingItemTypeId) {
           // Do nothing, keep x, y, stamina as is
        } else {
          const beforeX = predictedLocalPlayer.x;
          const beforeY = predictedLocalPlayer.y;
          
          // 检查是否正在移动
          const isMoving = commitKeys.up || commitKeys.down || commitKeys.left || commitKeys.right;
          
          // 更新耐力预测
          const currentStamina = predictedLocalPlayer.stamina ?? 100;
          const maxStamina = predictedLocalPlayer.maxStamina ?? 100;
          const wantsSprint = tickSprint;
          const isSprinting = canSprint(currentStamina, wantsSprint) && isMoving;
          
          // 计算新的耐力值
          const newStamina = calculateStaminaChange(
            currentStamina,
            maxStamina,
            isSprinting,
            isMoving,
            0.05 // 固定为 server tick 间隔
          );
          
          // 如果耐力耗尽，停止冲刺
          const finalIsSprinting = newStamina > 0 ? isSprinting : false;
          
          // 计算速度倍数（基于局内装备 buff）
          const equipmentSpeedMultiplier = getLocalSpeedMultiplier();
          const sprintSpeedMultiplier = getSprintSpeedMultiplier(finalIsSprinting);
          
          const newPredictedPos = simulatePlayerMove(
            { x: beforeX, y: beforeY },
            commitKeys,
            0.05, // 固定为 server tick 间隔
            mapConfig.width,
            mapConfig.height,
            cachedObstacles,
            equipmentSpeedMultiplier,
            sprintSpeedMultiplier
          );
          
          // 检测撞墙/被阻挡：触发短时间"快速收敛"，不瞬移
          const movedDist = Math.hypot(newPredictedPos.x - beforeX, newPredictedPos.y - beforeY);
          const keysAny = commitKeys.up || commitKeys.down || commitKeys.left || commitKeys.right;
          if (keysAny && movedDist < 0.01) {
            fastConvergeUntil = performance.now() + FAST_CONVERGE_ON_BLOCK_MS;
          }
          
          // 更新预测状态
          predictedLocalPlayer.x = newPredictedPos.x;
          predictedLocalPlayer.y = newPredictedPos.y;
          predictedLocalPlayer.stamina = Math.round(newStamina);
          predictedLocalPlayer.isSprinting = finalIsSprinting;
        }
      }
      } // 结束 if (currentPhase === 'RAID')
    }
    
    clientAccMs -= CLIENT_TICK_MS;
  }

  // P0-2 修复: Debug日志使用 performance.now()（仅在显示给用户时才用 Date.now()）
  if (isDebug) {
    // Debug per-tick logs removed to keep console quiet.
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
    // ✅ 关键：HUD 的撤离进度别读"插值 state"（它天生落后/可能停在最后一帧）
    let localPlayerExtractProgress: number | undefined = undefined;
    let hudLocalPlayer: PLAYER_STATE | null = null;
    if (currentPhase === 'RAID' && localPlayerId) {
      const localPlayer =
        renderLocalPlayer ??
        predictedLocalPlayer ??
        state.players.find((p) => p.id === localPlayerId);

      if (localPlayer && localPlayer.extractProgress !== undefined) {
        localPlayerExtractProgress = localPlayer.extractProgress;
        hudLocalPlayer = localPlayer;
      }

      // 调试: 打印一次本地玩家的 usingItem 状态（每次 HUD 更新，只要有就打印）
      if (
        localPlayer &&
        localPlayer.usingItemTypeId &&
        localPlayer.usingItemRemainingMs !== undefined &&
        localPlayer.usingItemTotalMs !== undefined
      ) {
        // eslint-disable-next-line no-console
        console.log('[HUD] local using item', {
          typeId: localPlayer.usingItemTypeId,
          remainingMs: localPlayer.usingItemRemainingMs,
          totalMs: localPlayer.usingItemTotalMs,
        });
      }
    }
    
    // 新增: 计算最近可交互目标
    let nearbyInteractable: { type: 'worldItem' | 'lootBag' | 'extractZone'; name: string; distance: number } | null = null;
    if (localPlayerId) {
      const localPlayer = hudLocalPlayer ?? renderLocalPlayer ?? predictedLocalPlayer ?? state.players.find((p) => p.id === localPlayerId);
      if (localPlayer) {
        hudLocalPlayer = localPlayer;
      }
      if (localPlayer && localPlayer.status === 'ALIVE') {
        const mapConfig = serverMapConfig ?? fallbackMapConfig;
        nearbyInteractable = findNearestInteractable(
          localPlayer.x,
          localPlayer.y,
          state.worldItems,
          state.lootBags,
          mapConfig.extractZone
        );
      }
    }
    
    const stateLocalPlayer = localPlayerId
      ? state.players.find((p) => p.id === localPlayerId)
      : null;

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
        // 新增: 显示账号 ID
        accountId: localAccountId ?? undefined,
      },
      players: state.players,
      counts: {
        bullets: currentPhase === 'RAID' ? bulletTracks.getBulletsForRender().length : 0, // 修复: 只在 RAID 阶段计算子弹数
        worldItems: state.worldItems.length, // P2-1: 改用 worldItems
        lootBags: state.lootBags.length, // P2-1: 新增掉落包计数
      },
      selectedEntity: selectedEntity,
      events: [], // events由HUD内部管理
      // P1-1 新增: 物品系统数据（从 Profile 获取）
      inventory: stateLocalPlayer?.inventory,
      stash: playerProfile?.stash, // 从 Profile 获取
      money: playerProfile?.money, // 从 Profile 获取
      // 新增: 局内交互提示
      nearbyInteractable,
      localPlayer: hudLocalPlayer,
    });

    raidLocalPlayer = stateLocalPlayer ?? hudLocalPlayer ?? null;
    updateRaidEquipmentUI(raidLocalPlayer);
    updateHotbarHud(raidLocalPlayer); // 新增: 更新快捷栏
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

// 管理员命令系统（通过控制台调用）
(window as any).__admin = {
  // 重新连接服务器（清空所有本地状态）
  reconnect: () => {
    console.log('[ADMIN] Reconnecting...');
    network.disconnect();
    setTimeout(() => {
      location.reload();
    }, 100);
  },
  
  // 清空本地 accountId（下次连接会创建新账号）
  resetAccount: () => {
    console.log('[ADMIN] Resetting account ID...');
    localStorage.removeItem('jerkie_man_account_id');
    console.log('[ADMIN] Account ID cleared. Reload page to create new account.');
    console.log('[ADMIN] Run: __admin.reconnect()');
  },
  
  // 显示当前 accountId
  showAccount: () => {
    const accountId = localStorage.getItem('jerkie_man_account_id');
    console.log('[ADMIN] Current accountId:', accountId);
    console.log('[ADMIN] Local playerId:', localPlayerId);
    console.log('[ADMIN] Profile:', playerProfile);
  },
  
  // 显示当前玩家状态
  showPlayer: () => {
    const state = network.getSnapshotBuffer().getInterpolatedState(180);
    const player = localPlayerId ? state.players.find(p => p.id === localPlayerId) : null;
    console.log('[ADMIN] Local player:', player);
    console.log('[ADMIN] Predicted:', predictedLocalPlayer);
    console.log('[ADMIN] Render:', renderLocalPlayer);
  },
  
  // 显示所有玩家
  showAllPlayers: () => {
    const state = network.getSnapshotBuffer().getInterpolatedState(180);
    console.log('[ADMIN] All players:', state.players);
    console.log('[ADMIN] World items:', state.worldItems);
    console.log('[ADMIN] Loot bags:', state.lootBags);
  },
  
  // 显示地图配置
  showMap: () => {
    console.log('[ADMIN] Server map config:', serverMapConfig);
    console.log('[ADMIN] Server seed:', serverSeed);
    console.log('[ADMIN] Fallback map config:', fallbackMapConfig);
    console.log('[ADMIN] Obstacles:', cachedObstacles.length);
  },
  
  // 请求服务器状态
  requestServerStatus: () => {
    console.log('[ADMIN] Requesting server status...');
    network.sendAdminCommand('show_status');
  },
  
  // 重置服务端世界
  resetServerWorld: () => {
    const confirm = window.confirm('重置服务端世界？这将断开所有玩家连接并重新生成地图。');
    if (confirm) {
      console.log('[ADMIN] Resetting server world...');
      network.sendAdminCommand('reset_world');
    }
  },
  
  // 帮助信息
  help: () => {
    console.log(`
=== 管理员命令 ===
调用方式：在控制台输入 __admin.命令名()

可用命令：
  reconnect()            - 重新连接服务器（清空本地状态）
  resetAccount()         - 清空本地账号ID（下次连接创建新账号）
  showAccount()          - 显示当前账号信息
  showPlayer()           - 显示当前玩家状态
  showAllPlayers()       - 显示所有玩家和世界物品
  showMap()              - 显示地图配置
  requestServerStatus()  - 请求服务器状态（通过网络）
  resetServerWorld()     - 重置服务端世界（需确认）
  help()                 - 显示此帮助信息

快捷键：
  Alt+Shift+R - 重置账号并重新连接
  Alt+Shift+D - 显示调试信息
  Alt+Shift+S - 请求服务器状态
  Alt+Shift+W - 重置服务端世界（需确认）

例如：
  __admin.showAccount()
  __admin.requestServerStatus()
    `);
  }
};

console.log('Client initialized');
console.log('Type __admin.help() in console for admin commands');


// ===== Chat System Logic =====
let chatInput: HTMLInputElement | null = null;
let chatLog: HTMLElement | null = null;
let chatSuggestions: HTMLElement | null = null;
let isChatFocused = false;
let selectedSuggestionIndex = -1;
let currentSuggestions: Array<{ text: string; desc: string }> = [];

// Available commands
const COMMANDS = [
  { cmd: '/admin ', desc: '激活管理员权限', adminOnly: false },
  { cmd: '/help', desc: '显示所有命令', adminOnly: false },
  { cmd: '/maps', desc: '查看所有可用地图', adminOnly: false },
  { cmd: '/players', desc: '查看在线玩家列表', adminOnly: false },
  { cmd: '/ping', desc: '测试连接延迟', adminOnly: false },
  { cmd: '/map ', desc: '切换地图 (需要管理员)', adminOnly: true },
  { cmd: '/reset', desc: '重置当前房间 (需要管理员)', adminOnly: true },
  { cmd: '/give ', desc: '给玩家加钱 (需要管理员)', adminOnly: true },
  { cmd: '/heal ', desc: '治疗玩家 (需要管理员)', adminOnly: true },
  { cmd: '/kill ', desc: '击杀玩家 (需要管理员)', adminOnly: true },
  { cmd: '/kick ', desc: '踢出玩家 (需要管理员)', adminOnly: true },
];

// Track admin status
let isCurrentUserAdmin = false;

// Update admin status (called when receiving admin auth response)
function updateAdminStatus(isAdmin: boolean) {
  isCurrentUserAdmin = isAdmin;
}
(window as any).updateAdminStatus = updateAdminStatus;

// Map list will be populated from server
let availableMaps: string[] = [];

function initChatSystem(): void {
  chatInput = document.getElementById('chatInput') as HTMLInputElement;
  chatLog = document.getElementById('chatLog');
  chatSuggestions = document.getElementById('chatSuggestions');
  
  if (!chatInput || !chatLog) {
     console.warn('[Chat] Chat elements not found during init, retrying on DOMContentLoaded or next frame');
     if (document.readyState === 'loading') {
         document.addEventListener('DOMContentLoaded', initChatSystem);
     }
     return;
  }
  
  // Input change handler for autocomplete
  chatInput.addEventListener('input', () => {
    if (!chatInput) return;
    updateSuggestions(chatInput.value);
  });
  
  // Enter key handling
  window.addEventListener('keydown', (e) => {
    if (!chatInput) return;

    // Handle chat-specific keys when chat is focused
    if (isChatFocused && document.activeElement === chatInput) {
      if (e.key === 'Escape') {
         // Close chat and suggestions
         chatInput.blur();
         chatInput.classList.remove('visible');
         hideSuggestions();
         isChatFocused = false;
         worldCanvas.focus();
         e.preventDefault();
         return;
      } else if (e.key === 'ArrowUp') {
         // Navigate suggestions up (cycle to bottom if at top)
         if (currentSuggestions.length > 0) {
           if (selectedSuggestionIndex <= 0) {
             selectedSuggestionIndex = currentSuggestions.length - 1;
           } else {
             selectedSuggestionIndex--;
           }
           updateSuggestionHighlight();
           e.preventDefault();
         }
         return;
      } else if (e.key === 'ArrowDown') {
         // Navigate suggestions down (cycle to top if at bottom)
         if (currentSuggestions.length > 0) {
           if (selectedSuggestionIndex >= currentSuggestions.length - 1) {
             selectedSuggestionIndex = 0;
           } else {
             selectedSuggestionIndex++;
           }
           updateSuggestionHighlight();
           e.preventDefault();
         }
         return;
      } else if (e.key === 'Tab') {
         // Terminal-style Tab completion
         if (currentSuggestions.length > 0) {
           // If nothing selected, select first one
           if (selectedSuggestionIndex < 0) {
             selectedSuggestionIndex = 0;
             updateSuggestionHighlight();
           } else {
             // Apply current selection
             chatInput.value = currentSuggestions[selectedSuggestionIndex].text;
             // Move to next suggestion for easy cycling
             selectedSuggestionIndex = (selectedSuggestionIndex + 1) % currentSuggestions.length;
             updateSuggestionHighlight();
           }
           e.preventDefault();
         }
         return;
      } else if (e.key === 'Enter') {
         // Apply suggestion or send message
         if (selectedSuggestionIndex >= 0 && currentSuggestions[selectedSuggestionIndex]) {
           chatInput.value = currentSuggestions[selectedSuggestionIndex].text;
           hideSuggestions();
           // Don't send, let user continue editing
           e.preventDefault();
           return;
         }
         
         // Send message
         const content = chatInput.value.trim();
         if (content.length > 0) {
           sendChatMessage(content);
           chatInput.value = '';
         }
         chatInput.blur();
         chatInput.classList.remove('visible');
         hideSuggestions();
         isChatFocused = false;
         worldCanvas.focus();
         e.preventDefault();
         return;
      }
      // For other keys, let default input handling work
      return;
    }

    // Open chat with / key (when not already focused)
    if (e.key === '/' && !isChatFocused) {
      chatInput.classList.add('visible');
      chatInput.value = '/'; // Auto-fill with /
      chatInput.focus();
      isChatFocused = true;
      e.preventDefault();
      
      // Auto-fetch fresh player list for autocomplete
      if (network && network.sendChat && isCurrentUserAdmin) {
        network.sendChat('/playerlist');
      }
    }
  });

  // Track focus state
  chatInput.addEventListener('focus', () => {
    isChatFocused = true;
  });
  
  chatInput.addEventListener('blur', () => {
    isChatFocused = false;
    // Hide input and suggestions after small delay
    setTimeout(() => {
        if (chatInput && document.activeElement !== chatInput) {
            chatInput.classList.remove('visible');
            hideSuggestions();
        }
    }, 100);
  });
  
  console.log('[Chat] System initialized with autocomplete');
}

// Track online players for autocomplete
let onlinePlayers: string[] = [];

function updateSuggestions(input: string): void {
  if (!chatSuggestions || !chatInput) return;
  
  console.log(`[Chat] updateSuggestions input: "${input}", isCurrentUserAdmin: ${isCurrentUserAdmin}, availableMaps count: ${availableMaps.length}`);
  
  currentSuggestions = [];
  selectedSuggestionIndex = -1;
  
  if (!input.startsWith('/')) {
    hideSuggestions();
    return;
  }
  
  const spaceIndex = input.indexOf(' ');
  
  if (spaceIndex > 0) {
    // User is typing parameters after command
    const cmd = input.substring(1, spaceIndex);
    const paramInput = input.substring(spaceIndex + 1).toLowerCase();
    
    console.log(`[Chat] Parameter mode - cmd: "${cmd}", paramInput: "${paramInput}"`);
    
    if (isCurrentUserAdmin) {
      if (cmd === 'map') {
        // Show map suggestions
        currentSuggestions = availableMaps
          .filter(m => m.toLowerCase().includes(paramInput))
          .map(m => ({ text: `/map ${m}`, desc: `切换到地图: ${m}` }));
        console.log(`[Chat] Map suggestions found: ${currentSuggestions.length}`);
      } else if (cmd === 'give' || cmd === 'heal' || cmd === 'kill' || cmd === 'kick') {
        // Show player suggestions
        currentSuggestions = onlinePlayers
          .filter(name => name.toLowerCase().includes(paramInput))
          .map(name => {
            if (cmd === 'give') {
              return { text: `/give ${name} `, desc: `给 ${name} 加钱` };
            } else if (cmd === 'heal') {
              return { text: `/heal ${name}`, desc: `治疗 ${name}` };
            } else if (cmd === 'kill') {
              return { text: `/kill ${name}`, desc: `击杀 ${name}` };
            } else {
              return { text: `/kick ${name}`, desc: `踢出 ${name}` };
            }
          });
        console.log(`[Chat] Player suggestions found: ${currentSuggestions.length}`);
      }
    } else {
      console.log(`[Chat] Not an admin, skipping param suggestions for: ${cmd}`);
    }
  } else {
    // User is typing command name
    // Filter commands based on admin status
    currentSuggestions = COMMANDS
      .filter(c => !c.adminOnly || isCurrentUserAdmin) // Only show permitted commands
      .filter(c => c.cmd.toLowerCase().startsWith(input.toLowerCase()))
      .map(c => ({ text: c.cmd, desc: c.desc }));
    console.log(`[Chat] Command suggestions found: ${currentSuggestions.length}`);
  }
  
  if (currentSuggestions.length > 0) {
    showSuggestions();
  } else {
    hideSuggestions();
  }
}

function showSuggestions(): void {
  if (!chatSuggestions) return;
  
  chatSuggestions.innerHTML = '';
  chatSuggestions.classList.add('visible');
  
  // Store reference to avoid null checks in forEach
  const suggestionsContainer = chatSuggestions;
  
  currentSuggestions.forEach((suggestion, index) => {
    const item = document.createElement('div');
    item.className = 'chat-suggestion-item';
    if (index === selectedSuggestionIndex) {
      item.classList.add('selected');
    }
    
    const name = document.createElement('span');
    name.className = 'suggestion-name';
    name.textContent = suggestion.text;
    
    const desc = document.createElement('span');
    desc.className = 'suggestion-desc';
    desc.textContent = suggestion.desc;
    
    item.appendChild(name);
    item.appendChild(desc);
    
    // Click to apply
    item.addEventListener('mousedown', (e) => {
      e.preventDefault(); // Prevent blur
      if (chatInput) {
        chatInput.value = suggestion.text;
        chatInput.focus();
        hideSuggestions();
      }
    });
    
    suggestionsContainer.appendChild(item);
  });
}

function hideSuggestions(): void {
  if (!chatSuggestions) return;
  chatSuggestions.classList.remove('visible');
  chatSuggestions.innerHTML = '';
  currentSuggestions = [];
  selectedSuggestionIndex = -1;
}

function updateSuggestionHighlight(): void {
  if (!chatSuggestions) return;
  
  const items = chatSuggestions.querySelectorAll('.chat-suggestion-item');
  items.forEach((item, index) => {
    if (index === selectedSuggestionIndex) {
      item.classList.add('selected');
    } else {
      item.classList.remove('selected');
    }
  });
}

// Function to update available maps from server
function updateAvailableMaps(maps: string[]): void {
  availableMaps = maps;
  console.log('[Chat] Updated available maps:', maps);
}

function updateOnlinePlayers(players: Array<{ name: string; status: string }>): void {
  onlinePlayers = players.map(p => p.name);
  console.log('[Chat] Updated online players:', onlinePlayers);
}
(window as any).updateOnlinePlayers = updateOnlinePlayers;

function sendChatMessage(content: string): void {
  if (!content) return;
  
  if (network) {
     network.sendChat(content);
  }
}

function addChatMessage(message: string): void {
  if (!chatLog) return;
  
  const div = document.createElement('div');
  div.className = 'chat-message';
  div.textContent = message;
  
  chatLog.appendChild(div);
  
  // Limit message count
  while (chatLog.children.length > 10) {
      chatLog.removeChild(chatLog.firstChild as Node);
  }
  
  // Auto-scroll to bottom
  chatLog.scrollTop = chatLog.scrollHeight;
  
  // Also show in HUD event log for redundancy or if chat is hidden?
  // hud.addEvent(message); // Optional
}

// Hook into Network messages to capture S2C_EVENT for chat
// We need to intercept the message handling.
// Since `network` is an instance of `Network`, let's check if it has an event emitter or callback we can hook.
// If `network` doesn't expose a way to 'listen', we might need to modify `Network` class or `client/src/main.ts` where it handles messages.
// Looking at `client/src/main.ts`, it seems `network` encapsulates the socket.
// Let's assume we can modify `client/src/network.ts` OR we can just piggyback on `S2C_EVENT` if it's handled globally.

// Call init associated with DOM
initChatSystem();

(window as any).addChatMessage = addChatMessage;
(window as any).updateAvailableMaps = updateAvailableMaps;

// 新增: 渲染击杀播报 (Existing)
function renderKillFeed(feed: S2C_KILL_FEED): void {
  const container = document.getElementById('killFeedContainer');
  if (!container) return;

  const feedEl = document.createElement('div');
  feedEl.className = 'kill-feed-item';
  
  // Killer
  const killerSpan = document.createElement('span');
  killerSpan.className = 'kill-killer';
  killerSpan.textContent = feed.killer;
  feedEl.appendChild(killerSpan);

  // Icon (or text "killed")
  const iconSpan = document.createElement('span');
  iconSpan.className = 'kill-icon';
  iconSpan.textContent = 'KILLED'; 
  feedEl.appendChild(iconSpan);

  // Victim
  const victimSpan = document.createElement('span');
  victimSpan.className = 'kill-victim';
  victimSpan.textContent = feed.victim;
  feedEl.appendChild(victimSpan);

  // Weapon
  if (feed.weapon) {
    const weaponSpan = document.createElement('span');
    weaponSpan.className = 'kill-weapon';
    weaponSpan.textContent = `[${feed.weapon}]`;
    feedEl.appendChild(weaponSpan);
  }

  // Append new feed item
  container.appendChild(feedEl);

  // Trigger animation
  requestAnimationFrame(() => {
    feedEl.classList.add('show');
  });

  // Remove after 5 seconds
  setTimeout(() => {
    feedEl.classList.remove('show');
    feedEl.classList.add('hide'); 
    setTimeout(() => {
      if (feedEl.parentNode === container) {
        container.removeChild(feedEl);
      }
    }, 300); 
  }, 5000);

  // Limit max items
  while (container.children.length > 5) {
    container.removeChild(container.firstChild as Node);
  }
}