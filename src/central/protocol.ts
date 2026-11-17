/** Versioned, bounded vocabulary. There is deliberately no command/script RPC. */
export const MAX_MESSAGE_BYTES = 65536;
export const MAX_TUNNEL_CHUNK = 16384;
export type TunnelPurpose = 'ssh' | 'chirpstack' | 'browser';
export type Health = { version: string; uptime: number; mqtt: 'connected' | 'disconnected' | 'connecting';
  fallback: boolean; queueDepth: number; updatesEnabled: boolean; uncertain: number; reconciled: number; superseded: number;
  lastError: 'none' | 'mqtt' | 'central' | 'local' | 'storage' | 'update' };
export type UplinkEvent = { fPort: 2; deviceInfo: { devEui: string; applicationId: string }; data?: string; dataHex?: string; dataEncoding?: 'hex' | 'base64'; deduplicationId?: string; fCnt?: number; time?: string };
export type AgentMessage =
  | { v: 1; type: 'health'; health: Health }
  | { v: 1; type: 'uplink'; id: string; event: UplinkEvent }
  | { v: 1; type: 'result'; id: string; outcome: 'enqueued' | 'locally-handled' | 'rejected' | 'uncertain' }
  | { v: 1; type: 'rotated' }
  | { v: 1; type: 'update-progress'; id: string; status: 'queued' | 'downloading' | 'verifying' | 'restarting' | 'succeeded' | 'failed' | 'rolled-back' }
  | TunnelMessage | PingMessage;
export type CentralMessage =
  | { v: 1; type: 'decision'; id: string; devEui: string; fPort: 2; confirmed: false; data: string }
  | { v: 1; type: 'rotate'; credential: string }
  | { v: 1; type: 'update'; id: string; image: string }
  | { v: 1; type: 'tunnel-open'; id: string; purpose: TunnelPurpose; host: string; port: number }
  | TunnelMessage | PingMessage;
