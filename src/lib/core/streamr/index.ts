import cron from "node-cron";
import { StreamrClient } from "@streamr/sdk";
import { getAllMeterRecords, getAllTransactionRecords } from "../../../store/sqlite";
import { buildBatchPayload, retry } from "../../utils";
import type { Hooks, TransactionRecord } from "../../../types";
import { pruneAndSyncOnchain } from "../../sync";

const { ETHEREUM_PRIVATE_KEY } = process.env;

if (!ETHEREUM_PRIVATE_KEY) {
  throw new Error("Missing ETHEREUM_PRIVATE_KEY in environment variables");
}

export default class implements Hooks {
  private streamIds: string[] = process.env.STREAMR_STREAM_ID ? process.env.STREAMR_STREAM_ID.split(",") : [];
  private cronSchedule: string = process.env.STREAMR_CRONSCHEDULE || "0 * * * *";

  async onAfterInit() {
    console.log("Registering Streamr cron job...");

    // Schedule a cron job to publish pending transactions
    cron.schedule(
      this.cronSchedule,
      async () => {
        console.log("Streamr cron job started: Pruning meters and publishing pending transactions...");
        const m3ters = getAllMeterRecords();
        for (const m3ter of m3ters) {
          try {
            pruneAndSyncOnchain(m3ter.publicKey);
          } catch (error) {
            console.error(`Error pruning and syncing meter ${m3ter.publicKey}:`, error);
          }
        }

        console.log("Publishing pending transactions to Streamr...");

        const pendingTransactions = await this.getPendingTransactions();
        if (pendingTransactions.length > 0) {
          await Promise.all(
            this.streamIds.map(async (STREAMR_STREAM_ID) => {
              console.log(`Publishing to Streamr stream: ${STREAMR_STREAM_ID}`);
              await retry(
                () => this.publishPendingTransactionsToStreamr(STREAMR_STREAM_ID, pendingTransactions),
                3,
                2000,
              );
            }),
          );
        }
      },
      { name: "streamr-publish-pending-transactions", noOverlap: true },
    );

    console.log("Streamr cron job registered.");
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

    try {
      console.log(`[streamr] Connecting to ${STREAMR_STREAM_ID}...`);
      const stream = await retry(() => streamrClient.getStream(STREAMR_STREAM_ID!), 3, 10000);

      await new Promise((resolve) => setTimeout(resolve, 2000)); // wait for 2 seconds to ensure connection is established

      console.log(`[streamr] Connected. Publishing ${pendingTransactions.length} transactions...`);
      const batchPayload = buildBatchPayload(pendingTransactions);
      await stream.publish(batchPayload);

      console.log(`[streamr] Published ${pendingTransactions.length} transactions to stream ${STREAMR_STREAM_ID}`);
      await new Promise((resolve) => setTimeout(resolve, 100000)); // wait for 100 seconds to ensure message is sent
    } catch (error) {
      console.error(`[streamr] Error publishing to Streamr:`, error);
      throw error;
    } finally {
      // destroy the client to free resources
      try {
        await streamrClient.destroy();
      } catch (destroyError) {
        console.error(`[streamr] Error destroying client:`, destroyError);
      }
    }
  }
}
