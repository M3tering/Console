import { decodePayload } from '../lib/decode';
import { verifyPayloadSignature } from '../lib/utils';

export type Telemetry = {
  decoder: string; nonce: number; rawEnergy: number; energy: number; rawVoltage: number; voltage: number;
  signature: string; publicKey: string | null; verificationKey: string | null; verification: 'verified' | 'invalid' | 'unverified';
};
// Additional firmware ports can register their own decoder without changing raw event storage.
export const telemetryDecoders = new Map<number, (data: Buffer, key?: string) => Telemetry>([[2, (data, knownKey) => {
  if (![74, 106].includes(data.length)) throw new Error('FPort 2 requires exactly 74 or 106 bytes');
  const decoded = decodePayload(data);
  const publicKey = decoded.extensions.deviceId || null;
  const key = knownKey || publicKey;
  const verification = key ? (verifyPayloadSignature(data, Buffer.from(key.replace(/^0x/, ''), 'hex')) ? 'verified' : 'invalid') : 'unverified';
  return { decoder: 'switch-cumulus-v1', nonce: decoded.nonce, rawEnergy: data.readUInt32BE(4), energy: decoded.energy,
    rawVoltage: data.readUInt16BE(72), voltage: decoded.extensions.voltage!, signature: decoded.signature, publicKey, verificationKey: key?.replace(/^0x/, '') || null, verification };
}]]);

export function decodeTelemetry(fPort: number, data: Buffer, knownKey?: string): Telemetry {
  const decode = telemetryDecoders.get(fPort);
  if (!decode) throw new Error(`No telemetry decoder for FPort ${fPort}`);
  return decode(data, knownKey);
}
