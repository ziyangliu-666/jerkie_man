import { Renderer } from './renderer.js';
import { Network } from './network.js';
import { InputManager } from './input.js';
import { HUD } from './hud.js';
import { DebugLog } from './debugLog.js'; // 修复: 添加 debug log 系统
import { BulletTrackManager } from './bulletTracks.js'; // 子弹轨迹管理器（dead-reckoning + 本地预测）
import { UIOverlay } from './uiOverlay.js'; // 新增: 屏幕 HUD 层
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
} from '@jerkie-man/shared';

// 本地发射 ID 计数器（用于客户端预测子弹对齐）
let localShotIdCounter = 0;
// 上次开火冷却时间（与服务端保持一致）
let lastLocalFireMs = 0;

/**
 * 获取当前装备的武器类型（从 playerProfile）
 */
function getEquippedWeaponType(): any | null {
  if (!playerProfile?.equipment?.weaponIid) return null;
  const wid = playerProfile.equipment.weaponIid;
  const pool = [...(playerProfile.prep ?? []), ...(playerProfile.stash ?? [])];
  const inst = pool.find(it => it.iid === wid);
  if (!inst) return null;
  try {
    return getWeaponDef(inst.typeId);
  } catch {
    return null;
  }
}

/**
 * 获取本地开火冷却时间（毫秒）
 */
function getLocalFireCooldownMs(): number {
  const weaponDef = getEquippedWeaponType();
  return weaponDef?.fireIntervalMs ?? 150; // 默认 150ms
}

/**
 * 获取本地子弹速度（px/s）
 */
function getLocalBulletSpeed(): number {
  const weaponDef = getEquippedWeaponType();
  return weaponDef?.bulletSpeed ?? 800; // 默认 800 px/s
}

// 三层结构：worldCanvas（世界层）+ uiCanvas（屏幕HUD层）+ DOM overlay（面板层）
const worldCanvas = document.getElementById('worldCanvas') as HTMLCanvasElement;
const uiCanvas = document.getElementById('uiCanvas') as HTMLCanvasElement;
if (!worldCanvas || !uiCanvas) {
  throw new Error('Canvas not found');
}

// 初始化渲染器（必须先初始化，才能调用resize）
const renderer = new Renderer(worldCanvas);

// 初始化 UI 覆盖层（屏幕 HUD：准星、受伤红边等）
const uiOverlay = new UIOverlay(uiCanvas);

// 初始化子弹轨迹管理器（dead-reckoning，解决子弹"忽快忽慢"）
const bulletTracks = new BulletTrackManager();

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

// 初始化HUD（使用 debugPanel 作为容器，右侧调试面板）
const hud = new HUD('debugPanel');
hud.addEvent('客户端已启动');

// Debug 面板折叠功能（F1 切换）
const hudContainer = document.getElementById('hudContainer');
const debugToggle = document.getElementById('debugToggle');
let debugPanelCollapsed = false;

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
// P1-1 新增: 玩家 Profile（从 S2C_PROFILE 接收）
let playerProfile: (PlayerProfile & { accountId: string; phase?: 'NAME' | 'HIDEOUT' | 'RAID' | 'RESULT' }) | null = null;
// 新增: 本地 accountId（从 WELCOME 消息确认）
let localAccountId: string | null = null;
// 新增: 游戏阶段状态机
type Phase = 'NAME' | 'HIDEOUT' | 'RAID' | 'RESULT';
let currentPhase: Phase = 'NAME';

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

// 修复: 客户端预测相关状态（必须在 updatePhaseUI 之前定义）
let predictedLocalPlayer: PLAYER_STATE | null = null; // 预测的本地玩家状态
let renderLocalPlayer: PLAYER_STATE | null = null; // 渲染平滑 - 每帧平滑追向预测位置，避免 20Hz 步进卡顿

