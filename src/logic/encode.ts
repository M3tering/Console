import { State, TransactionRecord } from "../types";

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
  let responseBytes = floatToByteArray(latitude).concat(
    floatToByteArray(longitude)
  );

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
  const encodedNonce = intToByteArray(nonce, 4);
  const encodedEnergy = intToByteArray(energy * 10e6, 4);
  const encodedSignature = stringToByteArray(signature, 64);
  const encodedVoltage = intToByteArray(voltage * 10, 2);
  const encodedDeviceId = stringToByteArray(deviceId, 32);
  const encodedLongitude = intToByteArray(longitude * 10e5, 3);
  const encodedLatitude = intToByteArray(latitude * 10e5, 3);

  return [
    ...encodedNonce,
    ...encodedEnergy,
    ...encodedSignature,
    ...encodedVoltage,
    ...encodedDeviceId,
    ...encodedLongitude,
    ...encodedLatitude,
  ];
}