export type PingMessage = { v: 1; type: 'ping' | 'pong'; id: string };
export type TunnelMessage =
  | { v: 1; type: 'tunnel-ready'; id: string; origin?:string }
  | { v: 1; type: 'tunnel-end'; id: string }
  | { v: 1; type: 'tunnel-data'; id: string; data: string }
  | { v: 1; type: 'tunnel-credit'; id: string; bytes: number }
  | { v: 1; type: 'tunnel-close'; id: string; reason: 'closed' | 'refused' | 'timeout' | 'limit' | 'disconnected' | 'error' };

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const integer = (v: unknown, min: number, max: number): v is number => Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max;
const id = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(v);
const isOneOf = (v: unknown, allowed: readonly unknown[]): boolean => allowed.includes(v);
const exact = (v: Record<string, unknown>, keys: string[]): boolean => Object.keys(v).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(v, key));
function base64(value: unknown, min: number, max: number): value is string {
  if (typeof value !== 'string' || value.length > Math.ceil(max / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return false;
  const bytes = Buffer.from(value, 'base64');
  return bytes.length >= min && bytes.length <= max && bytes.toString('base64') === value;
}
function stateFrame(value: unknown): value is string {
  if (!base64(value, 9, 13)) return false;
  const bytes = Buffer.from(value, 'base64');
  if (![9, 13].includes(bytes.length) || bytes[0] > 1) return false;
  return Number.isFinite(bytes.readFloatBE(bytes.length - 8)) && Number.isFinite(bytes.readFloatBE(bytes.length - 4));
}
export function validImageDigest(value: unknown): value is string {
  return typeof value === 'string' && value.length < 400 && /^ghcr\.io\/[a-z0-9][a-z0-9_.-]*\/[a-z0-9][a-z0-9_./-]*@sha256:[a-f0-9]{64}$/.test(value) && !value.includes('..');
}
function validUplink(value: unknown): value is UplinkEvent {
  if (!object(value) || value.fPort !== 2 || !object(value.deviceInfo)) return false;
  const info = value.deviceInfo;
  if (typeof info.devEui !== 'string' || !/^[a-fA-F0-9]{16}$/.test(info.devEui) ||
      typeof info.applicationId !== 'string' || !/^[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$/.test(info.applicationId)) return false;
  if (!id(value.deduplicationId)) return false;
  if (value.fCnt !== undefined && !integer(value.fCnt, 0, 0xffffffff)) return false;
  if (value.time !== undefined && (typeof value.time !== 'string' || value.time.length > 40 || !Number.isFinite(Date.parse(value.time)))) return false;
  // Use the original transport decoder, without alphabet heuristics or a second wire format.
  try {
    const bytes = requirePayload(value).bytes;
    return [74, 106, 112].includes(bytes.length);
  } catch { return false; }
}
import { uplinkPayload as requirePayload } from '../lib/uplink-payload';

export function parseMessage(input: Buffer | string, direction: 'agent'): AgentMessage;
export function parseMessage(input: Buffer | string, direction: 'central'): CentralMessage;
export function parseMessage(input: Buffer | string, direction: 'agent' | 'central'): AgentMessage | CentralMessage {
  if (Buffer.byteLength(input) > MAX_MESSAGE_BYTES) throw new Error('Agent message exceeds the size limit.');
  let value: unknown;
  try { value = JSON.parse(input.toString()); } catch { throw new Error('Invalid agent message.'); }
  if (!object(value) || value.v !== 1 || typeof value.type !== 'string') throw new Error('Invalid agent protocol version or envelope.');
  const keys = (...fields: string[]) => exact(value, ['v', 'type', ...fields]);
  let valid = false;
  switch (value.type) {
    case 'ping': case 'pong': case 'tunnel-end': valid = keys('id') && id(value.id); break;
    case 'tunnel-ready': {
      valid=id(value.id)&&keys('id');
      if(value.origin!==undefined&&typeof value.origin==='string'&&value.origin.length<512&&keys('id','origin')){
        try{const url=new URL(value.origin);valid=id(value.id)&&['http:','https:'].includes(url.protocol)&&url.origin===value.origin&&!url.username&&!url.password;}catch{valid=false;}
      }
      break;
    }
    case 'tunnel-data': valid = keys('id', 'data') && id(value.id) && base64(value.data, 1, MAX_TUNNEL_CHUNK); break;
    case 'tunnel-credit': valid = keys('id', 'bytes') && id(value.id) && integer(value.bytes, 1, 65536); break;
    case 'tunnel-close': valid = keys('id', 'reason') && id(value.id) && isOneOf(value.reason, ['closed', 'refused', 'timeout', 'limit', 'disconnected', 'error']); break;
    case 'tunnel-open': valid = direction === 'central' && keys('id', 'purpose', 'host', 'port') && id(value.id) &&
      isOneOf(value.purpose, ['ssh', 'chirpstack', 'browser']) && typeof value.host === 'string' &&
      value.host.length > 0 && value.host.length <= 253 && !/[\s\x00-\x1f/@?#%]/.test(value.host) && integer(value.port, 1, 65535); break;
    case 'decision': valid = direction === 'central' && keys('id', 'devEui', 'fPort', 'confirmed', 'data') && id(value.id) &&
      typeof value.devEui === 'string' && /^[a-fA-F0-9]{16}$/.test(value.devEui) && value.fPort === 2 && value.confirmed === false &&
      stateFrame(value.data); break;
    case 'rotate': valid = direction === 'central' && keys('credential') && typeof value.credential === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value.credential); break;
    case 'rotated': valid = direction === 'agent' && keys(); break;
    case 'update': valid = direction === 'central' && keys('id', 'image') && id(value.id) && validImageDigest(value.image); break;
    case 'update-progress': valid = direction === 'agent' && keys('id', 'status') && id(value.id) &&
      isOneOf(value.status, ['queued', 'downloading', 'verifying', 'restarting', 'succeeded', 'failed', 'rolled-back']); break;
    case 'result': valid = direction === 'agent' && keys('id', 'outcome') && id(value.id) && isOneOf(value.outcome, ['enqueued', 'locally-handled', 'rejected', 'uncertain']); break;
    case 'uplink': valid = direction === 'agent' && keys('id', 'event') && id(value.id) && validUplink(value.event) && value.event.deduplicationId===value.id; break;
    case 'health': {
      const h = value.health;
      valid = direction === 'agent' && keys('health') && object(h) && exact(h, ['version', 'uptime', 'mqtt', 'fallback', 'queueDepth', 'updatesEnabled', 'lastError', 'uncertain', 'reconciled', 'superseded']) &&
        typeof h.version === 'string' && /^[\w.+-]{1,80}$/.test(h.version) && integer(h.uptime, 0, Number.MAX_SAFE_INTEGER) &&
        isOneOf(h.mqtt, ['connected', 'disconnected', 'connecting']) && typeof h.fallback === 'boolean' && integer(h.queueDepth, 0, 1000000) &&
        typeof h.updatesEnabled === 'boolean' && integer(h.uncertain,0,Number.MAX_SAFE_INTEGER) && integer(h.reconciled,0,Number.MAX_SAFE_INTEGER) && integer(h.superseded,0,Number.MAX_SAFE_INTEGER) && isOneOf(h.lastError, ['none', 'mqtt', 'central', 'local', 'storage', 'update']);
      break;
    }
  }
  if (!valid) throw new Error('Unknown or invalid agent message.');
  // All discriminants and fields were checked above, including direction.
  return value as AgentMessage | CentralMessage;
}
