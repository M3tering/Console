import type { Decider } from './processor';

/** Separate from live operation replay: historical rows must never enqueue a
 * device reply or consume an agent operation/idempotency slot. A lost response
 * leaves the batch unacknowledged locally, so the same bytes are retried. */
export async function syncGatewayHistory(gateway: string, local: Decider, central: Decider): Promise<number> {
  if (!local.history || !central.history) throw new Error('History synchronization is unavailable.');
  const batch = await local.history(gateway, 'history-read');
  if (!batch) return 0;
  await central.history(gateway, 'history-import', batch);
  await local.history(gateway, 'history-ack', batch);
  return batch.transactions.length;
}
