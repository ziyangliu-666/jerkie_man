/**
 * Binary Codec for WebSocket Messages
 * 使用 MessagePack 进行高效的二进制序列化/反序列化
 * 
 * 设计原则：
 * 1. 自动字段名压缩 - 长字段名自动映射为短名
 * 2. 版本号支持 - 便于协议升级和向后兼容
 * 3. 自动检测类型 - 客户端可同时处理 JSON 和二进制
 */

import { encode, decode } from '@msgpack/msgpack';
import { compressFields, expandFields } from './fieldCompression.js';

/** 当前协议版本号 */
export const BINARY_PROTOCOL_VERSION = 2; // 升级版本号标识字段压缩

/** 二进制消息包装格式 */
interface BinaryWrapper {
  /** 协议版本号 */
  v: number;
  /** 消息数据（字段名已压缩） */
  d: unknown;
}

/**
 * 将消息编码为二进制格式 (MessagePack + 字段压缩)
 * @param message 要编码的消息对象
 * @returns Uint8Array 二进制数据
 */
export function encodeMessage<T>(message: T): Uint8Array {
  // 先压缩字段名，再进行 MessagePack 编码
  const compressed = compressFields(message);
  const wrapper: BinaryWrapper = {
    v: BINARY_PROTOCOL_VERSION,
    d: compressed,
  };
  return encode(wrapper);
}

/**
 * 将二进制数据解码为消息对象
 * @param data ArrayBuffer 或 Uint8Array
 * @returns 解码后的消息对象（字段名已还原）
 */
export function decodeMessage<T>(data: ArrayBuffer | Uint8Array): T {
  const wrapper = decode(data instanceof ArrayBuffer ? new Uint8Array(data) : data) as BinaryWrapper;
  
  if (wrapper.v !== BINARY_PROTOCOL_VERSION) {
    console.warn(
      `[BinaryCodec] Protocol version mismatch: received v${wrapper.v}, expected v${BINARY_PROTOCOL_VERSION}`
    );
  }
  
  // 还原字段名
  return expandFields<T>(wrapper.d);
}

/**
 * 检测数据是否为二进制格式
 * @param data WebSocket 接收到的数据
 * @returns true 如果是二进制数据
 */
export function isBinaryData(data: unknown): data is ArrayBuffer | Uint8Array {
  return data instanceof ArrayBuffer || data instanceof Uint8Array;
}

/**
 * 解析 WebSocket 消息 (自动检测 JSON 或二进制)
 * 便于在过渡期同时支持两种格式
 * @param data WebSocket event.data
 * @returns 解析后的消息对象
 */
export function parseWebSocketMessage<T>(data: string | ArrayBuffer | Uint8Array): T {
  if (typeof data === 'string') {
    // JSON 格式 (向后兼容，不做字段解压)
    return JSON.parse(data) as T;
  } else {
    // 二进制格式 (MessagePack + 字段解压)
    return decodeMessage<T>(data);
  }
}
