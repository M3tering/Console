import { connect } from "mqtt";
import { enqueue } from "./grpc";
import { interact } from "./warp";
import { encode } from "./encode";
import { getGPS } from "./gps";
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
      console.log(payload);
      const publicKey = await db.get(payload.pop())
      const m3ter = JSON.parse(publicKey); // pop public key from payload
      const result = await interact(m3ter.id, m3ter.latestNonce, payload);
      await db.put(publicKey, JSON.stringify({ ...m3ter, latestNonce: result?.nonce || m3ter.latestNonce }));
      let [lat, lon] = getGPS();
      if (result)
        enqueue(message["deviceInfo"]["devEui"], encode(result, lat, lon));
    } catch (error) {
      console.log(error);
    }
  });
}
