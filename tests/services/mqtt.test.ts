import { handleMessage, mqttConnection } from '../../src/services/mqtt';
import * as store from '../../src/store/sqlite';
import { getLatestTransactionNonce } from '../../src/lib/sync';
import { runHook, notifyHook, verifyPayloadSignature } from '../../src/lib/utils';
import { enqueue } from '../../src/services/grpc';

jest.mock('mqtt', () => ({ connect: jest.fn() }));
jest.mock('../../src/services/grpc', () => ({ enqueue: jest.fn() }));
jest.mock('../../src/store/sqlite', () => ({ getAllTransactionRecords: jest.fn(), getMeterByDevEui: jest.fn(), getMeterByPublicKey: jest.fn(), getTransactionByNonce: jest.fn(), getReplyTransaction: jest.fn(), recordMeterTransaction: jest.fn(), saveMeter: jest.fn(), updateMeterDevEui: jest.fn(), updateMeterNonce: jest.fn() }));
jest.mock('../../src/lib/sync', () => ({ getLatestTransactionNonce: jest.fn() }));
jest.mock('../../src/utils/contracts', () => ({ meterIdFromPublicKeyContractCall: jest.fn() }));
jest.mock('../../src/lib/utils', () => ({ runHook: jest.fn(), notifyHook: jest.fn(), verifyPayloadSignature: jest.fn() }));

const key = '0x' + 'ab'.repeat(32);
let meter: any;
let records: any[];
function uplink(nonce = 1, device = 'device-a', energy = 1000000) {
  const data = Buffer.alloc(112);
  data.writeUInt32BE(nonce, 0); data.writeUInt32BE(energy, 4);
  Buffer.from(key.slice(2), 'hex').copy(data, 74);
  return Buffer.from(JSON.stringify({ deviceInfo: { devEui: device }, data: data.toString('base64') }));
}
function resetFixture() {
  jest.resetAllMocks();
  meter = { publicKey: key, tokenId: 1, latestNonce: 0, devEui: 'device-a' }; records = [];
  (verifyPayloadSignature as jest.Mock).mockReturnValue(true);
  (runHook as jest.Mock).mockResolvedValue(true);
  (notifyHook as jest.Mock).mockResolvedValue(undefined);
  (enqueue as jest.Mock).mockResolvedValue(undefined);
  (store.getMeterByPublicKey as jest.Mock).mockImplementation(() => ({ ...meter }));
  (store.getMeterByDevEui as jest.Mock).mockImplementation(() => ({ ...meter }));
  (getLatestTransactionNonce as jest.Mock).mockImplementation(async () => meter.latestNonce);
  (store.updateMeterNonce as jest.Mock).mockImplementation((_, nonce) => { meter.latestNonce = nonce; return true; });
  (store.updateMeterDevEui as jest.Mock).mockReturnValue(true);
  (store.getAllTransactionRecords as jest.Mock).mockImplementation(() => records);
  (store.getTransactionByNonce as jest.Mock).mockImplementation(nonce => records.find(record => record.nonce === nonce));
  (store.getReplyTransaction as jest.Mock).mockImplementation(nonce => records.find(record => record.nonce === nonce));
  (store.recordMeterTransaction as jest.Mock).mockImplementation((_, record) => { records.push(record); meter.latestNonce = record.nonce; });
}
beforeEach(resetFixture);

