import { connect } from "mqtt";
import { enqueue } from "./grpc";
import { encode } from "../lib/encode";
import { app, m3ter as m3terContract } from "./context";
import {
  deleteMeterByPublicKey,
  getAllTransactionRecords,
  getMeterByDevEui,
  getMeterByPublicKey,
  getMeterByTokenId,
  insertTransaction,
  saveMeter,
  updateMeterDevEui,
  updateMeterNonce,
} from "../store/sqlite";
import type { State, TransactionRecord } from "../types";
import { decodePayload } from "../lib/decode";
import { runHook, verifyPayloadSignature } from "../lib/utils";
import { getLatestTransactionNonce, pruneAndSyncOnchain, getCrossChainRevenue, getOwedFromPriceContext } from "../lib/sync";
import { createMeterLogger } from "../utils/logger";

const CHIRPSTACK_HOST = process.env.CHIRPSTACK_HOST;
const SYNC_EPOCH = 100; // after 100 transactions, sync with blockchain
const deviceLocks = new Map<string, boolean>(); // Lock per devEUI to prevent concurrent message processing

export function handleUplinks(): Promise<boolean> {
  return new Promise(function (resolve, reject) {
    const client = connect({
      host: CHIRPSTACK_HOST,
      port: 1883,
      clean: true,
      connectTimeout: 9000,
      reconnectPeriod: 1000,
    });

    client.on("reconnect", () => {
      runHook("onMqttReconnect", client);
    });

    client.on("message", async (_, blob) => {
      return await handleMessage(blob);
    });

    client.on("connect", () => {
      const topic = `application/${process.env.APPLICATION_ID}/device/+/event/up`;
      client.subscribe(topic, () => {
        console.log(`\nConnected & Subscribed to CHIRPSTACK_HOST: ${CHIRPSTACK_HOST}\n`);

        runHook("onMqttSubscribed", client, topic);
        resolve(true);
      });

      runHook("onMqttConnect", client);
    });

    client.on("error", (err) => {
      console.error("Connection error: ", err);

      runHook("onMqttError", err, client);

      client.end();
      reject(err);
    });
  });
}

