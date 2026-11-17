# Verification ledger and test plan

This is a development ledger, not a declaration that the full feature passes.
No test contacts real MQTT/ChirpStack, a gateway, meter or blockchain.

## Automated coverage implemented

- Frozen baseline `handleMessage` versus the modified collector for signature
  rejection, valid reports, stale nonces, nonce zero, repeated reports and an
  extension exception. Downlink bytes, transaction content, latest nonce,
  distribution count and error outcomes are compared.
- Existing codec, signature, hooks, nonce synchronization and SQLite tests.
- Manager removal: no desktop entry or HTTP API, old settings ignored without
  logging values, initialization preserves an existing Manager table and data.
- Role configuration defaults, TLS opt-in validation and bounded settings.
- Hashed enrollment/credentials, single-use tokens, expiry, rotation overlap,
  acknowledgment and revocation; hashed passwords and session expiry/logout.
- Credential file permissions and symlink refusal; bounded sign-in rate limiting.
- Strict protocol direction, message sizes, fixed vocabulary, billing-only
  downlinks, FPort 2 uplinks, tunnel limits and image digest format.
- Address classification, unusual IPv4 encodings, IPv4-mapped IPv6, metadata
  refusal, DNS pinning contract, mixed-address refusal and private routing policy.

The completed `npm test -- --runInBand --silent` run passed **193 tests in 24
suites**, including HTTP-auth injection tests, in approximately 15 seconds.
The desktop suite passed 24 of 25 tests; the remaining new removal assertion
expected the wrong desktop title. After correcting it, the two Browser tests
passed on a targeted rerun. No existing application behavior was changed to
satisfy that assertion. This is not a full post-fix suite rerun.

A first attempt could not locate the Playwright browser; the successful runs used
the existing `/tmp/console-ci-browsers` installation. The required
`playwright install --with-deps chromium` was attempted but sudo
required an interactive password unavailable in this session. This is not a
successful reproduction of that CI installation step.

## Coverage still required before publication

The agent/central/local integration, durable ownership, uncertain outcomes,
reconciliation/distribution, lease handoff, bounded spool and crash recovery must
be implemented and tested. The required billing safety decision is recorded in
`design.md`. Browser engine/proxy/PNA tests, SSH tunnel tests, ChirpStack streaming
tunnel tests, updater verification and rollback tests, and central gateway UI
tests remain outstanding. Classifier tests alone do not prove proxy enforcement.

Before any push run the exact dependency, unit, UI and Docker checks requested in
the task. Do not publish or report a green workflow before doing so. The local
host is AMD64; native ARM64 execution and physical gateway resource measurements
are unavailable here. Docker has other running services: never stop them or
prune unrelated images to make room for tests.

## Manual plan: one explicitly authorized test gateway

These steps are a future operator plan, **not executed by this task**. Use an
isolated meter/network and test contract environment; do not alter production
billing. Record gateway architecture, firmware, image digests and signing identity.

1. Back up `.env` and database. Verify standalone starts without new settings and
   serves the LAN desktop without login. Check that Manager is absent and billing
   still produces the same fail-closed decision on an unavailable revenue read.
2. Start the opt-in central test deployment behind TLS and enroll the gateway
   with a one-time token. Verify replay/expiry rejection, owner-only credentials,
   no inbound gateway listener, and authenticated central pages and upgrades.
3. Send known signed FPort 2 reports. Check event IDs, the central transaction
   records, and **exactly one** ChirpStack queue entry per processed report. Confirm
   non-billing uplinks are ignored.
4. Stop central, continue reporting, then restart central. Check agreed fallback
   ownership, local durable transactions, late-decision rejection and idempotent
   replay. Inspect each publication destination for duplicate `(tokenId, nonce)`.
   Explicitly test an enqueue response lost after the queue accepted it.
5. Restart the agent during each ownership/enqueue transition. Check the journal
   and queue for duplicates; test both Consoles down, ordered drain, spool bounds,
   lease handoff and firmware behavior after unanswered reports.
6. Open central Terminal for this gateway; authenticate against a test SSH user,
   resize, disconnect and reconnect. Check host-key change refusal, idle/session
   limits and purpose allowlists. Verify audit entries contain no credentials or
   keystrokes. The local Terminal must still work directly.
7. Open ChirpStack through central, including a streaming gRPC-Web request.
   Verify the destination gateway and that Console cookies/API_TOKEN do not leak.
8. Browse a non-frameable test website inside Browser, navigate back/forward and
   open a target-blank link. Open an explicitly typed gateway-local page. Attempt
   public-page fetches, forms, WebSockets and redirects to private/metadata hosts;
   all unauthorized requests must fail at the proxy. Inspect destination logs.
9. Rotate and revoke the agent credential. Verify rotation keeps service and
   revocation disconnects immediately. Test reconnect and session expiration.
10. Request an authorized signed digest update. Verify both containers change,
    configuration/data remain, and an unhealthy or non-reconnecting image rolls
    back. Wrongly signed/unsigned images must never start. Verify disabled owner
    policy and cancellation before an update begins.
11. Restore the previous recorded digest, then return the gateway to standalone.
    Confirm no double subscriptions and no orphaned tunnel/browser/updater jobs.

Capture actual results and CI URLs when these tests become runnable. Do not tick
manual or architecture-specific checks based only on simulated unit fixtures.
