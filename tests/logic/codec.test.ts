import { generateKeyPairSync, sign } from 'crypto';
import { encodeTransaction } from '../../src/lib/encode';
import { decodePayload } from '../../src/lib/decode';
import { verifyPayloadSignature } from '../../src/lib/utils';

const record = { nonce: 12, energy: 1.234567, signature: 'ab'.repeat(64), deviceId: 'cd'.repeat(32), voltage: 230.1, longitude: -12.34567, latitude: 43.21098 };
test('transaction bytes round trip without scaling or hex corruption', () => {
  const decoded = decodePayload(Buffer.from(encodeTransaction(record)));
  expect(decoded).toMatchObject({ nonce: record.nonce, energy: record.energy, signature: record.signature, extensions: { deviceId: record.deviceId, voltage: record.voltage, longitude: record.longitude, latitude: record.latitude } });
});
test('a real Ed25519 signature remains valid after encoding', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const message = Buffer.alloc(8); message.writeUInt32BE(record.nonce, 0); message.writeUInt32BE(1234567, 4);
  const rawKey = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const encoded = Buffer.from(encodeTransaction({ ...record, signature: sign(null, message, privateKey).toString('hex'), deviceId: '0x' + rawKey.toString('hex') }));
  expect(verifyPayloadSignature(encoded, rawKey)).toBe(true);
});
test.each([{ signature: 'bad' }, { deviceId: 'zz'.repeat(32) }, { energy: NaN }, { nonce: -1 }, { longitude: 180 }])('rejects malformed or unrepresentable values %j', override => {
  expect(() => encodeTransaction({ ...record, ...override })).toThrow();
});
