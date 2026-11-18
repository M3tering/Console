# Current architecture

Inspected baseline: `fc396d63e31f7f8979cc031c880ceb73237fdbd8` on the fork's
`main`. This document describes that baseline, before the feature changes.
Inspection did not contact a gateway, meter, broker, contract or blockchain.

## Startup and deployment

`src/index.ts` loads backend extensions and UI extensions, initializes contracts,
runs `onBeforeInit`, initializes SQLite, runs `onDatabaseSetup`, starts MQTT,
starts HTTP, and runs `onAfterInit`. Terminal WebSocket registration happens when
the entry point is loaded. A startup failure invokes `onInitError` and exits.
Contract clients are also imported by billing dependencies; merely importing the
production entry point is not a safe integration-test harness.

The image uses Node 20 Alpine and builds native dependencies with the distribution
toolchain. `entrypoint.sh` runs `scripts/install-modules.cjs` before its command.
The installer validates module references and prepares configured extensions.
`compose.yaml` runs one Console with host networking, the existing `.env`, a
bind-mounted `.data`, and extension volumes. Its health check requests `/healthz`.
`auto-compose.sh` updates the Console service, preserves configuration and volumes,
waits for health, and restores the prior image if startup fails. These are the
standalone deployment interfaces to preserve.

## Billing pipeline and its boundaries

`src/services/mqtt.ts` currently owns **one** MQTT client. It subscribes with QoS 1
to `application/{APPLICATION_ID}/device/+/event/+`. The connection uses `MQTT_URL`
when present; otherwise it uses `CHIRPSTACK_HOST || 'localhost'`, port 1883.
The current session is clean, uses a random `console-` client ID, and reconnects.
Each event is independently offered to Manager ingestion. Only matching uplinks
with FPort 2 (or the legacy missing-port case) enter billing. There is no second
monitoring connection in this baseline; removing Manager must remove its fan-out,
not accidentally remove the collector.

`handleMessage`:

1. Validates the device identity and takes a process-local DevEUI lock.
2. Uses `uplinkPayload` and `decodePayload`, finds the public key from the packet
   or stored device, and verifies the Ed25519 signature over bytes 0–7.
3. Takes a second lock by public key, preventing different DevEUIs from advancing
   the same meter concurrently.
4. For a packet containing a public key, registers the meter through the contract
   lookup or updates its DevEUI, then synchronizes its latest nonce.
5. For `latestNonce + 1`, atomically inserts the transaction and advances the
   stored nonce. A repeated current nonce is accepted only if the stored
   transaction exists and the reported energy has not decreased. It does not
   insert or distribute that transaction again. Other nonzero nonces fail.
6. Initializes `is_on = false`, invokes `isOnStateCompute`, and leaves it false
   if any extension throws. `runHook` combines boolean results with AND and
   throws after collecting extension errors. Revenue/owed failures therefore
   remain **off**; the reported ENS issue is outside this task.
7. Calls `encode` and gRPC enqueue. Nonce zero includes the stored nonce in the
   reply; ordinary replies do not. Coordinates retain the existing float format.
8. In a `finally` after the enqueue attempt, notifies
   `onTransactionDistribution` for a newly stored transaction. The hook does not
   delay completion. Errors are caught; locks are released in `finally`.

Manager-specific `collectorAccepted` observes the transaction after persistence
and is isolated by a catch. `ingestEvent` is separate from billing. Neither is
required to compute the billing decision.

The transaction commit precedes enqueue. `src/services/grpc.ts` sends an
unconfirmed FPort 2 `DeviceQueueItem` and does not supply an idempotency key.
Consequently a crash between sending and receiving the enqueue response has an
unknown outcome. Neither the device locks nor SQLite uniqueness solve that
external side-effect ambiguity. A central timeout also cannot prove that the
central process stopped working. These constraints must inform the ownership
protocol, rather than assuming that retries are harmless.

## Extensions and distribution

`BACKEND_MODULES` and `UI_MODULES` are parsed by `src/lib/modules.ts`; `utils.ts`
loads their hooks and UI implementations. `src/types.ts` defines initialization,
MQTT, message lifecycle, meter registration, state computation/enqueue and
transaction distribution hooks. Hooks must retain their names and arguments.
UI actions are dispatched through `/api/actions/:moduleId/:actionId`.

| Built-in module | Behavior | Existing idempotency boundary |
| --- | --- | --- |
| `core/is_on` | Reads cross-chain revenue and amount owed; compares them | Errors propagate, preserving fail-closed behavior |
| `core/arweave` | Uploads each new transaction through Turbo | No durable publication claim; a retry can upload twice |
| `core/prover` | Immediate transaction submission and scheduled batch publication | Cron excludes chain-confirmed nonces; an unconfirmed batch can be republished |
| `core/streamr` | Scheduled pending batches; UI also offers publication | Cron synchronizes chain nonces, but does not deduplicate repeated external publications |

