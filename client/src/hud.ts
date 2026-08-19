import type {
  PLAYER_STATE,
  PlayerInventory,
  ItemInstance,
  COMBAT_ACTOR,
  COMBAT_WEAPON,
} from '@ziyang-protocol/shared';
import {
  getItemType,
  getWeaponDef,
  ticksToMs,
  EXTRACT_DURATION_MS,
  t,
  itemName,
  rarityLabel,
  combatActorName,
  combatWeaponName,
  hasKey,
  onLocaleChange,
} from '@ziyang-protocol/shared';

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

/**
 * 调试面板里可能出现任意服务端 typeId。
 * 有翻译就用翻译，没有就直接显示 id（比显示 "item.xxx.name" 更有用）。
 */
function displayItemName(typeId: string): string {
  return hasKey(`item.${typeId}.name`) ? itemName(typeId) : typeId;
}

/** 玩家/实体状态词的唯一来源，避免各处出现「死亡」「阵亡」两套说法 */
function stateLabel(status: PLAYER_STATE['status']): string {
  if (status === 'ALIVE') return t('hud.state.alive');
  if (status === 'DEAD') return t('hud.state.dead');
  if (status === 'EXTRACTED') return t('hud.state.extracted');
  return status;
}

/** 字段行：加粗标签 + 值（标签不带冒号，见 docs/LOCALIZATION.md §2） */
function field(label: string, value: string): string {
  return `<div><strong>${label}</strong> ${value}</div>`;
}

// 英文比中文宽 40-60%，面板固定 300px，表格统一降到 11px 并禁止数值列换行
const TABLE_STYLE = 'font-size: 11px;';
const NOWRAP = 'white-space: nowrap;';

// HUDActions 接口已移除（不再需要 Sell 按钮）

export interface HUDData {
  connection: {
    status: 'connected' | 'reconnecting' | 'disconnected';
    ping?: number; // Day1占位
    clientTime: number;
    lastServerTick: number;
    reconnectAttempts?: number; // P1-2 修复: 重连尝试次数
    nextReconnectInMs?: number | null; // P1-2 修复: 下次重连倒计时（毫秒）
    extractProgress?: number; // 游戏化增强: 本地玩家撤离进度（0到EXTRACT_DURATION_MS）
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
  private unsubscribeLocale: () => void;

  constructor(containerId: string) {
    const container = document.getElementById(containerId);
    if (!container) {
      throw new Error(`HUD container not found: ${containerId}`);
    }
    this.container = container;
    this.createHUD();
    // 切换语言时只改标题文字（不能重建容器：main.ts 在 #hud-inventory 上挂了丢弃按钮的
    // 事件委托，重建会丢监听），并让带缓存的分区（背包/事件）强制重绘
    this.unsubscribeLocale = onLocaleChange(() => {
      this.refreshSectionTitles();
      this.lastInventorySignature = null;
      this.lastRenderedEventCount = -1;
    });
  }

  private createHUD(): void {
    this.container.innerHTML = `
      <h3 data-i18n="hud.section.connection"></h3>
      <div id="hud-connection"></div>

      <h3 data-i18n="hud.section.players"></h3>
      <div id="hud-players"></div>

      <h3 data-i18n="hud.section.counts"></h3>
      <div id="hud-counts"></div>

      <h3 data-i18n="hud.section.status"></h3>
      <div id="hud-status"></div>

      <h3 data-i18n="hud.section.nearby"></h3>
      <div id="hud-nearby" style="color: #4CAF50; font-weight: bold;"></div>

      <h3 data-i18n="hud.section.inventory"></h3>
      <div id="hud-inventory"></div>

      <h3 data-i18n="hud.section.selected"></h3>
      <div id="hud-selected"></div>

      <h3 data-i18n="hud.section.events"></h3>
      <div id="hud-events" class="event-log"></div>
    `;
    this.refreshSectionTitles();
  }

  /** 用当前语言刷新分区标题，保留所有子节点和已绑定的监听 */
  private refreshSectionTitles(): void {
    const titles = this.container.querySelectorAll<HTMLElement>('h3[data-i18n]');
    titles.forEach((el) => {
      const key = el.dataset.i18n;
      if (key) el.textContent = t(key);
    });
  }

  addEvent(event: string): void {
    const timestamp = new Date().toLocaleTimeString();
    this.events.push(`[${timestamp}] ${event}`);
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }
  }

