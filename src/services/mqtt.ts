import { connect, MqttClient } from 'mqtt';
import { randomUUID } from 'crypto';
import { applicationId } from '../lib/chirpstack-config';
import { enqueue } from './grpc';
import type { DownlinkSink } from './downlink';
import { encode } from '../lib/encode';
import {
  getAllTransactionRecords, getMeterByDevEui, getMeterByPublicKey,
  getTransactionByNonce, recordMeterTransaction, saveMeter, updateMeterDevEui, updateMeterNonce,
} from '../store/sqlite';
import type { State, TransactionRecord } from '../types';
import { decodePayload } from '../lib/decode';
import { uplinkPayload } from '../lib/uplink-payload';
import { runHook, notifyHook, verifyPayloadSignature } from '../lib/utils';
import { getLatestTransactionNonce } from '../lib/sync';
import { createMeterLogger, createLogger } from '../utils/logger';
import { meterIdFromPublicKeyContractCall } from '../utils/contracts';

const logger = createLogger('[mqtt]');
const deviceLocks = new Set<string>();
const meterLocks = new Set<string>();
let collectorClient: MqttClient | undefined;

// Existing process-level broker configuration, also reused by the opt-in agent.
export function mqttConnection(): string | { host: string; port: number } {
  if (!process.env.MQTT_URL) return { host: process.env.CHIRPSTACK_HOST || 'localhost', port: 1883 };
  try {
    const url = new URL(process.env.MQTT_URL);
    if (!['mqtt:', 'mqtts:', 'ws:', 'wss:'].includes(url.protocol) || !url.hostname || url.hash) throw new Error();
    return process.env.MQTT_URL;
  } catch { throw new Error('MQTT_URL must be a valid mqtt, mqtts, ws or wss broker URL.'); }
}
// Optional arguments are dependency injection for integration tests, not configuration.
export async function handleUplinks(connection = mqttConnection(), collect = handleMessage): Promise<boolean> {
  if (collectorClient) return true;
  const application = applicationId();
  const topic = `application/${application}/device/+/event/+`;
  const options = { clientId: `console-${randomUUID()}`, clean: true, resubscribe: false, connectTimeout: 9000, reconnectPeriod: 2000 };
  const client = collectorClient = typeof connection === 'string' ? connect(connection, options) : connect({ ...connection, ...options });
  client.on('reconnect', () => { void notifyHook('onMqttReconnect', client); });
  client.on('message', (receivedTopic, blob) => {
    try {
      const match = receivedTopic.match(/^application\/([^/]+)\/device\/([a-f0-9]{16})\/event\/up$/i);
      if (match && match[1].toLowerCase() === application) {
        const event = JSON.parse(blob.toString());
        if ((event.fPort === undefined || event.fPort === 2) &&
            String(event.deviceInfo?.devEui).toLowerCase() === match[2].toLowerCase() &&
            (!event.deviceInfo?.applicationId || event.deviceInfo.applicationId.toLowerCase() === application)) {
          void Promise.resolve().then(() => collect(blob)).catch(() => logger.error('Collector uplink handler failed'));
        }
      }
    } catch { logger.warn('Invalid collector MQTT event ignored'); }
  });
  client.on('connect', () => {
    client.subscribe(topic, { qos: 1 }, (error, granted) => {
      if (error || granted?.some(subscription => subscription.qos === 128)) {
        logger.error('MQTT subscription rejected. Check broker permissions.');
        client.stream.destroy(); return; // reconnect, then subscribe exactly once again
      }
      logger.info('MQTT collector connected and subscribed');
      void notifyHook('onMqttSubscribed', client, topic);
    });
    void notifyHook('onMqttConnect', client);
  });
  client.on('error', error => {
    logger.error(`MQTT connection error: ${(error as NodeJS.ErrnoException).code || 'broker error'}`);
    void notifyHook('onMqttError', error, client);
    // MQTT.js owns reconnection. Do not end the client on a transient error.
  });
  return true; // HTTP remains available while MQTT reconnects.
}

export function stopUplinks(): void {
  collectorClient?.end(true); collectorClient = undefined;
}

const chirpstackSink: DownlinkSink = decision => enqueue(decision.devEui, decision.bytes);

