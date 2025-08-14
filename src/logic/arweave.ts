import { State, Payload } from "../types";

import { TurboFactory } from "@ardrive/turbo-sdk";
import { Readable } from "stream";
import Arweave from "arweave";

export async function interact(
  m3terId: string,
  lastNonce: number,
  payload: any,
  transactionAsBytes: number[]
) {
  const arweave = Arweave.init({
    host: "arweave.net",
    protocol: "https",
    port: 443,
  });

  const key = await arweave.wallets.generate();
  const turbo = TurboFactory.authenticated({ privateKey: key });

  const transactionBytesAsHex = Buffer.from(transactionAsBytes).toString("hex");

  const input = transactionBytesAsHex;
  const contractLabel = process.env.CONTRACT_LABEL || "M3ters";

  const byteLength = Buffer.byteLength(transactionBytesAsHex, "utf8");

  // tags payload
  // timestamp
  // meter number
  // current
  // energy
  // nonce
  // signature
  // voltage
  const [nonce, voltage, current, energy] = JSON.parse(payload[0]);
  const signature = payload[1];
  const publicKey = payload[2];

  await turbo.uploadFile({
    fileStreamFactory: () =>
      Readable.from(Buffer.from(transactionBytesAsHex, "utf8")),
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
        { name: "Current", value: current.toString() },
        { name: "Energy", value: energy.toString() },
        { name: "Nonce", value: nonce.toString() },
        { name: "Signature", value: signature },
        { name: "Voltage", value: voltage.toString() },
      ],
    },
  });

  const deviceNonce: number = JSON.parse(payload[0])[0];
  const nonceIsCardinal = lastNonce + 1 === deviceNonce;

  if (nonceIsCardinal) {
    return { is_on: true } as State;
  }

  return { nonce: lastNonce + 1, is_on: true } as State;
}
