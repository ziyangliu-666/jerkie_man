import type { S2C_SNAPSHOT, PLAYER_STATE, BULLET_STATE, ITEM_STATE, WorldItem, LootBag, OBSTACLE_STATE, DECOY_STATE } from '@jerkie-man/shared';
import { lerp } from '@jerkie-man/shared';

interface SnapshotEntry {
  snapshot: S2C_SNAPSHOT;
  receivedAt: number; // 客户端接收时间戳
}

export class SnapshotBuffer {
  private buffer: SnapshotEntry[] = [];
  private readonly maxSize = 10; // 保留最近10条（约1秒）
  
  // P0-1: 服务器时间偏移估计（serverNow - clientNow）
  // 用于跨机器时钟偏移补偿，避免插值时找不到t0/t1或alpha跳变
  private serverOffsetMs = 0;

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
    
    // P0-1: 更新服务器时间偏移估计（平滑更新，避免单次抖动）
    // snapshot.timestamp是服务器发送时的时间戳（server时间域）
    // Date.now()是客户端当前时间（client时间域）
    // offsetNow = serverNow - clientNow，即服务器时间比客户端快多少
    const offsetNow = snapshot.timestamp - Date.now();
    // 使用指数移动平均（90%旧值 + 10%新值）平滑更新，避免网络抖动影响
    this.serverOffsetMs = this.serverOffsetMs * 0.9 + offsetNow * 0.1;
  }

  // 获取插值后的状态
  getInterpolatedState(renderDelay: number = 120): {
    players: PLAYER_STATE[];
    bullets: BULLET_STATE[];
    items: ITEM_STATE[];
    worldItems: WorldItem[];
    lootBags: LootBag[];
    obstacles?: OBSTACLE_STATE[];
    ais: any[];
    decoys?: DECOY_STATE[];
  } {
    // P0-1: 使用服务器时间域计算renderTime，避免跨机器时钟偏移导致插值失败
    // 将客户端时间转换为服务器时间域：clientNow + offset = serverNow
    const clientNow = Date.now();
    const serverNow = clientNow + this.serverOffsetMs;
    // renderTime是服务器时间域中的目标渲染时间点（考虑延迟补偿）
    const renderTimeServer = serverNow - renderDelay;

    if (this.buffer.length === 0) {
      return { players: [], bullets: [], items: [], worldItems: [], lootBags: [], obstacles: [], ais: [], decoys: [] };
    }

    if (this.buffer.length === 1) {
      return {
        players: this.buffer[0].snapshot.players,
        bullets: this.buffer[0].snapshot.bullets,
        items: this.buffer[0].snapshot.items ?? [],
        worldItems: this.buffer[0].snapshot.worldItems ?? [],
        lootBags: this.buffer[0].snapshot.lootBags ?? [],
        obstacles: this.buffer[0].snapshot.obstacles ?? [],
        ais: this.buffer[0].snapshot.ais ?? [],
        decoys: this.buffer[0].snapshot.decoys ?? [],
      };
    }

    // 找到t0（<=renderTimeServer）和t1（>renderTimeServer）
    // 注意：所有时间比较都在服务器时间域中进行
    let t0: SnapshotEntry | null = null;
    let t1: SnapshotEntry | null = null;

    for (let i = 0; i < this.buffer.length - 1; i++) {
      const a = this.buffer[i];
      const b = this.buffer[i + 1];

      // 使用server的timestamp（服务器时间域），与renderTimeServer比较
      if (a.snapshot.timestamp <= renderTimeServer && b.snapshot.timestamp > renderTimeServer) {
        t0 = a;
        t1 = b;
        break;
      }
    }

    // 修复插值退化：找不到 t0/t1 时，用最后两帧作为 t0/t1（允许轻微外推）
    if (!t0 || !t1) {
      if (this.buffer.length >= 2) {
        // 用最后两帧做外推
        t0 = this.buffer[this.buffer.length - 2];
        t1 = this.buffer[this.buffer.length - 1];
      } else {
        // 只有一帧，无法插值
        const latest = this.buffer[this.buffer.length - 1];
        return {
          players: latest.snapshot.players,
          bullets: latest.snapshot.bullets,
          items: latest.snapshot.items ?? [],
          worldItems: latest.snapshot.worldItems ?? [],
          lootBags: latest.snapshot.lootBags ?? [],
          obstacles: latest.snapshot.obstacles ?? [],
          ais: latest.snapshot.ais ?? [],
          decoys: latest.snapshot.decoys ?? [],
        };
      }
    }

    // 计算插值alpha（在服务器时间域中计算）
    const timeRange = t1.snapshot.timestamp - t0.snapshot.timestamp;
    const alpha = timeRange > 0 ? (renderTimeServer - t0.snapshot.timestamp) / timeRange : 0;
    // 修复：允许轻微外推 [-0.05, 1.25]，避免 renderTime 落在 latest 之后就直接跳
    const clampedAlphaPlayers = Math.max(0, Math.min(1, alpha)); // 玩家仍然 clamp 到 [0,1]
    // 注：子弹插值已移除（由 BulletTrackManager 负责）

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
        // 两个快照都有：
        //  - 位置使用插值（平滑移动）
        //  - 其他状态字段（包括伪装AI状态/枪口方向等）使用最新快照 p1 的值
        interpolatedPlayers.push({
          ...p1,
          x: lerp(p0.x, p1.x, clampedAlphaPlayers),
          y: lerp(p0.y, p1.y, clampedAlphaPlayers),
          // 显式保证致盲相关字段也使用最新值（兜底）
          isFlashed: p1.isFlashed ?? p0.isFlashed ?? false,
          flashEndTime: p1.flashEndTime ?? p0.flashEndTime ?? 0,
        });
      } else if (p0) {
        // 只有t0有
        interpolatedPlayers.push(p0);
      } else if (p1) {
        // 只有t1有
        interpolatedPlayers.push(p1);
      }
    }

    // AI插值（类似玩家插值）
    const interpolatedAIs: any[] = [];
    const aiMap0 = new Map((t0.snapshot.ais ?? []).map((a: any) => [a.id, a]));
    const aiMap1 = new Map((t1.snapshot.ais ?? []).map((a: any) => [a.id, a]));

    const allAIIds = new Set([
      ...(t0.snapshot.ais ?? []).map((a: any) => a.id),
      ...(t1.snapshot.ais ?? []).map((a: any) => a.id),
    ]);

    for (const id of allAIIds) {
      const a0 = aiMap0.get(id);
      const a1 = aiMap1.get(id);

      if (a0 && a1) {
        interpolatedAIs.push({
          ...a1,
          x: lerp(a0.x, a1.x, clampedAlphaPlayers),
          y: lerp(a0.y, a1.y, clampedAlphaPlayers),
        });
      } else if (a1) {
        interpolatedAIs.push(a1);
      }
    }

    // Decoy插值 (类似AI插值)
    const interpolatedDecoys: DECOY_STATE[] = [];
    const decoyMap0 = new Map((t0.snapshot.decoys ?? []).map((d) => [d.id, d]));
    const decoyMap1 = new Map((t1.snapshot.decoys ?? []).map((d) => [d.id, d]));
    
    const allDecoyIds = new Set([
      ...(t0.snapshot.decoys ?? []).map((d) => d.id),
      ...(t1.snapshot.decoys ?? []).map((d) => d.id),
    ]);

    for (const id of allDecoyIds) {
        const d0 = decoyMap0.get(id);
        const d1 = decoyMap1.get(id);

        if (d0 && d1) {
            interpolatedDecoys.push({
                ...d1,
                x: lerp(d0.x, d1.x, clampedAlphaPlayers),
                y: lerp(d0.y, d1.y, clampedAlphaPlayers),
            })
        } else if (d1) {
            interpolatedDecoys.push(d1);
        }
    }

    // 子弹渲染已完全由 BulletTrackManager 负责，此处不再插值
    // 仅保留字段用于向后兼容（如服务端调试等）

    return {
      players: interpolatedPlayers,
      bullets: t1.snapshot.bullets,
      items: t1.snapshot.items ?? [],
      worldItems: t1.snapshot.worldItems ?? [],
      lootBags: t1.snapshot.lootBags ?? [],
      obstacles: t1.snapshot.obstacles ?? [],
      ais: interpolatedAIs,
      decoys: interpolatedDecoys,
    };
  }

  getLatest(): S2C_SNAPSHOT | null {
    return this.buffer.length > 0 ? this.buffer[this.buffer.length - 1].snapshot : null;
  }

  /**
   * 获取服务器时间偏移（serverNow - clientNow）
   */
  getServerOffsetMs(): number {
    return this.serverOffsetMs;
  }

  /**
   * 获取渲染时间（服务器时间域）
   * @param renderDelayMs 渲染延迟（毫秒）
   */
  getRenderTimeServer(renderDelayMs: number): number {
    const clientNow = Date.now();
    const serverNow = clientNow + this.serverOffsetMs;
    return serverNow - renderDelayMs;
  }

  clear(): void {
    this.buffer = [];
    // P0-1: 清空时重置时间偏移，避免重连后使用旧的偏移值
    this.serverOffsetMs = 0;
  }
}
