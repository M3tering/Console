import { generateKeyPairSync, sign } from 'crypto';
import { decodeTelemetry, reportObject } from '../../src/m3ter/decoder';
import { decodePayload } from '../../src/lib/decode';
const keys = generateKeyPairSync('ed25519');
const publicKey = keys.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
function payload(length: number, nonce = 0) {
  const bytes = Buffer.alloc(length); bytes.writeUInt32BE(nonce,0); bytes.writeUInt32BE(12345678,4);
  sign(null, bytes.subarray(0,8), keys.privateKey).copy(bytes,8); bytes.writeUInt16BE(2301,72);
  if (length === 106) publicKey.copy(bytes,74); return bytes;
}
test.each([74,106])('%d byte telemetry reuses the existing decoder and exact scaling', length => {
  const data = payload(length, length === 74 ? 4294967295 : 0), decoded = decodeTelemetry(2,data, length === 74 ? publicKey.toString('hex') : undefined);
  expect(decoded).toMatchObject({ nonce: length === 74 ? 4294967295 : 0, rawEnergy: 12345678, energy: 12.345678, rawVoltage: 2301, voltage: 230.1, verification:'verified' });
  expect(decoded.energy).toBe(decodePayload(data).energy); expect(decoded.voltage).toBe(decodePayload(data).extensions.voltage);
  expect(decoded.signature).toHaveLength(128); expect(decoded.publicKey).toBe(length === 106 ? publicKey.toString('hex') : null);
  expect(decoded).not.toHaveProperty('latitude'); expect(decoded).not.toHaveProperty('longitude');
});
test('never claims verification without a known key and detects tampering', () => {
  const data = payload(74, 1); expect(decodeTelemetry(2,data).verification).toBe('unverified');
  data[0] ^= 1; expect(decodeTelemetry(2,data,publicKey.toString('hex')).verification).toBe('invalid');
});
test('voltage is explicitly outside the verified signature region', () => {
  const data = payload(106); data.writeUInt16BE(6900,72);
  expect(decodeTelemetry(2,data)).toMatchObject({ voltage: 690, verification:'verified' });
});
test.each([0,1,72,73,75,105,107,112,256])('rejects invalid length %d', length => { expect(() => decodeTelemetry(2,Buffer.alloc(length))).toThrow(); });
test.each([0,1,3,200,201,202])('does not decode unrelated FPort %d', port => { expect(() => decodeTelemetry(port,payload(74))).toThrow(); });
test('report codec objects retain independent raw-byte signature verification', () => {
  const bytes=payload(106), raw=decodeTelemetry(2,bytes);
  expect(reportObject({type:'report',...raw},bytes)).toEqual(raw);
  expect(reportObject({type:'telemetry',...raw},bytes)).toBeNull();
  expect(reportObject({type:'report',...raw,energy:999},bytes)).toBeNull();
  bytes[8]^=1;
  expect(reportObject({type:'report',...raw,signature:bytes.subarray(8,72).toString('hex'),verification:'verified'},bytes)?.verification).toBe('invalid');
});
