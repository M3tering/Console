import { TransactionRecord, BatchTransactionPayload } from "./types";

export function buildBatchPayload(transactions: TransactionRecord[]): BatchTransactionPayload[] {
  return transactions.map((transaction) => ({
    meter_id: Number(transaction.identifier),
    message: transaction.raw,
  }));
}
