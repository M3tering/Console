import { TurboFactory } from "@ardrive/turbo-sdk";
import { Readable } from "stream";
import Arweave from "arweave";
import type { DecodedPayload, M3terPayload } from "../types";

export async function interact(
  m3terId: number,
  payload: M3terPayload,
  decoded: DecodedPayload
) {
  // encode transaction into standard format (payload[0])
  // format: nonce | energy | signature | voltage | device_id | longitude | latitude
  const transactionHex = payload[0];

  const arweave = Arweave.init({
    host: "arweave.net",
    protocol: "https",
    port: 443,
  });

  const key = await arweave.wallets.generate();
  const turbo = TurboFactory.authenticated({ privateKey: key });

  const contractLabel = process.env.CONTRACT_LABEL || "M3ters";

  const byteLength = Buffer.byteLength(transactionHex, "utf8");

  return await turbo.uploadFile({
    fileStreamFactory: () => Readable.from(Buffer.from(transactionHex, "utf8")),
    fileSizeFactory: () => byteLength,
    dataItemOpts: {
      tags: [
        { name: "Contract-Label", value: contractLabel },
        { name: "Contract-Use", value: "M3tering Protocol" },
        { name: "Content-Type", value: "text/plain" },
        { name: "M3ter-ID", value: m3terId.toString() },
        { name: "payload", value: JSON.stringify(decoded) },
        { name: "Timestamp", value: Date.now().toString() },
        { name: "Message", value: transactionHex.substring(0, 16) }, // nonce and energy bytes
        { name: "Signature", value: transactionHex.substring(16, 144) }, // signature bytes
      ],
    },
  });
}
