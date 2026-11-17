# Centralized Console design and decision record

Status: implementation in progress on `feat/centralized-console`. This is a test
branch, not a production deployment. See `current-architecture.md` for the audited
baseline. Sections below distinguish decisions from unresolved requirements.

## Compatibility and roles

One Console image is the target, with separate Console and agent entry points.
The default role remains standalone. The existing deployment script and default
Compose file must not activate central features. The gateway role retains its
LAN desktop and local SSH service; central must authenticate before serving any
desktop, application API, WebSocket or tunnel.

The Manager application is removed. Its former protocol decoder is retained under
`src/lib/protocol` with its companion decoder and protocol tests, because the task
explicitly protects decoder compatibility. This does not retain any Manager API,
monitoring subscription, command catalogue, persistence or UI. Existing database
tables remain untouched. Legacy Manager configuration produces one warning with
no values. Shared application UUID validation moves to `lib/chirpstack-config`.

## Single-decider safety: decision required

The baseline commits transactions before calling enqueue and invokes distribution
after the attempt. ChirpStack enqueue supplies no idempotency key. If a reply is
lost, neither retrying nor handing the report to another decider is safe merely
because a deadline expired. A network partition does not fence the remote worker.

The proposed safe rule is durable ownership before side effects, with uncertain
committed events held for reconciliation. Fallback is permitted before ownership
is committed; a late offer cannot regain ownership. Before an enqueue call the
agent must durably mark the attempt; an interrupted attempt cannot be retried
automatically. This guarantees at-most-one attempt, at the cost of potentially
missing a downlink after a crash. An 8-second deadline would bound normal offer
waiting, not grant permission to duplicate a committed operation.

**Pending user clarification:** may uncertain events be held instead of falling
back/retrying automatically? The requested unconditional deadline fallback and
exactly-one side effects cannot both be promised with the current external APIs.
Do not enable a billing failover path until this tradeoff is agreed.

## Distribution boundary

Chain-confirmed nonce filtering is useful but is not external publication
idempotency. Arweave, Streamr and prover retries can repeat an unconfirmed
publication. The proposed managed-mode policy is central-only publication,
including cron and UI actions, with durable per-module claims and reconciliation
records. Local billing can persist reports during an outage but must not
independently publish them. An uncertain external publication requires the same
explicit availability tradeoff; claiming exactly-once from an in-memory Set or
SQLite flag alone would be incorrect. Standalone behavior must remain unchanged.

## Browser approach under evaluation

A remote Chromium engine is required for ordinary sites: an iframe rewriting
proxy cannot generally preserve CSP, service workers, cookies and modern scripts.
Chromium should be optional so the default image remains usable on small gateways.
A missing engine must be visible in the app, not cause Console startup failure.

Traffic must use a per-session controlled proxy and isolated browser profile.
DNS must be classified and pinned at the connection boundary. In central mode,
private destinations route only through the selected agent, never through the
central network. Cloud metadata is always refused. Gateway allowlists remain
owner-controlled and separate by tunnel purpose.

A blind CONNECT proxy cannot inspect the requesting origin inside TLS. Therefore
public-to-private protection cannot be claimed from destination filtering alone.
An implementation must pair trusted request provenance with proxy enforcement
and prevent engine bypass, or terminate and inspect browser traffic in a
controlled trust boundary. This is an implementation/security gate, not a reason
to silently ship an unrestricted HTTP CONNECT proxy.

## Deployment and verification constraints

No production services are contacted. Contract, MQTT, ChirpStack and SSH tests use
doubles or local fixture services. No rollout is performed by this task.
The local host is AMD64; ARM64 runtime resource measurements require an ARM64
test environment. Measurements must not be estimated and presented as observed.
Existing workflow publishing conventions are preserved; attestations will be
additive and run only when images are actually published.
