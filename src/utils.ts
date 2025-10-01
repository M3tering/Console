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
    const derKey = Buffer.concat([spkiPrefix, rawPubKey]);

    const publicKey = createPublicKey({
      key: derKey,
      format: "der",
      type: "spki",
    });

    // Verify
    const ok = verify(null, message, publicKey, signature);
    
    return ok;
  } catch (error) {
    console.error("Error verifying signature:", error);
    return false;
  }
}
