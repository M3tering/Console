import { connect } from "mqtt";
import { enqueue } from "./grpc";
import { interact } from "./warp";
import { prepData } from "./encode";

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

  client.on("message", async (topic, payload) => {
    const payloadData = JSON.parse(payload.toString());
    const devEui = payloadData["deviceInfo"]["devEui"];
    const rawData = payloadData["data"];

    if (rawData && devEui) {
      const data = Buffer.from(rawData, "base64").toString();
      try {
        const result = await interact(
          "xJBbK2IPE69XKg0NGylvJ6AhsRUaVUV82oNuuv87Jcc",
          JSON.parse(data)
        );
        if (result) {
          const bytes = prepData(result);
          enqueue(devEui, bytes);
          console.log("Success onchain; data posted to chirpstack")
        }
        console.log("\nDecoded data:\n", data);
      } catch (error) {
        console.log(error);
      }
    }
  });
}
