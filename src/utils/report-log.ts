import { uplinkPayload } from '../lib/uplink-payload';
import { decodePayload } from '../lib/decode';

/** One readable line per meter report and per state reply, for `docker compose logs`.
 * Only meter readings and reply contents: never keys, tokens or the full signature. */

type Uplink = { deviceInfo?: { devEui?: unknown }; fCnt?: unknown; fPort?: unknown; deduplicationId?: unknown;
  data?: unknown; dataHex?: unknown; dataEncoding?: unknown };

const short = (hex: string) => hex.length > 16 ? `${hex.slice(0, 8)}…${hex.slice(-8)}` : hex;

export function describeReport(event: Uplink): string {
  const parts = [`devEui=${String(event.deviceInfo?.devEui ?? '?')}`];
  if (typeof event.fCnt === 'number') parts.push(`fCnt=${event.fCnt}`);
  if (typeof event.fPort === 'number') parts.push(`fPort=${event.fPort}`);
  if (typeof event.deduplicationId === 'string') parts.push(`id=${event.deduplicationId}`);
  try {
    const bytes = uplinkPayload(event).bytes;
    try {
      const reading = decodePayload(bytes), ext = reading.extensions;
      parts.push(`nonce=${reading.nonce}`, `energy=${reading.energy}kWh`);
      if (ext.voltage !== undefined) parts.push(`voltage=${ext.voltage}V`);
      if (ext.latitude !== undefined && ext.longitude !== undefined) parts.push(`location=${ext.latitude},${ext.longitude}`);
      if (ext.deviceId) parts.push(`meterKey=${short(ext.deviceId)}`);
      parts.push(`signature=${short(reading.signature)}`);
    } catch { parts.push('reading=undecodable'); }
    parts.push(`bytes=${bytes.length}`);
  } catch { parts.push('payload=missing or invalid'); }
  return parts.join(' ');
}

/** State reply: is_on(1) [nonce(4)] latitude(f32) longitude(f32). */
export function describeReply(bytes: number[]): string {
  const buf = Buffer.from(bytes), parts = [`state=${buf[0] === 1 ? 'ON' : buf[0] === 0 ? 'OFF' : `?(${buf[0]})`}`];
  if (buf.length === 13) parts.push(`nonce=${buf.readUInt32BE(1)}`);
  if (buf.length === 9 || buf.length === 13) {
    const at = buf.length - 8;
    parts.push(`location=${+buf.readFloatBE(at).toFixed(5)},${+buf.readFloatBE(at + 4).toFixed(5)}`);
  }
  parts.push(`hex=${buf.toString('hex').toUpperCase()}`);
  return parts.join(' ');
}

export const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
