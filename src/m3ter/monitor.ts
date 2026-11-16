import { EventEmitter } from 'events';
import { createHash, randomUUID } from 'crypto';
import { decodeTelemetry } from './decoder';
import * as store from './store';
import { applicationId, deviceId } from './chirpstack';
import { getMeterByDevEui } from '../store/sqlite';
import { uplinkPayload } from '../lib/uplink-payload';

export const managerEvents = new EventEmitter();
managerEvents.setMaxListeners(128);
export const monitoring = { state: 'disconnected', lastMessage: null as number | null, error: null as string | null, since: Date.now() };
export function inactiveMilliseconds(): number {
  const seconds = Number(process.env.M3TER_INACTIVE_SECONDS || 300);
  return (Number.isFinite(seconds) && seconds >= 10 ? seconds : 300) * 1000;
}
export function connectionState(state: string, error: string | null = null): void {
  const changed = monitoring.state !== state;
  Object.assign(monitoring, { state, error, since: Date.now() });
  if (changed) {
    try { store.applicationEvent(applicationId(), null, 'mqtt', `MQTT ${state}${error ? ': ' + error : ''}`); } catch { /* Startup/configuration errors remain visible in status. */ }
    managerEvents.emit('update', { type: 'connection', monitoring });
  }
}
export function validLocation(value: any): { latitude: number; longitude: number } | null {
  if (!value || typeof value.latitude !== 'number' || typeof value.longitude !== 'number' ||
    !Number.isFinite(value.latitude) || !Number.isFinite(value.longitude) || Math.abs(value.latitude) > 90 || Math.abs(value.longitude) > 180) return null;
  return { latitude: value.latitude, longitude: value.longitude };
}
export function ingestEvent(topic: string, blob: Buffer): boolean {
  let application: string;
  try { application = applicationId(); } catch { return false; }
  let devEui: string | null = null;
  try {
    if (blob.length > 512 * 1024) throw new Error('MQTT event exceeds the size limit');
    const parts = topic.match(/^application\/([^/]+)\/device\/([\da-f]{16})\/event\/(up|ack|txack|join|location|log|status)$/i);
    if (!parts || parts[1].toLowerCase() !== application) return false;
    monitoring.lastMessage = Date.now();
    const event = JSON.parse(blob.toString());
    devEui = deviceId(event.deviceInfo?.devEui);
    if (devEui !== parts[2].toLowerCase() || event.deviceInfo?.applicationId?.toLowerCase() !== application) throw new Error('MQTT topic and device identity do not match');
    const receivedAt = Date.now(), parsedTime = Date.parse(event.time);
    const timestamp = Number.isFinite(parsedTime) && parsedTime > 0 && parsedTime < receivedAt + 300_000 ? parsedTime : receivedAt;
    const kind = parts[3].toLowerCase();
    const fields = [event.time, event.fCnt, event.devAddr, event.data, event.queueItemId, event.acknowledged, event.downlinkId];
    if (event.dataHex !== undefined || event.dataEncoding !== undefined) fields.push(event.dataHex, event.dataEncoding);
    const identity = event.deduplicationId || (event.time ? fields : randomUUID());
    const eventKey = createHash('sha256').update(JSON.stringify([devEui, kind, identity])).digest('hex');
    const rx = Array.isArray(event.rxInfo) ? event.rxInfo[0] : null;
    const metadata: Record<string, unknown> = { sourceTime: typeof event.time === 'string' ? event.time.slice(0,100) : null, timestampSource: timestamp === parsedTime ? 'ChirpStack' : 'console receipt', name: String(event.deviceInfo.deviceName || devEui).slice(0, 200),
      applicationName: String(event.deviceInfo.applicationName || '').slice(0, 200), deviceProfileName: String(event.deviceInfo.deviceProfileName || '').slice(0, 200),
      fCnt: Number.isInteger(event.fCnt) ? event.fCnt : null, rssi: typeof rx?.rssi === 'number' ? rx.rssi : null,
      snr: typeof rx?.snr === 'number' ? rx.snr : null, gatewayId: typeof rx?.gatewayId === 'string' ? rx.gatewayId.slice(0, 32) : null };
    const suppliedPayload = event.dataHex !== undefined ? event.dataHex : event.data;
    const rawPayload = typeof suppliedPayload === 'string' ? suppliedPayload.slice(0, 4096) : null;
    metadata.payloadField = event.dataHex !== undefined ? 'dataHex' : 'data';
    metadata.payloadEncoding = event.dataHex !== undefined ? 'hex' : event.dataEncoding ?? 'base64';
    if (typeof event.data === 'string' && event.dataHex !== undefined) metadata.upstreamData = event.data.slice(0, 4096);
    const record: store.ManagerEvent = { application, devEui, kind, source: 'ChirpStack', timestamp, receivedAt, eventKey, rawPayload,
      fPort: Number.isInteger(event.fPort) ? event.fPort : null, metadata, message: `ChirpStack ${kind} event` };
    let inserted: boolean;
    if (kind === 'up') {
      let telemetry;
      try {
        const payload = uplinkPayload(event);
        metadata.payloadHex = payload.hex;
        const knownKey = store.deviceState(application, devEui)?.publicKey || getMeterByDevEui(devEui)?.publicKey;
        telemetry = decodeTelemetry(event.fPort, payload.bytes, knownKey);
        record.message = telemetry.verification === 'invalid' ? 'Telemetry decoded; signature INVALID. Voltage is outside the signed fields.' : 'Uplink decoded';
      } catch (error) { record.kind = 'decode-error'; record.message = (error as Error).message; }
      inserted = store.recordUplink(record, telemetry, inactiveMilliseconds());
    } else {
      if (kind === 'location') {
        const location = validLocation(event.location);
        if (location) {
          if (timestamp >= (store.deviceState(application, devEui)?.metadata?.locationTime || 0)) {
            metadata.location = location; metadata.locationTime = timestamp;
          }
          record.message = 'Device location received from ChirpStack';
        }
      }
      if (kind === 'log') record.message = `ChirpStack diagnostic: ${String(event.code || 'unknown').slice(0, 80)}`;
      if (kind === 'ack') record.message = event.acknowledged === true ? 'Confirmed downlink acknowledged by device; command execution is not verified' : 'Downlink was not acknowledged';
      if (kind === 'txack') record.message = 'Gateway reported downlink transmission; device delivery is not confirmed';
      inserted = store.addEvent(record) !== null;
      if (inserted) {
        store.updateDevice(application, devEui, metadata);
        if (typeof event.queueItemId === 'string' && ['ack', 'txack'].includes(kind)) {
          store.commandStatus(application, devEui, event.queueItemId,
            kind === 'txack' ? 'transmitted' : event.acknowledged === true ? 'delivered' : 'failed', record.message);
        }
      }
    }
    if (inserted) managerEvents.emit('update', { type: 'device', devEui, kind: record.kind, timestamp });
    return inserted;
  } catch {
    // Do not persist an untrusted identity when the topic and payload disagree.
    try { store.applicationEvent(application, null, 'diagnostic', 'Malformed MQTT event ignored; check event JSON and device identity.'); } catch { /* Database failures must not crash MQTT. */ }
    managerEvents.emit('update', { type: 'diagnostic', message: 'Unable to process an MQTT event. Check diagnostics and database availability.' });
    return false;
  }
}
export function checkActivity(): void {
  try { store.markInactive(applicationId(), inactiveMilliseconds()); } catch { /* Exposed by API error and next reconnect. */ }
}
