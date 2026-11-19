jest.mock('../../src/store/sqlite', () => ({ getMeterByPublicKey: jest.fn(), mergeBillingSnapshot: jest.fn(), readBillingSnapshot: jest.fn() }));
jest.mock('../../src/utils/contracts', () => ({ meterIdFromPublicKeyContractCall: jest.fn(async () => 7), meterLatestNonceContractCall: jest.fn(async () => 100) }));
jest.mock('../../src/lib/utils', () => ({ verifyPayloadSignature: jest.fn(() => true), distributeManaged: jest.fn(async () => {}) }));
jest.mock('../../src/services/mqtt', () => ({ handleMessage: jest.fn() }));
import { importBillingSnapshot } from '../../src/central/billing';
import { getMeterByPublicKey, mergeBillingSnapshot } from '../../src/store/sqlite';
import { verifyPayloadSignature } from '../../src/lib/utils';
import type { BillingSnapshot } from '../../src/central/processor';

const publicKey = `0x${'a'.repeat(64)}`;
const record = (nonce: number) => { const raw = Buffer.alloc(74); raw.writeUInt32BE(nonce, 0); return { nonce, identifier: 7, receivedAt: 1, raw: raw.toString('hex') }; };
const snapshot = (...nonces: number[]): BillingSnapshot => ({ meter: { devEui: 'fadf417b946e25ef', publicKey, tokenId: 7, latestNonce: Math.max(...nonces) }, transactions: nonces.map(record) });
beforeEach(() => { jest.clearAllMocks(); jest.spyOn(console, 'log').mockImplementation(() => {}); });
afterEach(() => jest.restoreAllMocks());

test('a meter new to central starts its history at the oldest signed record, then gaps are refused again', async () => {
  (getMeterByPublicKey as jest.Mock).mockReturnValue(undefined);
  // The chain has nonce 100; the gateway, which ran standalone first, replays 1246.
  await importBillingSnapshot(snapshot(1246));
  expect(mergeBillingSnapshot).toHaveBeenCalledTimes(1);
  // Now central knows the meter at 1246: the next record must follow on.
  (getMeterByPublicKey as jest.Mock).mockReturnValue({ publicKey, tokenId: 7, devEui: 'fadf417b946e25ef', latestNonce: 1246 });
  await importBillingSnapshot(snapshot(1247));
  await expect(importBillingSnapshot(snapshot(1250))).rejects.toThrow('gap before nonce 1250 (central can confirm up to 1246)');
  expect(mergeBillingSnapshot).toHaveBeenCalledTimes(2);
});

test('first contact still checks signatures and the token', async () => {
  (getMeterByPublicKey as jest.Mock).mockReturnValue(undefined);
  (verifyPayloadSignature as jest.Mock).mockReturnValueOnce(false);
  await expect(importBillingSnapshot(snapshot(1246))).rejects.toThrow('Invalid signed reconciliation record');
  await expect(importBillingSnapshot({ ...snapshot(1246), meter: { ...snapshot(1246).meter!, tokenId: 8 } })).rejects.toThrow('token does not match');
  expect(mergeBillingSnapshot).not.toHaveBeenCalled();
});
