import type { PLAYER_STATE, S2C_SNAPSHOT, PlayerInventory, ItemInstance } from '@jerkie-man/shared';
import { getItemType, ITEM_CATALOG } from '@jerkie-man/shared';

/**
 * HTML 转义函数（防止 XSS）
 * 将所有来自网络/玩家/物品/事件的字符串视为不可信，必须转义
 */
function escapeHtml(text: string | number): string {
  const str = String(text);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// HUDActions 接口已移除（不再需要 Sell 按钮）

export interface HUDData {
  connection: {
    status: 'connected' | 'reconnecting' | 'disconnected';
    ping?: number; // Day1占位
    clientTime: number;
    lastServerTick: number;
    reconnectAttempts?: number; // P1-2 修复: 重连尝试次数
    nextReconnectInMs?: number | null; // P1-2 修复: 下次重连倒计时（毫秒）
    extractProgress?: number; // 游戏化增强: 本地玩家撤离进度（0-2000ms）
    accountId?: string; // 新增: 账号 ID（用于调试）
  };
  players: PLAYER_STATE[];
  counts: {
    bullets: number;
    worldItems: number; // P2-1: 改用 worldItems（旧 items 已停用）
    lootBags: number; // P2-1: 新增掉落包计数
  };
  selectedEntity: PLAYER_STATE | null;
  events: string[]; // 最近30条事件
  // 新增: 物品系统数据
  inventory?: PlayerInventory; // 本地玩家背包
  stash?: ItemInstance[]; // 仓库（需要从服务器获取，暂时留空）
  money?: number; // 钱（需要从服务器获取，暂时留空）
  // 新增: 局内交互提示
  nearbyInteractable?: { type: 'worldItem' | 'lootBag' | 'extractZone'; name: string; distance: number } | null;
}

export class HUD {
  private container: HTMLElement;
  private events: string[] = [];
  private readonly maxEvents = 30;
  // 缓存上次渲染的 stash 数据，避免频繁重建 DOM
  private lastStashJson: string = '';

  constructor(containerId: string) {
    const container = document.getElementById(containerId);
    if (!container) {
      throw new Error(`HUD container not found: ${containerId}`);
    }
    this.container = container;
    this.createHUD();
  }

  private createHUD(): void {
    this.container.innerHTML = `
      <h3>连接</h3>
      <div id="hud-connection"></div>
      
      <h3>玩家</h3>
      <div id="hud-players"></div>
      
      <h3>计数</h3>
      <div id="hud-counts"></div>
      
      <h3>附近交互（按E）</h3>
      <div id="hud-nearby" style="color: #4CAF50; font-weight: bold;"></div>
      
      <h3>背包（局内）</h3>
      <div id="hud-inventory"></div>
      
      <h3>仓库（局外）</h3>
      <div id="hud-stash"></div>
      
      <h3>金钱</h3>
      <div id="hud-money"></div>
      
      <h3>选中实体</h3>
      <div id="hud-selected"></div>
      
      <h3>事件日志</h3>
      <div id="hud-events" class="event-log"></div>
    `;
  }

  addEvent(event: string): void {
    const timestamp = new Date().toLocaleTimeString();
    this.events.push(`[${timestamp}] ${event}`);
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }
  }

  // bindStashEvents 方法已移除（不再需要 Sell 按钮）

  update(data: HUDData): void {
    // Connection
    const connectionEl = document.getElementById('hud-connection');
    if (connectionEl) {
      // P1-2 修复: 显示重连信息
      let statusDisplay: string = data.connection.status;
      if (data.connection.status === 'connected') {
        statusDisplay = '已连接';
      } else if (data.connection.status === 'reconnecting') {
        const attempts = data.connection.reconnectAttempts ?? 0;
        const nextIn = data.connection.nextReconnectInMs;
        statusDisplay = `重连中（尝试 ${attempts}${nextIn !== null ? `，${nextIn}ms 后重试` : ''}）`;
      } else if (data.connection.status === 'disconnected') {
        statusDisplay = '已断开';
      }
      let extractProgressHtml = '';
      if (data.connection.extractProgress !== undefined && data.connection.extractProgress > 0) {
        const progressPercent = Math.min(100, (data.connection.extractProgress / 2000) * 100);
        // 修复: 使用 escapeHtml 防止 XSS
        extractProgressHtml = `<div><strong>撤离进度：</strong> ${escapeHtml(progressPercent.toFixed(1))}% (${escapeHtml(data.connection.extractProgress)}/2000ms)</div>`;
      }
      // 修复: 使用 escapeHtml 防止 XSS（虽然 statusDisplay 是本地生成，但保持一致性）
      connectionEl.innerHTML = `
        <div><strong>状态：</strong> ${escapeHtml(statusDisplay)}</div>
        ${data.connection.ping !== undefined ? `<div><strong>延迟：</strong> ${escapeHtml(data.connection.ping)}ms</div>` : ''}
        ${data.connection.accountId ? `<div><strong>账号：</strong> ${escapeHtml(data.connection.accountId.substring(0, 8))}...</div>` : ''}
        <div><strong>客户端时间：</strong> ${escapeHtml(new Date(data.connection.clientTime).toISOString())}</div>
        <div><strong>最后服务器Tick：</strong> ${escapeHtml(data.connection.lastServerTick)}</div>
        ${extractProgressHtml}
      `;
    }

    // Players
    const playersEl = document.getElementById('hud-players');
    if (playersEl) {
      if (data.players.length === 0) {
        playersEl.innerHTML = '<div>无玩家</div>';
      } else {
        // 修复: 对玩家数据使用 escapeHtml（防止恶意 playerId 等字段注入）
        let html = '<table><tr><th>ID</th><th>X</th><th>Y</th><th>血量</th><th>状态</th><th>战利品</th><th>序号</th></tr>';
        for (const player of data.players) {
          let statusText: string;
          if (player.status === 'ALIVE') statusText = '存活';
          else if (player.status === 'DEAD') statusText = '死亡';
          else if (player.status === 'EXTRACTED') statusText = '已撤离';
          else statusText = player.status;
          html += `
            <tr>
              <td>${escapeHtml(player.id.substring(0, 8))}</td>
              <td>${escapeHtml(player.x.toFixed(1))}</td>
              <td>${escapeHtml(player.y.toFixed(1))}</td>
              <td>${escapeHtml(player.hp)}</td>
              <td>${escapeHtml(statusText)}</td>
              <td>${escapeHtml(player.lootCount ?? 0)}</td>
              <td>${escapeHtml(player.lastInputSeq)}</td>
            </tr>
          `;
        }
        html += '</table>';
        playersEl.innerHTML = html;
      }
    }

    // Counts
    const countsEl = document.getElementById('hud-counts');
    if (countsEl) {
      countsEl.innerHTML = `
        <div>子弹：${data.counts.bullets}</div>
        <div>世界物品：${data.counts.worldItems}</div>
        <div>掉落包：${data.counts.lootBags}</div>
      `;
    }

    // 新增: Nearby Interaction
    const nearbyEl = document.getElementById('hud-nearby');
    if (nearbyEl) {
      if (data.nearbyInteractable) {
        const { type, name, distance } = data.nearbyInteractable;
        const typeLabel = type === 'worldItem' ? '物品' : type === 'lootBag' ? '掉落包' : '撤离区';
        nearbyEl.innerHTML = `<div>${typeLabel}：${escapeHtml(name)} (${escapeHtml(distance.toFixed(1))}px)</div>`;
      } else {
        nearbyEl.innerHTML = '<div style="color: #999;">无</div>';
      }
    }

    // 新增: Inventory (In-Raid)
    const inventoryEl = document.getElementById('hud-inventory');
    if (inventoryEl) {
      if (data.inventory) {
        const items = data.inventory.items;
        if (items.length === 0) {
          inventoryEl.innerHTML = '<div>空</div>';
        } else {
          let html = `<div><strong>容量：</strong> ${items.length}/${data.inventory.bagCap}</div><ul>`;
          for (const item of items) {
            try {
              const itemType = getItemType(item.typeId);
              html += `<li>${escapeHtml(itemType.name)} x${escapeHtml(item.qty)}</li>`;
            } catch {
              html += `<li>${escapeHtml(item.typeId)} x${escapeHtml(item.qty)}</li>`;
            }
          }
          html += '</ul>';
          inventoryEl.innerHTML = html;
        }
      } else {
        inventoryEl.innerHTML = '<div>不可用</div>';
      }
    }

    // 新增: Stash (Out-of-Raid)
    const stashEl = document.getElementById('hud-stash');
    if (stashEl) {
      // 关键优化：只在 stash 数据真正变化时才重建 DOM（避免点击时按钮被销毁）
      const currentStashJson = JSON.stringify(data.stash || []);
      if (currentStashJson !== this.lastStashJson) {
        this.lastStashJson = currentStashJson;
        
        if (data.stash && data.stash.length > 0) {
          // 逐条显示每个 ItemInstance（不显示 Sell 按钮）
          let html = '<ul style="list-style: none; padding: 0; margin: 0;">';
          for (const item of data.stash) {
            try {
              const itemType = getItemType(item.typeId);
              const value = itemType.value * item.qty;
              html += `
                <li style="display:flex; justify-content:space-between; align-items:center; margin:4px 0; gap:8px;">
                  <span>${escapeHtml(itemType.name)} x${escapeHtml(item.qty)} ($${escapeHtml(value)})</span>
                </li>
              `;
            } catch {
              // 未知物品类型，仍然显示但标记为 Unknown
              html += `
                <li style="display:flex; justify-content:space-between; align-items:center; margin:4px 0; gap:8px;">
                  <span>${escapeHtml(item.typeId)} x${escapeHtml(item.qty)} (未知)</span>
                </li>
              `;
            }
          }
          html += '</ul>';
          stashEl.innerHTML = html;
        } else {
          stashEl.innerHTML = '<div>空</div>';
        }
      }
    }

    // 新增: Money
    const moneyEl = document.getElementById('hud-money');
    if (moneyEl) {
      if (data.money !== undefined) {
        moneyEl.innerHTML = `<div><strong>$${escapeHtml(data.money)}</strong></div>`;
      } else {
        moneyEl.innerHTML = '<div>不可用</div>';
      }
    }

    // Selected Entity
    const selectedEl = document.getElementById('hud-selected');
    if (selectedEl) {
      if (data.selectedEntity) {
        const e = data.selectedEntity;
        let statusText: string;
        if (e.status === 'ALIVE') statusText = '存活';
        else if (e.status === 'DEAD') statusText = '死亡';
        else if (e.status === 'EXTRACTED') statusText = '已撤离';
        else statusText = e.status;
        // 修复: 对选中实体数据使用 escapeHtml
        selectedEl.innerHTML = `
          <div><strong>ID：</strong> ${escapeHtml(e.id)}</div>
          <div><strong>位置：</strong> (${escapeHtml(e.x.toFixed(1))}, ${escapeHtml(e.y.toFixed(1))})</div>
          <div><strong>血量：</strong> ${escapeHtml(e.hp)}/100</div>
          <div><strong>状态：</strong> ${escapeHtml(statusText)}</div>
          <div><strong>战利品数量：</strong> ${escapeHtml(e.lootCount ?? 0)}</div>
          <div><strong>最后输入序号：</strong> ${escapeHtml(e.lastInputSeq)}</div>
          <div><strong>最后输入Tick：</strong> ${escapeHtml(e.lastInputTick)}</div>
        `;
      } else {
        selectedEl.innerHTML = '<div>无（点击玩家）</div>';
      }
    }

    // Events
    // 修复: Event Log 使用 DOM 节点 + textContent，完全避免 XSS
    const eventsEl = document.getElementById('hud-events');
    if (eventsEl) {
      // 清空现有内容
      eventsEl.textContent = '';
      
      // 为每个事件创建 DOM 节点
      for (const event of this.events) {
        const div = document.createElement('div');
        div.textContent = event; // 使用 textContent，自动转义
        eventsEl.appendChild(div);
      }
      
      // 滚动到底部
      eventsEl.scrollTop = eventsEl.scrollHeight;
    }
  }
}
