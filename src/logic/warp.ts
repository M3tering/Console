import { State, Payload } from "../types";

import { TurboFactory } from "@ardrive/turbo-sdk";
import { Readable } from "stream";
import Arweave from "arweave";

export async function interact(m3terId: string, lastNonce: number, payload: Payload) {

  const arweave = Arweave.init({
    host: "arweave.net",
    protocol: "https",
    port: 443,
  });

  const key = await arweave.wallets.generate();
  const turbo = TurboFactory.authenticated({ privateKey: key });

  const input = { payload, function: "meter" };
  const contractLabel = process.env.CONTRACT_LABEL || "M3ters";
  const tags = [
    { name: "Input", value: input.toString() },
    { name: "Contract-Label", value: contractLabel },
    { name: "Contract-Use", value: "M3tering Protocol" },
    { name: "Content-Type", value: "application/json" },
    { name: "M3ter-ID", value: m3terId },
  ];

  const byteLength = Buffer.byteLength(JSON.stringify(input), "utf8");
  console.log("data size:", byteLength);
  const { id, owner, dataCaches, fastFinalityIndexes } =
    await turbo.uploadFile({
      fileStreamFactory: () => Readable.from(Buffer.from(JSON.stringify(input), "utf8")),
      fileSizeFactory: () => byteLength,
      dataItemOpts: {
        tags: [
          // { name: "Contract-Label", value: contractLabel },
          { name: "Contract-Use", value: "M3tering Protocol" },
          { name: "Content-Type", value: "application/json" },
          { name: "M3ter-ID", value: m3terId },
        ]
      }
    });


  console.log(id, owner);


  const deviceNonce: number = JSON.parse(payload[0])[0];
  const nonceIsCardinal = lastNonce + 1 === deviceNonce

  if (deviceNonce > lastNonce && !nonceIsCardinal) {
    return { is_on: true } as State;
  } else if (deviceNonce <= lastNonce) {
    return { nonce: lastNonce + 1, is_on: true } as State;
  }

  return null;
}
