import { ArweaveSigner, TurboFactory } from "@ardrive/turbo-sdk";
import { Readable } from "stream";
import Arweave from "arweave";
import type { DecodedPayload, Hooks } from "../../../types";
import { createLogger } from "../../../utils/logger";

const logger = createLogger("[arweave]");

export default class implements Hooks {
  async onTransactionDistribution(m3terId: number, decoded: DecodedPayload) {
    // encode transaction into standard format (payload[0])
    // format: nonce | energy | signature | voltage | device_id | longitude | latitude
    const transactionHex = decoded.buf;

    const arweave = Arweave.init({
      host: "arweave.net",
      protocol: "https",
      port: 443,
    });

    const key = await arweave.wallets.generate();
    const signer = new ArweaveSigner(key);
    const turbo = TurboFactory.authenticated({ signer });

    const contractLabel = process.env.CONTRACT_LABEL || "M3ters";

    const byteLength = Buffer.byteLength(transactionHex.toString("hex"), "utf8");

    await turbo.uploadFile({
      fileStreamFactory: () => Readable.from(transactionHex.toString("hex"), { encoding: "utf8" }),
      fileSizeFactory: () => byteLength,
      dataItemOpts: {
        paidBy: await arweave.wallets.jwkToAddress(key),
        tags: [
          { name: "Contract-Label", value: contractLabel },
          { name: "Contract-Use", value: "M3tering Protocol Test" },
          { name: "Content-Type", value: "text/plain" },
          { name: "M3ter-ID", value: m3terId.toString() },
          { name: "Timestamp", value: Date.now().toString() },
          { name: "Nonce", value: decoded.nonce.toString() },
          { name: "Energy", value: decoded.energy.toString() },
          { name: "Signature", value: decoded.signature },
          { name: "Voltage", value: decoded.extensions?.voltage?.toString() ?? "" },
          { name: "Device-ID", value: decoded.extensions?.deviceId?.toString() ?? "" },
          { name: "Longitude", value: decoded.extensions?.longitude?.toString() ?? "" },
          { name: "Latitude", value: decoded.extensions?.latitude?.toString() ?? "" },
        ],
      },
      events: {
        onUploadProgress: (progress) => {
          logger.info("Upload progress:", progress);
        },
        onError: (error) => {
          logger.error("Upload error:", error);
        },
        onSuccess(event) {
          logger.info("Upload successful! Transaction ID:", event);
        },
        onUploadSuccess(event) {
          logger.info("Upload completed! Transaction ID:", event);
        },
      },
    });

    logger.info(`Uploaded transaction ${decoded.nonce} for M3ter ID ${m3terId} to Arweave.`);
  }
}
