import { TransactionRecord, BatchTransactionPayload } from "./types";

export function buildBatchPayload(transactions: TransactionRecord[]): BatchTransactionPayload {
  const payload: BatchTransactionPayload = {};

  for (const tx of transactions) {
    if (!tx.identifier) {
      continue;
    }

    if (!payload[tx.identifier]) {
      payload[tx.identifier] = [];
    }
    payload[tx.identifier].push(tx.raw!);
  }

  return payload;
}
