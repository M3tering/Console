jest.mock('../../src/store/sqlite', () => ({ getMeterByPublicKey: jest.fn(), mergeBillingSnapshot: jest.fn(), readBillingSnapshot: jest.fn() }));
jest.mock('../../src/utils/contracts', () => ({ meterIdFromPublicKeyContractCall: jest.fn(async () => 7), meterLatestNonceContractCall: jest.fn(async () => 0) }));
jest.mock('../../src/lib/utils', () => ({ verifyPayloadSignature: jest.fn(() => true), distributeManaged: jest.fn(async () => {}) }));
jest.mock('../../src/services/mqtt', () => ({ handleMessage: jest.fn() }));
import { configurePublications, publishManaged } from '../../src/central/distribution';
import { importBillingSnapshot, withProverSends } from '../../src/central/billing';
import { getMeterByPublicKey } from '../../src/store/sqlite';
import { distributeManaged } from '../../src/lib/utils';
import { validOutcome } from '../../src/central/rpc';
import { OperationJournal } from '../../src/central/operations';
import { Replication } from '../../src/central/replication';
import type { BillingSnapshot, Decider, Outcome } from '../../src/central/processor';

const raw = (nonce: number) => { const b = Buffer.alloc(74); b.writeUInt32BE(nonce, 0); return b.toString('hex'); };
const record = (nonce: number) => ({ identifier: 7, nonce, receivedAt: 1, raw: raw(nonce) });
const snapshot = (nonce: number): BillingSnapshot => ({ meter: { devEui: 'fadf417b946e25ef', publicKey: `0x${'a'.repeat(64)}`, tokenId: 7, latestNonce: nonce }, transactions: [record(nonce)] });
const PROVER = 'prover:https://prover.example';
const role = process.env.CONSOLE_ROLE;
beforeEach(() => { jest.clearAllMocks(); jest.spyOn(console, 'log').mockImplementation(() => {}); });
afterEach(() => { jest.restoreAllMocks(); if (role === undefined) delete process.env.CONSOLE_ROLE; else process.env.CONSOLE_ROLE = role; });

test('a managed gateway sends only to the prover, records it, and reports it at handover', async () => {
  process.env.CONSOLE_ROLE = 'gateway'; configurePublications(':memory:');
  const send = jest.fn(async () => 'ok');
  expect(await publishManaged('arweave', [record(1)], send)).toBeNull();
  expect(await publishManaged('streamr:s', [record(1)], send)).toBeNull();
  expect(await publishManaged(PROVER, [record(1)], send)).toBe('ok');
  expect(send).toHaveBeenCalledTimes(1);
  expect(await publishManaged(PROVER, [record(1)], send)).toBeNull(); // never twice
  await expect(publishManaged(PROVER, [record(2)], async () => { throw new Error('reply lost'); })).rejects.toThrow('uncertain');
  const outcome: Outcome = { id: 'r', state: 'decided', active: false, decision: null, snapshot: { ...snapshot(2), transactions: [record(1), record(2), record(3)] } };
  expect(withProverSends(outcome).snapshot!.published).toEqual([
    { destination: PROVER, tokenId: 7, nonce: 1, state: 'submitted' },
    { destination: PROVER, tokenId: 7, nonce: 2, state: 'uncertain' },
  ]);
  expect(validOutcome(withProverSends(outcome), 'r')).toBe(true);
});

test('central adopts the gateway\'s prover sends before publishing, so they are not sent again', async () => {
  process.env.CONSOLE_ROLE = 'central'; configurePublications(':memory:');
  (getMeterByPublicKey as jest.Mock).mockReturnValue(undefined);
  await importBillingSnapshot({ ...snapshot(5), published: [
    { destination: PROVER, tokenId: 7, nonce: 5, state: 'submitted' },
    { destination: PROVER, tokenId: 7, nonce: 99, state: 'submitted' }, // not in this handover: ignored
  ] });
  expect(distributeManaged).toHaveBeenCalledTimes(1);
  const send = jest.fn(async () => 'sent');
  expect(await publishManaged(PROVER, [record(5)], send)).toBeNull(); // already sent by the gateway
  expect(await publishManaged(PROVER, [record(99)], send)).toBe('sent'); // a forged entry suppressed nothing
  expect(await publishManaged('prover:https://other.example', [record(5)], send)).toBe('sent'); // another prover still gets it
});

test('a gateway importing central\'s decisions publishes nothing', async () => {
  process.env.CONSOLE_ROLE = 'gateway'; configurePublications(':memory:');
  (getMeterByPublicKey as jest.Mock).mockReturnValue(undefined);
  await importBillingSnapshot(snapshot(5));
  expect(distributeManaged).not.toHaveBeenCalled();
});

test('the handover reads the gateway\'s outcome again, so sends finished after the decision are included', async () => {
  const journal = new OperationJournal(':memory:');
  const event = { deduplicationId: 'replay-1', fPort: 2, deviceInfo: { devEui: 'fadf417b946e25ef', applicationId: '11111111-1111-4111-8111-111111111111' }, data: Buffer.from(raw(5), 'hex').toString('base64') };
  const stored: Outcome = { id: 'replay-1', state: 'decided', active: false, decision: null, snapshot: snapshot(5) };
  const fresh: Outcome = { ...stored, snapshot: { ...snapshot(5), published: [{ destination: PROVER, tokenId: 7, nonce: 5, state: 'submitted' }] } };
  const reconcile = jest.fn(async () => {});
  const central = { offer: jest.fn(), commit: jest.fn(), outcome: jest.fn(), reconcile } as unknown as Decider;
  const local = { offer: jest.fn(), commit: jest.fn(), outcome: jest.fn(async () => fresh) } as unknown as Decider;
  try {
    journal.receive('gateway', event as never);
    const replication = new Replication(journal, central, local);
    await replication.observe('local', stored);
    expect(reconcile).toHaveBeenCalledWith('gateway', expect.anything(), expect.objectContaining({ decision: null, snapshot: fresh.snapshot }));
  } finally { journal.close(); }
});
