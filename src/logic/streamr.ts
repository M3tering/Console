import { StreamrClient } from "@streamr/sdk";
import { TransactionRecord } from "../types";
import { buildBatchPayload } from "../utils";

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

stream.then((stream) => {
  console.log(`[Streamr] Connected to stream: ${stream.id}`);
}).catch((error) => {
  console.error("[Streamr] Error connecting to stream:", error);
});

async function getStream() {
  return await stream;
}

export async function publishHeartbeatToStream() {
  const stream = await getStream();
  const heartbeatPayload = {
    timestamp: new Date().toISOString(),
  };
  await stream.publish(heartbeatPayload);
  console.log("[Streamr] Published heartbeat:", heartbeatPayload);
}

async function publishToStream(data: any) {
  const stream = await getStream();
  await stream.publish(data);
}

export async function publishPendingTransactionsToStreamr(pendingTransactions: TransactionRecord[]) {
    await publishToStream(buildBatchPayload(pendingTransactions));
}