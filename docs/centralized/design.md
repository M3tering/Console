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

## Single-decider safety: approved rule

The baseline commits transactions before calling enqueue and invokes distribution
after the attempt. ChirpStack enqueue supplies no idempotency key. If a reply is
lost, neither retrying nor handing the report to another decider is safe merely
because a deadline expired. A network partition does not fence the remote worker.

The implemented safe rule is durable ownership before side effects, with uncertain
committed events held for reconciliation. Fallback is permitted before ownership
is committed; a late offer cannot regain ownership. Before an enqueue call the
agent must durably mark the attempt; an interrupted attempt cannot be retried
automatically. This guarantees at-most-one attempt, at the cost of potentially
missing a downlink after a crash. An 8-second deadline bounds normal offer
waiting, not grant permission to duplicate a committed operation.

The user approved holding uncertain operations once processing or enqueueing has
begun, and fallback only before ownership is committed. The ChirpStack
`deduplicationId` is mandatory end to end. Both processors return their stored
outcome for that ID; neither recomputes a decision after a processing claim.

The agent first offers an event without side effects, then durably chooses a
decider before sending commit. An unanswered offer can fall back; an unanswered
commit cannot. Reconciliation queries the chosen Console by ID and inspects the
device queue before any enqueue. The enqueue-attempt fence is persisted BEFORE
the gRPC call. An empty queue after a lost response can mean delivery, so it never
authorizes a retry. A newly observed matching queue entry is recorded as
`queue-observed`, not proof of command execution or unique attribution.

The next distinct report supersedes the previous unresolved reply. Checks after
every await prevent a late decision or queue inspection from sending that reply.
Already committed billing records are not deleted or rewritten. If an older
computation may still be writing records, its reply is dropped immediately, but
the newer report cannot switch deciders until its billing snapshot is reconciled.
This prevents conflicting signed values for the same nonce across two databases.
Uncertainty itself never creates an OFF reply. The ordinary revenue/owed hook
retains its existing fail-closed behavior for an actual new decision.

Enqueue outcomes have a persistent acknowledgment outbox: central records each
event/outcome pair once before acknowledging it, and reconnects replay unacknowledged
reports. These audits distinguish API acceptance from an uncertain attempt; they
do not assert meter execution. Unknown acknowledgments cannot allocate journal
rows. Uncertain, reconciled and superseded counts are durable and included in gateway
health and the central selector/status panel. Logs contain event IDs and statuses,
not signed payloads, keys or credentials. Completed IDs remain tombstones. The
journal has a hard configured capacity; a full journal stops ingestion instead of
evicting deduplication state and making old events actionable again.

### Agent failure and buffering decision

The gateway Console does not autonomously take over MQTT when the agent process
dies. Docker restarts the agent; MQTT uses QoS 1 with a persistent, stable session
and the agent's disk journal survives. This deliberately chooses the alternative
permitted in section 3.5 of the task: automatic independent takeover would need
cross-process fencing over the same enqueue journal and could duplicate commands.
Operators can deliberately return the deployment to standalone after stopping the
agent and reconciling its journal. No hidden lease timeout creates a second
subscriber. While both Consoles are down, the latest unresolved report for each
device remains buffered in arrival order; the user's newer-report rule supersedes
older unresolved reports from that same device.

## Distribution boundary

Chain-confirmed nonce filtering is useful but is not external publication
idempotency. Arweave, Streamr and prover retries can repeat an unconfirmed
publication. The implemented managed-mode policy is central-only publication,
including cron and UI actions, with durable per-module claims and reconciliation
records. Local billing can persist reports during an outage but must not
independently publish them. An uncertain external publication requires the same
explicit availability tradeoff; claiming exactly-once from an in-memory Set or
SQLite flag alone would be incorrect. Standalone behavior remains unchanged.

