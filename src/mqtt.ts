import { db } from "./db";
import { connect } from "mqtt";
import { enqueue } from "./grpc";
import { encode } from "./encode";
import { interact } from "./warp";

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
      const [_, contractId] = JSON.parse(await db.get(payload[0]));
      const result = await interact(contractId, payload);
      if (result) enqueue(message["deviceInfo"]["devEui"], encode(result));
    } catch (error) {
      console.log(error);
    }
  });
}
