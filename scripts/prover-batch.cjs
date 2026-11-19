// Sends readings not yet confirmed on-chain to the prover, now. For each meter it sends the lowest
// PROVER_BATCH_LIMIT nonces (default 100; 0 = all), the ones the prover needs next.
// Run through ./prover-batch.sh, inside the Console container.
const role = process.env.CONSOLE_ROLE || 'standalone';
const url = process.env.PREFERRED_PROVER_NODE;
if (role === 'gateway') { console.log('This is a managed gateway: central sends batches to the prover. Run this on central.'); process.exit(2); }
if (!url) { console.log('PREFERRED_PROVER_NODE is not set in .env, so there is no prover to send to.'); process.exit(2); }
require('/opt/app/dist/store/sqlite').default();
if (role === 'central') require('/opt/app/dist/central/distribution').configurePublications('.data/central.db');
const Prover = require('/opt/app/dist/lib/core/prover').default;
const { getSyncedPendingTransactions } = require('/opt/app/dist/lib/sync');
(async () => {
  const pending = await getSyncedPendingTransactions(); // checks each meter on-chain and prunes confirmed readings first
  console.log(pending.length + ' reading(s) not yet confirmed on-chain.');
  if (!pending.length) return;
  const limit = Number(process.env.PROVER_BATCH_LIMIT ?? 100);
  if (!Number.isInteger(limit) || limit < 0) { console.log('PROVER_BATCH_LIMIT must be a whole number (0 = all).'); process.exit(2); }
  const byMeter = new Map();
  for (const record of pending) byMeter.set(record.identifier, [...(byMeter.get(record.identifier) || []), record]);
  const batch = [];
  for (const [meter, records] of [...byMeter].sort((a, b) => a[0] - b[0])) {
    const lowest = records.sort((a, b) => a.nonce - b.nonce).slice(0, limit || records.length);
    console.log('meter ' + meter + ': sending nonces ' + lowest[0].nonce + '-' + lowest[lowest.length - 1].nonce +
      ' (' + lowest.length + ' of ' + records.length + ' unconfirmed)');
    batch.push(...lowest);
  }
  const response = await new Prover().sendPendingTransactionsToProver(url, batch);
  console.log(response ? 'Prover answered: ' + await response.text() : 'Nothing was sent.');
})().then(() => process.exit(0), e => { console.error('Batch failed: ' + e.message); process.exit(1); });