`managed_publications` claims `(destination, tokenId, nonce)` before calling an
external publisher. A lost result is marked uncertain and never automatically
submitted again, even after restart. Arweave uses a destination claim; prover and
Streamr cron/UI paths share their respective destination claims. Extension hook
claims are separate so an interrupted extension is not called twice. The central
recovery dispatcher synchronizes with chain and excludes confirmed nonces before
trying pending records. Gateway cron and UI publishing are suppressed. Custom
third-party cron publishers must adopt the same guard before being enabled in
managed roles; arbitrary extension code cannot be made externally idempotent by
a wrapper. This guarantees at-most-one attempt, not guaranteed delivery.

Fallback snapshots are replayed through a persistent agent outbox. The receiving
Console verifies signatures and contract token ownership, rejects conflicting
raw records for a nonce, and bounds nonce advancement by the chain, existing
state and contiguous signed records. A decider cannot accept a new report until
its replay backlog has been applied. An older committed handler remains a fence
even if several intervening, unowned reports have already been superseded.

## Browser implementation and isolation

A remote Chromium engine is required for ordinary sites: an iframe rewriting
proxy cannot generally preserve CSP, service workers, cookies and modern scripts.
Chromium is optional so the default image remains usable on small gateways.
A missing engine must be visible in the app, not cause Console startup failure.

Traffic must use a per-session controlled proxy and isolated browser profile.
DNS must be classified and pinned at the connection boundary. In central mode,
private destinations route only through the selected agent, never through the
central network. Gateway-local `.local`/`.lan` names are resolved and pinned by the gateway
tunnel endpoint, which refuses public answers and applies its owner allowlist;
central DNS is not used for those names. Cloud metadata is always refused. Gateway allowlists remain
owner-controlled and separate by tunnel purpose.

A blind CONNECT proxy cannot inspect the requesting origin inside TLS. Therefore
public-to-private protection cannot be claimed from destination filtering alone.
The implementation terminates CONNECT with a per-session certificate trusted
only by that Chromium process's SPKI allowlist. Upstream TLS is independently
validated. CDP pauses each request; the proxy resolves and classifies its target,
then issues a short-lived, single-use permit bound to URL, method and pinned IP.
The browser cannot choose routing headers; the proxy strips its permit upstream.
Public-page requests to private targets are refused, including redirects. An
explicit address-bar navigation or user-clicked top-level navigation may open a
local target. WebSocket handshakes use the browser-controlled Origin, previously
classified by the proxy; unknown or ambiguously classified origins are refused.
QUIC and unproxied WebRTC UDP are disabled. Service workers are bypassed.

A rewriting iframe proxy was rejected for internet sites because framing, cookie
and script restrictions would remain. A hybrid adds two inconsistent security
and navigation models without removing Chromium's cost. The selected optional
engine provides a single CDP screencast page; target-blank links stay in it.
Profiles/cookies are temporary and deleted at close. Chromium receives a minimal
environment, excluding the Console wallet, API tokens and agent credentials. Uploads and downloads are
explicitly disabled. Copy uses the selected text and the viewer's clipboard;
paste/IME text is sent as input, never audited. Pixel streaming has no remote DOM
screen-reader semantics; this is an accessibility limitation requiring follow-up.

The default image has no Chromium and displays an unavailable message without
breaking startup. The optional `browser` target uses Alpine Chromium and a
non-root runtime; production never adds `--no-sandbox`. Three global sessions,
one per central user, 10-minute idle and 60-minute lifetime caps, bounded CDP
queues/sockets/frame buffering, and Compose memory/CPU limits bound resource use.
An AMD64 static-page fixture measured 422 MiB summed RSS across six Chromium
processes and 0% of one CPU core over a three-second idle sample (100 Hz process
clock, Node 24.16.0 host, test-only sandbox bypass). RSS double-counts shared
pages; this is neither peak memory nor an ARM64 measurement. No i.MX8 hardware is
available, so ARM64 size/RAM/CPU and production sandbox checks remain release
gates. This cost is why Chromium is an optional image, not installed on all
gateways. The image build's offline about:blank smoke test uses a build-only sandbox bypass;
that is not evidence of production sandbox support on an i.MX8 host.

## Deployment and verification constraints

No production services are contacted. Contract, MQTT, ChirpStack and SSH tests use
doubles or local fixture services. No rollout is performed by this task.
The local host is AMD64; ARM64 runtime resource measurements require an ARM64
test environment. Measurements must not be estimated and presented as observed.
Existing workflow publishing conventions are preserved; attestations will be
additive and run only when images are actually published.

