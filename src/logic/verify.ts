import { BatchTransactionPayload, TransactionRecord } from "../types";
import { rollup } from "./context";
import { getUnverifiedTransactionRecords } from "../store/sqlite";
import { buildBatchPayload } from "../utils";

const PREFERRED_PROVER_NODE = process.env.PREFERRED_PROVER_NODE || "https://prover.m3tering.com";

// Prover node structure
export interface ProverNode {
  id: string;
  url: string;
  isActive: boolean;
  lastSeen: number;
}

/**
 * Get prover node list from smart contract
 * Makes a request to a smart contract to get an array of node structs
 */
export async function getProverNodeList(): Promise<ProverNode[]> {
  try {
    // TODO: Implement smart contract call to get prover nodes
    console.log("Fetching prover node list from smart contract...");
    return [];
  } catch (err: any) {
    console.error("Failed to get prover node list:", err.message);
    return [];
  }
}

/**
 * Choose a prover node from the fetched list
 * Picks one prover node from the available nodes (e.g., random selection, load balancing, etc.)
 */
export function chooseProverNode(nodes: ProverNode[]): ProverNode | null {
  try {
    // TODO: Implement node selection logic
    // Filter active nodes
    const activeNodes = nodes.filter((node) => node.isActive);

    if (activeNodes.length === 0) {
      console.warn("No active prover nodes available");
      return null;
    }
    const randomIndex = Math.floor(Math.random() * activeNodes.length);
    const selectedNode = activeNodes[randomIndex];

    console.log("Selected prover node:", {
      id: selectedNode.id,
      url: selectedNode.url,
    });
    return selectedNode;
  } catch (err: any) {
    console.error("❌ Failed to choose prover node:", err.message);
    return null;
  }
}

/**
 * Send transactions to prover node for verification
 */
export async function sendTransactionsToProver(
  proverURL: string,
  transactionData: BatchTransactionPayload
): Promise<boolean> {
  try {
    const response = await fetch(`${proverURL}/prove`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...transactionData }),
    });

    if (!response.ok) {
      throw new Error(`Prover responded with status: ${response.status}`);
    }

    const result = await response.json();

    console.log("Transactions sent to prover:");
    return result.success;
  } catch (err: any) {
    console.error("Failed to send transactions to prover:", err.message);
    return false;
  }
}

/**
 * Check prover node status
 */
export async function checkProverNodeStatus(proverURL: string) {
  try {
    const response = await fetch(`${proverURL}/status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      return false;
    }

    return true;
  } catch (err: any) {
    console.error("❌ Failed to check prover node status:", err);
    return false;
  }
}

/**
 * Checks the nonce for a meter id onchain
 *
 * @returns {Promise<number>} meter nonce onchain
 */
export async function checkNonceOnchain(meterId: string): Promise<number> {
  try {
    const nonce = await rollup.nonce(meterId);
    return nonce;
  } catch (err: any) {
    console.error("Failed to check nonce onchain:", err);
    throw err;
  }
}

export async function getProverURL(): Promise<string | null> {
  return PREFERRED_PROVER_NODE;
}

export async function sendPendingTransactionsToProver(proverURL: string) {
  const pendingTransactions = getUnverifiedTransactionRecords();

  if (!proverURL) {
    console.error("No active prover node available");
    return;
  }

  const requestPayload = buildBatchPayload(pendingTransactions);

  await sendTransactionsToProver(proverURL, requestPayload);

  return;
}