test.each(['{', '{}', 'null', '{"deviceInfo":{}}', '{"deviceInfo":{"devEui":"device-a"}}'])('malformed uplink %s stays inside the error boundary', async input => {
  await expect(handleMessage(Buffer.from(input))).resolves.toBeUndefined();
  expect(enqueue).not.toHaveBeenCalled();
  expect(notifyHook).toHaveBeenCalledWith('onMessageError', expect.any(Error));
});
test('dropped messages cannot release the in-flight device lock', async () => {
  let resume!: (value: number) => void;
  (getLatestTransactionNonce as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { resume = resolve; }));
  const first = handleMessage(uplink());
  await handleMessage(uplink()); await handleMessage(uplink());
  expect(getLatestTransactionNonce).toHaveBeenCalledTimes(1);
  expect(notifyHook).not.toHaveBeenCalledWith('onDeviceUnlocked', 'device-a');
  resume(0); await first;
  expect(enqueue).toHaveBeenCalledTimes(1);
  await handleMessage(uplink(2));
  expect(enqueue).toHaveBeenCalledTimes(2);
});
test('different device EUIs cannot concurrently advance the same meter', async () => {
  let resume!: (value: number) => void;
  (getLatestTransactionNonce as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { resume = resolve; }));
  const first = handleMessage(uplink());
  await handleMessage(uplink(1, 'device-b'));
  expect(notifyHook).toHaveBeenCalledWith('onMessageDropped', 'meter-locked', 'device-b');
  expect(getLatestTransactionNonce).toHaveBeenCalledTimes(1);
  resume(0); await first;
});
test('acknowledgement precedes delivery and never waits for a delivery hook', async () => {
  (notifyHook as jest.Mock).mockImplementation(hook => hook === 'onTransactionDistribution' ? new Promise(() => {}) : Promise.resolve());
  await handleMessage(uplink());
  expect(enqueue).toHaveBeenCalledTimes(1);
  const distribution = (notifyHook as jest.Mock).mock.calls.findIndex(([name]) => name === 'onTransactionDistribution');
  expect((enqueue as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan((notifyHook as jest.Mock).mock.invocationCallOrder[distribution]);
  expect(records).toHaveLength(1);
});
test('lost acknowledgements accept growing same-nonce snapshots without duplicate collection', async () => {
  (enqueue as jest.Mock).mockRejectedValueOnce(new Error('gRPC unavailable'));
  await handleMessage(uplink()); await handleMessage(uplink());
  expect(enqueue).toHaveBeenCalledTimes(2);
  expect(store.recordMeterTransaction).toHaveBeenCalledTimes(1);
  expect((notifyHook as jest.Mock).mock.calls.filter(([name]) => name === 'onTransactionDistribution')).toHaveLength(1);
  await handleMessage(uplink(1, 'device-a', 2000000));
  expect(enqueue).toHaveBeenCalledTimes(3);
  expect(records).toHaveLength(1);
  expect(records[0].raw).toBe(JSON.parse(uplink().toString()).data ? Buffer.from(JSON.parse(uplink().toString()).data,'base64').toString('hex') : '');
});
test('bootstrap messages use the balance hook and computation failures return off', async () => {
  (runHook as jest.Mock).mockRejectedValueOnce(new Error('RPC unavailable'));
  await handleMessage(uplink(0));
  expect(runHook).toHaveBeenCalledWith('isOnStateCompute', 1);
  expect((enqueue as jest.Mock).mock.calls[0][1][0]).toBe(0);
  expect(store.recordMeterTransaction).not.toHaveBeenCalled();
});

test('a confirmed report pruned from transactions is acknowledged using its saved checkpoint',async()=>{
  await handleMessage(uplink());
  const checkpoint=records[0];records=[];
  (store.getReplyTransaction as jest.Mock).mockImplementation(nonce=>nonce===1?checkpoint:null);
  await handleMessage(uplink(1,'device-a',2000000));
  expect(enqueue).toHaveBeenCalledTimes(2);
  expect(store.recordMeterTransaction).toHaveBeenCalledTimes(1);
  expect(records).toEqual([]);
});
test('persistence failure never acknowledges uncommitted data and releases the lock', async () => {
  (store.recordMeterTransaction as jest.Mock).mockImplementationOnce(() => { throw new Error('disk full'); });
  await handleMessage(uplink()); expect(enqueue).not.toHaveBeenCalled();
  await handleMessage(uplink()); expect(enqueue).toHaveBeenCalledTimes(1);
});

test('the injected transport receives the identical billing reply without contacting gRPC', async () => {
  const sink = jest.fn().mockResolvedValue(undefined);
  await handleMessage(uplink(), sink);
  expect(sink).toHaveBeenCalledWith({ devEui: 'device-a', fPort: 2, confirmed: false, bytes: [1,0,0,0,0,0,0,0,0] });
  expect(enqueue).not.toHaveBeenCalled();
  expect(records).toHaveLength(1);
});

test('collector decodes explicitly marked hex using the same bytes as the existing transport', async () => {
  const event=JSON.parse(uplink().toString()), hex=Buffer.from(event.data,'base64').toString('hex');
  event.data=hex;event.dataEncoding='hex';
  await handleMessage(Buffer.from(JSON.stringify(event)));
  expect(records).toHaveLength(1);expect(records[0].raw).toBe(hex);expect(enqueue).toHaveBeenCalledTimes(1);
});

test('shared MQTT URL preserves the original default, supports remote protocols, and rejects invalid URLs safely', () => {
  const environment=process.env;
  try {
    process.env={...environment};delete process.env.MQTT_URL;delete process.env.CHIRPSTACK_HOST;
    expect(mqttConnection()).toEqual({host:'localhost',port:1883});
    process.env.CHIRPSTACK_HOST='network-server';expect(mqttConnection()).toEqual({host:'network-server',port:1883});
    for(const url of ['mqtt://remote:1883','mqtts://operator:private@remote:8883','ws://remote:9001/mqtt','wss://remote/mqtt']) {
      process.env.MQTT_URL=url;expect(mqttConnection()).toBe(url);
    }
    process.env.MQTT_URL='https://operator:private@remote';
    expect(mqttConnection).toThrow('MQTT_URL must be a valid');
    try {mqttConnection();} catch(error) {expect(String(error)).not.toContain('private');}
  } finally {process.env=environment;}
});

test('one collector broker connection delivers reports and resubscribes once', async () => {
  const { EventEmitter } = require('events');
  const mqtt = require('mqtt');
  const { handleUplinks, stopUplinks } = require('../../src/services/mqtt');
  const oldApp=process.env.APPLICATION_ID, oldHost=process.env.CHIRPSTACK_HOST;
  process.env.APPLICATION_ID='11111111-1111-4111-8111-111111111111'; process.env.CHIRPSTACK_HOST='existing-broker';
  const client = new EventEmitter(); client.end=jest.fn(); client.stream={destroy:jest.fn()};
  client.subscribe=jest.fn((topic:any,options:any,done:any)=>done(null,[{qos:1}]));
  mqtt.connect.mockReturnValue(client);
  const collect=jest.fn().mockResolvedValue(undefined);
  try {
    await handleUplinks(undefined,collect);await handleUplinks(undefined,collect);
    expect(mqtt.connect).toHaveBeenCalledTimes(1);
    expect(mqtt.connect).toHaveBeenCalledWith(expect.objectContaining({host:'existing-broker',port:1883,clientId:expect.stringMatching(/^console-/)}));
    const clientId=mqtt.connect.mock.calls[0][0].clientId;
    client.emit('connect');client.emit('connect');expect(client.subscribe).toHaveBeenCalledTimes(2);
    const body=Buffer.from(JSON.stringify({deviceInfo:{devEui:'0102030405060708'},fPort:2,data:'AAAA'}));
    client.emit('message',`application/${process.env.APPLICATION_ID}/device/0102030405060708/event/up`,body);
    await Promise.resolve();expect(collect).toHaveBeenCalledWith(body);
    collect.mockRejectedValueOnce(new Error('collector unavailable'));
    client.emit('message',`application/${process.env.APPLICATION_ID}/device/0102030405060708/event/up`,body);
    await Promise.resolve();await Promise.resolve();expect(collect).toHaveBeenCalledTimes(2);
    client.emit('error',Object.assign(new Error('network'),{code:'ECONNRESET'}));expect(client.end).not.toHaveBeenCalled();
    stopUplinks();await handleUplinks(undefined,collect);expect(mqtt.connect.mock.calls[1][0].clientId).not.toBe(clientId);
  } finally { stopUplinks();if(oldApp===undefined)delete process.env.APPLICATION_ID;else process.env.APPLICATION_ID=oldApp;if(oldHost===undefined)delete process.env.CHIRPSTACK_HOST;else process.env.CHIRPSTACK_HOST=oldHost; }
});

// Execute the frozen baseline body against the same doubles, rather than deriving
// expected decisions from the new implementation.
test.each(['valid', 'invalid-signature', 'stale', 'bootstrap', 'duplicate', 'extension-error'])('billing is identical to baseline: %s', async scenario => {
  const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
  const source = fs.readFileSync(require('node:path').join(__dirname, '../fixtures/handle-message-baseline.txt'), 'utf8');
  const exports = {};
  const quiet = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const context = { exports, Buffer, Date, Set, logger: quiet, createMeterLogger: () => quiet,
    deviceLocks: new Set(), meterLocks: new Set(), ...store,
    getLatestTransactionNonce, runHook, notifyHook, verifyPayloadSignature, enqueue,
    encode: require('../../src/lib/encode').encode,
    decodePayload: require('../../src/lib/decode').decodePayload,
    uplinkPayload: require('../../src/lib/uplink-payload').uplinkPayload,
    meterIdFromPublicKeyContractCall: require('../../src/utils/contracts').meterIdFromPublicKeyContractCall,
    applicationId: () => 'fixture', collectorAccepted: () => undefined };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, context);
  const outputs = [];
  for (const implementation of [context.exports.handleMessage, handleMessage]) {
    resetFixture();
    if (scenario === 'invalid-signature') (verifyPayloadSignature as jest.Mock).mockReturnValue(false);
    if (scenario === 'extension-error') (runHook as jest.Mock).mockRejectedValue(new Error('fixture extension failure'));
    if (scenario === 'stale') meter.latestNonce = 8;
    await implementation(uplink(scenario === 'bootstrap' ? 0 : 1));
    if (scenario === 'duplicate') await implementation(uplink(1, 'device-a', 2000000));
    outputs.push({ downlinks: (enqueue as jest.Mock).mock.calls.map(([device, bytes]) => [device, bytes]),
      records: records.map(({receivedAt, ...record}) => record), latestNonce: meter.latestNonce,
      distribution: (notifyHook as jest.Mock).mock.calls.filter(([hook]) => hook === 'onTransactionDistribution').length,
      errors: (notifyHook as jest.Mock).mock.calls.filter(([hook]) => hook === 'onMessageError').length });
  }
  expect(outputs[1]).toEqual(outputs[0]);
});
