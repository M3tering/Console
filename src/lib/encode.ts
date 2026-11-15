import { State } from "../types";

export function intToByteArray(num: number, byteLength: number = 4) {
  const byteArray = new Uint8Array(byteLength);
  for (let i = 0; i < byteLength; i++) {
    byteArray[byteLength - 1 - i] = (num >> (i * 8)) & 0xff;
  }
  return Array.from(byteArray);
}

export function stringToByteArray(str: string, length: number | null = null) {
  const encoder = new TextEncoder(); // UTF-8
  const encoded = encoder.encode(str);
  const byteArray = new Uint8Array(length === null ? encoded.length : length);
  byteArray.set(encoded.slice(0, length == null ? encoded.length : length)); // truncate if longer
  return Array.from(byteArray);
}

function floatToByteArray(float: number) {
  const buffer = new ArrayBuffer(4); // 4 bytes for a float (32-bit)
  const view = new DataView(buffer);
  view.setFloat32(0, float, false); // false for Big Endian
  return Array.from(new Uint8Array(buffer));
}

/**
 *
 * @notice only needs `nonce` from the state
 */
export function encode(state: State, latitude: number, longitude: number) {
  let responseBytes = floatToByteArray(latitude).concat(floatToByteArray(longitude));

  let nonce = state.nonce;

  if (nonce) {
    responseBytes = intToByteArray(nonce).concat(responseBytes);
  }

  responseBytes.unshift(state.is_on ? 1 : 0);
  return responseBytes;
}

/**
 * Encode transaction data into a byte array.
 *
 * format: nonce(4 bytes) | energy (4 bytes) | signature(64 bytes) | voltage(2 bytes) | device_id(32 bytes) | longitude(3 bytes) | latitude(3 bytes)
 *
 * @param nonce - The transaction nonce.
 * @param energy - The energy value.
 * @param signature - The transaction signature.
 * @param voltage - The voltage value.
 * @param deviceId - The device ID.
 * @param longitude - The longitude value.
 * @returns The encoded transaction byte array.
 */
export function encodeTransaction({
  nonce,
  energy,
  signature,
  voltage,
  deviceId,
  longitude,
  latitude,
}: {
  nonce: number;
  energy: number;
  signature: string;
  voltage: number;
  deviceId: string;
  longitude: number;
  latitude: number;
}) {
  const hexBytes = (value: string, length: number, name: string): Buffer => {
    const raw = value.replace(/^0x/, '');
    if (!new RegExp(`^[0-9a-fA-F]{${length * 2}}$`).test(raw)) throw new Error(`${name} must contain ${length} hexadecimal bytes`);
    return Buffer.from(raw, 'hex');
  };
  const scaled = (value: number, scale: number, name: string): number => {
    if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
    return Math.round(value * scale);
  };
  if (!Number.isInteger(nonce) || nonce < 0) throw new Error('Nonce must be a non-negative integer');
  const result = Buffer.alloc(112);
  result.writeUInt32BE(nonce, 0);
  result.writeUInt32BE(scaled(energy, 1e6, 'Energy'), 4);
  hexBytes(signature, 64, 'Signature').copy(result, 8);
  result.writeUInt16BE(scaled(voltage, 10, 'Voltage'), 72);
  hexBytes(deviceId, 32, 'Device ID').copy(result, 74);
  // Signed 24-bit coordinates retain the existing device wire format.
  result.writeIntBE(scaled(longitude, 1e5, 'Longitude'), 106, 3);
  result.writeIntBE(scaled(latitude, 1e5, 'Latitude'), 109, 3);
  return Array.from(result);
}
