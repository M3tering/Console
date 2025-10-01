import { getMeterByTokenId, pruneTransactionsBefore, updateMeterNonce } from "../store/sqlite";
import { rollup as rollupContract } from "./context";

export async function pruneAndSyncOnchain(meterNumber: number) {
  const meter = getMeterByTokenId(meterNumber);

  if (!meter) {
    throw new Error(`Meter with tokenId ${meterNumber} not found`);
  }

  // Check the latest nonce on the blockchain
  const onchainNonce = Number(await rollupContract.nonce(meter.tokenId));
  const latestNonce = meter.latestNonce;

  if (onchainNonce > latestNonce) {
    const publicKey = meter.publicKey;
    // If the onchain nonce is greater, update the local record
    updateMeterNonce(publicKey, onchainNonce);
  }
  // prune transactions with nonce less than or equal to onchainNonce
  pruneTransactionsBefore(meter.tokenId, onchainNonce);

  return onchainNonce;
}
