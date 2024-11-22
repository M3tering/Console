import { State } from "../types";

function intToByteArray(num: number) {
  const byteArray = new Uint8Array(4);
  byteArray[0] = (num >> 24) & 0xff; // Most significant byte
  byteArray[1] = (num >> 16) & 0xff;
  byteArray[2] = (num >> 8) & 0xff;
  byteArray[3] = num & 0xff; // Least significant byte
  return Array.from(byteArray);
}

function floatToByteArray(float: number) {
  const buffer = new ArrayBuffer(4); // 4 bytes for a float (32-bit)
  const view = new DataView(buffer);
  view.setFloat32(0, float, false); // false for Big Endian
  return Array.from(new Uint8Array(buffer));
}

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
