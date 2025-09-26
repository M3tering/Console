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

  client.on("message", async (_, blob) => {
    return await handleMessage(blob);
  });
}

async function handleMessage(blob: Buffer) {
  try {
    const message = JSON.parse(blob.toString());
    const payload = Buffer.from(message["data"], "hex");
    // encode transaction into standard format (payload is hex string)
    // format: nonce | energy | signature | voltage | device_id | longitude | latitude
    const transactionHex = payload;
    const decoded = decodePayload(transactionHex);
    const publicKey = decoded.extensions.deviceId;

    if (!publicKey) {
      throw new Error("Invalid Public Key");
    }

    const m3ter = getMeterByPublicKey(publicKey ?? "");

    if (!m3ter) {
      console.error("Meter not found for public key:", publicKey);
      return;
    }

    console.log("[info] Received blob for meter", m3ter?.tokenId, "nonce", m3ter?.latestNonce + 1);

    // if device nonce is correct
    const expectedNonce = m3ter.latestNonce + 1;
    let state;
    if (decoded.nonce === expectedNonce) {
      state = { is_on: true };
      // Upload to arweave
      await interact(m3ter.tokenId, decoded);

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
      } catch (error) {
        console.error("Error inserting transaction:", error);
      }

      updateMeterNonce(publicKey, expectedNonce);

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
