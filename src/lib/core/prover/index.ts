import { buildBatchPayload } from "../../utils";
import type { BatchTransactionPayload, Hooks, TransactionRecord } from "../../../types";

const PREFERRED_PROVER_NODE = process.env.PREFERRED_PROVER_NODE || "https://prover.m3ter.ing";

export default class implements Hooks {
  async onTransactionDistribution(_: any, __: any, pendingTransactions: TransactionRecord[]) {
    // send pending transactions to prover node
    try {
      const proverURL = await this.getProverURL();

      if (!proverURL) {
        console.warn("No prover URL configured. Skipping sending transactions to prover.");
        return;
      }

      console.info(`Sending pending transactions to prover: ${proverURL}`);

      const response = await this.sendPendingTransactionsToProver(proverURL!, pendingTransactions);

      console.info("done sending to prover");
      console.info(`Prover response (text): ${await response?.text()}`);
    } catch (error) {
      console.error(`Error sending pending transactions to prover: ${error}`);
    }
  }

  async sendTransactionsToProver(
    proverURL: string,
    transactionData: BatchTransactionPayload[]
  ): Promise<Response | null> {
    try {
      const response = await fetch(`${proverURL}/batch-payloads`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(transactionData),
      });

      console.log("[info] received", response.status, "from the prover");

      if (!response.ok) {
        throw new Error(`Prover responded with status: ${response.status}`);
      }
      return response;
    } catch (err: any) {
      console.error("Failed to send transactions to prover:", err.message);
      return null;
    }
  }

  async getProverURL(): Promise<string | null> {
    return PREFERRED_PROVER_NODE;
  }

  async sendPendingTransactionsToProver(proverURL: string, pendingTransactions: TransactionRecord[]) {
    console.log("[info] Sending", pendingTransactions.length, "transactions to prover at", proverURL);

    const requestPayload = buildBatchPayload(pendingTransactions);

    return await this.sendTransactionsToProver(proverURL, requestPayload);
  }
}
