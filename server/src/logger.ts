export interface LogContext {
  tick?: number;
  room?: string;
  player?: string;
  [key: string]: string | number | undefined;
}

export function log(msg: string, context: LogContext = {}): void {
  const timestamp = new Date().toISOString();
  const parts: string[] = [`[${timestamp}]`];

  if (context.tick !== undefined) {
    parts.push(`[tick=${context.tick}]`);
  }

  if (context.room) {
    parts.push(`[room=${context.room}]`);
  }

  if (context.player) {
    parts.push(`[player=${context.player}]`);
  }

  // 其他键值对
  const otherKeys = Object.keys(context).filter(
    (k) => !['tick', 'room', 'player'].includes(k)
  );
  if (otherKeys.length > 0) {
    const extras = otherKeys
      .map((k) => `${k}=${context[k]}`)
      .join(' ');
    parts.push(msg, extras);
  } else {
    parts.push(msg);
  }

  console.log(parts.join(' '));
}