// 新增: 更新 phase UI（显示/隐藏 modal，控制世界渲染等）
function updatePhaseUI(): void {
  // 确保 DOM 元素已获取
  getModalElements();
  getHideoutElements();
  
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
    if (hideoutUI) {
      hideoutUI.style.display = 'none';
      console.log('[updatePhaseUI] Hiding Hideout UI, computed display:', window.getComputedStyle(hideoutUI).display);
    } else {
      console.warn('[updatePhaseUI] hideoutUI is null, cannot hide');
    }
  } else if (currentPhase === 'RESULT') {
    // 隐藏 NAME modal 和 Hideout UI，显示结果页面
    if (nameModal) {
      nameModal.style.display = 'none';
    }
    if (hideoutUI) {
      hideoutUI.style.display = 'none';
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
    getResultElements();
    if (resultUI) {
      resultUI.style.display = 'none';
    }
  }
}

// 新增: 战局结果数据
let raidResult: { result: 'EXTRACTED' | 'DIED'; loot: ItemInstance[]; moneyGained: number; moneyLost: number } | null = null;

// 新增: 结果页面 DOM 元素
let resultUI: HTMLElement | null = null;
let resultTitle: HTMLElement | null = null;
let resultStatus: HTMLElement | null = null;
let resultDetails: HTMLElement | null = null;
let resultContinueBtn: HTMLButtonElement | null = null;

// 获取结果页面 DOM 元素的辅助函数
function getResultElements(): void {
  if (!resultUI) resultUI = document.getElementById('resultUI');
  if (!resultTitle) resultTitle = document.getElementById('resultTitle');
  if (!resultStatus) resultStatus = document.getElementById('resultStatus');
  if (!resultDetails) resultDetails = document.getElementById('resultDetails');
  if (!resultContinueBtn) resultContinueBtn = document.getElementById('resultContinueBtn') as HTMLButtonElement;
}

// 新增: 更新结果页面 UI
function updateResultUI(): void {
  getResultElements();
  
  if (!resultUI || !resultTitle || !resultStatus || !resultDetails || !resultContinueBtn) {
    console.warn('[Result UI] DOM elements not found');
    return;
  }
  
  if (!raidResult) {
    // 没有结果数据，隐藏结果页面
    resultUI.style.display = 'none';
    return;
  }
  
  // 显示结果页面
  resultUI.style.display = 'flex';
  
  // 更新标题和状态
  if (raidResult.result === 'EXTRACTED') {
    resultTitle.textContent = '成功撤离';
    resultStatus.textContent = '✓ 成功撤离';
    resultStatus.className = 'success';
    
    // 显示获得的物品和金钱
    let detailsHtml = '';
    if (raidResult.loot.length > 0) {
      detailsHtml += '<div><strong>获得物品:</strong></div>';
      for (const item of raidResult.loot) {
        try {
          const itemType = getItemType(item.typeId);
          detailsHtml += `<div>  • ${escapeHtml(itemType.name)} x${escapeHtml(item.qty)}</div>`;
        } catch {
          detailsHtml += `<div>  • ${escapeHtml(item.typeId)} x${escapeHtml(item.qty)}</div>`;
        }
      }
    }
    if (raidResult.moneyGained > 0) {
      detailsHtml += `<div style="margin-top: 10px;"><strong>获得金钱:</strong> $${escapeHtml(raidResult.moneyGained)}</div>`;
    }
    resultDetails.innerHTML = detailsHtml || '<div>无额外奖励</div>';
  } else {
    resultTitle.textContent = '战局失败';
    resultStatus.textContent = '✗ 死亡';
    resultStatus.className = 'failed';
    
    // 显示损失的金钱
    let detailsHtml = '';
    if (raidResult.moneyLost > 0) {
      detailsHtml += `<div><strong>损失金钱:</strong> $${escapeHtml(raidResult.moneyLost)}</div>`;
    }
    detailsHtml += '<div style="margin-top: 10px; color: #666;">你携带的所有物品已丢失</div>';
    resultDetails.innerHTML = detailsHtml || '<div>无损失</div>';
  }
  
  // 绑定继续按钮
  resultContinueBtn.onclick = () => {
    // 隐藏结果页面
    resultUI!.style.display = 'none';
    // 更新 phase 为 HIDEOUT，返回整备界面
    const oldPhase = currentPhase;
    currentPhase = 'HIDEOUT';
    console.log(`[Result Continue] Phase changed: ${oldPhase} -> ${currentPhase}`);
    updatePhaseUI();
    // 请求更新 Profile（确保数据是最新的）
    // 注意：这里不需要手动请求，因为 phase 更新后，如果服务端发送新的 Profile，会自动更新
  };
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
  btn.classList.add(success ? 'success' : 'error');
  if (message) {
    const originalText = btn.textContent;
    btn.textContent = message;
    setTimeout(() => {
      btn.classList.remove('success', 'error');
      btn.textContent = originalText;
    }, 1000);
  } else {
    setTimeout(() => {
      btn.classList.remove('success', 'error');
    }, 500);
  }
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
  if (prepList && playerProfile.prep) {
    prepList.innerHTML = '';
    const availablePrepItems = playerProfile.prep.filter(item => !isItemEquipped(item));
    if (availablePrepItems.length === 0) {
      prepList.innerHTML = '<div style="color: #666; padding: 20px; text-align: center;">整备区为空</div>';
    } else {
      for (const item of availablePrepItems) {
        const itemType = getItemType(item.typeId);
        const row = createItemRow(item, itemType, 'prep');
        prepList.appendChild(row);
      }
    }
  }
  
  // 更新仓库列表（过滤已装备的物品）
  if (stashList && playerProfile.stash) {
    stashList.innerHTML = '';
    const availableStashItems = playerProfile.stash.filter(item => !isItemEquipped(item));
    if (availableStashItems.length === 0) {
      stashList.innerHTML = '<div style="color: #666; padding: 20px; text-align: center;">仓库为空</div>';
    } else {
      for (const item of availableStashItems) {
        const itemType = getItemType(item.typeId);
        const row = createItemRow(item, itemType, 'stash');
        stashList.appendChild(row);
      }
    }
  }
  
  // 更新商店列表
  if (shopList) {
    shopList.innerHTML = '';
    const allItemTypes = getAllItemTypes();
    for (const itemType of allItemTypes) {
      const row = createShopRow(itemType);
      shopList.appendChild(row);
    }
  }
}

