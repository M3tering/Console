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

The latest full `npm test -- --runInBand --silent` run passed **217 tests in
29 suites**. The full `PLAYWRIGHT_BROWSERS_PATH=/tmp/console-ci-browsers npm run
test:ui` run passed **27 tests**, including the new gateway status/selection UI
and existing Paint, Terminal, ChirpStack, themes, touch and responsive behavior.
All three Compose files passed `docker compose config --quiet` using disposable
placeholder configuration. No containers were started by this validation.

Added safety coverage includes response loss after enqueue, down before offer,
duplicate delivery, overtaken uncertain reports, several newer reports while an
older handler remains active, slow committed decisions, process restart fences,
empty queues after delivery, durable replay and destination publication claims.
Central/local RPC tests verify stored decisions, human versus agent
authentication, heartbeat counters, secret exclusion and immediate revocation.
SSH fixtures exercise authentication, bidirectional data, resize and cleanup.
A 180 kB binary HTTP/gRPC-Web stream exercises tunnel flow control.

A first attempt could not locate the Playwright browser; the successful runs used
the existing `/tmp/console-ci-browsers` installation. The required
`playwright install --with-deps chromium` was attempted but sudo
required an interactive password unavailable in this session. This is not a
successful reproduction of that CI installation step.

## Coverage still required before publication

The four explicitly requested uncertain-operation scenarios are covered. More
coverage is still needed for full agent MQTT lifecycle, production-mode TLS
proxies, complete gateway application routing, and real hardware behavior.
Browser engine/proxy/PNA tests, signed updater verification/rollback and full
architecture builds remain outstanding. Classifier tests alone do not prove
proxy enforcement. The agent-failure policy intentionally has no automatic
lease takeover; see the safety rationale in `design.md`.

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
   the documented no-takeover policy and firmware behavior after unanswered reports.
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
