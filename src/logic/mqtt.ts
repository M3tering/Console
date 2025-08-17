import { connect } from "mqtt";
import { enqueue } from "./grpc";
import { interact } from "./arweave";
import { encode } from "./encode";
import {
  getMeterByPublicKey,
  insertTransaction,
  updateMeterNonce,
} from "../store/sqlite";
import { State, TransactionRecord } from "../types";
import { getProverURL, sendPendingTransactionsToProver } from "./verify";
import { decodePayload } from "./decode";

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
      // encode transaction into standard format (payload[0])
      // format: nonce | energy | signature | voltage | device_id | longitude | latitude
      const transactionHex = payload[0];
      const publicKey = payload[1];
      const m3ter = getMeterByPublicKey(publicKey ?? "");

      if (!m3ter) {
        console.error("Meter not found for public key:", publicKey);
        return;
      }

      const { nonce, energy, signature, extensions } =
        decodePayload(transactionHex);
      let voltage, identifier, longitude, latitude;

      if (extensions !== null && typeof extensions === "object") {
        voltage = extensions.voltage ?? null;
        identifier = extensions.deviceId ?? null;
        longitude = extensions.longitude ?? null;
        latitude = extensions.latitude ?? null;
      }

      const transactionData = {
        nonce: m3ter.latestNonce || 0,
        energy,
        signature,
        voltage,
        deviceId: publicKey,
        longitude,
        latitude,
      };

      // if device nonce is correct
      const expectedNonce = m3ter.latestNonce ? m3ter.latestNonce + 1 : 0;
      if (nonce === expectedNonce) {
        // Upload to arweave
        await interact(m3ter.contractId, payload);

        // send transaction to prover
        // save transaction to sqlite database
        try {
          // send pending transactions to prover node
          const proverURL = await getProverURL();

          sendPendingTransactionsToProver(proverURL!);
        } catch {
          console.error("Failed to send pending transactions to prover");
        } finally {
          updateMeterNonce(publicKey, expectedNonce);

          // save transaction to sqlite
          const transactionRecord = {
            ...transactionData,
            identifier: publicKey,
            receivedAt: Date.now(),
            raw: transactionHex,
          } as TransactionRecord;

          insertTransaction(transactionRecord);
        }
      }

      enqueue(
        message["deviceInfo"]["devEui"],
        encode(
          { nonce: expectedNonce, is_on: true } as State,
          latitude ?? 0,
          longitude ?? 0
        )
      );
    } catch (error) {
      console.log(error);
    }
  });
}
