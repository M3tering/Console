import { handleMessage } from '../../src/services/mqtt';
import * as store from '../../src/store/sqlite';
import { getLatestTransactionNonce } from '../../src/lib/sync';
import { runHook, notifyHook, verifyPayloadSignature } from '../../src/lib/utils';
import { enqueue } from '../../src/services/grpc';

jest.mock('mqtt', () => ({ connect: jest.fn() }));
jest.mock('../../src/services/grpc', () => ({ enqueue: jest.fn() }));
jest.mock('../../src/store/sqlite', () => ({ getAllTransactionRecords: jest.fn(), getMeterByDevEui: jest.fn(), getMeterByPublicKey: jest.fn(), getTransactionByNonce: jest.fn(), recordMeterTransaction: jest.fn(), saveMeter: jest.fn(), updateMeterDevEui: jest.fn(), updateMeterNonce: jest.fn() }));
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
beforeEach(() => {
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
  (store.recordMeterTransaction as jest.Mock).mockImplementation((_, record) => { records.push(record); meter.latestNonce = record.nonce; });
});

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
test('lost acknowledgements accept exact retransmissions without duplicate writes or delivery', async () => {
  (enqueue as jest.Mock).mockRejectedValueOnce(new Error('gRPC unavailable'));
  await handleMessage(uplink()); await handleMessage(uplink());
  expect(enqueue).toHaveBeenCalledTimes(2);
  expect(store.recordMeterTransaction).toHaveBeenCalledTimes(1);
  expect((notifyHook as jest.Mock).mock.calls.filter(([name]) => name === 'onTransactionDistribution')).toHaveLength(1);
  await handleMessage(uplink(1, 'device-a', 2000000));
  expect(enqueue).toHaveBeenCalledTimes(2);
});
test('bootstrap messages use the balance hook and computation failures return off', async () => {
  (runHook as jest.Mock).mockRejectedValueOnce(new Error('RPC unavailable'));
  await handleMessage(uplink(0));
  expect(runHook).toHaveBeenCalledWith('isOnStateCompute', 1);
  expect((enqueue as jest.Mock).mock.calls[0][1][0]).toBe(0);
  expect(store.recordMeterTransaction).not.toHaveBeenCalled();
});
test('persistence failure never acknowledges uncommitted data and releases the lock', async () => {
  (store.recordMeterTransaction as jest.Mock).mockImplementationOnce(() => { throw new Error('disk full'); });
  await handleMessage(uplink()); expect(enqueue).not.toHaveBeenCalled();
  await handleMessage(uplink()); expect(enqueue).toHaveBeenCalledTimes(1);
});
