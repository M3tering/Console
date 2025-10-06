import { TransactionRecord, BatchTransactionPayload } from "./types";
import { createPublicKey, verify } from "crypto";

export function buildBatchPayload(transactions: TransactionRecord[]): BatchTransactionPayload[] {
  return transactions.map((transaction) => ({
    m3ter_id: Number(transaction.identifier),
    message: transaction.raw,
  }));
}

export function verifyPayloadSignature(transaction: Buffer, rawPubKey: Buffer): boolean {
  try {
    const message = transaction.subarray(0, 8);
    const signature = transaction.subarray(8, 72);

    // Wrap raw key in SPKI DER
    const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
    const derKey = Buffer.concat([new Uint8Array(spkiPrefix), new Uint8Array(rawPubKey)]);

    const publicKey = createPublicKey({
      key: derKey,
      format: "der",
      type: "spki",
    });

    // Verify
    const ok = verify(null, new Uint8Array(message), publicKey, new Uint8Array(signature));

    return ok;
  } catch (error) {
    console.error("Error verifying signature:", error);
    return false;
  }
}
