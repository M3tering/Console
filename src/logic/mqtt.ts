import { connect } from "mqtt";
import { enqueue } from "./grpc";
import { interact } from "./arweave";
import { encode, encodeTransaction } from "./encode";
import { getGPS } from "./gps";
import {
  getMeterByPublicKey,
  insertTransaction,
  updateMeterNonce,
} from "../store/sqlite";
import { Payload, TransactionRecord } from "../types";

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
      console.log("payload", payload);
      const publicKey = payload[2];
      const m3ter = getMeterByPublicKey(publicKey ?? "");

      if (!m3ter) {
        console.error("❌ Meter not found for public key:", publicKey);
        return;
      }

      let [lat, lon] = getGPS();
      const [nonce, voltage, , energy] = JSON.parse(payload[0]);
      const signature = payload[1];

      const transactionData = {
        nonce: m3ter.latestNonce || 0,
        energy,
        signature,
        voltage,
        deviceId: publicKey,
        longitude: lon,
        latitude: lat,
      };

      // encode transaction into standard format
      // format: nonce | energy | signature | voltage | device_id | longitude | latitude
      const transactionAsBytes = encodeTransaction(transactionData);

      const result = await interact(
        m3ter.contractId,
        m3ter.latestNonce || 0,
        payload,
        transactionAsBytes
      );

      // Update the meter's latest nonce if the interaction was successful
      // and device nonce is correct
      if (nonce === m3ter.latestNonce! + 1) {
        updateMeterNonce(publicKey, result.nonce);

        // save transaction to sqlite
        const transactionRecord = {
          ...transactionData,
          identifier: publicKey,
          receivedAt: Date.now(),
          raw: Buffer.from(transactionAsBytes).toString("hex"),
        } as TransactionRecord;

        insertTransaction(transactionRecord);
      }

      if (result)
        enqueue(message["deviceInfo"]["devEui"], encode(result, lat, lon));
    } catch (error) {
      console.log(error);
    }
  });
}
