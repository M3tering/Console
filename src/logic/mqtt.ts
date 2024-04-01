import { connect } from "mqtt";
import { enqueue } from "./grpc";
import { interact } from "./warp";
import { encode } from "./encode";
import { db } from "./context";

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
      const m3ter = JSON.parse(await db.get(payload[2]));
      const result = await interact(m3ter.contractId, payload);
      if (result) enqueue(message["deviceInfo"]["devEui"], encode(result));
      console.log(payload)
    } catch (error) {
      console.log(error);
    }
  });
}
