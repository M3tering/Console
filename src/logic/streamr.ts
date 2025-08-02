import { StreamPermission, StreamrClient } from "@streamr/sdk";
import "dotenv/config";
import { Payload, StreamrMessage } from "../types";
import { saveGossipMessage } from "../store/sqlite";

const { STREAM_ID, STREAMR_PRIVATE_KEY } = process.env;

if (!STREAM_ID || !STREAMR_PRIVATE_KEY) {
  throw new Error("Missing STREAMR_PRIVATE_KEY or STREAM_ID in env");
}

// Initialize the client with an Ethereum account
const streamr = new StreamrClient({
  auth: {
    privateKey: STREAMR_PRIVATE_KEY,
  },
  environment: process.env.STREAMR_ENV == "live" ? "polygon" : "polygonAmoy",
});

async function ensureStream() {
  const stream = await streamr.getOrCreateStream({ id: STREAM_ID as string });
  return stream;
}

export async function publishToStream(data: Payload) {
  const stream = await ensureStream();

  await stream.publish({
    payload: data,
    timestamp: Date.now(),
  });

  console.log("✅ Published to Streamr:", data);
}

streamr.subscribe(STREAM_ID, (data: unknown) => {
  console.log("📥 Received message:", data);

  // Type guard to ensure data is a StreamrMessage
  if (
    data &&
    typeof data === "object" &&
    "payload" in data &&
    "timestamp" in data
  ) {
    saveGossipMessage(data as StreamrMessage);
  } else {
    console.warn("⚠️ Received invalid message format:", data);
  }
});