export async function handleMessage(blob: Buffer, downlink: DownlinkSink = chirpstackSink): Promise<void> {
  let devEui: string | undefined;
  let lockedMeter: string | undefined;
  let ownsDeviceLock = false;
  let log = logger;
  try {
    void notifyHook('onMessageReceived', blob);
    const message = JSON.parse(blob.toString());
    if (typeof message?.deviceInfo?.devEui !== 'string' || !message.deviceInfo.devEui) {
      throw new Error('Message has no valid device EUI');
    }
    devEui = message.deviceInfo.devEui;
    log = createMeterLogger({ devEui });
    if (deviceLocks.has(devEui!)) {
      void notifyHook('onMessageDropped', 'locked', devEui!);
      return;
    }
    deviceLocks.add(devEui!);
    ownsDeviceLock = true;
    const transaction = uplinkPayload(message).bytes;
    const decoded = decodePayload(transaction);
    const payloadHadPublicKey = !!decoded.extensions.deviceId;
    const publicKey = decoded.extensions.deviceId || getMeterByDevEui(devEui!)?.publicKey.replace(/^0x/, '');
    if (!publicKey || !verifyPayloadSignature(transaction, Buffer.from(publicKey, 'hex'))) {
      throw new Error('Unknown meter or invalid transaction signature');
    }
    const key = `0x${publicKey}`;
    // Two device EUIs can identify the same meter. Serialize that identity too.
    if (meterLocks.has(key)) {
      void notifyHook('onMessageDropped', 'meter-locked', devEui!);
      return;
    }
    meterLocks.add(key);
    lockedMeter = key;
    if (payloadHadPublicKey) {
      const existing = getMeterByPublicKey(key);
      if (!existing) {
        const tokenId = await meterIdFromPublicKeyContractCall(key);
        const latestNonce = await getLatestTransactionNonce(tokenId);
        const meter = { publicKey: key, devEui: devEui!, tokenId, latestNonce };
        saveMeter(meter);
        void notifyHook('onMeterCreated', meter);
      } else {
        if (existing.devEui !== devEui && !updateMeterDevEui(key, devEui!)) throw new Error('Could not update meter device EUI');
        const latestNonce = await getLatestTransactionNonce(existing.tokenId);
        if (!updateMeterNonce(key, latestNonce)) throw new Error('Could not synchronize meter nonce');
      }
    }
    const meter = getMeterByPublicKey(key);
    if (!meter) throw new Error('Meter not found');
    const expectedNonce = meter.latestNonce + 1;
    let newTransaction = false;
    if (decoded.nonce === expectedNonce) {
      const record: TransactionRecord = { nonce: decoded.nonce, identifier: meter.tokenId, receivedAt: Date.now(), raw: transaction.toString('hex') };
      // Acknowledgement means both the transaction and its nonce are durable.
      recordMeterTransaction(key, record);
      newTransaction = true;
    } else if (decoded.nonce !== 0) {
      const previous = getTransactionByNonce(decoded.nonce, meter.tokenId);
      if (decoded.nonce !== meter.latestNonce || !previous || decoded.energy < decodePayload(Buffer.from(previous.raw, 'hex')).energy) {
        throw new Error(`Invalid nonce. Expected ${expectedNonce}, got ${decoded.nonce}`);
      }
      // A lost acknowledgment may leave the same signed accumulator increasing.
      // Re-acknowledge the durable transaction; never store/bill it twice.
      // Additional uncollected energy is not silently rewritten into that transaction.
    }
    let is_on = false;
    try { is_on = await runHook('isOnStateCompute', meter.tokenId); }
    catch (error) {
      log.error('Could not determine meter power state:', error);
      void notifyHook('onIsOnStateComputeError', meter.tokenId, error);
    }
    void notifyHook('onIsOnStateComputed', meter.tokenId, is_on);
    const state = decoded.nonce === 0 ? { nonce: meter.latestNonce, is_on } : { is_on };
    try {
      await downlink({ devEui: devEui!, fPort: 2, confirmed: false,
        bytes: encode(state as State, decoded.extensions.latitude ?? 0, decoded.extensions.longitude ?? 0) });
      void notifyHook('onStateEnqueued', state, decoded.extensions.latitude ?? 0, decoded.extensions.longitude ?? 0);
    } finally {
      // Delivery services run after the downlink attempt and cannot prevent it.
      // notifyHook isolates failures so later delivery extensions still run.
      if (newTransaction) void notifyHook('onTransactionDistribution', meter.tokenId, decoded, getAllTransactionRecords());
    }
  } catch (error) {
    log.error('Error handling MQTT message:', error);
    void notifyHook('onMessageError', error);
  } finally {
    if (lockedMeter) meterLocks.delete(lockedMeter);
    if (ownsDeviceLock && devEui) {
      deviceLocks.delete(devEui);
      void notifyHook('onDeviceUnlocked', devEui);
    }
    void notifyHook('onMessageProcessingComplete');
  }
}
