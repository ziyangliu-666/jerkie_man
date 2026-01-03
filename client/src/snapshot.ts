import type { S2C_SNAPSHOT, PLAYER_STATE, BULLET_STATE, ITEM_STATE } from '@jerkie-man/shared';
import { lerp } from '@jerkie-man/shared';

interface SnapshotEntry {
  snapshot: S2C_SNAPSHOT;
  receivedAt: number; // 客户端接收时间戳
}

export class SnapshotBuffer {
  private buffer: SnapshotEntry[] = [];
  private readonly maxSize = 10; // 保留最近10条（约1秒）

  add(snapshot: S2C_SNAPSHOT): void {
    const entry: SnapshotEntry = {
      snapshot,
      receivedAt: Date.now(),
    };

    this.buffer.push(entry);

    // 保持buffer大小
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }

    // 按timestamp排序（确保顺序）
    this.buffer.sort((a, b) => a.snapshot.timestamp - b.snapshot.timestamp);
  }

  // 获取插值后的状态
  getInterpolatedState(renderDelay: number = 120): {
    players: PLAYER_STATE[];
    bullets: BULLET_STATE[];
    items: ITEM_STATE[];
  } {
    const now = Date.now();
    const renderTime = now - renderDelay; // 120ms延迟补偿

    if (this.buffer.length === 0) {
      return { players: [], bullets: [], items: [] };
    }

    if (this.buffer.length === 1) {
      return {
        players: this.buffer[0].snapshot.players,
        bullets: this.buffer[0].snapshot.bullets,
        items: this.buffer[0].snapshot.items,
      };
    }

    // 找到t0（<=renderTime）和t1（>renderTime）
    let t0: SnapshotEntry | null = null;
    let t1: SnapshotEntry | null = null;

    for (let i = 0; i < this.buffer.length - 1; i++) {
      const a = this.buffer[i];
      const b = this.buffer[i + 1];

      // 使用server的timestamp（不是receivedAt）
      if (a.snapshot.timestamp <= renderTime && b.snapshot.timestamp > renderTime) {
        t0 = a;
        t1 = b;
        break;
      }
    }

    // 如果找不到，使用最新的
    if (!t0 || !t1) {
      const latest = this.buffer[this.buffer.length - 1];
      return {
        players: latest.snapshot.players,
        bullets: latest.snapshot.bullets,
        items: latest.snapshot.items,
      };
    }

    // 计算插值alpha
    const timeRange = t1.snapshot.timestamp - t0.snapshot.timestamp;
    const alpha = timeRange > 0 ? (renderTime - t0.snapshot.timestamp) / timeRange : 0;
    const clampedAlpha = Math.max(0, Math.min(1, alpha));

    // 插值玩家位置
    const interpolatedPlayers: PLAYER_STATE[] = [];
    const playerMap0 = new Map(t0.snapshot.players.map((p) => [p.id, p]));
    const playerMap1 = new Map(t1.snapshot.players.map((p) => [p.id, p]));

    // 合并所有玩家ID
    const allPlayerIds = new Set([
      ...t0.snapshot.players.map((p) => p.id),
      ...t1.snapshot.players.map((p) => p.id),
    ]);

    for (const id of allPlayerIds) {
      const p0 = playerMap0.get(id);
      const p1 = playerMap1.get(id);

      if (p0 && p1) {
        // 两个快照都有，插值
        interpolatedPlayers.push({
          ...p0,
          x: lerp(p0.x, p1.x, clampedAlpha),
          y: lerp(p0.y, p1.y, clampedAlpha),
        });
      } else if (p0) {
        // 只有t0有
        interpolatedPlayers.push(p0);
      } else if (p1) {
        // 只有t1有
        interpolatedPlayers.push(p1);
      }
    }

    // Day1子弹和物品不做插值（占位）
    return {
      players: interpolatedPlayers,
      bullets: t1.snapshot.bullets,
      items: t1.snapshot.items,
    };
  }

  getLatest(): S2C_SNAPSHOT | null {
    return this.buffer.length > 0 ? this.buffer[this.buffer.length - 1].snapshot : null;
  }
}

