import { configurePublications, publishManaged } from '../../src/central/distribution';
import type { TransactionRecord } from '../../src/types';

const record = (nonce: number): TransactionRecord => ({ identifier: 7, nonce, receivedAt: 1, raw: '' });
const role = process.env.CONSOLE_ROLE;
afterEach(() => { if (role === undefined) delete process.env.CONSOLE_ROLE; else process.env.CONSOLE_ROLE = role; });

test('central resends to the prover and Streamr every run, but uploads to Arweave and runs each module hook once', async () => {
  process.env.CONSOLE_ROLE = 'central'; configurePublications(':memory:');
  const send = jest.fn(async () => 'sent');
  for (const destination of ['prover:https://prover.example', 'streamr:stream/a']) {
    expect(await publishManaged(destination, [record(1)], send)).toBe('sent');
    expect(await publishManaged(destination, [record(1)], send)).toBe('sent'); // not confirmed on-chain yet: send again
  }
  for (const destination of ['arweave', 'hook:core/prover', 'hook:core/arweave']) {
    expect(await publishManaged(destination, [record(1)], send)).toBe('sent');
    expect(await publishManaged(destination, [record(1)], send)).toBeNull();   // once per reading
  }
  expect(send).toHaveBeenCalledTimes(7);
});

test('a managed gateway sends only to the prover (including through the module hook), without keeping a record', async () => {
  process.env.CONSOLE_ROLE = 'gateway';
  const send = jest.fn(async () => 'sent');
  expect(await publishManaged('hook:core/prover', [record(1)], send)).toBe('sent');
  expect(await publishManaged('hook:core/prover', [record(1)], send)).toBe('sent');
  expect(await publishManaged('prover:https://prover.example', [record(1)], send)).toBe('sent');
  for (const destination of ['arweave', 'hook:core/arweave', 'streamr:stream/a', 'hook:core/streamr'])
    expect(await publishManaged(destination, [record(1)], send)).toBeNull();
  expect(send).toHaveBeenCalledTimes(3);
});

test('standalone always sends', async () => {
  delete process.env.CONSOLE_ROLE;
  const send = jest.fn(async () => 'sent');
  for (const destination of ['arweave', 'prover:x', 'streamr:y', 'hook:core/prover']) expect(await publishManaged(destination, [record(1)], send)).toBe('sent');
});
