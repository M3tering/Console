import { connect } from "mqtt";
import { enqueue } from "./grpc";
import { interact } from "./arweave";
import { encode } from "./encode";
import { m3ter as m3terContract, rollup as rollupContract } from "./context";
import {
  getAllMeterRecords,
  getMeterByDevEui,
  getMeterByPublicKey,
  insertTransaction,
  saveMeter,
  updateMeterDevEui,
  updateMeterNonce,
} from "../store/sqlite";
import { State, TransactionRecord } from "../types";
import { getProverURL, sendPendingTransactionsToProver } from "./verify";
import { decodePayload } from "./decode";
import { verifyPayloadSignature } from "../utils";

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

export async function handleMessage(blob: Buffer) {
  try {
    const message = JSON.parse(blob.toString());

    console.log("[info] Received uplink from device:", JSON.stringify(message));

    const payload = Buffer.from(message["data"], "base64");
    // encode transaction into standard format (payload is hex string)
    // format: nonce | energy | signature | voltage | device_id | longitude | latitude
    const transactionHex = payload;
    const decoded = decodePayload(transactionHex);
    let publicKey = decoded.extensions.deviceId;
    let payloadHadPublicKey = !!publicKey;

    console.log("[info] Decoded payload:", decoded);

    if (!publicKey) {
      // try to find public key by DevEui
      const devEui = message["deviceInfo"]["devEui"];
      const meterByDevEui = getMeterByDevEui(devEui);

      if (!meterByDevEui) {
        throw new Error("Device EUI not associated with any meter: " + devEui);
      }

      publicKey = meterByDevEui.publicKey.replace("0x", "");
    }

    // verify transaction signature
    const isValid = verifyPayloadSignature(transactionHex, Buffer.from(publicKey!, "hex"));
    if (!isValid) {
      throw new Error("Invalid transaction signature for meter with public key: " + publicKey);
    }

    if (payloadHadPublicKey) {
      // save public key with device EUI mapping if not already saved
      const existingMeter = getMeterByPublicKey(`0x${publicKey}`);

      if (!existingMeter) {
        const tokenId = Number(await m3terContract.tokenID(`0x${publicKey}`));
        if (tokenId === 0) {
          throw new Error("Token ID not found for public key: " + publicKey);
        }

        const latestNonce = Number(await rollupContract.nonce(tokenId));

        // save new meter with devEui
        const newMeter = {
          publicKey: `0x${publicKey}`,
          devEui: message["deviceInfo"]["devEui"],
          tokenId,
          latestNonce,
        };
        saveMeter(newMeter);
        console.log("[info] Saved new meter:", newMeter);
      } else if (existingMeter && !existingMeter.devEui) {
        // update existing meter with devEui if not already set
        updateMeterDevEui(`0x${publicKey}`, message["deviceInfo"]["devEui"]);
        console.log("[info] Updated meter with DevEui:", existingMeter.tokenId);
      }
    }

    const m3ter = getMeterByPublicKey(`0x${publicKey}`) ?? null;

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

    if (decoded.nonce === expectedNonce) {
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

      updateMeterNonce(`0x${publicKey}`, expectedNonce);

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

    const state =
      decoded.nonce === m3ter.latestNonce + 1 || (decoded.nonce === 0 && m3ter.latestNonce === 0)
        ? { is_on: true }
        : { nonce: m3ter.latestNonce, is_on: true };

    // TODO: remove the following block after testing
    // if transaction nonce is 0 and the latest nonce is 0
    // update the latest nonce to 1, respond with 1
    if (decoded.nonce === 0 && m3ter.latestNonce === 0) {
      updateMeterNonce(`0x${publicKey}`, 1);
      state.nonce = 1;
    }

    console.log("[info] Enqueuing state:", state);

    enqueue(
      message["deviceInfo"]["devEui"],
      encode(state as State, decoded.extensions.latitude ?? 0, decoded.extensions.longitude ?? 0)
    );
  } catch (error) {
    console.log(error);
  }
}
