import { StreamrClient } from "@streamr/sdk";
import { buildBatchPayload } from "../../utils";
import type { Hooks, TransactionRecord } from "../../../types";

const { STREAMR_STREAM_ID, ETHEREUM_PRIVATE_KEY } = process.env;

if (!STREAMR_STREAM_ID || !ETHEREUM_PRIVATE_KEY) {
  throw new Error("Missing STREAMR_STREAM_ID or ETHEREUM_PRIVATE_KEY in environment variables");
}

export const streamrClient = new StreamrClient({
  auth: {
    privateKey: ETHEREUM_PRIVATE_KEY,
  },
});

const stream = streamrClient.getStream(STREAMR_STREAM_ID);

stream
  .then((stream) => {
    console.log(`[Streamr] Connected to stream: ${stream.id}`);
  })
  .catch((error) => {
    console.error("[Streamr] Error connecting to stream:", error);
  });

export default class implements Hooks {
  async onTransactionDistribution(_: any, __: any, pendingTransactions: TransactionRecord[]) {
    // send pending transactions to streamr
    try {
      console.info(`Sending pending transactions to streamr`);
      await publishPendingTransactionsToStreamr(pendingTransactions);
      console.info(`Successfully sent pending transactions to streamr`);
    } catch (error) {
      console.error(`Error sending pending transactions to streamr: ${error}`);
    }
  }
}

async function getStream() {
  return await stream;
}

async function publishToStream(data: any) {
  const stream = await getStream();
  await stream.publish(data);
}

async function publishPendingTransactionsToStreamr(pendingTransactions: TransactionRecord[]) {
  await publishToStream(buildBatchPayload(pendingTransactions));
}
