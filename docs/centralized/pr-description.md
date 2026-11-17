# Draft PR: central Console and gateway agent

## Summary

Adds opt-in central/gateway roles while preserving standalone collection, its
fail-closed relay decision and existing wire formats. One durable event owner
computes each decision; an uncertain committed/enqueued operation is held for
reconciliation, never automatically retried by another Console. A newer report
supersedes the old reply without manufacturing an OFF command.

Central authentication, gateway enrollment/rotation/revocation, audit reporting,
SSH/ChirpStack tunnels, an isolated in-window Browser and a separate signed-image
updater share the existing application. Manager is removed in every role. This
removes its technician downlink controls, telemetry history, charts and raw event
inspection. Alternatives are ChirpStack's device queue and the operator's
monitoring platform. Existing Manager tables are preserved.

## Review checklist

- [x] New feature branch only; no main changes, deployment or blockchain traffic.
- [x] Architecture inventory, design/security decisions, deployment and test plan.
- [x] Same protected codecs, encoder and baseline billing decisions; fail-closed
  revenue handling remains unchanged.
- [x] Durable ChirpStack-ID ownership, stored outcomes, enqueue fence, queue
  reconciliation, supersession, replay and at-most-one publication attempts.
- [x] Central login and session protection; hashed agent identity, one-time
  enrollment, uninterrupted rotation, revocation and operational audits.
- [x] Gateway selection, device discovery/manual assignment, purpose-limited SSH,
  ChirpStack streaming and Browser private routing.
- [x] Optional Chromium Browser, proxy provenance/private-network enforcement,
  local-service names, input/clipboard/touch/history and unavailable-engine state.
- [x] Owner-enabled separate updater; immutable digest, provenance identity,
  paired replacement, health/reconnect rollback and failed-digest blocking.
- [x] Existing deployment preserved; optional Compose overlays and additive
  platform/manifest attestations. No skipped/weakened tests.
- [ ] Docker/ARM64 validation was left unfinished at the user's request; the
  AMD64 attempt compiled but was cancelled during image export.
- [ ] All GitHub workflow jobs green and run URL: publication blocked by account
  access; no remote CI run has been claimed.
- [ ] Real gateway/meter, production Chromium sandbox and live signed-image
  verification: deliberately not performed during test-only development.

## How to try after publication

Expected workflow tags are `ghcr.io/fluxion9/console:feat-centralized-console`,
`ghcr.io/fluxion9/console-browser:feat-centralized-console` and
`ghcr.io/fluxion9/console-updater:feat-centralized-console`. These names are
conventions, not a claim that this unpublished branch already has images.

Follow [deployment.md](deployment.md) to configure an isolated central test
server and gateway, create owner files and enroll it. Start central with
`docker compose -f compose.central.yaml up -d`; start the managed test pair with
`docker compose -f compose.gateway.yaml up -d`. Add the optional Browser/updater
files only after reviewing their owner settings. Do not run these commands
against production as part of this PR.

## Validation and limitations

239 unit/integration tests and all 28 Playwright cases passed; the final Browser
subset passed again after network-policy hardening. See [test-plan.md](test-plan.md) for exact commands/results and the receiving-device
manual plan. Unit, proxy, agent and updater integration tests use fake services;
Playwright uses local fixtures. There is no claim of live blockchain, MQTT meter
or ChirpStack testing.

The safety policy chooses availability loss over duplicate relay/billing effects:
no automatic local MQTT takeover when the agent dies, no automatic retries for
uncertain external publications, and no eviction of idempotency tombstones at the
journal capacity bound. Third-party publishers must adopt the managed claim
interface. Rollouts are manual per gateway, not automatic latest-main scheduling.
Browser uploads/downloads are disabled; pixel streaming lacks remote DOM screen
reader semantics. ARM64 resource and production sandbox measurements remain a
hardware release gate. Nothing is merged by this change.