export async function handleMessage(blob: Buffer) {
  runHook("onMessageReceived", blob);

  const message = JSON.parse(blob.toString());
  const devEui = message["deviceInfo"]["devEui"] || null;

  // Create a logger with devEui context
  const logger = createMeterLogger({ devEui });

  try {
    if (!devEui) {
      console.log("[warn] Message dropped - no devEui found in message");
      return;
    }

    // Check if this specific device is already being processed
    if (deviceLocks.get(devEui)) {
      logger.warn(`Message dropped - device is already being processed`);
      runHook("onMessageDropped", "locked", devEui);
      return;
    }

    let is_on = true;

    // Set lock for this specific device
    deviceLocks.set(devEui, true);

    logger.info(`Received uplink from device: ${JSON.stringify(message)}`);

    // encoded transaction in standard format (payload is hex string)
    // format: nonce | energy | signature | voltage | device_id | longitude | latitude
    const transactionHex = Buffer.from(message["data"], "base64");
    const decoded = decodePayload(transactionHex);
    let publicKey = decoded.extensions.deviceId;
    let payloadHadPublicKey = !!publicKey;

    logger.info(`Decoded payload: ${JSON.stringify(decoded)}`);

    if (!publicKey) {
      // try to find public key by DevEui
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

    logger.info("Verified signature");

    if (payloadHadPublicKey) {
      logger.info(`Payload contained public key: ${publicKey}`);
      // save public key with device EUI mapping if not already saved
      const existingMeter = getMeterByPublicKey(`0x${publicKey}`);

      if (!existingMeter) {
        const tokenId = Number(await m3terContract.tokenID(`0x${publicKey}`));

        const latestNonce = await getLatestTransactionNonce(tokenId);

        logger.info(`Fetched tokenId and latestNonce from chain and local state: ${tokenId}, ${latestNonce}`);

        // save new meter with devEui
        const newMeter = {
          publicKey: `0x${publicKey}`,
          devEui: message["deviceInfo"]["devEui"],
          tokenId,
          latestNonce,
        };

        const existingMeter = getMeterByTokenId(tokenId);

        // in-case of the public key being updated
        if (existingMeter && existingMeter.publicKey !== `0x${publicKey}`) {
          deleteMeterByPublicKey(`0x${publicKey}`);
        }

        saveMeter(newMeter);
        logger.info(`Saved new meter: ${JSON.stringify(newMeter)}`);

        runHook("onMeterCreated", newMeter);
      } else {
        // update existing meter with devEui if not already set
        if (!existingMeter.devEui || existingMeter.devEui !== message["deviceInfo"]["devEui"]) {
          logger.info(`Updating meter with DevEui: ${message["deviceInfo"]["devEui"]}`);
          updateMeterDevEui(`0x${publicKey}`, message["deviceInfo"]["devEui"]);
        }

        // fetch and update latest nonce from chain
        const latestNonce = await getLatestTransactionNonce(existingMeter.tokenId);

        logger.info(`Fetched latestNonce from chain and local state: ${latestNonce}`);

        updateMeterNonce(`0x${publicKey}`, latestNonce);
      }
    }

    let m3ter = getMeterByPublicKey(`0x${publicKey}`) ?? null;

    if (!m3ter) {
      throw new Error("Meter not found for public key: " + publicKey);
    }

    logger.info(`Found meter: ${JSON.stringify(m3ter)}`);

    // If both latest nonce and received nonce are 0, enqueue 0 immediately
    if (m3ter.latestNonce === 0 && decoded.nonce === 0) {
      logger.info("Both latest nonce and received nonce are 0, enqueuing 0 immediately");

      try {
        is_on = true; // Always on
        // (await getCrossChainRevenue(m3ter.tokenId)) >=
        // (await getOwedFromPriceContext(m3ter.tokenId));
      } catch (error) {
        logger.error(`Error fetching cross chain revenue or owed amount: ${error}`);
      }

      const state = { nonce: 0, is_on };

      logger.info(`Enqueuing state: ${JSON.stringify(state)}`);

      enqueue(
        message["deviceInfo"]["devEui"],
        encode(state as State, decoded.extensions.latitude ?? 0, decoded.extensions.longitude ?? 0)
      );

      return; // Exit early without processing the transaction
    }

    if (m3ter.latestNonce % SYNC_EPOCH === 0) {
      // sync with blockchain every SYNC_EPOCH transactions
      await pruneAndSyncOnchain(m3ter.tokenId);

      runHook("onSyncEpochReached");

      logger.info(`Synced meter with blockchain: ${m3ter.tokenId}`);

      m3ter = getMeterByPublicKey(`0x${publicKey}`) ?? null;

      if (!m3ter) {
        throw new Error("Meter not found after sync for public key: " + publicKey);
      }
    }

    const expectedNonce = m3ter.latestNonce + 1;

    logger.info(`Received blob for meter ${m3ter?.tokenId}, expected nonce: ${expectedNonce}, got: ${decoded.nonce}`);

    if (decoded.nonce !== expectedNonce && decoded.nonce !== 0) {
      throw new Error(`Invalid nonce. Expected ${expectedNonce}, got ${decoded.nonce}. Public key: ${publicKey}`);
    }

    // if device nonce is correct
    if (decoded.nonce === expectedNonce) {
      logger.info(`Nonce is valid: ${decoded.nonce}`);

      // save transaction to local store
      const transactionRecord = {
        nonce: decoded.nonce,
        identifier: m3ter.tokenId,
        receivedAt: Date.now(),
        raw: transactionHex.toString("hex"),
      } as TransactionRecord;
      insertTransaction(transactionRecord);
      updateMeterNonce(`0x${publicKey}`, expectedNonce);

      logger.info(`Updated meter nonce to: ${expectedNonce}`);

      const pendingTransactions = getAllTransactionRecords();
      runHook("onTransactionDistribution", m3ter.tokenId, decoded, pendingTransactions);

      try {
        is_on = await runHook("isOnStateCompute", m3ter.tokenId);
      } catch (error) {
        runHook("onIsOnStateComputeError", m3ter.tokenId, error);
        logger.error(`Error in isOnStateCompute hook: ${error}`);
      }

      runHook("onIsOnStateComputed", m3ter.tokenId, is_on);

      const state = decoded.nonce === expectedNonce ? { is_on } : { nonce: m3ter.latestNonce, is_on };

      logger.info(`Enqueuing state: ${JSON.stringify(state)}`);

      enqueue(
        message["deviceInfo"]["devEui"],
        encode(state as State, decoded.extensions.latitude ?? 0, decoded.extensions.longitude ?? 0)
      );
      runHook("onStateEnqueued", state, decoded.extensions.latitude ?? 0, decoded.extensions.longitude ?? 0);
    }
  } catch (error) {
    logger.error(`Error handling MQTT message: ${error}`);
    runHook("onMessageError", error);
  } finally {
    // Release lock for this specific device
    if (devEui) {
      deviceLocks.delete(devEui);
      runHook("onDeviceUnlocked", devEui);
    }
    runHook("onMessageProcessingComplete");
  }
}
