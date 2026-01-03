import type { PLAYER_STATE, S2C_SNAPSHOT } from '@jerkie-man/shared';

export interface HUDData {
  connection: {
    status: 'connected' | 'reconnecting' | 'disconnected';
    ping?: number; // Day1占位
    clientTime: number;
    lastServerTick: number;
  };
  players: PLAYER_STATE[];
  counts: {
    bullets: number;
    items: number;
  };
  selectedEntity: PLAYER_STATE | null;
  events: string[]; // 最近30条事件
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
      connectionEl.innerHTML = `
        <div>Status: ${data.connection.status}</div>
        <div>Client Time: ${new Date(data.connection.clientTime).toLocaleTimeString()}</div>
        <div>Last Server Tick: ${data.connection.lastServerTick}</div>
      `;
    }

    // Players
    const playersEl = document.getElementById('hud-players');
    if (playersEl) {
      if (data.players.length === 0) {
        playersEl.innerHTML = '<div>No players</div>';
      } else {
        let html = '<table><tr><th>ID</th><th>X</th><th>Y</th><th>HP</th><th>Status</th><th>Seq</th></tr>';
        for (const player of data.players) {
          html += `
            <tr>
              <td>${player.id.substring(0, 8)}</td>
              <td>${player.x.toFixed(1)}</td>
              <td>${player.y.toFixed(1)}</td>
              <td>${player.hp}</td>
              <td>${player.status}</td>
              <td>${player.lastInputSeq}</td>
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
        <div>Items: ${data.counts.items}</div>
      `;
    }

    // Selected Entity
    const selectedEl = document.getElementById('hud-selected');
    if (selectedEl) {
      if (data.selectedEntity) {
        const e = data.selectedEntity;
        selectedEl.innerHTML = `
          <div><strong>ID:</strong> ${e.id}</div>
          <div><strong>Position:</strong> (${e.x.toFixed(1)}, ${e.y.toFixed(1)})</div>
          <div><strong>HP:</strong> ${e.hp}/100</div>
          <div><strong>Status:</strong> ${e.status}</div>
          <div><strong>Last Input Seq:</strong> ${e.lastInputSeq}</div>
          <div><strong>Last Input Tick:</strong> ${e.lastInputTick}</div>
        `;
      } else {
        selectedEl.innerHTML = '<div>None (click on player)</div>';
      }
    }

    // Events
    const eventsEl = document.getElementById('hud-events');
    if (eventsEl) {
      eventsEl.innerHTML = this.events.map((e) => `<div>${e}</div>`).join('');
      // 滚动到底部
      eventsEl.scrollTop = eventsEl.scrollHeight;
    }
  }
}

