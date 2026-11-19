import cron from 'node-cron';
import { getAllMeterRecords, pruneGatewayHistory } from '../store/sqlite';
import { meterLatestNonceContractCall } from '../utils/contracts';
import { createLogger } from '../utils/logger';

const logger = createLogger('[gateway-pruning]');

export async function pruneConfirmedGatewayHistory(target: string): Promise<number> {
  let removed = 0;
  for (const meter of getAllMeterRecords()) {
    try {
      const confirmed = await meterLatestNonceContractCall(meter.tokenId);
      removed += pruneGatewayHistory(target, meter.tokenId, confirmed);
    } catch {
      // A failed chain read is never evidence that a local record may be deleted.
      logger.warn(`Kept readings for meter ${meter.tokenId}: confirmation or pruning failed.`);
    }
  }
  if (removed) logger.info(`Removed ${removed} confirmed readings already accepted by central.`);
  return removed;
}

export function startGatewayPruning(target: () => string) {
  const schedule = process.env.GATEWAY_PRUNE_CRONSCHEDULE || '*/5 * * * *';
  if (!cron.validate(schedule)) throw new Error('GATEWAY_PRUNE_CRONSCHEDULE must be a valid cron expression.');
  return cron.schedule(schedule, async () => {
    try { await pruneConfirmedGatewayHistory(target()); }
    catch { logger.warn('Pruning deferred until gateway enrollment is ready.'); }
  }, { name: 'gateway-prune-confirmed-history', noOverlap: true, timezone: 'UTC' });
}
