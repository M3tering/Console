import { TransactionRecord, BatchTransactionPayload } from "./types";
import { createPublicKey, verify } from "crypto";

/**
 * Retries a function up to 5 times with exponential backoff
 * @param fn Function to retry
 * @param maxRetries Maximum number of retries (default: 5)
 * @param baseDelay Base delay in milliseconds (default: 1000)
 * @returns Promise that resolves with the function result or rejects with the last error
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 5,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt === maxRetries) {
        throw lastError;
      }
      
      const delay = baseDelay * Math.pow(2, attempt);
      console.log(`Attempt ${attempt + 1} failed, retrying in ${delay}ms...`, error);
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError!;
}

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
