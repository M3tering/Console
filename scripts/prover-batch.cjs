// Sends every stored reading not yet confirmed on-chain to the prover, now: the same batch the
// scheduled prover job (PROVER_CRONSCHEDULE) sends. Run through ./prover-batch.sh, inside the Console container.
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
  const response = await new Prover().sendPendingTransactionsToProver(url, pending);
  console.log(response ? 'Prover answered: ' + await response.text() : 'Nothing was sent.');
})().then(() => process.exit(0), e => { console.error('Batch failed: ' + e.message); process.exit(1); });
