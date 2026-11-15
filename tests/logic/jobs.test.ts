import cron from 'node-cron';
import { getSyncedPendingTransactions } from '../../src/lib/sync';
jest.mock('node-cron', () => ({ schedule: jest.fn() }));
jest.mock('@streamr/sdk', () => ({ StreamrClient: jest.fn() }));
jest.mock('../../src/lib/sync', () => ({ getSyncedPendingTransactions: jest.fn() }));
jest.mock('../../src/store/sqlite', () => ({}));
const old = { prover: process.env.PREFERRED_PROVER_NODE, key: process.env.ETHEREUM_PRIVATE_KEY, stream: process.env.STREAMR_STREAM_ID };
beforeAll(() => { process.env.PREFERRED_PROVER_NODE = 'https://prover.example'; process.env.ETHEREUM_PRIVATE_KEY = 'test-only'; process.env.STREAMR_STREAM_ID = 'test-stream'; });
afterAll(() => {
  for (const [name, value] of Object.entries({ PREFERRED_PROVER_NODE: old.prover, ETHEREUM_PRIVATE_KEY: old.key, STREAMR_STREAM_ID: old.stream })) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});
test.each(['prover', 'streamr'])('%s cron waits for a synchronized batch before delivery', async type => {
  jest.clearAllMocks();
  const Module = require(`../../src/lib/core/${type}`).default;
  const extension = new Module();
  const method = type === 'prover' ? 'sendPendingTransactionsToProver' : 'publishPendingTransactionsToStreamr';
  const deliver = jest.spyOn(extension, method).mockResolvedValue({ text: async () => 'ok' });
  let resume!: (records: any[]) => void;
  (getSyncedPendingTransactions as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { resume = resolve; }));
  await extension.onAfterInit();
  const callback = (cron.schedule as jest.Mock).mock.calls[0][1];
  const running = callback();
  expect(deliver).not.toHaveBeenCalled();
  const records = [{ nonce: 3, identifier: 42, raw: 'abc', receivedAt: 1 }];
  resume(records); await running;
  expect(deliver).toHaveBeenCalledWith(type === 'prover' ? 'https://prover.example' : 'test-stream', records);
});
