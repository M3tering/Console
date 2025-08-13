import { Contract, JsonRpcProvider } from "ethers";
import { TransactionRecord } from "../types";

// Verifier node structure
export interface VerifierNode {
  id: string;
  url: string;
  isActive: boolean;
  lastSeen: number;
}

/**
 * Get verifier node list from smart contract
 * Makes a request to a smart contract to get an array of node structs
 */
export async function getVerifierNodeList(): Promise<VerifierNode[]> {
  try {
    // TODO: Implement smart contract call to get verifier nodes
    // const provider = new JsonRpcProvider(process.env.GNOSIS_RPC);
    // const contract = new Contract(
    //   process.env.VERIFIER_REGISTRY_CONTRACT,
    //   ["function getVerifierNodes() view returns (tuple(string id, string url, bool isActive, uint256 lastSeen)[])"],
    //   provider
    // );
    // const nodes = await contract.getVerifierNodes();
    // return nodes.map((node: any) => ({
    //   id: node.id,
    //   url: node.url,
    //   isActive: node.isActive,
    //   lastSeen: node.lastSeen
    // }));

    console.log("📡 Fetching verifier node list from smart contract...");
    return [];
  } catch (err: any) {
    console.error("❌ Failed to get verifier node list:", err.message);
    return [];
  }
}

/**
 * Choose a verifier node from the fetched list
 * Picks one verifier node from the available nodes (e.g., random selection, load balancing, etc.)
 */
export function chooseVerifierNode(nodes: VerifierNode[]): VerifierNode | null {
  try {
    // TODO: Implement node selection logic
    // Filter active nodes
    const activeNodes = nodes.filter((node) => node.isActive);

    if (activeNodes.length === 0) {
      console.warn("⚠️ No active verifier nodes available");
      return null;
    }

    // For now, select a random active node
    // In production, you might want to implement:
    // - Load balancing based on node capacity
    // - Geographic proximity
    // - Node reputation scoring
    const randomIndex = Math.floor(Math.random() * activeNodes.length);
    const selectedNode = activeNodes[randomIndex];

    console.log("🎯 Selected verifier node:", {
      id: selectedNode.id,
      url: selectedNode.url,
    });
    return selectedNode;
  } catch (err: any) {
    console.error("❌ Failed to choose verifier node:", err.message);
    return null;
  }
}

/**
 * Send transactions to verifier node for verification
 */
export async function sendTransactionsToVerifier(
  transactions: TransactionRecord[],
  verifierNode: VerifierNode
): Promise<boolean> {
  try {
    // TODO: Implement HTTP request to verifier node
    // const response = await fetch(`${verifierNode.url}/verify-transactions`, {
    //   method: 'POST',
    //   headers: {
    //     'Content-Type': 'application/json',
    //   },
    //   body: JSON.stringify({ transactions })
    // });
    //
    // if (!response.ok) {
    //   throw new Error(`Verifier responded with status: ${response.status}`);
    // }
    //
    // const result = await response.json();
    // console.log("✅ Transactions sent to verifier:", { count: transactions.length, verifier: verifierNode.id });
    // return result.success;

    console.log("📤 Sending transactions to verifier node:", {
      count: transactions.length,
      verifier: verifierNode.id,
    });
    return true;
  } catch (err: any) {
    console.error("❌ Failed to send transactions to verifier:", err.message);
    return false;
  }
}

/**
 * Check verification status from verifier node
 */
export async function checkVerificationStatus(
  transactionIds: number[],
  verifierNode: VerifierNode
): Promise<{ transactionId: number; verified: boolean }[]> {
  try {
    // TODO: Implement HTTP request to check verification status
    // const response = await fetch(`${verifierNode.url}/verification-status`, {
    //   method: 'POST',
    //   headers: {
    //     'Content-Type': 'application/json',
    //   },
    //   body: JSON.stringify({ transactionIds })
    // });
    //
    // if (!response.ok) {
    //   throw new Error(`Verifier responded with status: ${response.status}`);
    // }
    //
    // const result = await response.json();
    // console.log("📋 Checked verification status:", { count: result.verifications.length });
    // return result.verifications;

    console.log("📋 Checking verification status from verifier node:", {
      count: transactionIds.length,
      verifier: verifierNode.id,
    });
    return [];
  } catch (err: any) {
    console.error("❌ Failed to check verification status:", err.message);
    return [];
  }
}
