import { decodePayload } from '../decode';
import { verifyPayloadSignature } from '../utils';
import { decodeElectrical, ElectricalTelemetry } from './electrical';

export type Telemetry = {
  decoder: string; nonce: number; rawEnergy: number; energy: number; rawVoltage: number; voltage: number;
  signature: string; publicKey: string | null; verificationKey: string | null; verification: 'verified' | 'invalid' | 'unverified';
};
// Additional firmware ports can register their own decoder without changing raw event storage.
export const telemetryDecoders = new Map<number, (data: Buffer, key?: string) => Telemetry | ElectricalTelemetry>([[2, (data, knownKey) => {
  if (![74, 106].includes(data.length)) throw new Error('FPort 2 requires exactly 74 or 106 bytes');
  const decoded = decodePayload(data);
  const publicKey = decoded.extensions.deviceId || null;
  const key = knownKey || publicKey;
  const verification = key ? (verifyPayloadSignature(data, Buffer.from(key.replace(/^0x/, ''), 'hex')) ? 'verified' : 'invalid') : 'unverified';
  return { decoder: 'switch-cumulus-v1', nonce: decoded.nonce, rawEnergy: data.readUInt32BE(4), energy: decoded.energy,
    rawVoltage: data.readUInt16BE(72), voltage: decoded.extensions.voltage!, signature: decoded.signature, publicKey, verificationKey: key?.replace(/^0x/, '') || null, verification };
}], [4, decodeElectrical]]);

export function decodeTelemetry(fPort: 2, data: Buffer, knownKey?: string): Telemetry;
export function decodeTelemetry(fPort: 4, data: Buffer, knownKey?: string): ElectricalTelemetry;
export function decodeTelemetry(fPort: number, data: Buffer, knownKey?: string): Telemetry | ElectricalTelemetry;
export function decodeTelemetry(fPort: number, data: Buffer, knownKey?: string): Telemetry | ElectricalTelemetry {
  const decode = telemetryDecoders.get(fPort);
  if (!decode) throw new Error(`No telemetry decoder for FPort ${fPort}`);
  return decode(data, knownKey);
}

/** A codec's report object may supply scaled fields; raw bytes still authenticate
 * nonce/energy. Never accept an upstream claim that a signature was verified. */
export function reportObject(value: any, data: Buffer, knownKey?: string): Telemetry | null {
  if (!value || value.type !== 'report' || ![74,106].includes(data.length)) return null;
  if (value.nonce !== data.readUInt32BE(0) || value.energy !== data.readUInt32BE(4) / 1e6 || value.voltage !== data.readUInt16BE(72) / 10 ||
      typeof value.signature !== 'string' || value.signature.toLowerCase().replace(/^0x/, '') !== data.subarray(8,72).toString('hex')) return null;
  const publicKey = data.length === 106 ? data.subarray(74).toString('hex') : null;
  const key = knownKey || publicKey;
  return { decoder: 'switch-cumulus-v1', nonce: value.nonce, energy: value.energy, rawEnergy: data.readUInt32BE(4), voltage: value.voltage,
    rawVoltage: data.readUInt16BE(72), signature: data.subarray(8,72).toString('hex'), publicKey, verificationKey: key?.replace(/^0x/,'') || null,
    verification: key ? (verifyPayloadSignature(data,Buffer.from(key.replace(/^0x/,''),'hex')) ? 'verified' : 'invalid') : 'unverified' };
}
