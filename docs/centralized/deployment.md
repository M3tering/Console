# Opt-in test deployment

For everyday installation and updates, follow [../deployment-guide.md](../deployment-guide.md).
This page keeps the detailed security notes and advanced options.

This branch is for isolated evaluation, not a production rollout. Read
[test-plan.md](test-plan.md) for executed checks and release gates. No live gateway,
meter, ChirpStack server or blockchain was contacted during implementation.
Published tag names below describe the workflow convention; do not assume an image
exists until that branch's workflow and provenance have been checked.

## Existing standalone installations

Keep `.env`, `compose.yaml`, project name, volumes and `auto-compose.sh` unchanged.
With no role configured the Console stays standalone, without a Console login.
Manager is removed, including telemetry/commands UI; old Manager environment
variables are ignored with one warning. Its SQLite tables are preserved. Use
ChirpStack's device queue for technician downlinks and your external monitoring
tool for telemetry. The Browser now uses an optional remote Chromium engine.

Manual update and rollback still use the existing script:

```sh
./auto-compose.sh --image ghcr.io/fluxion9/console:main
./auto-compose.sh --image ghcr.io/fluxion9/console@sha256:PREVIOUS_RECORDED_DIGEST
```

Replace the placeholder with a previously recorded trusted digest. This document
is not authorization to run either command on production.

## Central test server

Start from `.env.example` only on a new checkout; never overwrite an existing
`.env`. Configure the existing contract/module settings for an isolated test
network, plus `CENTRAL_DOMAIN`, `CENTRAL_ADMIN_USERNAME` and a unique
`CENTRAL_ADMIN_PASSWORD` of at least 16 characters. Set file permissions to 0600.
The bootstrap user is created once; changing its environment password does not
silently reset an existing account. Central does not connect directly to MQTT,
SSH or ChirpStack. Existing module hooks and contract configuration are still
needed for billing; never point a test deployment at a production wallet.

```sh
docker compose -f compose.central.yaml pull
docker compose -f compose.central.yaml up -d
```

The file opts into central role, binds Console to loopback, and runs Caddy on the
host network for TLS. DNS must point to this test server and ports 80/443 must be
available. Only the explicit loopback reverse-proxy peers are trusted. Do not
publish the unencrypted backend port or set broad trusted-proxy ranges.
Caddy follows its [reverse proxy documentation](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).
All desktop pages, APIs and browser upgrades require a central session. Agent
enrollment is a narrowly scoped one-time-token endpoint. Logout/expiry also close
active user sockets. Local roles retain LAN access without a Console login.

## Gateway enrollment and owner files

Keep the existing gateway `.env` with MQTT/ChirpStack and fallback contract
configuration. Add `CENTRAL_URL=wss://YOUR_TEST_CENTRAL_HOST`. Default
`MQTT_URL` behavior remains `CHIRPSTACK_HOST:1883`; do not add a second broker.
Stop the old standalone Console before starting the managed pair under the same
Compose project. Do not run both subscribers concurrently.

For the default root runtime, create shared owner-only files once:

```sh
sudo install -d -m 700 .data/agent .data/updater
sudo node - <<'JS'
const fs=require('fs'),crypto=require('crypto');
for(const name of ['fallback-secret','updater-secret']) {
  try { fs.writeFileSync(`.data/agent/${name}`,crypto.randomBytes(32).toString('base64url'),{flag:'wx',mode:0o600}); }
  catch(error) { if(error.code!=='EEXIST') throw error; }
}
JS
```

This procedure is idempotent and never prints or replaces a secret. Use the
actual runtime UID if running without root; permissive files or a mismatched
owner are intentionally refused. The agent credential and operation journal live
in this directory, never the image.

Log into central, open Manage gateways, create the test gateway, and copy its
one-time enrollment token into `AGENT_ENROLLMENT_TOKEN` in the gateway's protected
`.env`. Tokens expire after ten minutes and are single use. Then:

```sh
docker compose -f compose.gateway.yaml pull
docker compose -f compose.gateway.yaml up -d
```

After enrollment, remove the token from `.env`; the long-lived credential is
stored atomically in the owner-only credential file. A lost enrollment response
requires revocation and a new token, not token reuse. Rotate credentials from
central while connected; old/new overlap for two minutes until the agent persists
and acknowledges the new credential. Revocation immediately disconnects it.

Local fallback RPC listens on 127.0.0.1:3001 and requires the shared secret.
Never proxy that port. Gateway Console serves the existing LAN UI; the agent owns
MQTT, uses a stable persistent QoS-1 session, and forwards only signed FPort 2
reports. No autonomous MQTT takeover occurs when the agent dies: restart it and
retain the journal. This avoids two relay deciders. The journal has a hard
`AGENT_QUEUE_LIMIT`; full storage stops ingestion without deleting idempotency
records. Monitor pending/uncertain/reconciled counts and provision storage before
the bound is reached. See design.md for the deliberately conservative availability
tradeoff and reconciliation rules.

## Tunnel policy

Gateway owners control each purpose separately. SSH defaults to 127.0.0.1:22;
ChirpStack uses the existing configured web endpoint. Browser defaults to
loopback ports 80,443,3000,8080,8090. Set `AGENT_BROWSER_PORTS` locally to adjust
that list; private LAN access additionally requires `AGENT_BROWSER_ALLOW_LAN=true`.
Metadata, Docker and fallback/SSH control ports remain blocked for Browser.
Central cannot override these settings. SSH uses first-use host-key pinning and
refuses changes; investigate legitimate key changes before manually removing that
gateway's `central_hostkeys` record. Do not routinely disable host-key validation.

