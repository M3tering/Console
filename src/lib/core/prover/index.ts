import cron from 'node-cron';
import { pruneAndSyncOnchain } from '../../sync';
import { buildBatchPayload, retry } from '../../utils';
import { getAllMeterRecords, getAllTransactionRecords, getTransactionByNonce } from '../../../store/sqlite';
import type { BatchTransactionPayload, DecodedPayload, Hooks, TransactionRecord } from '../../../types';
import { createLogger } from '../../../utils/logger';

const PREFERRED_PROVER_NODE = process.env.PREFERRED_PROVER_NODE;
const logger = createLogger('[prover-job]');

export default class implements Hooks {
  private proverSchedule: string = process.env.PROVER_CRONSCHEDULE || '0 0 * * *'; // default to every 24 hours

  async onAfterInit() {
    if (!PREFERRED_PROVER_NODE) {
      logger.warn('No PREFERRED_PROVER_NODE configured. Prover hooks will not be registered.');
      return;
    }

    logger.info('Registering prover cron job...');
    logger.info('Schedule: ', this.proverSchedule, ' Prover URL: ', PREFERRED_PROVER_NODE);

    // Schedule a cron job to publish pending transactions
    cron.schedule(
      this.proverSchedule,
      async () => {
        logger.info(
          `Prover cron job started: Pruning meters and sending pending transactions to the prover at ${PREFERRED_PROVER_NODE}...`,
        );
        const m3ters = getAllMeterRecords();
        for (const m3ter of m3ters) {
          try {
            pruneAndSyncOnchain(m3ter.publicKey);
          } catch (error) {
            logger.error(`Error pruning and syncing meter ${m3ter.publicKey}:`, error);
          }
        }

        logger.info('sending pending transactions to prover...');

        const pendingTransactions = getAllTransactionRecords();
        const proverUrl = await this.getProverURL();

        if (pendingTransactions.length > 0) {
          try {
            const response = await this.sendPendingTransactionsToProver(proverUrl!, pendingTransactions);

            logger.info('done sending all pending transactions to prover');
            logger.info(`Prover response (text): ${await response?.text()}`);
          } catch (error) {
            logger.error(`Error sending pending transactions to prover: ${error}`);
          }
        }
      },
      { name: 'prover-publish-pending-transactions', noOverlap: true },
    );

    logger.info('Prover cron job registered.');
    return;
  }

  async onTransactionDistribution(tokenId: number, currentTransaction: DecodedPayload, _: any) {
    // send pending transactions to prover node
    try {
      const proverURL = await this.getProverURL();

      if (!proverURL) {
        logger.warn('No prover URL configured. Skipping sending transactions to prover.');
        return;
      }

      logger.info(`Sending new transaction to prover: ${proverURL}`);

      const latestTransaction = getTransactionByNonce(currentTransaction.nonce, tokenId);
      if (!latestTransaction) {
        logger.warn(
          `No transactions found for meter ${tokenId} with nonce ${currentTransaction.nonce}. Skipping sending to prover.`,
        );
        return;
      }

      const response = await this.sendPendingTransactionsToProver(proverURL!, [latestTransaction]);

      logger.info('done sending to prover');
      logger.info(`Prover response (text): ${await response?.text()}`);
    } catch (error) {
      logger.error(`Error sending pending transactions to prover: ${error}`);
    }
  }

  async sendTransactionsToProver(
    proverURL: string,
    transactionData: BatchTransactionPayload[],
  ): Promise<Response | null> {
    try {
      const response = await fetch(`${proverURL}/batch-payloads`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(transactionData),
      });

      if (!response.ok) {
        throw new Error(`Prover responded with status: ${response.status}`);
      }

      return response;
    } catch (err: any) {
      logger.error('Failed to send transactions to prover:', err.message);
      throw err;
    }
  }

  async getProverURL(): Promise<string | null> {
    return PREFERRED_PROVER_NODE || null;
  }

  async sendPendingTransactionsToProver(proverURL: string, pendingTransactions: TransactionRecord[]) {
    logger.info('[info] Sending', pendingTransactions.length, 'transactions to prover at', proverURL);

    const requestPayload = buildBatchPayload(pendingTransactions);

    return retry(async () => this.sendTransactionsToProver(proverURL, requestPayload));
  }
}
