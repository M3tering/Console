import { connect } from "mqtt";
import { enqueue } from "./grpc";
import { interact } from "./warp";
import { encode } from "./encode";
import { getGPS } from "./gps";
import { db } from "./context";
import { Payload } from "../types";

export function handleUplinks() {
  const client = connect({
    host: process.env.CHIRPSTACK_HOST,
    port: 1883,
    clean: true,
    connectTimeout: 9000,
    reconnectPeriod: 1000,
  });

  client.on("connect", () => {
    client.subscribe(
      `application/${process.env.APPLICATION_ID}/device/+/event/up`,
      () => {
        console.log("\nConnected & Subscribed\n");
      }
    );
  });

  client.on("message", async (_, blob) => {
    try {
      const message = JSON.parse(blob.toString());
      const payload = JSON.parse(
        Buffer.from(message["data"], "base64").toString()
      );
      const publicKey = payload[2]
      const m3terDoc = await db.get(publicKey ?? "")
      console.log("m3terDoc", m3terDoc);
      const m3ter = JSON.parse(m3terDoc);
      const result = await interact(m3ter.tokenId, m3ter.latestNonce, payload);
      await db.put(publicKey, JSON.stringify({ ...m3ter, latestNonce: result?.nonce || m3ter.latestNonce }));
      let [lat, lon] = getGPS();
      if (result)
        enqueue(message["deviceInfo"]["devEui"], encode(result, lat, lon));
    } catch (error) {
      console.log(error);
    }
  });
}

const call_interact = async () => {
  const payload = [
    "[2, 213.7, 0.38, 0.007420]",
    "9C7lPdznR9pymAIvjDPmm/mVX/uUTemapJRb8yzGKvG8or43u6V97oDPcW7ZP9HeHRZrGEf1iIkyLixAVdWsDg==",
    "C/VyOqGu8Q8Y92BgRh92ZpPZnSAxQ8GRhJGKDxsyn6A="
  ]
  const publicKey = payload[2]
  const m3terDoc = await db.get(publicKey ?? "")
  console.log("m3terDoc", m3terDoc);
  const m3ter = JSON.parse(m3terDoc); // pop public key from payload
  const result = await interact(m3ter.tokenId, m3ter.latestNonce, payload);
  await db.put(publicKey, JSON.stringify({ ...m3ter, latestNonce: result?.nonce || m3ter.latestNonce }));
}

call_interact()
  .then(() => {
    console.log("Interact function executed successfully");
  })