// 新增: 检查物品类型（武器/背包/防具）
function getItemSlot(typeId: string): 'weapon' | 'bag' | 'armor' | null {
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

// 新增: 创建物品行（用于整备区和仓库）
function createItemRow(item: ItemInstance, itemType: any, source: 'prep' | 'stash'): HTMLElement {
  const row = document.createElement('div');
  row.className = 'item-row';
  
  const info = document.createElement('div');
  info.className = 'item-info';
  
  // stackMax==1的物品：qty固定显示1
  const displayQty = itemType.stackMax <= 1 ? 1 : item.qty;
  info.innerHTML = `
    <div class="item-name">${itemType.name}</div>
    <div class="item-meta">数量: ${displayQty} | 价值: ${itemType.value} | 稀有度: ${rarityToZh(itemType.rarity)}</div>
  `;
  
  const actions = document.createElement('div');
  actions.className = 'item-actions';
  
  // 检查是否是装备（武器/背包/防具）
  const slot = getItemSlot(item.typeId);
  
  // stackMax==1的物品：移动/卖出时qty固定为1
  const moveQty = itemType.stackMax <= 1 ? 1 : item.qty;
  
  if (source === 'prep') {
    // 整备区：可以移回仓库，如果是装备可以装备
    const moveBtn = document.createElement('button');
    moveBtn.className = 'item-btn';
    moveBtn.textContent = '移回仓库';
    moveBtn.onclick = () => {
      moveBtn.classList.add('loading');
      network.sendMovePrepToStash(item.iid, moveQty);
      hud.addEvent(`移回仓库: ${itemType.name}${itemType.stackMax <= 1 ? '' : ` x${moveQty}`}`);
      setTimeout(() => {
        moveBtn.classList.remove('loading');
        addButtonFeedback(moveBtn, true);
      }, 300);
    };
    actions.appendChild(moveBtn);
    
    if (slot) {
      const equipBtn = document.createElement('button');
      equipBtn.className = 'item-btn primary';
      equipBtn.textContent = slot === 'weapon' ? '装备为武器' : slot === 'bag' ? '装备为背包' : '装备为防具';
      equipBtn.onclick = () => {
        equipBtn.classList.add('loading');
        network.sendEquip(slot, item.iid);
        hud.addEvent(`装备: ${itemType.name}`);
        setTimeout(() => {
          equipBtn.classList.remove('loading');
          addButtonFeedback(equipBtn, true, '已装备');
        }, 300);
      };
      actions.appendChild(equipBtn);
    }
  } else {
    // 仓库：可以移到整备区或卖出，如果是装备可以装备
    const moveBtn = document.createElement('button');
    moveBtn.className = 'item-btn';
    moveBtn.textContent = '移到整备';
    moveBtn.onclick = () => {
      moveBtn.classList.add('loading');
      network.sendMoveStashToPrep(item.iid, moveQty);
      hud.addEvent(`移到整备: ${itemType.name}${itemType.stackMax <= 1 ? '' : ` x${moveQty}`}`);
      setTimeout(() => {
        moveBtn.classList.remove('loading');
        addButtonFeedback(moveBtn, true);
      }, 300);
    };
    actions.appendChild(moveBtn);
    
    const sellBtn = document.createElement('button');
    sellBtn.className = 'item-btn';
    sellBtn.textContent = '卖出';
    sellBtn.onclick = () => {
      sellBtn.classList.add('loading');
      network.sendSellFromStash(item.iid, moveQty);
      hud.addEvent(`卖出: ${itemType.name}${itemType.stackMax <= 1 ? '' : ` x${moveQty}`}`);
      setTimeout(() => {
        sellBtn.classList.remove('loading');
        addButtonFeedback(sellBtn, true, '已卖出');
      }, 300);
    };
    actions.appendChild(sellBtn);
    
    if (slot) {
      const equipBtn = document.createElement('button');
      equipBtn.className = 'item-btn primary';
      equipBtn.textContent = slot === 'weapon' ? '装备为武器' : slot === 'bag' ? '装备为背包' : '装备为防具';
      equipBtn.onclick = () => {
        equipBtn.classList.add('loading');
        network.sendEquip(slot, item.iid);
        hud.addEvent(`装备: ${itemType.name}`);
        setTimeout(() => {
          equipBtn.classList.remove('loading');
          addButtonFeedback(equipBtn, true, '已装备');
        }, 300);
      };
      actions.appendChild(equipBtn);
    }
  }
  
  row.appendChild(info);
  row.appendChild(actions);
  return row;
}

// 新增: 创建商店物品行
function createShopRow(itemType: any): HTMLElement {
  const row = document.createElement('div');
  row.className = 'item-row';
  
  const info = document.createElement('div');
  info.className = 'item-info';
  info.innerHTML = `
    <div class="item-name">${itemType.name}</div>
    <div class="item-meta">价格: ${itemType.value} | 稀有度: ${rarityToZh(itemType.rarity)} | 堆叠上限: ${itemType.stackMax}</div>
  `;
  
  const actions = document.createElement('div');
  actions.className = 'item-actions';
  
  const buyBtn = document.createElement('button');
  buyBtn.className = 'item-btn primary';
  buyBtn.textContent = `购买 (${itemType.value})`;
  buyBtn.onclick = () => {
    if (playerProfile && playerProfile.money >= itemType.value) {
      buyBtn.classList.add('loading');
      network.sendBuy(itemType.id, 1);
      hud.addEvent(`购买: ${itemType.name}`);
      setTimeout(() => {
        buyBtn.classList.remove('loading');
        addButtonFeedback(buyBtn, true, '已购买');
      }, 300);
    } else {
      hud.addEvent(`金钱不足: 需要 ${itemType.value}，当前 ${playerProfile?.money ?? 0}`);
      addButtonFeedback(buyBtn, false, '金钱不足');
    }
  };
  actions.appendChild(buyBtn);
  
  row.appendChild(info);
  row.appendChild(actions);
  return row;
}

// 新增: 初始化 Hideout UI（Tab 切换等）
function initHideoutUI(): void {
  getHideoutElements();
  
  // Tab 切换
  if (hideoutTabs) {
    hideoutTabs.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('tab-btn')) {
        const tabName = target.getAttribute('data-tab');
        if (!tabName) return;
        
        // 更新 Tab 按钮状态
        hideoutTabs?.querySelectorAll('.tab-btn').forEach(btn => {
          btn.classList.remove('active');
        });
        target.classList.add('active');
        
        // 更新面板显示
        if (hideoutEquipment) hideoutEquipment.classList.remove('active');
        if (hideoutStash) hideoutStash.classList.remove('active');
        if (hideoutShop) hideoutShop.classList.remove('active');
        
        if (tabName === 'equipment' && hideoutEquipment) {
          hideoutEquipment.classList.add('active');
        } else if (tabName === 'stash' && hideoutStash) {
          hideoutStash.classList.add('active');
        } else if (tabName === 'shop' && hideoutShop) {
          hideoutShop.classList.add('active');
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
      } else {
        hud.addEvent('进入战局失败：连接未就绪');
      }
    };
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
    updatePhaseUI(); // ✅ 启动时先把 NAME/Hideout UI 挂出来
  });
} else {
  initNameModal();
  initHideoutUI();
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

// 动态构建 WebSocket 服务器地址（支持内网穿透）
// 根据当前访问的地址自动确定服务器地址
function getWebSocketUrl(): string {
  const hostname = window.location.hostname;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  // 使用相同的 hostname，但端口改为服务器端口 18723
  return `${protocol}//${hostname}:18723`;
}

const network = new Network(getWebSocketUrl(), 'local', {
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
          console.log('[Snapshot] Player with name:', p.id, 'name:', p.name);
        } else {
          console.log('[Snapshot] Player without name:', p.id);
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
          
          // 重置发送缓存，避免还在 stream
          lastSentKeys = null;
          lastSentShoot = false;
          lastSentExtractHeld = null;
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
    hud.addEvent(`错误：${error}`);
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
    
    // 设置子弹轨迹管理器的地图尺寸和障碍物（用于本地碰撞检测）
    bulletTracks.setMapSize(world.mapConfig.width, world.mapConfig.height);
    bulletTracks.setObstacles(world.obstacles);
    
    const itemsCount = world.items?.length ?? 0;
    const worldItemsCount = world.worldItems?.length ?? 0;
    console.log(`Received world init: seed=${world.seed}, obstacles=${world.obstacles.length}, items=${itemsCount}, worldItems=${worldItemsCount}`);
    hud.addEvent(`世界已初始化：${world.obstacles.length} 个障碍物，${itemsCount} 个物品，${worldItemsCount} 个世界物品`);
  },
  // P1-1 新增: 接收 Profile 消息并更新 HUD
  onProfile: (profile) => {
    // 修复: 处理 prep 可能是 undefined 的情况
    playerProfile = {
      ...profile,
      prep: profile.prep ?? [],
    };
    // 更新 phase（如果服务端提供了 phase）
    const oldPhase = currentPhase;
    if (profile.phase) {
      currentPhase = profile.phase;
    } else {
      // 兼容旧服务端：根据 displayName 推断 phase
      currentPhase = profile.displayName === null ? 'NAME' : 'HIDEOUT';
    }
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
      uiOverlay.showText('没子弹');
      hud.addEvent('干火！');
    } else if (event.kind === 'HIT') {
      // 命中反馈
      uiOverlay.triggerHitMarker();
    } else if (event.kind === 'DAMAGE_TAKEN') {
      // 受伤反馈
      uiOverlay.triggerDamage(event.direction);
    }
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
  
  // 修复: 只在 RAID 阶段更新子弹轨迹
  if (currentPhase === 'RAID') {
    bulletTracks.update(dtSec);
  }
  
  // UI 覆盖层更新（衰减动画）
  uiOverlay.update(dtSec);
  
  // 获取插值后的状态
  const state = network.getSnapshotBuffer().getInterpolatedState(180);
  
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
        
        // 只有"大回滚/死亡等状态切换"才允许瞬移
        const shouldSnap = predictedLocalPlayer.status !== 'ALIVE';
        
        // 撞墙后的短时间内，加速 smooth 收敛（避免"慢慢贴墙"但也不"吸附瞬移"）
        const halfLife = performance.now() < fastConvergeUntil ? HALF_LIFE_BLOCKED : HALF_LIFE_NORMAL;
        
        // 大回滚/需要snap时直接瞬移，避免慢慢"飘回去"
        if (dist > 80 || shouldSnap) {
          renderLocalPlayer.x = predictedLocalPlayer.x;
          renderLocalPlayer.y = predictedLocalPlayer.y;
        } else {
          renderLocalPlayer.x = smoothTo(renderLocalPlayer.x, predictedLocalPlayer.x, dtSec, halfLife);
          renderLocalPlayer.y = smoothTo(renderLocalPlayer.y, predictedLocalPlayer.y, dtSec, halfLife);
        }
        
        // 其他字段保持最新（别让血量/状态落后一拍）
        renderLocalPlayer.hp = predictedLocalPlayer.hp;
        renderLocalPlayer.status = predictedLocalPlayer.status;
        renderLocalPlayer.lootCount = predictedLocalPlayer.lootCount;
        renderLocalPlayer.lastInputSeq = predictedLocalPlayer.lastInputSeq;
        renderLocalPlayer.lastInputTick = predictedLocalPlayer.lastInputTick;
        renderLocalPlayer.extractProgress = predictedLocalPlayer.extractProgress;
        renderLocalPlayer.weaponRuntime = predictedLocalPlayer.weaponRuntime; // 修复: 更新武器运行时状态（包括弹药数）
      }
      
      // 使用平滑后的 renderLocalPlayer 渲染本地玩家
      playersToRender = state.players.map((p) =>
        p.id === localPlayerId ? (renderLocalPlayer as PLAYER_STATE) : p
      );
    }
  }

      // 新增: 只在 RAID phase 时渲染世界
      if (currentPhase === 'RAID') {
        // Day4-1: 使用 server 下发的 mapConfig（优先），fallback 到本地配置
        const extractZone = serverMapConfig?.extractZone ?? fallbackMapConfig.extractZone;
        
        // 修复: 使用缓存的静态世界数据（obstacles 从 WORLD_INIT 接收，不再从 snapshot 获取）
        // items 仍然从 snapshot 获取（因为会被拾取，是动态的）
        // 新增: 渲染 worldItems 和 lootBags
        // 使用 BulletTrackManager 的 dead-reckoning + 本地预测渲染
        // 本地预测子弹会通过 shotId 自动对齐到服务端子弹（无接棒割裂）
        const bulletsToRender = bulletTracks.getBulletsForRender();
        
        renderer.render(
          playersToRender,
          localPlayerId,
          isDebug,
          bulletsToRender,
          state.items,
          extractZone,
          cachedObstacles,
          state.worldItems, // 新增: 世界物品
          state.lootBags, // 新增: 掉落包
          bulletTracks.getHitEffects(), // 命中特效
          network.getConnectionState().lastServerTick // 新增: 当前服务器 tick（用于计算换弹进度）
        );
      } else {
        // 非 RAID phase: 只清屏（显示暗背景）
        renderer.clear();
      }
      
      // 更新 UI 覆盖层状态（撤离进度 + 武器状态）
      // ✅ 关键：只有 RAID 才允许显示撤离环
      if (currentPhase === 'RAID' && localPlayerId) {
        const localPlayer = renderLocalPlayer ?? predictedLocalPlayer ?? state.players.find((p) => p.id === localPlayerId);
        if (localPlayer && (localPlayer.extractProgress ?? 0) > 0) {
          uiOverlay.updateState({
            extractProgress: {
              enabled: true,
              progress: (localPlayer.extractProgress as number) / 2000,
            },
          });
        } else {
          uiOverlay.updateState({ extractProgress: { enabled: false, progress: 0 } });
        }
      } else {
        uiOverlay.updateState({ extractProgress: { enabled: false, progress: 0 } });
      }
      
      // 武器状态（只在有本地玩家时更新）
      if (localPlayerId) {
        const localPlayer = renderLocalPlayer ?? predictedLocalPlayer ?? state.players.find((p) => p.id === localPlayerId);
        if (localPlayer) {
          
          // 武器状态
          if (localPlayer.weaponRuntime) {
            try {
              const weaponDef = getWeaponDef(localPlayer.weaponRuntime.weaponTypeId);
              const currentTick = network.getConnectionState().lastServerTick;
              const reloading = localPlayer.weaponRuntime.reloadingUntilTick > 0 && currentTick < localPlayer.weaponRuntime.reloadingUntilTick;
              const reloadProgress = reloading 
                ? Math.min(1, (currentTick - (localPlayer.weaponRuntime.reloadingUntilTick - Math.ceil(weaponDef.reloadMs / 50))) / Math.ceil(weaponDef.reloadMs / 50))
                : 0;
              
              uiOverlay.updateState({
                weaponStatus: {
                  enabled: true,
                  weaponName: weaponDef.name,
                  ammoInMag: localPlayer.weaponRuntime.ammoInMag,
                  magSize: weaponDef.magSize,
                  reloading,
                  reloadProgress,
                },
              });
            } catch {
              // 无效武器类型，隐藏武器状态
              uiOverlay.updateState({
                weaponStatus: { enabled: false, weaponName: '', ammoInMag: 0, magSize: 0, reloading: false, reloadProgress: 0 },
              });
            }
          } else {
            // 没有武器，隐藏武器状态
            uiOverlay.updateState({
              weaponStatus: { enabled: false, weaponName: '', ammoInMag: 0, magSize: 0, reloading: false, reloadProgress: 0 },
            });
          }
        }
      }
      
      // 绘制 UI 覆盖层（准星、受伤红边、撤离进度等）
      uiOverlay.draw();

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
      
      // 1. 读取输入（非 ALIVE 时清零）
      const rawKeys = inputManager.getKeys();
      const tickKeys = canControl ? rawKeys : { up: false, down: false, left: false, right: false };
      const tickAim = (() => {
        if (localPlayerId && localPlayer) {
          const playerScreenPos = renderer.worldToScreen(localPlayer.x, localPlayer.y);
          return inputManager.getAimAngleFromPoint(playerScreenPos.x, playerScreenPos.y);
        }
        return inputManager.getAimAngle(worldCanvas);
      })();
      const tickShoot = canControl ? inputManager.getShoot() : false;
      const tickExtractHeld = canControl ? inputManager.getExtractHeld() : false;
      
      // 本地预测子弹已在发送 input 时由 BulletTrackManager 生成（通过 shotId 对齐）
      
      // P2-2: 合并 interact 脉冲（使用 TTL，不再无限期保留）
      // 非 ALIVE 时清零 interact
      if (!canControl) {
        interactUntil = 0;
      } else if (inputManager.consumeInteract()) {
        interactUntil = performance.now() + INTERACT_TTL_MS;
        dbg.push('INTERACT_PRESS', { until: interactUntil });
      }
      
      // 新增: 消费换弹脉冲事件（edge-trigger）
      const tickReload = canControl ? inputManager.consumeReload() : false;
      
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
      if (connState.connected && canControl) {
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
          
          // 检查是否需要本地预测子弹（开火 + 冷却通过 + 武器状态检查）
          const nowPerf2 = performance.now();
          let shotIdToSend: number | undefined = undefined;
          const fireCooldownMs = getLocalFireCooldownMs();
          // 修复: 防止快速连点绕过冷却限制 - 使用严格的时间检查
          // 注意: 即使在同一循环中执行多个 tick，每次检查都会使用最新的 nowPerf2
          // 但为了更严格，我们在通过检查后立即更新 lastLocalFireMs
          if (tickShoot && nowPerf2 - lastLocalFireMs >= fireCooldownMs) {
            // 检查武器状态（从 snapshot 中的本地玩家状态）
            const canShoot = localPlayer && localPlayer.weaponRuntime && 
              localPlayer.weaponRuntime.ammoInMag > 0 && 
              !(localPlayer.weaponRuntime.reloadingUntilTick > 0 && network.getConnectionState().lastServerTick < localPlayer.weaponRuntime.reloadingUntilTick);
            
            if (canShoot) {
              // 修复: 在生成本地预测子弹之前就更新 lastLocalFireMs，防止同一循环中多次通过检查
              // 这确保即使客户端在一次循环中执行多个 tick，每个 tick 最多只生成本地预测子弹一次
              lastLocalFireMs = nowPerf2;
              
              localShotIdCounter++;
              shotIdToSend = localShotIdCounter;
              
              // 生成本地预测子弹（立即显示，无延迟，使用动态子弹速度）
              const localP = renderLocalPlayer ?? predictedLocalPlayer ?? localPlayer;
              if (localP && localP.weaponRuntime) {
                console.log(`[main.ts] 准备生成本地预测子弹: weaponTypeId=${localP.weaponRuntime.weaponTypeId}, shotId=${shotIdToSend}`);
                bulletTracks.spawnLocalPrediction(
                  shotIdToSend,
                  localP.x,
                  localP.y,
                  tickAim,
                  getLocalBulletSpeed(),
                  localP.weaponRuntime.weaponTypeId
                );
              } else {
                console.warn(`[main.ts] 无法生成本地预测子弹: localP=${!!localP}, weaponRuntime=${!!localP?.weaponRuntime}`);
              }
            } else {
              // 干火：触发本地反馈（不等待服务端）
              uiOverlay.showText('没子弹'); // 屏幕中央显示"没子弹"提示
            }
          }
          
          // P0-1 修复: interact 参数设为 false，不再触发服务端旧拾取逻辑
          // 修复: 参数顺序：seq, keys, aim, shoot, reload, interact, extract, extractHeld, shotId
          const sent = network.sendInput(nextSeq, tickKeys, tickAim, tickShoot, tickReload, false, false, tickExtractHeld, shotIdToSend);
          
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
              shotId: shotIdToSend,
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
        const beforeX = predictedLocalPlayer.x;
        const beforeY = predictedLocalPlayer.y;
        
        const newPredictedPos = simulatePlayerMove(
          { x: beforeX, y: beforeY },
          commitKeys,
          0.05, // 固定为 server tick 间隔
          mapConfig.width,
          mapConfig.height,
          cachedObstacles
        );
        
        // 检测撞墙/被阻挡：触发短时间"快速收敛"，不瞬移
        const movedDist = Math.hypot(newPredictedPos.x - beforeX, newPredictedPos.y - beforeY);
        const keysAny = commitKeys.up || commitKeys.down || commitKeys.left || commitKeys.right;
        if (keysAny && movedDist < 0.01) {
          fastConvergeUntil = performance.now() + FAST_CONVERGE_ON_BLOCK_MS;
        }
        
        predictedLocalPlayer.x = newPredictedPos.x;
        predictedLocalPlayer.y = newPredictedPos.y;
      }
      } // 结束 if (currentPhase === 'RAID')
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
    // ✅ 关键：HUD 的撤离进度别读"插值 state"（它天生落后/可能停在最后一帧）
    let localPlayerExtractProgress: number | undefined = undefined;
    if (currentPhase === 'RAID' && localPlayerId) {
      const localPlayer =
        renderLocalPlayer ??
        predictedLocalPlayer ??
        state.players.find((p) => p.id === localPlayerId);

      if (localPlayer && localPlayer.extractProgress !== undefined) {
        localPlayerExtractProgress = localPlayer.extractProgress;
      }
    }
    
    // 新增: 计算最近可交互目标
    let nearbyInteractable: { type: 'worldItem' | 'lootBag' | 'extractZone'; name: string; distance: number } | null = null;
    if (localPlayerId) {
      const localPlayer = renderLocalPlayer ?? predictedLocalPlayer ?? state.players.find((p) => p.id === localPlayerId);
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
      inventory: localPlayerId ? (state.players.find(p => p.id === localPlayerId)?.inventory) : undefined,
      stash: playerProfile?.stash, // 从 Profile 获取
      money: playerProfile?.money, // 从 Profile 获取
      // 新增: 局内交互提示
      nearbyInteractable,
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
