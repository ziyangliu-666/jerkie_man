import { Player } from './player.js';
import type { PLAYER_STATE, BULLET_STATE, ITEM_STATE, C2S_INPUT } from '@jerkie-man/shared';
import { loadMapConfig } from '@jerkie-man/shared';
import { log } from './logger.js';

export class Room {
  public id: string;
  public players: Map<string, Player>;
  public bullets: BULLET_STATE[]; // Day1占位
  public items: ITEM_STATE[]; // Day1占位
  public mapConfig: ReturnType<typeof loadMapConfig>;
  public tick: number;

  constructor(id: string) {
    this.id = id;
    this.players = new Map();
    this.bullets = [];
    this.items = [];
    this.mapConfig = loadMapConfig();
    this.tick = 0;
  }

  addPlayer(playerId: string): Player {
    const player = new Player(
      playerId,
      Math.random() * this.mapConfig.width,
      Math.random() * this.mapConfig.height
    );
    this.players.set(playerId, player);
    log('PLAYER_JOIN', {
      room: this.id,
      player: playerId,
      tick: this.tick,
    });
    return player;
  }

  removePlayer(playerId: string): void {
    if (this.players.has(playerId)) {
      this.players.delete(playerId);
      log('PLAYER_LEAVE', {
        room: this.id,
        player: playerId,
        tick: this.tick,
      });
    }
  }

  getPlayer(playerId: string): Player | undefined {
    return this.players.get(playerId);
  }

  // 处理输入（由tick循环调用）
  processInput(playerId: string, input: C2S_INPUT): void {
    const player = this.players.get(playerId);
    if (!player) return;

    // 丢弃过期输入（seq小于等于已处理的）
    if (input.seq <= player.lastInputSeq) {
      return;
    }

    player.lastInputSeq = input.seq;
    player.lastInputTick = input.tick;

    // 更新玩家位置（20Hz tick = 50ms = 0.05s）
    const deltaTime = 0.05;
    player.processInput(input.keys, deltaTime, this.mapConfig.width, this.mapConfig.height);

    log('INPUT', {
      room: this.id,
      player: playerId,
      tick: this.tick,
      seq: input.seq,
      up: input.keys.up ? 1 : 0,
      down: input.keys.down ? 1 : 0,
      left: input.keys.left ? 1 : 0,
      right: input.keys.right ? 1 : 0,
    });
  }

  // 获取当前状态快照
  getSnapshot(): {
    players: PLAYER_STATE[];
    bullets: BULLET_STATE[];
    items: ITEM_STATE[];
  } {
    return {
      players: Array.from(this.players.values()).map((p) => p.toState()),
      bullets: this.bullets,
      items: this.items,
    };
  }
}

