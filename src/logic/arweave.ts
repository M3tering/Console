import { TurboFactory } from "@ardrive/turbo-sdk";
import { Readable } from "stream";
import Arweave from "arweave";
import { decodePayload } from "./decode";
import type { M3terPayload } from "../types";

export async function interact(
  m3terId: string,
  payload: M3terPayload
) {
  // encode transaction into standard format (payload[0])
  // format: nonce | energy | signature | voltage | device_id | longitude | latitude
  const transactionHex = payload[0];

  const { nonce, energy, signature, extensions } =
    decodePayload(transactionHex);
  let voltage, identifier, longitude, latitude;

  if (extensions !== null && typeof extensions === "object") {
    voltage = extensions.voltage ?? null;
    identifier = extensions.deviceId ?? null;
    longitude = extensions.longitude ?? null;
    latitude = extensions.latitude ?? null;
  }

  const arweave = Arweave.init({
    host: "arweave.net",
    protocol: "https",
    port: 443,
  });

  const key = await arweave.wallets.generate();
  const turbo = TurboFactory.authenticated({ privateKey: key });

  const input = transactionHex;
  const contractLabel = process.env.CONTRACT_LABEL || "M3ters";

  const byteLength = Buffer.byteLength(transactionHex, "utf8");

  // tags payload
  // timestamp
  // meter number
  // energy
  // nonce
  // signature
  // voltage
  return await turbo.uploadFile({
    fileStreamFactory: () => Readable.from(Buffer.from(transactionHex, "utf8")),
    fileSizeFactory: () => byteLength,
    dataItemOpts: {
      tags: [
        { name: "Input", value: JSON.stringify(input) },
        { name: "Contract-Label", value: contractLabel },
        { name: "Contract-Use", value: "M3tering Protocol" },
        { name: "Content-Type", value: "text/plain" },
        { name: "M3ter-ID", value: m3terId },
        { name: "Timestamp", value: Date.now().toString() },
        { name: "Meter-Number", value: m3terId },
        { name: "Energy", value: energy.toString() },
        { name: "Nonce", value: nonce.toString() },
        { name: "Signature", value: signature },
        { name: "Voltage", value: voltage?.toString() ?? "" },
      ],
    },
  });
}
