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

The latest full `npm test -- --runInBand --silent` run passed **239 tests in
32 suites**, with TypeScript checking and a clean Jest exit. The full
`PLAYWRIGHT_BROWSERS_PATH=/tmp/console-ci-browsers npm run test:ui` run passed
**28 tests**. After gateway-local DNS hardening, the three Browser Playwright
cases passed again. No existing UI tests were disabled or weakened. A Browser
credential-URL notification regression found in the first run was fixed in the
application, preserving the original notification test.

`npm ci --include=dev` completed successfully on the host (Node 24.16.0).
An offline attempt first failed because Playwright tarballs were absent; an
online retry fetched the locked versions. No lockfile or dependency versions
changed. Native Node 20/Alpine verification is tracked separately below.

Default, central and gateway Compose configuration, plus optional Browser and
updater combinations, passed `docker compose config --quiet` with disposable
placeholder configuration. `bash -n auto-compose.sh`, `git diff --check` and
Dockerized actionlint passed. No production containers were started/replaced.
The protected decoder/encoder/uplink-payload files, default compose.yaml and
auto-compose.sh are byte-for-byte unchanged from the branch base.

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

## Additional integration checks

- Actual agent entry point with an in-process MQTT client double, local fallback
  HTTP and fake central WebSocket: durable commit before MQTT acknowledgment,
  duplicate delivery/restart, stable session ID, reconnect subscriptions, wrong
  FPort filtering and malformed objects without disconnecting MQTT.
- Durable result acknowledgment replay, idempotent central downlink audits,
  device discovery/manual assignment, owner-gated update APIs, and credential
  rotation on the same live connection without interrupting tunnels.
- Proxy single-use request provenance, DNS pinning, central private routing only
  through a fake agent, gateway-local service names, metadata refusal, public to
  private blocking, inspected TLS CONNECT, and bidirectional WebSocket bytes.
- Real Chromium against local non-frameable pages, address/history navigation,
  target-blank handling inside the app, mobile bounds and unavailable-engine UI.
- Updater controller with signed fixture data and fake Docker/registry adapters:
  wrong repository/tag/unsigned/wrong-identity refusal, cancellation, paired
  replacement, health/reconnect rollback, crash recovery and failed-digest block.
  The actual CLI arguments constrain GitHub provenance identity. This is **not**
  a live Sigstore verification or real container replacement test.
- A static-page AMD64 browser sample measured 422 MiB aggregate RSS over six
  processes and 0% of one core during a three-second idle interval. It used the
  test-only sandbox bypass; it is not an ARM64 or peak-load measurement.

## Release gates and environment limitations

The first full UI attempt was interrupted when disk space reached 26 MiB and
Chromium targets crashed. Stopping that run released temporary space; the full
rerun then passed. No unrelated images, containers, volumes or data were pruned.

The required `playwright install --with-deps chromium` step was attempted again
and failed because sudo requires an interactive password unavailable here. The
successful UI runs used existing cached Chromium. That install step is not
reported as passing.

GitHub's connected account is `MADjnr` and repository permissions report
`push: false` for `fluxion9/Console`. A Git push dry-run also failed because no
HTTPS username/credential is configured. No remote ref has been changed, no CI
run is claimed, and no PR can be opened from an unpublished branch. Reconnect as
an authorized account before the required push, CI watch and draft PR.

Docker validation was left unfinished at the user's request. An AMD64 build
completed Node 20/Alpine dependency installation and TypeScript compilation, but
was cancelled during image export (exit 130). It is **not** a successful image
build or runtime check. No further Docker targets or ARM64 builds were attempted;
the optional Browser/updater images and live provenance verification remain
unverified. The build's npm audit reported 117 existing-lockfile findings (23 low,
36 moderate, 51 high, 7 critical). No dependency versions were changed and no
blanket audit fix was applied; reachability and remediation need separate review
before internet-facing production use.

The host is AMD64. Its Docker builder advertises only AMD64 variants, without
ARM64/QEMU, so ARM64 builds and physical gateway measurements require another
runner. The optional browser's production sandbox still needs verification on
that receiving host. Never replace that check with a production --no-sandbox flag.
The agent-failure policy intentionally has no automatic lease takeover; see the
safety rationale in design.md. Real broker persistence, actual meter reboot/nonce
behavior, live attestation retrieval and paired Docker rollback remain manual
gates; all gateway/MQTT/contract/SSH integration tests here use test doubles or
local fixture services.

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
