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

export interface HUDData {
  connection: {
    status: 'connected' | 'reconnecting' | 'disconnected';
    ping?: number; // Day1占位
    clientTime: number;
    lastServerTick: number;
    reconnectAttempts?: number; // P1-2 修复: 重连尝试次数
    nextReconnectInMs?: number | null; // P1-2 修复: 下次重连倒计时（毫秒）
    extractProgress?: number; // 游戏化增强: 本地玩家撤离进度（0-2000ms）
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
}

export class HUD {
  private container: HTMLElement;
  private events: string[] = [];
  private readonly maxEvents = 30;

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
      <h3>Connection</h3>
      <div id="hud-connection"></div>
      
      <h3>Players</h3>
      <div id="hud-players"></div>
      
      <h3>Counts</h3>
      <div id="hud-counts"></div>
      
      <h3>Inventory (In-Raid)</h3>
      <div id="hud-inventory"></div>
      
      <h3>Stash (Out-of-Raid)</h3>
      <div id="hud-stash"></div>
      
      <h3>Money</h3>
      <div id="hud-money"></div>
      
      <h3>Selected Entity</h3>
      <div id="hud-selected"></div>
      
      <h3>Event Log</h3>
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

  update(data: HUDData): void {
    // Connection
    const connectionEl = document.getElementById('hud-connection');
    if (connectionEl) {
      // P1-2 修复: 显示重连信息
      let statusDisplay: string = data.connection.status;
      if (data.connection.status === 'reconnecting') {
        const attempts = data.connection.reconnectAttempts ?? 0;
        const nextIn = data.connection.nextReconnectInMs;
        statusDisplay = `reconnecting (attempt ${attempts}${nextIn !== null ? `, next in ${nextIn}ms` : ''})`;
      }
      let extractProgressHtml = '';
      if (data.connection.extractProgress !== undefined && data.connection.extractProgress > 0) {
        const progressPercent = Math.min(100, (data.connection.extractProgress / 2000) * 100);
        // 修复: 使用 escapeHtml 防止 XSS
        extractProgressHtml = `<div><strong>Extract Progress:</strong> ${escapeHtml(progressPercent.toFixed(1))}% (${escapeHtml(data.connection.extractProgress)}/2000ms)</div>`;
      }
      // 修复: 使用 escapeHtml 防止 XSS（虽然 statusDisplay 是本地生成，但保持一致性）
      connectionEl.innerHTML = `
        <div><strong>Status:</strong> ${escapeHtml(statusDisplay)}</div>
        ${data.connection.ping !== undefined ? `<div><strong>Ping:</strong> ${escapeHtml(data.connection.ping)}ms</div>` : ''}
        <div><strong>Client Time:</strong> ${escapeHtml(new Date(data.connection.clientTime).toISOString())}</div>
        <div><strong>Last Server Tick:</strong> ${escapeHtml(data.connection.lastServerTick)}</div>
        ${extractProgressHtml}
      `;
    }

    // Players
    const playersEl = document.getElementById('hud-players');
    if (playersEl) {
      if (data.players.length === 0) {
        playersEl.innerHTML = '<div>No players</div>';
      } else {
        // 修复: 对玩家数据使用 escapeHtml（防止恶意 playerId 等字段注入）
        let html = '<table><tr><th>ID</th><th>X</th><th>Y</th><th>HP</th><th>Status</th><th>Loot</th><th>Seq</th></tr>';
        for (const player of data.players) {
          html += `
            <tr>
              <td>${escapeHtml(player.id.substring(0, 8))}</td>
              <td>${escapeHtml(player.x.toFixed(1))}</td>
              <td>${escapeHtml(player.y.toFixed(1))}</td>
              <td>${escapeHtml(player.hp)}</td>
              <td>${escapeHtml(player.status)}</td>
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
        <div>Bullets: ${data.counts.bullets}</div>
        <div>World Items: ${data.counts.worldItems}</div>
        <div>Loot Bags: ${data.counts.lootBags}</div>
      `;
    }

    // 新增: Inventory (In-Raid)
    const inventoryEl = document.getElementById('hud-inventory');
    if (inventoryEl) {
      if (data.inventory) {
        const items = data.inventory.items;
        if (items.length === 0) {
          inventoryEl.innerHTML = '<div>Empty</div>';
        } else {
          let html = `<div><strong>Capacity:</strong> ${items.length}/${data.inventory.bagCap}</div><ul>`;
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
        inventoryEl.innerHTML = '<div>Not available</div>';
      }
    }

    // 新增: Stash (Out-of-Raid)
    const stashEl = document.getElementById('hud-stash');
    if (stashEl) {
      if (data.stash && data.stash.length > 0) {
        // 按 typeId 聚合显示
        const stashMap = new Map<string, number>();
        for (const item of data.stash) {
          stashMap.set(item.typeId, (stashMap.get(item.typeId) || 0) + item.qty);
        }
        let html = '<ul>';
        for (const [typeId, qty] of stashMap.entries()) {
          try {
            const itemType = getItemType(typeId);
            html += `<li>${escapeHtml(itemType.name)} x${escapeHtml(qty)}</li>`;
          } catch {
            html += `<li>${escapeHtml(typeId)} x${escapeHtml(qty)}</li>`;
          }
        }
        html += '</ul>';
        stashEl.innerHTML = html;
      } else {
        stashEl.innerHTML = '<div>Empty</div>';
      }
    }

    // 新增: Money
    const moneyEl = document.getElementById('hud-money');
    if (moneyEl) {
      if (data.money !== undefined) {
        moneyEl.innerHTML = `<div><strong>${escapeHtml(data.money)}</strong></div>`;
      } else {
        moneyEl.innerHTML = '<div>Not available</div>';
      }
    }

    // Selected Entity
    const selectedEl = document.getElementById('hud-selected');
    if (selectedEl) {
      if (data.selectedEntity) {
        const e = data.selectedEntity;
        // 修复: 对选中实体数据使用 escapeHtml
        selectedEl.innerHTML = `
          <div><strong>ID:</strong> ${escapeHtml(e.id)}</div>
          <div><strong>Position:</strong> (${escapeHtml(e.x.toFixed(1))}, ${escapeHtml(e.y.toFixed(1))})</div>
          <div><strong>HP:</strong> ${escapeHtml(e.hp)}/100</div>
          <div><strong>Status:</strong> ${escapeHtml(e.status)}</div>
          <div><strong>Loot Count:</strong> ${escapeHtml(e.lootCount ?? 0)}</div>
          <div><strong>Last Input Seq:</strong> ${escapeHtml(e.lastInputSeq)}</div>
          <div><strong>Last Input Tick:</strong> ${escapeHtml(e.lastInputTick)}</div>
        `;
      } else {
        selectedEl.innerHTML = '<div>None (click on player)</div>';
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
