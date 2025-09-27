import { connect } from "mqtt";
import { enqueue } from "./grpc";
import { interact } from "./arweave";
import { encode } from "./encode";
import { getMeterByPublicKey, insertTransaction, updateMeterNonce } from "../store/sqlite";
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
    client.subscribe(`application/${process.env.APPLICATION_ID}/device/+/event/up`, () => {
      console.log("\nConnected & Subscribed\n");
    });
  });

  client.on("error", (err) => {
    console.error("Connection error: ", err);
    client.end();
  });

  client.on("reconnect", () => {
    console.log("Reconnecting...");
  });

  client.on("message", async (_, blob) => {
    return await handleMessage(blob);
  });
}

async function handleMessage(blob: Buffer) {
  try {
    const message = JSON.parse(blob.toString());

    console.log("[info] Received uplink from device:", JSON.stringify(message));

    const payload = Buffer.from(message["data"], "base64");
    // encode transaction into standard format (payload is hex string)
    // format: nonce | energy | signature | voltage | device_id | longitude | latitude
    const transactionHex = payload;
    const decoded = decodePayload(transactionHex);
    const publicKey = decoded.extensions.deviceId;

    console.log("[info] Decoded payload:", decoded);

    if (!publicKey) {
      throw new Error("Invalid Public Key");
    }

    const m3ter = getMeterByPublicKey(publicKey ?? "");

    if (!m3ter) {
      throw new Error("Meter not found for public key: " + publicKey);
    }

    console.log(
      "[info] Received blob for meter",
      m3ter?.tokenId,
      "expected nonce:",
      m3ter?.latestNonce + 1,
      "got:",
      decoded.nonce
    );

    // if device nonce is correct
    const expectedNonce = m3ter.latestNonce + 1;

    let state;
    if (decoded.nonce === expectedNonce) {
      state = { is_on: true };

      console.log("[info] Nonce is valid:", decoded.nonce);
      // Upload to arweave
      await interact(m3ter.tokenId, decoded);

      console.log("[info] Uploaded transaction to Arweave for meter", m3ter.tokenId);

      // save transaction to local store
      const transactionRecord = {
        nonce: decoded.nonce,
        verified: false,
        identifier: m3ter.tokenId.toString(),
        receivedAt: Date.now(),
        raw: transactionHex.toString("hex"),
      } as TransactionRecord;

      try {
        insertTransaction(transactionRecord);

        console.log("[info] Inserted transaction record:", transactionRecord);
      } catch (error) {
        console.error("Error inserting transaction:", error);
      }

      updateMeterNonce(publicKey, expectedNonce);

      console.log("[info] Updated meter nonce to:", expectedNonce);

      try {
        // send pending transactions to prover node
        const proverURL = await getProverURL();
        console.log("[info] Sending pending transactions to prover:", proverURL);

        await sendPendingTransactionsToProver(proverURL!);

        console.log("[info] done sending to prover");
      } catch (error) {
        console.error("Error sending pending transactions to prover:", error);
      }
    }

    enqueue(
      message["deviceInfo"]["devEui"],
      encode(
        (state ? state : { nonce: expectedNonce, is_on: true }) as State,
        decoded.extensions.latitude ?? 0,
        decoded.extensions.longitude ?? 0
      )
    );
  } catch (error) {
    console.log(error);
  }
}
