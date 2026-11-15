import { connect, MqttClient } from 'mqtt';
import { connectionState, ingestEvent } from '../m3ter/monitor';
import { applicationId } from '../m3ter/chirpstack';
import { enqueue } from './grpc';
import { encode } from '../lib/encode';
import {
  getAllTransactionRecords, getMeterByDevEui, getMeterByPublicKey,
  getTransactionByNonce, recordMeterTransaction, saveMeter, updateMeterDevEui, updateMeterNonce,
} from '../store/sqlite';
import type { State, TransactionRecord } from '../types';
import { decodePayload } from '../lib/decode';
import { runHook, notifyHook, verifyPayloadSignature } from '../lib/utils';
import { getLatestTransactionNonce } from '../lib/sync';
import { createMeterLogger, createLogger } from '../utils/logger';
import { meterIdFromPublicKeyContractCall } from '../utils/contracts';

const logger = createLogger('[mqtt]');
const deviceLocks = new Set<string>();
const meterLocks = new Set<string>();
let monitoringClient: MqttClient | undefined;

export async function handleUplinks(): Promise<boolean> {
  if (monitoringClient) return true;
  const topic = `application/${applicationId()}/device/+/event/+`;
  connectionState('connecting');
  const options = { clean: true, resubscribe: false, connectTimeout: 9000, reconnectPeriod: 2000,
    username: process.env.MQTT_USERNAME, password: process.env.MQTT_PASSWORD };
  const client = monitoringClient = process.env.MQTT_URL ? connect(process.env.MQTT_URL, options) :
    connect({ ...options, host: process.env.CHIRPSTACK_HOST || 'localhost', port: 1883 });
  client.on('reconnect', () => { connectionState('reconnecting'); void notifyHook('onMqttReconnect', client); });
  client.on('offline', () => connectionState('disconnected'));
  client.on('close', () => connectionState('disconnected'));
  client.on('message', (topic, blob) => {
    ingestEvent(topic, blob);
    // Preserve the existing billing handler as a separate, optional consumer.
    // Telemetry is already durable before this workflow can fail or wait on a chain.
    if (process.env.CONSOLE_MONITOR_ONLY !== 'true' && topic.endsWith('/event/up')) {
      try {
        const event = JSON.parse(blob.toString());
        if (event.fPort === 2 && event.deviceInfo?.applicationId?.toLowerCase() === applicationId() &&
          topic.toLowerCase().endsWith(`/device/${String(event.deviceInfo.devEui).toLowerCase()}/event/up`)) {
          void handleMessage(blob).catch(() => logger.error('Billing uplink handler failed'));
        }
      }
      catch { /* The monitoring ingestion boundary records malformed messages. */ }
    }
  });
  client.on('connect', () => {
    client.subscribe(topic, { qos: 1 }, (error, granted) => {
      if (error || granted?.some(subscription => subscription.qos === 128)) {
        connectionState('error', 'MQTT subscription rejected. Check broker permissions.');
        client.stream.destroy(); return; // reconnect, then subscribe exactly once again
      }
      connectionState('connected'); void notifyHook('onMqttSubscribed', client, topic);
    });
    void notifyHook('onMqttConnect', client);
  });
  client.on('error', error => {
    connectionState('error', 'MQTT connection failed. Check broker address and credentials.');
    void notifyHook('onMqttError', error, client);
    // MQTT.js owns reconnection. Do not end the client on a transient error.
  });
  return true; // The dashboard stays available while MQTT is connecting/reconnecting.
}

export function stopUplinks(): void {
  monitoringClient?.end(true); monitoringClient = undefined; connectionState('disconnected');
}

export async function handleMessage(blob: Buffer): Promise<void> {
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
    if (typeof message.data !== 'string' || !message.data || !/^[A-Za-z0-9+/]+={0,2}$/.test(message.data)) {
      throw new Error('Message has no valid base64 payload');
    }
    const transaction = Buffer.from(message.data, 'base64');
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
      if (decoded.nonce !== meter.latestNonce || previous?.raw !== transaction.toString('hex')) {
        throw new Error(`Invalid nonce. Expected ${expectedNonce}, got ${decoded.nonce}`);
      }
      // A lost downlink may cause an exact retransmission. Acknowledge without
      // inserting or redistributing it. Different data at the same nonce is rejected.
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
      await enqueue(devEui!, encode(state as State, decoded.extensions.latitude ?? 0, decoded.extensions.longitude ?? 0));
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
