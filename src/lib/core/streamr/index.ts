import { StreamrClient } from "@streamr/sdk";
import { buildBatchPayload, retry } from "../../utils";
import type { Hooks, TransactionRecord } from "../../../types";

const { STREAMR_STREAM_ID, ETHEREUM_PRIVATE_KEY } = process.env;

if (!STREAMR_STREAM_ID || !ETHEREUM_PRIVATE_KEY) {
  throw new Error("Missing STREAMR_STREAM_ID or ETHEREUM_PRIVATE_KEY in environment variables");
}

export default class implements Hooks {
  async onTransactionDistribution(_: any, __: any, pendingTransactions: TransactionRecord[]) {
    // send pending transactions to streamr
    try {
      console.info(`Sending pending transactions to streamr`);

     await retry(() => publishPendingTransactionsToStreamr(pendingTransactions), 3);

      console.info(`Successfully sent pending transactions to streamr`);
    } catch (error) {
      console.error(`Error sending pending transactions to streamr: ${error}`);
    }
  }
}

async function publishPendingTransactionsToStreamr(pendingTransactions: TransactionRecord[]) {
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