## Integrated transport and authentication

The agent connects to `/agent` using an Authorization header. Browser sessions
are not accepted as agent credentials. The versioned operation RPC separates
`offer`, `commit`, `outcome` and `reconcile`; every envelope carries the original
ChirpStack ID and a transport request ID. The authenticated connection supplies
the gateway identity, never the message body. Duplicate commits return durable
outcomes. The loopback fallback uses the same RPC and a separate owner-only file
secret. Invalid messages are rejected before billing. Agent MQTT acknowledges
QoS 1 delivery only after the local journal has persisted the event.

Central session authentication mounts before static assets and application
routes. Agent enrollment is the narrowly scoped token-authenticated exception.
Browser WebSockets require both the same origin and an unexpired human session;
active sessions are rechecked periodically. Revocation closes the agent link
immediately. Credential rotation persists the replacement locally before acknowledging it on the existing link,
without interrupting tunnels. A two-minute overlap covers interrupted handshakes;
reconnection with the new credential also confirms rotation.

The gateway selector shows cumulative uncertain/reconciled/superseded counts and
current pending count. Switching gateway closes open network application windows
to prevent a window from silently changing its target. Each app title identifies
the selected gateway. Managed logs omit credentials and raw signed envelopes.

## SSH and ChirpStack tunnels

Both services use independent multiplexed duplex streams over the outbound link.
Streams have 64 KiB credit windows, 16 KiB frames, an eight-session default cap,
one MiB/s per-stream limit, and a two-minute idle timeout. Closing the link closes
all streams. The SSH purpose resolves only the owner-configured loopback SSH
port; ChirpStack resolves only the gateway's existing configured web endpoint.
Browser-purpose targets cannot access SSH, Docker or fallback/updater ports.

Central SSH2 uses the stream as its `sock`, so passwords and shell traffic are
inside SSH encryption through the relay. Host keys use trust on first use and
are refused on change; re-enrollment does not silently replace a saved key.
Operators must investigate a change before manually removing the saved key.
Audits record user, gateway and start/end session IDs, including after logout.
The local Terminal keeps its existing direct loopback connection. ChirpStack
uses the existing response rewriting and Bearer-only forwarding over the tunnel,
including streaming gRPC-Web bytes; Console cookies and API_TOKEN are not passed.

These integrations are tested with local fixture servers, never live gateways.
Architecture image builds and physical-gateway measurements are separate release
gates recorded in test-plan.md.

## Gateway inventory and signed updates

Authenticated offers learn the DevEUI-to-gateway inventory. Manual assignments
are preserved separately from the last observed gateway and can be cleared back
to discovery. These are routing metadata, not authorization to transfer ownership
of an already committed report. Billing snapshots preserve meter keys/token IDs;
operation journals associate outcomes, side and distribution snapshots with the
gateway and event ID without changing existing billing tables.

Only the separate updater mounts Docker. The network-facing agent sends fixed
job IDs and allowlisted image digests over a 0600 Unix socket with a second
owner-file secret. The updater verifies GitHub/Sigstore provenance using `gh
attestation verify`, constraining repository, workflow, issuer and locally
allowed refs before pull/replacement. There is no signature-bypass option.
Platform images and manifest digests are attested only on published builds;
PR builds never attest or push. Existing main image tags remain unchanged.

One durable job runs at a time. Queued work is cancellable; cancellation racing
execution reports the actual stored state. Console and agent are replaced
together using the same pinned digest, same Compose project and existing mounts.
Readiness failure or no authenticated reconnect within 180 seconds restores the
previous local image ID; interrupted replacement also rolls back on updater
restart. Failed digests are blocked from automatic retry. `.env`, credentials,
SQLite and volumes are never replaced or deleted. Rollout is operator-directed,
one gateway at a time; automatic latest-main scheduling is not implemented.
A registry/API read token, if needed by gh, exists only in the updater. The agent
has no shell/update script vocabulary and no Docker socket mount.
