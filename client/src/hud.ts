import type { PLAYER_STATE, PlayerInventory, ItemInstance } from '@jerkie-man/shared';
import { getItemType, getWeaponDef, ticksToMs } from '@jerkie-man/shared';

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
    extractProgress?: number; // 游戏化增强: 本地玩家撤离进度（0-10000ms，10秒）
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
  localPlayer?: PLAYER_STATE | null;
}

export class HUD {
  private container: HTMLElement;
  private events: string[] = [];
  private readonly maxEvents = 30;
  private lastInventorySignature: string | null = null;
  // 性能优化: 缓存上次渲染的事件数量，只在有新事件时才更新 DOM
  private lastRenderedEventCount: number = 0;

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

      <h3>战斗状态</h3>
      <div id="hud-status"></div>
      
      <h3>附近交互（按E）</h3>
      <div id="hud-nearby" style="color: #4CAF50; font-weight: bold;"></div>
      
      <h3>背包（局内）</h3>
      <div id="hud-inventory"></div>
      
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
        const progressPercent = Math.min(100, (data.connection.extractProgress / 10000) * 100);
        // 修复: 使用 escapeHtml 防止 XSS
        extractProgressHtml = `<div><strong>撤离进度：</strong> ${escapeHtml(progressPercent.toFixed(1))}% (${escapeHtml(data.connection.extractProgress)}/10000ms)</div>`;
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
        let html = '<table><tr><th>名字</th><th>血量</th><th>坐标</th><th>状态</th></tr>';
        for (const player of data.players) {
          let statusText: string;
          if (player.status === 'ALIVE') statusText = '存活';
          else if (player.status === 'DEAD') statusText = '死亡';
          else if (player.status === 'EXTRACTED') statusText = '已撤离';
          else statusText = player.status;
          const displayName = player.name && player.name.trim().length > 0 ? player.name : player.id.substring(0, 8);
          const coordText = `(${player.x.toFixed(1)}, ${player.y.toFixed(1)})`;
          html += `
            <tr>
              <td>${escapeHtml(displayName)}</td>
              <td>${escapeHtml(player.hp)}</td>
              <td>${escapeHtml(coordText)}</td>
              <td>${escapeHtml(statusText)}</td>
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

    // Status (Local Player)
    const statusEl = document.getElementById('hud-status');
    if (statusEl) {
      const local = data.localPlayer;
      if (!local) {
        statusEl.innerHTML = '<div>未进入战局</div>';
      } else {
        const hp = local.hp;
        let hpLabel = '良好';
        if (hp <= 20) hpLabel = '危急';
        else if (hp <= 40) hpLabel = '重伤';
        else if (hp <= 70) hpLabel = '轻伤';

        let statusText = local.status === 'ALIVE' ? '存活' : local.status === 'DEAD' ? '阵亡' : '已撤离';
        let extraStatus = '';
        if (local.status === 'DEAD' && local.killedBy) {
          const weaponName = local.killedByWeaponName ? `（${escapeHtml(local.killedByWeaponName)}）` : '';
          extraStatus = `<div><strong>击杀来源：</strong> ${escapeHtml(local.killedBy)}${weaponName}</div>`;
        }

        let weaponName = '空手';
        let ammoLine = '';
        let reloadLine = '';
        let cooldownLine = '';
        if (local.weaponRuntime) {
          try {
            const weaponDef = getWeaponDef(local.weaponRuntime.weaponTypeId);
            weaponName = weaponDef.name;
            if (weaponDef.magSize > 0) {
              ammoLine = `<div><strong>弹匣：</strong> ${escapeHtml(local.weaponRuntime.ammoInMag)}/${escapeHtml(weaponDef.magSize)}</div>`;
            }
          } catch {
            weaponName = local.weaponRuntime.weaponTypeId;
          }
          const reloadRemaining = local.weaponRuntime.reloadingUntilTick - data.connection.lastServerTick;
          if (reloadRemaining > 0) {
            reloadLine = `<div><strong>换弹：</strong> 进行中（${escapeHtml(ticksToMs(reloadRemaining))}ms）</div>`;
          }
          const cooldownRemaining = local.weaponRuntime.nextFireTick - data.connection.lastServerTick;
          if (cooldownRemaining > 0) {
            cooldownLine = `<div><strong>冷却：</strong> ${escapeHtml(ticksToMs(cooldownRemaining))}ms</div>`;
          }
        }

        // 新增: 道具读条提示（例如急救包使用中）
        let usingItemLine = '';
        if (local.usingItemTypeId && local.usingItemRemainingMs !== undefined && local.usingItemTotalMs !== undefined) {
          try {
            const itemType = getItemType(local.usingItemTypeId);
            const percent = Math.max(
              0,
              Math.min(100, ((local.usingItemTotalMs - local.usingItemRemainingMs) / local.usingItemTotalMs) * 100)
            );
            usingItemLine = `<div><strong>道具：</strong> 正在使用 ${escapeHtml(
              itemType.name
            )}（${escapeHtml(percent.toFixed(0))}%）</div>`;
          } catch {
            usingItemLine = `<div><strong>道具：</strong> 正在使用 ${escapeHtml(
              local.usingItemTypeId
            )}</div>`;
          }
        }

        statusEl.innerHTML = `
          <div><strong>状态：</strong> ${escapeHtml(statusText)}</div>
          <div><strong>生命：</strong> ${escapeHtml(hp)}/100（${escapeHtml(hpLabel)}）</div>
          <div><strong>武器：</strong> ${escapeHtml(weaponName)}</div>
          ${ammoLine}
          ${reloadLine}
          ${cooldownLine}
          ${usingItemLine}
          ${extraStatus}
        `;
      }
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
      const inventorySignature = data.inventory
        ? `${data.inventory.bagCap}|${data.inventory.items
            .map((item: ItemInstance) => `${item.iid}:${item.typeId}:${item.qty}`)
            .join(',')}`
        : 'none';

      if (inventorySignature !== this.lastInventorySignature) {
        this.lastInventorySignature = inventorySignature;
        if (data.inventory) {
          const items = data.inventory.items;
          if (items.length === 0) {
            inventoryEl.innerHTML = '<div>空</div>';
          } else {
            let totalValue = 0;
            let rows = '';
            for (const item of items) {
              let itemName = item.typeId;
              let rarityLabel = '未知';
              let rarityColor = '#888';
              let valueText = '未知';
              let stackableText = '未知';
              try {
                const itemType = getItemType(item.typeId);
                itemName = itemType.name;
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
                const itemValue = itemType.value * item.qty;
                totalValue += itemValue;
                valueText = `$${itemValue}`;
                stackableText = itemType.stackMax > 1 ? `可堆叠(${itemType.stackMax})` : '不可堆叠';
              } catch {
                itemName = item.typeId;
              }
              rows += `
                <tr>
                  <td>${escapeHtml(itemName)}</td>
                  <td style="color: ${rarityColor}; font-weight: bold;">${escapeHtml(rarityLabel)}</td>
                  <td>x${escapeHtml(item.qty)}</td>
                  <td style="color: #ffd700; font-weight: bold;">${escapeHtml(valueText)}</td>
                  <td>${escapeHtml(stackableText)}</td>
                  <td><button class="item-btn hud-drop-btn" data-iid="${escapeHtml(item.iid)}" data-qty="${escapeHtml(item.qty)}">丢弃</button></td>
                </tr>
              `;
            }
            const totalQty = items.reduce((sum: number, entry: ItemInstance) => sum + entry.qty, 0);
            let html = `
              <div><strong>容量：</strong> ${escapeHtml(items.length)}/${escapeHtml(data.inventory.bagCap)} <span style="color: #666;">| 总数 ${escapeHtml(totalQty)}</span></div>
              <div><strong>总价值：</strong> <span style="color: #ffd700; font-weight: bold;">$${escapeHtml(totalValue)}</span></div>
              <table>
                <tr><th>物品</th><th>稀有度</th><th>数量</th><th>价格</th><th>堆叠</th><th>操作</th></tr>
                ${rows}
              </table>
            `;
            inventoryEl.innerHTML = html;
          }
        } else {
          inventoryEl.innerHTML = '<div>不可用</div>';
        }
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
    // 性能优化: 只在有新事件时才更新 DOM，避免每帧重建所有节点
    const eventsEl = document.getElementById('hud-events');
    if (eventsEl) {
      const currentEventCount = this.events.length;
      
      // 只在事件数量变化时才更新（新增事件或事件被移除）
      if (currentEventCount !== this.lastRenderedEventCount) {
        // 清空现有内容
        eventsEl.textContent = '';
        
        // 为每个事件创建 DOM 节点
        for (const event of this.events) {
          const div = document.createElement('div');
          div.textContent = event; // 使用 textContent，自动转义
          eventsEl.appendChild(div);
        }
        
        // 滚动到底部（只在有新事件时才滚动，避免频繁 reflow）
        eventsEl.scrollTop = eventsEl.scrollHeight;
        
        this.lastRenderedEventCount = currentEventCount;
      }
    }
  }
}
