import {
  getMeterByPublicKey,
  getMeterByTokenId,
  getTransactionByNonce,
  pruneTransactionsAfter,
  pruneTransactionsBefore,
  updateMeterNonce,
} from "../store/sqlite";
import {
  provider,
  rollup as rollupContract,
  ccipRevenueReader as ccipRevenueReaderContract,
  priceContext as priceContextContract,
} from "../services/context";
import { JsonRpcProvider, Contract, ZeroAddress } from "ethers";
import { retry } from "./utils";
import type { VerifierInfo } from "../types";

// Cache for verifiers - populated once on startup
let verifiersCache: VerifierInfo[] | null = null;
let isCacheInitialized = false;

/**
 * Initialize verifiers cache on program startup
 * Fetches all verifiers and resolves their ENS names once
 * Throws error if any fetch/resolution fails
 */
export async function initializeVerifiersCache(): Promise<void> {
  try {
    console.log("[info] Initializing verifiers cache...");
    
    // Get the number of verifiers
    const verifierCount = Number(await retry(() => ccipRevenueReaderContract.verifierCount()));
    console.log(`[info] Found ${verifierCount} verifiers to cache`);
    
    const verifiers: VerifierInfo[] = [];
    
    // Fetch all verifiers and resolve their ENS names
    for (let i = 0; i < verifierCount; i++) {
      try {
        // Get verifier info (ensName, targetContractAddress)
        const [ensName, targetAddress] = await retry(() => ccipRevenueReaderContract.verifiers(i));
        
        console.log(`[info] Fetching verifier ${i}: ENS: ${ensName}, target: ${targetAddress}`);
        
        // Resolve ENS name to get the verifier address
        const verifierAddress = await retry(() => provider.resolveName(ensName));
        
        if (!verifierAddress || verifierAddress === ZeroAddress) {
          throw new Error(`Failed to resolve ENS name: ${ensName}`);
        }
        
        console.log(`[info] Resolved ${ensName} to verifier address: ${verifierAddress}`);
        
        verifiers.push({
          ensName,
          targetAddress,
          verifierAddress,
        });
      } catch (error) {
        console.error(`[error] Failed to initialize verifier ${i}:`, error);
        throw error; // Fail fast as requested
      }
    }
    
    // Cache the verifiers
    verifiersCache = verifiers;
    isCacheInitialized = true;
    
    console.log(`[info] Successfully cached ${verifiers.length} verifiers`);
  } catch (error) {
    console.error("[error] Failed to initialize verifiers cache:", error);
    isCacheInitialized = false;
    verifiersCache = null;
    throw error;
  }
}

/**
 * Get cached verifiers, throws error if cache is not initialized
 */
async function getCachedVerifiers(): Promise<VerifierInfo[]> {
  if (!isCacheInitialized || !verifiersCache) {
    await initializeVerifiersCache();
  }
  return verifiersCache!;
}

/**
 * Check if verifiers cache is initialized
 */
export function isVerifiersCacheInitialized(): boolean {
  return isCacheInitialized && verifiersCache !== null;
}

/**
 * Get the number of cached verifiers
 */
export function getCachedVerifiersCount(): number {
  return verifiersCache?.length ?? 0;
}

export async function pruneAndSyncOnchain(meterIdentifier: number | string): Promise<number> {
  const meter =
    typeof meterIdentifier === "number"
      ? getMeterByTokenId(meterIdentifier)
      : getMeterByPublicKey(meterIdentifier);

  if (!meter) {
    throw new Error(`Meter with identifier ${meterIdentifier} not found`);
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

export async function getLatestTransactionNonce(meterIdentifier: number): Promise<number> {
  // get latest nonce from chain
  let latestNonce = Number(await rollupContract.nonce(meterIdentifier));

  // check local state for the highest nonce we have
  while (true) {
    const existingTransaction = getTransactionByNonce(latestNonce + 1, meterIdentifier);
    if (existingTransaction) {
      latestNonce += 1;
    } else {
      pruneTransactionsAfter(latestNonce, meterIdentifier);
      break;
    }
  }

  return latestNonce;
}

// get revenue across suppored chains
export async function getCrossChainRevenue(tokenId: number): Promise<number> {
  try {
    // Use cached verifiers instead of fetching them each time
    const verifiers = await getCachedVerifiers();
    
    let totalRevenue = 0;

    // Iterate through all cached verifiers and get revenue from each chain
    for (const verifier of verifiers) {
      try {
        console.log(`[info] Getting revenue from ENS: ${verifier.ensName}, target: ${verifier.targetAddress}, verifier: ${verifier.verifierAddress}`);

        // Get revenue from this specific chain using CCIP read
        // Parameters: tokenId, target (L2 contract), verifier (resolved from ENS)
        const revenue = await retry(() =>
          ccipRevenueReaderContract.read(tokenId, verifier.targetAddress, verifier.verifierAddress, {
            enableCcipRead: true,
          })
        );
        const revenueAmount = Number(revenue);

        console.log(`[info] Revenue from ${verifier.ensName} (${verifier.verifierAddress}): ${revenueAmount}`);
        totalRevenue += revenueAmount;
      } catch (error) {
        console.error(`[error] Failed to get revenue from verifier ${verifier.ensName}:`, error);
        // Continue with other verifiers even if one fails
      }
    }

    console.log(`[info] Total cross-chain revenue for token ${tokenId}: ${totalRevenue}`);
    return totalRevenue;
  } catch (error) {
    console.error(`[error] Failed to get cross-chain revenue for token ${tokenId}:`, error);
    throw error;
  }
}

// get owed from price context
export async function getOwedFromPriceContext(tokenId: number): Promise<number> {
  try {
    return await retry(async () => {
      console.log(`[info] Getting owed amount for token ${tokenId} from price context`);

      // Call the price context to get the amount the user owes with CCIP read enabled
      const owedAmount = await priceContextContract.owed(tokenId);
      const owed = Number(owedAmount);

      console.log(`[info] Owed amount for token ${tokenId}: ${owed}`);
      return owed;
    });
  } catch (error) {
    console.error(`[error] Failed to get owed amount for token ${tokenId}:`, error);
    throw error;
  }
}