`getLatestTransactionNonce` reconciles chain and local state. Scheduled
`getSyncedPendingTransactions` only includes meters successfully synchronized
with chain and nonces above their chain nonce. This is not an exactly-once
external delivery guarantee: chain confirmation can lag publication. The managed
roles need explicit distribution ownership, including scheduled and UI paths.

## Storage

`src/store/sqlite.ts` opens `.data/m3tering.db`. `meters` stores public key,
DevEUI, token ID and latest nonce. `transactions` has unique `(nonce, identifier)`;
`recordMeterTransaction` inserts and advances the meter nonce in one transaction.
Read helpers frequently return null/empty on errors; persistence errors propagate.
Nonce synchronization prunes records according to the existing chain rules.

Startup also calls `initializeManagerStore`. Manager owns events, command
history, usage readings, electrical readings, authentication/monitoring state and
per-device interpretation state in its modules under `src/m3ter`. Its rolling
telemetry limit is separate from billing records. Removal must stop initializing
or pruning these tables and leave existing tables and their data untouched.
`applicationId` currently lives in Manager's ChirpStack helper but is imported by
the collector: move that shared validation to a neutral module before removal.

## HTTP and applications

`server.ts` mounts ChirpStack before body parsers so gRPC-Web remains streamed,
then same-origin middleware, no-store headers, health, static assets, Manager
routes, desktop rendering and extension actions. There is no Console login.
`auth.ts` checks Fetch Metadata and Origin/Host; forwarded headers are not trusted.
`socket-router.ts` authorizes exact WebSocket paths and requires same-origin
browser upgrades. Central authentication must also precede proxy/static routes
and upgrade dispatch; agent upgrades need separate credential authentication.

| App or endpoint | Current resources and behavior | Standalone / gateway target | Central target |
| --- | --- | --- | --- |
| Desktop `/`, static assets | Handlebars, client window manager | Existing LAN UI, no login | Login required; selected gateway displayed |
| Terminal `/terminal` | `ssh2` to `127.0.0.1:22`; browser supplies SSH credentials, resize and input | Keep direct local SSH | `ssh2` over purpose-limited agent TCP stream; audit sessions |
| ChirpStack `/chirpstack/*` | HTTP/gRPC-Web reverse proxy to optional ChefStack/web URL or `CHIRPSTACK_HOST:8080` | Keep local streaming proxy | Same proxy through selected agent, no central local-network access |
| M3ter Manager `/api/m3ter-manager/*`, live stream | Own login, MQTT observations, SQLite history, REST device/queue management | Remove | Remove |
| Browser | Explicit URLs framed; Google searches open another tab | Removed | Removed |
| Paint | Browser canvas, pointer drawing, undo, image export | Unchanged client-side | Unchanged client-side |
| Settings / themes / toggle / desktop preferences | Local storage, four themes, icon layout, window control | Unchanged | Unchanged, with gateway selection added separately |
| App feedback / actions | App-scoped dialogs, notifications, extension action calls | Unchanged | Authenticated actions; selected gateway context where relevant |
| Streamr extension UI | Server extension configuration and publisher | Preserve standalone behavior | Central distribution ownership; no independent gateway publishing |
| `/healthz` | HTTP liveness/readiness probe | Existing behavior | Local readiness mechanism without exposing unauthenticated central UI/API |
| `/api/actions/:moduleId/:actionId` | Configured UI extension callbacks | Existing behavior | Require login and managed-role side-effect policy |

No independent Print application or METAS application is registered in this
baseline. Do not invent or remove unrelated functionality to satisfy those names.
ChirpStack forwards the user's bearer token, strips Console cookies and upstream
authentication headers, rewrites assets/redirects, and preserves streaming. The
gateway API token is never a substitute for the user's web login.

## Tests and CI

Jest runs after `tsc --noEmit`. Existing suites cover billing locks/nonces,
encoding/decoding, hooks, SQLite, proxy/origin handling, deployment scripts and
Manager-specific functionality. Playwright uses local fixture servers, a test SSH
server and fake ChirpStack/MQTT services. Manager fixtures and tests are removable;
unrelated assertions must remain covered.

`.github/workflows/ci.yml` runs Node 20 tests and Playwright, then native AMD64
and ARM64 builds on separate runners. Pushed platform digests are collected into
the existing multi-architecture manifest; PRs build without publishing. Signing
must be additive and conditional on publishing. No production startup, contract
RPC or gateway traffic belongs in verification of this feature.

Firmware sources referenced in the task are not present in this checkout.
The stated nonce reset after more than three unanswered reports is therefore a
deployment assumption requiring validation against the actual firmware.
