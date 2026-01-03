import {
  C2S_HELLO_SCHEMA,
  C2S_INPUT_SCHEMA,
  S2C_MESSAGE_SCHEMA,
  type S2C_MESSAGE,
  type S2C_SNAPSHOT,
} from '@jerkie-man/shared';
import { SnapshotBuffer } from './snapshot.js';

export interface NetworkCallbacks {
  onSnapshot?: (snapshot: S2C_SNAPSHOT) => void;
  onError?: (error: string) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onWelcome?: (playerId: string) => void;
}

export class Network {
  private ws: WebSocket | null = null;
  private url: string;
  private room: string;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 10;
  private reconnectDelay = 1000; // 初始1秒
  private reconnectTimer: number | null = null;
  private callbacks: NetworkCallbacks;
  private snapshotBuffer: SnapshotBuffer;
  private isConnected = false;
  private lastServerTick = 0;

  constructor(url: string, room: string, callbacks: NetworkCallbacks = {}) {
    this.url = url;
    this.room = room;
    this.callbacks = callbacks;
    this.snapshotBuffer = new SnapshotBuffer();
    this.connect();
  }

  private connect(): void {
    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.reconnectDelay = 1000;
        console.log('Connected to server');

        // 发送HELLO
        this.sendHello();

        if (this.callbacks.onConnect) {
          this.callbacks.onConnect();
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const raw = JSON.parse(event.data.toString());
          
          // 处理S2C_WELCOME消息（不在schema中，需要特殊处理）
          if (raw.type === 'S2C_WELCOME' && raw.playerId) {
            if (this.callbacks.onWelcome) {
              this.callbacks.onWelcome(raw.playerId);
            }
            return;
          }

          const message = S2C_MESSAGE_SCHEMA.parse(raw) as S2C_MESSAGE;

          if (message.type === 'S2C_SNAPSHOT') {
            this.lastServerTick = message.tick;
            this.snapshotBuffer.add(message);
            if (this.callbacks.onSnapshot) {
              this.callbacks.onSnapshot(message);
            }
          } else if (message.type === 'S2C_ERROR') {
            console.error('Server error:', message.message);
            if (this.callbacks.onError) {
              this.callbacks.onError(message.message);
            }
          }
        } catch (error) {
          console.error('Failed to parse message:', error);
        }
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        console.log('Disconnected from server');

        if (this.callbacks.onDisconnect) {
          this.callbacks.onDisconnect();
        }

        // 自动重连
        this.scheduleReconnect();
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        if (this.callbacks.onError) {
          this.callbacks.onError('WebSocket error');
        }
      };
    } catch (error) {
      console.error('Failed to connect:', error);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) {
      return; // 已经安排了重连
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    console.log(`Reconnecting in ${this.reconnectDelay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
      // 指数退避，最多10秒
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 10000);
    }, this.reconnectDelay);
  }

  private sendHello(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const message = C2S_HELLO_SCHEMA.parse({
      type: 'C2S_HELLO',
      room: this.room,
    });

    this.ws.send(JSON.stringify(message));
  }

  sendInput(seq: number, keys: { up: boolean; down: boolean; left: boolean; right: boolean }, aim: number): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const message = C2S_INPUT_SCHEMA.parse({
      type: 'C2S_INPUT',
      seq,
      tick: this.lastServerTick, // 使用最后收到的server tick
      keys,
      aim,
    });

    this.ws.send(JSON.stringify(message));
  }

  getSnapshotBuffer(): SnapshotBuffer {
    return this.snapshotBuffer;
  }

  getConnectionState(): {
    connected: boolean;
    lastServerTick: number;
  } {
    return {
      connected: this.isConnected,
      lastServerTick: this.lastServerTick,
    };
  }

  disconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

