import cron from "node-cron";
import { StreamrClient } from "@streamr/sdk";
import { getAllTransactionRecords } from "../../../store/sqlite";
import { buildBatchPayload, loadConfigurations, retry } from "../../utils";
import type { BatchTransactionPayload, Hooks, TransactionRecord } from "../../../types";

const { ETHEREUM_PRIVATE_KEY } = process.env;

if (!ETHEREUM_PRIVATE_KEY) {
  throw new Error("Missing ETHEREUM_PRIVATE_KEY in environment variables");
}

export default class implements Hooks {
  private config = loadConfigurations();

  async onAfterInit() {
    // Schedule a cron job to publish pending transactions every hour
    cron.schedule(this.config.streamr.cronSchedule, async () => {
      console.log("Publishing pending transactions to Streamr...");

      const pendingTransactions = await this.getPendingTransactions();
      if (pendingTransactions.length > 0) {
        for (const STREAMR_STREAM_ID of this.config.streamr.streamId) {
          console.log(`Publishing to Streamr stream: ${STREAMR_STREAM_ID}`);
          await retry(() => this.publishPendingTransactionsToStreamr(STREAMR_STREAM_ID, pendingTransactions), 3, 2000);
        }
      }
    });

    return;
  }

  async getPendingTransactions(): Promise<TransactionRecord[]> {
    return getAllTransactionRecords();
  }

  async publishPendingTransactionsToStreamr(STREAMR_STREAM_ID: string, pendingTransactions: TransactionRecord[]) {
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
