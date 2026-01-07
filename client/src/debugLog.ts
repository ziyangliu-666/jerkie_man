/**
 * Debug Log - 环形缓冲区日志记录器
 * 用于记录客户端调试信息，支持快速 dump 最近的日志条目
 */

export interface LogEntry {
  time: number;
  tag: string;
  data: Record<string, unknown>;
}

export class DebugLog {
  private buffer: LogEntry[] = [];
  private maxSize: number;

  constructor(maxSize: number = 600) {
    this.maxSize = maxSize;
  }

  /**
   * 添加日志条目
   */
  push(tag: string, data: Record<string, unknown>): void {
    const entry: LogEntry = {
      time: performance.now(),
      tag,
      data,
    };
    
    this.buffer.push(entry);
    
    // Ring buffer: 超过最大长度时移除最旧的
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }
  }

  /**
   * 获取最近 N 条日志
   */
  getRecent(count: number): LogEntry[] {
    const start = Math.max(0, this.buffer.length - count);
    return this.buffer.slice(start);
  }

  /**
   * 导出日志为可读字符串
   */
  dump(count: number = 200): string {
    const entries = this.getRecent(count);
    const lines: string[] = [];
    
    for (const entry of entries) {
      const timeStr = entry.time.toFixed(1);
      const dataStr = JSON.stringify(entry.data);
      lines.push(`[${timeStr}] ${entry.tag}: ${dataStr}`);
    }
    
    return lines.join('\n');
  }

  /**
   * 清空日志
   */
  clear(): void {
    this.buffer = [];
  }
}















