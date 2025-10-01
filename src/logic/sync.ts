import { getAllMeterRecords, pruneTransactionsBefore, updateMeterNonce } from "../store/sqlite";
import { rollup as rollupContract } from "./context";

export async function pruneAndSyncWithBlockchain() {
  // Get all meter records from the local database
  const meters = getAllMeterRecords();

  for (const meter of meters) {
    const { publicKey, latestNonce } = meter;

    // Check the latest nonce on the blockchain
    const blockchainNonce = Number(await rollupContract.nonce(meter.tokenId));

    if (blockchainNonce > latestNonce) {
      // If the blockchain nonce is greater, update the local record
      updateMeterNonce(publicKey, blockchainNonce);
      // prune transactions with nonce less than or equal to blockchainNonce
      pruneTransactionsBefore(meter.tokenId, blockchainNonce);
    }
  }
}
