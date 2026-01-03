import { z } from 'zod';

// C2S (Client to Server) 消息
export const C2S_HELLO_SCHEMA = z.object({
  type: z.literal('C2S_HELLO'),
  room: z.string(),
});

export const C2S_INPUT_SCHEMA = z.object({
  type: z.literal('C2S_INPUT'),
  seq: z.number().int().positive(),
  tick: z.number().int().nonnegative(),
  keys: z.object({
    up: z.boolean(),
    down: z.boolean(),
    left: z.boolean(),
    right: z.boolean(),
  }),
  aim: z.number(), // 鼠标角度（弧度），Day1占位
});

export const C2S_MESSAGE_SCHEMA = z.discriminatedUnion('type', [
  C2S_HELLO_SCHEMA,
  C2S_INPUT_SCHEMA,
]);

// S2C (Server to Client) 消息
export const PLAYER_STATE_SCHEMA = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  hp: z.number().int().min(0).max(100),
  status: z.enum(['ALIVE', 'DEAD', 'EXTRACTED']),
  lastInputSeq: z.number().int(),
  lastInputTick: z.number().int(),
});

export const BULLET_STATE_SCHEMA = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  vx: z.number(),
  vy: z.number(),
  ownerId: z.string(),
});

export const ITEM_STATE_SCHEMA = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  type: z.string(),
  quantity: z.number().int().positive(),
});

export const S2C_SNAPSHOT_SCHEMA = z.object({
  type: z.literal('S2C_SNAPSHOT'),
  tick: z.number().int().nonnegative(),
  timestamp: z.number(),
  players: z.array(PLAYER_STATE_SCHEMA),
  bullets: z.array(BULLET_STATE_SCHEMA),
  items: z.array(ITEM_STATE_SCHEMA),
});

export const S2C_ERROR_SCHEMA = z.object({
  type: z.literal('S2C_ERROR'),
  code: z.string(),
  message: z.string(),
});

export const S2C_MESSAGE_SCHEMA = z.discriminatedUnion('type', [
  S2C_SNAPSHOT_SCHEMA,
  S2C_ERROR_SCHEMA,
]);

// TypeScript 类型推导
export type C2S_HELLO = z.infer<typeof C2S_HELLO_SCHEMA>;
export type C2S_INPUT = z.infer<typeof C2S_INPUT_SCHEMA>;
export type C2S_MESSAGE = z.infer<typeof C2S_MESSAGE_SCHEMA>;

export type PLAYER_STATE = z.infer<typeof PLAYER_STATE_SCHEMA>;
export type BULLET_STATE = z.infer<typeof BULLET_STATE_SCHEMA>;
export type ITEM_STATE = z.infer<typeof ITEM_STATE_SCHEMA>;
export type S2C_SNAPSHOT = z.infer<typeof S2C_SNAPSHOT_SCHEMA>;
export type S2C_ERROR = z.infer<typeof S2C_ERROR_SCHEMA>;
export type S2C_MESSAGE = z.infer<typeof S2C_MESSAGE_SCHEMA>;

