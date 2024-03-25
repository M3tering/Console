import { connect } from "mqtt";
import { enqueue } from "./grpc";
import { interact } from "./warp";
import { prepData } from "./encode";

export function handleUplinks() {
  const client = connect({
    host: process.env.CHIRPSTACK_HOST,
    port: 1883,
    clean: true,
    connectTimeout: 4000,
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
          "4A3sCQ-fWlzSc17He_mPd_s3QTbPuzzOmrR_RAkPPv8",
          JSON.parse(data)
        );
        const bytes = prepData(result);
        enqueue(devEui, bytes);
      } catch (error) {
        console.log(error);
        console.log("\nDecoded data:\n", data);
      }
    }
  });
}