  /** 取消语言订阅（HUD 生命周期与页面一致，通常无需调用） */
  dispose(): void {
    this.unsubscribeLocale();
  }

  // bindStashEvents 方法已移除（不再需要 Sell 按钮）

  update(data: HUDData): void {
    // Connection
    const connectionEl = document.getElementById('hud-connection');
    if (connectionEl) {
      // P1-2 修复: 显示重连信息
      let statusDisplay: string = data.connection.status;
      if (data.connection.status === 'connected') {
        statusDisplay = t('hud.connection.connected');
      } else if (data.connection.status === 'reconnecting') {
        const attempt = data.connection.reconnectAttempts ?? 0;
        const nextIn = data.connection.nextReconnectInMs;
        statusDisplay =
          nextIn !== null && nextIn !== undefined
            ? t('hud.connection.reconnectingRetry', { attempt, ms: nextIn })
            : t('hud.connection.reconnecting', { attempt });
      } else if (data.connection.status === 'disconnected') {
        statusDisplay = t('hud.connection.disconnected');
      }
      let extractProgressHtml = '';
      if (data.connection.extractProgress !== undefined && data.connection.extractProgress > 0) {
        const progressPercent = Math.min(100, (data.connection.extractProgress / EXTRACT_DURATION_MS) * 100);
        // 修复: 使用 escapeHtml 防止 XSS
        extractProgressHtml = field(
          t('hud.field.extraction'),
          `${escapeHtml(progressPercent.toFixed(1))}% (${escapeHtml(data.connection.extractProgress)}/${EXTRACT_DURATION_MS}ms)`
        );
      }
      // 修复: 使用 escapeHtml 防止 XSS（虽然 statusDisplay 是本地生成，但保持一致性）
      connectionEl.innerHTML = `
        ${field(t('hud.field.status'), escapeHtml(statusDisplay))}
        ${data.connection.ping !== undefined ? field(t('hud.field.ping'), `${escapeHtml(data.connection.ping)}ms`) : ''}
        ${data.connection.accountId ? field(t('hud.field.account'), `${escapeHtml(data.connection.accountId.substring(0, 8))}...`) : ''}
        ${field(t('hud.field.clientTime'), escapeHtml(new Date(data.connection.clientTime).toISOString()))}
        ${field(t('hud.field.serverTick'), escapeHtml(data.connection.lastServerTick))}
        ${extractProgressHtml}
      `;
    }

    // Players
    const playersEl = document.getElementById('hud-players');
    if (playersEl) {
      if (data.players.length === 0) {
        playersEl.innerHTML = `<div>${t('hud.players.empty')}</div>`;
      } else {
        // 修复: 对玩家数据使用 escapeHtml（防止恶意 playerId 等字段注入）
        let html =
          `<table style="${TABLE_STYLE}"><tr>` +
          `<th>${t('hud.players.col.name')}</th>` +
          `<th style="${NOWRAP}">${t('hud.players.col.hp')}</th>` +
          `<th style="${NOWRAP}">${t('hud.players.col.pos')}</th>` +
          `<th style="${NOWRAP}">${t('hud.players.col.status')}</th>` +
          `</tr>`;
        for (const player of data.players) {
          const statusText = stateLabel(player.status);
          const displayName = player.name && player.name.trim().length > 0 ? player.name : player.id.substring(0, 8);
          const coordText = `(${player.x.toFixed(1)}, ${player.y.toFixed(1)})`;
          html += `
            <tr>
              <td>${escapeHtml(displayName)}</td>
              <td style="${NOWRAP}">${escapeHtml(player.hp)}</td>
              <td style="${NOWRAP}">${escapeHtml(coordText)}</td>
              <td style="${NOWRAP}">${escapeHtml(statusText)}</td>
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
        ${field(t('hud.counts.bullets'), String(data.counts.bullets))}
        ${field(t('hud.counts.worldItems'), String(data.counts.worldItems))}
        ${field(t('hud.counts.lootBags'), String(data.counts.lootBags))}
      `;
    }

    // Status (Local Player)
    const statusEl = document.getElementById('hud-status');
    if (statusEl) {
      const local = data.localPlayer;
      if (!local) {
        statusEl.innerHTML = `<div>${t('hud.status.notInRaid')}</div>`;
      } else {
        const hp = local.hp;
        let hpLabel = t('hud.status.hp.healthy');
        if (hp <= 20) hpLabel = t('hud.status.hp.critical');
        else if (hp <= 40) hpLabel = t('hud.status.hp.wounded');
        else if (hp <= 70) hpLabel = t('hud.status.hp.hurt');

        const statusText = stateLabel(local.status);
        let extraStatus = '';
        if (local.status === 'DEAD' && local.killedBy) {
          const weaponSuffix = local.killedByWeapon
            ? ` (${escapeHtml(combatWeaponName(local.killedByWeapon))})`
            : '';
          extraStatus = field(
            t('hud.field.killedBy'),
            `${escapeHtml(combatActorName(local.killedBy))}${weaponSuffix}`
          );
        }

        let weaponName = t('hud.status.fists');
        let ammoLine = '';
        let reloadLine = '';
        let cooldownLine = '';
        if (local.weaponRuntime) {
          weaponName = displayItemName(local.weaponRuntime.weaponTypeId);
          try {
            const weaponDef = getWeaponDef(local.weaponRuntime.weaponTypeId);
            if (weaponDef.magSize > 0) {
              ammoLine = field(
                t('hud.field.mag'),
                `${escapeHtml(local.weaponRuntime.ammoInMag)}/${escapeHtml(weaponDef.magSize)}`
              );
            }
          } catch {
            // 未知武器类型：只显示 typeId，不显示弹匣
          }
          const reloadRemaining = local.weaponRuntime.reloadingUntilTick - data.connection.lastServerTick;
          if (reloadRemaining > 0) {
            reloadLine = field(t('hud.field.reloading'), `${escapeHtml(ticksToMs(reloadRemaining))}ms`);
          }
          const cooldownRemaining = local.weaponRuntime.nextFireTick - data.connection.lastServerTick;
          if (cooldownRemaining > 0) {
            cooldownLine = field(t('hud.field.cooldown'), `${escapeHtml(ticksToMs(cooldownRemaining))}ms`);
          }
        }

        // 新增: 道具读条提示（例如急救包使用中）
        let usingItemLine = '';
        if (local.usingItemTypeId) {
          const usedName = escapeHtml(displayItemName(local.usingItemTypeId));
          if (local.usingItemRemainingMs !== undefined && local.usingItemTotalMs !== undefined) {
            const percent = Math.max(
              0,
              Math.min(100, ((local.usingItemTotalMs - local.usingItemRemainingMs) / local.usingItemTotalMs) * 100)
            );
            usingItemLine = field(t('hud.field.using'), `${usedName} (${escapeHtml(percent.toFixed(0))}%)`);
          } else {
            usingItemLine = field(t('hud.field.using'), usedName);
          }
        }

        statusEl.innerHTML = `
          ${field(t('hud.field.status'), escapeHtml(statusText))}
          ${field(t('hud.field.health'), `${escapeHtml(hp)}/100 (${escapeHtml(hpLabel)})`)}
          ${field(t('hud.field.weapon'), escapeHtml(weaponName))}
          ${ammoLine}
          ${reloadLine}
          ${cooldownLine}
          ${usingItemLine}
          ${extraStatus}
        `;
      }
    }

    // 新增: Nearby Interaction
    // 注意：E 只能拾取物品/掉落包；撤离是站进区域后自动读条，不需要按键。
    // 所以交互方式写在每一项自己的提示里，标题不再统一写「按E」。
    const nearbyEl = document.getElementById('hud-nearby');
    if (nearbyEl) {
      if (data.nearbyInteractable) {
        const { type, name, distance } = data.nearbyInteractable;
        const typeKey = type === 'worldItem' ? 'item' : type === 'lootBag' ? 'lootBag' : 'extractZone';
        const typeLabel = t(`hud.nearby.${typeKey}`);
        const hint = t(`hud.nearby.${typeKey}.hint`);
        // 撤离区没有有意义的实例名（main.ts 传的是固定字符串），只显示分类名+距离
        const detail = type === 'extractZone' ? '' : ` · ${escapeHtml(name)}`;
        nearbyEl.innerHTML = `
          <div>${typeLabel}${detail} (${escapeHtml(distance.toFixed(1))}px)</div>
          <div style="font-weight: normal; color: #8fbf8f;">${hint}</div>
        `;
      } else {
        nearbyEl.innerHTML = `<div style="color: #999;">${t('hud.nearby.none')}</div>`;
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
            inventoryEl.innerHTML = `<div>${t('hud.inventory.empty')}</div>`;
          } else {
            let totalValue = 0;
            let rows = '';
            for (const item of items) {
              const displayName = displayItemName(item.typeId);
              let rarityText = t('hud.unknown');
              let rarityColor = '#888';
              // 未知 typeId 时数值列用破折号，比塞一个长单词更省列宽
              let valueText = '—';
              let stackableText = '—';
              try {
                const itemType = getItemType(item.typeId);
                rarityText = rarityLabel(itemType.rarity);
                if (itemType.rarity === 'COMMON') {
                  rarityColor = '#aaa';
                } else if (itemType.rarity === 'RARE') {
                  rarityColor = '#4CAF50';
                } else if (itemType.rarity === 'EPIC') {
                  rarityColor = '#9d4edd';
                } else if (itemType.rarity === 'LEGENDARY') {
                  rarityColor = '#ffaa00';
                }
                const itemValue = itemType.value * item.qty;
                totalValue += itemValue;
                valueText = `$${itemValue}`;
                stackableText =
                  itemType.stackMax > 1
                    ? t('hud.inventory.stack.max', { max: itemType.stackMax })
                    : t('hud.inventory.stack.none');
              } catch {
                // 未知物品类型：只显示 typeId 和破折号
              }
              rows += `
                <tr>
                  <td>${escapeHtml(displayName)}</td>
                  <td style="color: ${rarityColor}; font-weight: bold; ${NOWRAP}">${escapeHtml(rarityText)}</td>
                  <td style="${NOWRAP}">x${escapeHtml(item.qty)}</td>
                  <td style="color: #ffd700; font-weight: bold; ${NOWRAP}">${escapeHtml(valueText)}</td>
                  <td style="${NOWRAP}">${escapeHtml(stackableText)}</td>
                  <td style="${NOWRAP}"><button class="item-btn hud-drop-btn" data-iid="${escapeHtml(item.iid)}" data-qty="${escapeHtml(item.qty)}">${t('hud.inventory.drop')}</button></td>
                </tr>
              `;
            }
            const totalQty = items.reduce((sum: number, entry: ItemInstance) => sum + entry.qty, 0);
            const capacityValue =
              `${escapeHtml(items.length)}/${escapeHtml(data.inventory.bagCap)} ` +
              `<span style="color: #666;">| ${t('hud.inventory.total', { count: totalQty })}</span>`;
            const html = `
              ${field(t('hud.field.capacity'), capacityValue)}
              ${field(
                t('hud.field.totalValue'),
                `<span style="color: #ffd700; font-weight: bold;">$${escapeHtml(totalValue)}</span>`
              )}
              <table style="${TABLE_STYLE}">
                <tr>
                  <th>${t('hud.inventory.col.item')}</th>
                  <th style="${NOWRAP}">${t('hud.inventory.col.rarity')}</th>
                  <th style="${NOWRAP}">${t('hud.inventory.col.qty')}</th>
                  <th style="${NOWRAP}">${t('hud.inventory.col.value')}</th>
                  <th style="${NOWRAP}">${t('hud.inventory.col.stack')}</th>
                  <th></th>
                </tr>
                ${rows}
              </table>
            `;
            inventoryEl.innerHTML = html;
          }
        } else {
          inventoryEl.innerHTML = `<div>${t('hud.inventory.unavailable')}</div>`;
        }
      }
    }

    // Selected Entity
    const selectedEl = document.getElementById('hud-selected');
    if (selectedEl) {
      if (data.selectedEntity) {
        const e = data.selectedEntity;
        const statusText = stateLabel(e.status);
        // 修复: 对选中实体数据使用 escapeHtml
        selectedEl.innerHTML = `
          ${field(t('hud.field.id'), escapeHtml(e.id))}
          ${field(t('hud.field.position'), `(${escapeHtml(e.x.toFixed(1))}, ${escapeHtml(e.y.toFixed(1))})`)}
          ${field(t('hud.field.health'), `${escapeHtml(e.hp)}/100`)}
          ${field(t('hud.field.status'), escapeHtml(statusText))}
          ${field(t('hud.field.loot'), escapeHtml(e.lootCount ?? 0))}
          ${field(t('hud.field.lastInputSeq'), escapeHtml(e.lastInputSeq))}
          ${field(t('hud.field.lastInputTick'), escapeHtml(e.lastInputTick))}
        `;
      } else {
        selectedEl.innerHTML = `<div>${t('hud.selected.none')}</div>`;
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
