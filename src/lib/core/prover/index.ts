import cron from "node-cron";
import { pruneAndSyncOnchain } from "../../sync";
import { buildBatchPayload, retry } from "../../utils";
import { getAllMeterRecords, getAllTransactionRecords, getTransactionByNonce } from "../../../store/sqlite";
import type { BatchTransactionPayload, DecodedPayload, Hooks, TransactionRecord } from "../../../types";

const PREFERRED_PROVER_NODE = process.env.PREFERRED_PROVER_NODE;

export default class implements Hooks {
  private proverSchedule: string = process.env.PROVER_CRONSCHEDULE || "0 0 * * *"; // default to every 24 hours

  async onAfterInit() {
    if (!PREFERRED_PROVER_NODE) {
      console.warn("No PREFERRED_PROVER_NODE configured. Prover hooks will not be registered.");
      return;
    }

    console.log("Registering prover cron job...");
    console.log("Schedule: ", this.proverSchedule, " Prover URL: ", PREFERRED_PROVER_NODE);

    // Schedule a cron job to publish pending transactions
    cron.schedule(
      this.proverSchedule,
      async () => {
        console.log(
          `Prover cron job started: Pruning meters and sending pending transactions to the prover at ${PREFERRED_PROVER_NODE}...`,
        );
        const m3ters = getAllMeterRecords();
        for (const m3ter of m3ters) {
          try {
            pruneAndSyncOnchain(m3ter.publicKey);
          } catch (error) {
            console.error(`Error pruning and syncing meter ${m3ter.publicKey}:`, error);
          }
        }

        console.log("sending pending transactions to prover...");

        const pendingTransactions = getAllTransactionRecords();
        const proverUrl = await this.getProverURL();

        if (pendingTransactions.length > 0) {
          try {
            const response = await this.sendPendingTransactionsToProver(proverUrl!, pendingTransactions);

            console.info("done sending all pending transactions to prover");
            console.info(`Prover response (text): ${await response?.text()}`);
          } catch (error) {
            console.error(`Error sending pending transactions to prover: ${error}`);
          }
        }
      },
      { name: "prover-publish-pending-transactions", noOverlap: true },
    );

    console.log("Prover cron job registered.");
    return;
  }

  async onTransactionDistribution(tokenId: number, currentTransaction: DecodedPayload, _: any) {
    // send pending transactions to prover node
    try {
      const proverURL = await this.getProverURL();

      if (!proverURL) {
        console.warn("No prover URL configured. Skipping sending transactions to prover.");
        return;
      }

      console.info(`Sending new transaction to prover: ${proverURL}`);

      const latestTransaction = getTransactionByNonce(currentTransaction.nonce, tokenId);
      if (!latestTransaction) {
        console.warn(
          `No transactions found for meter ${tokenId} with nonce ${currentTransaction.nonce}. Skipping sending to prover.`,
        );
        return;
      }

      const response = await this.sendPendingTransactionsToProver(proverURL!, [latestTransaction]);

      console.info("done sending to prover");
      console.info(`Prover response (text): ${await response?.text()}`);
    } catch (error) {
      console.error(`Error sending pending transactions to prover: ${error}`);
    }
  }

  async sendTransactionsToProver(
    proverURL: string,
    transactionData: BatchTransactionPayload[],
  ): Promise<Response | null> {
    try {
      const response = await fetch(`${proverURL}/batch-payloads`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(transactionData),
      });

      if (!response.ok) {
        throw new Error(`Prover responded with status: ${response.status}`);
      }

      return response;
    } catch (err: any) {
      console.error("Failed to send transactions to prover:", err.message);
      throw err;
    }
  }

  async getProverURL(): Promise<string | null> {
    return PREFERRED_PROVER_NODE || null;
  }

  async sendPendingTransactionsToProver(proverURL: string, pendingTransactions: TransactionRecord[]) {
    console.log("[info] Sending", pendingTransactions.length, "transactions to prover at", proverURL);

    const requestPayload = buildBatchPayload(pendingTransactions);

    return retry(async () => this.sendTransactionsToProver(proverURL, requestPayload));
  }
}
