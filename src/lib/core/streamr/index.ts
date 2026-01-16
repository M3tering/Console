import cron from "node-cron";
import { StreamrClient } from "@streamr/sdk";
import { getAllTransactionRecords } from "../../../store/sqlite";
import { buildBatchPayload, retry } from "../../utils";
import type { BatchTransactionPayload, Hooks, TransactionRecord } from "../../../types";

const { STREAMR_STREAM_ID, ETHEREUM_PRIVATE_KEY } = process.env;

if (!STREAMR_STREAM_ID || !ETHEREUM_PRIVATE_KEY) {
  throw new Error("Missing STREAMR_STREAM_ID or ETHEREUM_PRIVATE_KEY in environment variables");
}

export default class implements Hooks {
  async onAfterInit() {
    // Schedule a cron job to publish pending transactions every hour
    cron.schedule("0 * * * *", async () => {
      console.log("Publishing pending transactions to Streamr...");
      
      const pendingTransactions = await this.getPendingTransactions();
      if (pendingTransactions.length > 0) {
        await retry(() => this.publishPendingTransactionsToStreamr(pendingTransactions), 3, 2000);
      }
    });

    return;
  }

  async getPendingTransactions(): Promise<TransactionRecord[]> {
    return getAllTransactionRecords();
  }

  async publishPendingTransactionsToStreamr(pendingTransactions: TransactionRecord[]) {
    const streamrClient = new StreamrClient({
      auth: {
        privateKey: ETHEREUM_PRIVATE_KEY!,
      },
    });

    const stream = await streamrClient.getStream(STREAMR_STREAM_ID!);

    const batchPayload = buildBatchPayload(pendingTransactions);

    await stream.publish(batchPayload);

    // destroy the client to free resources
    await streamrClient.destroy();
  }
}