## Optional Browser engine

The default image intentionally omits Chromium. For a central or standalone test
server, add `-f compose.browser.yaml` to its Compose commands. This selects
`ghcr.io/fluxion9/console-browser:feat-centralized-console`, an optional target of
the same Dockerfile, with Alpine Chromium/OpenSSL and a non-root runtime. Ensure
its data and extension volumes are owned by UID 1000. Do not blindly apply this
override to a managed gateway pair: both services must use the same image and
owner-file UID. Small gateways can keep Browser unavailable and use central's
engine instead. The default Console still starts and passes health checks.

Production engine execution requires working Chromium sandbox/user namespaces.
Never enable `BROWSER_UNSANDBOXED_TEST` outside test fixtures; it is ignored unless
NODE_ENV=test. If the host cannot support the sandbox, retain the unavailable
state until host isolation is correctly configured. No privileged-container or
Docker-socket workaround is supported. Browser profiles are temporary; uploads
and downloads are disabled. Copy/paste, IME, touch scrolling and zoom are provided.
The optional Compose profile bounds the whole Console/engine to 2 GiB, 2 CPUs and
256 MiB shared memory. These are limits, not measured i.MX8 requirements.

## Optional signed updater

Only `compose.updater.yaml` mounts Docker. The agent never receives Docker access.
Set these gateway-owner variables in the existing protected `.env`:

```dotenv
REMOTE_UPDATES_ENABLED=true
COMPOSE_PROJECT_NAME=YOUR_EXISTING_PROJECT
UPDATER_DEPLOY_DIRECTORY=/absolute/host/path/to/Console
UPDATER_IMAGE_REPOSITORY=ghcr.io/fluxion9/console
UPDATER_SOURCE_REPOSITORY=fluxion9/Console
UPDATER_ALLOWED_REFS=refs/heads/main,refs/heads/feat/centralized-console
UPDATER_RECONNECT_TIMEOUT_MS=180000
```

The test branch must be explicitly trusted; remove it after testing. If the
registry/API requires authentication, set `UPDATER_GITHUB_TOKEN` to a narrowly
scoped read token. Only the updater receives it. The exact same absolute checkout
path is mounted into the updater so Compose bind mounts resolve on the Docker
host, not a fictitious container path.

```sh
docker compose -f compose.gateway.yaml -f compose.updater.yaml up -d
```

The trust identity is GitHub's OIDC issuer, source repository `fluxion9/Console`,
workflow `fluxion9/Console/.github/workflows/ci.yml`, and the allowed source refs.
`gh attestation verify` checks signed provenance and subject digest before the
updater pulls/restarts anything. The workflow attests each published platform and
manifest, never pull-request builds. An unsigned/wrongly signed digest is refused.
The updater itself is owner-installed and is not replaced remotely.

In central gateway controls, enter the selected release's immutable image digest
and confirm restarting the pair. Queued work can be cancelled before execution.
The updater replaces Console and agent together, keeping project, `.env`, data,
credentials and volumes. It records the previous image ID before replacement.
Failed readiness or no authenticated agent reconnect within the configured window
rolls back; interrupted replacement rolls back on updater restart. Failed digests
are blocked from automatic retry. No general shell command/script is accepted.

Set `REMOTE_UPDATES_ENABLED=false` locally and restart only updater to disable
remote updates; central cannot override this. Rollout is manual, one gateway at a
time; there is no automatic latest-main scheduler. A remote update does not rewrite
`.env` image preferences: record/pin a successful image there before a later manual
Compose recreation. Review each target digest before retrying a failed release.

## systemd alternative and return to standalone

Use the same built image/artifacts and owner-controlled paths. A systemd unit for
the agent can use `ExecStart=/usr/bin/node /opt/console/dist/agent/index.js`,
`WorkingDirectory=/opt/console`, `EnvironmentFile=/etc/console/gateway.env`,
`Restart=always`, `UMask=0077`, `NoNewPrivileges=true`, `ProtectSystem=strict`,
`ReadWritePaths=/var/lib/console-agent`, and the owner runtime user. Set absolute
credential/fallback paths accordingly. Install Console as a separate unit; never
start its standalone MQTT subscriber alongside the agent. The Docker updater is
specific to the Compose topology and must stay disabled for systemd deployments.
No system packages or service files are installed automatically by this feature.

To return to standalone, stop agent/updater first, reconcile or explicitly resolve
pending owned operations, remove the opt-in role settings, and use the original
`compose.yaml`/`auto-compose.sh` with a recorded image. Preserve all journals and
SQLite files. Never delete uncertain ownership records to force a relay reply.

## Device inventory API

Authenticated operators can inspect `/api/devices/gateways`. Offers learn the last
observed gateway for each DevEUI. `POST /api/devices/{devEui}/gateway` with JSON
`{"gateway":"GATEWAY_ID"}` pins an observed device's preferred assignment; use
`{"gateway":null}` to resume discovery. Requests must come from the same-origin
logged-in session. An assignment never transfers ownership of an already
committed uplink or permits another relay reply for its event ID.
