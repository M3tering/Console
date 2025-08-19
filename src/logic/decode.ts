import type { DecodedPayload } from "../types";

export function decodePayload(hex: string) {
  const buf = Buffer.from(hex, "hex");

  if (buf.length < 72) {
    throw new Error("Payload too short. Must be at least 72 bytes");
  }

  // --- Core fields ---
  const nonce = buf.readUInt32BE(0);

  const rawEnergy = buf.readUInt32BE(4);
  const energyKWh = rawEnergy / 1e6;

  const signature = buf.subarray(8, 72).toString("hex");

  // --- Optional extensions ---
  const ext = {} as NonNullable<DecodedPayload["extensions"]>;
  let offset = 72;

  if (buf.length >= offset + 2) {
    ext.voltage = buf.readUInt16BE(offset) / 10;
    offset += 2;
  }

  if (buf.length >= offset + 32) {
    ext.deviceId = buf.subarray(offset, offset + 32).toString("hex");
    offset += 32;
  }

  if (buf.length >= offset + 3) {
    let lon = buf.readIntBE(offset, 3); // signed 3-byte int
    ext.longitude = lon / 1e5;
    offset += 3;
  }

  if (buf.length >= offset + 3) {
    let lat = buf.readIntBE(offset, 3); // signed 3-byte int
    ext.latitude = lat / 1e5;
    offset += 3;
  }

  return {
    nonce,
    energy: energyKWh,
    signature,
    extensions: ext,
  };
}
