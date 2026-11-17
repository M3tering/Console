# Deployment status

This feature branch is **not deployable as a central system yet**. Do not set the
new role variables on an operating gateway. No real gateway has been contacted,
enrolled or updated during development.

The implemented compatibility work removes Manager while preserving standalone
collection and the default deployment interfaces. The central configuration,
identity, protocol, durable agent/fallback RPC and SSH/ChirpStack tunnels are
connected and tested with local fixtures. Signed updater and browser-engine
deployment still require integration. Do not mistake example configuration for a working rollout recipe.

## Existing standalone deployments

Keep the current `.env`, `compose.yaml`, project name and data directory. The
deployment script still updates only the Console service and preserves data and
extension volumes. An explicitly selected previous image can be restored with:

```sh
./auto-compose.sh --image ghcr.io/OWNER/console@sha256:PREVIOUS_IMAGE_DIGEST
```

Use the actual trusted repository and recorded digest; these are placeholders.
No task instruction authorizes testing this against a production device.

## Planned opt-in topology

- Central: TLS reverse proxy, authenticated Console, persistent central SQLite
  database, optional isolated Chromium service. Explicit proxy peers are trusted;
  arbitrary forwarded headers are not.
- Gateway: local Console and outbound-only agent with host networking; durable
  agent state and owner-only secret files. Existing ChirpStack and MQTT settings
  are reused. The agent has no Docker socket mount.
- Updater: separate local authenticated service, disabled by the gateway owner
  unless opted in. It alone has Docker access. It must verify image provenance by
  digest and replace agent and local Console together, retaining volumes and `.env`.

Enrollment credentials are single-use and expire. Long-lived agent secrets must
never appear in URLs, Compose command arguments, logs, or git. Rotation overlaps
old and new credentials for two minutes and ends the overlap on acknowledgment.
Revocation must close the active connection as well as rejecting authentication.
The connection registry now closes revoked sessions and fences replaced links.

The future signing trust policy must constrain registry/repository, workflow
identity and allowed refs; enabling a test ref must be explicit on the gateway.
No unsigned updater fallback is acceptable. Automatic rollout and systemd
installation instructions will be added only with their tested implementations.

## Test topology files now present

`compose.central.yaml` defines the loopback-bound Console plus a Caddy TLS proxy,
using explicit loopback trusted peers. `compose.gateway.yaml` defines the local
Console and agent using the same image and host network. The agent receives only
its MQTT/ChirpStack and connection settings, not blockchain wallet environment
variables, and mounts only its own state directory. No Docker socket is mounted.
Both files are opt-in and have passed Compose configuration validation with fake
values; neither has been deployed. Their default feature image tag is a planned
branch tag, not an assertion that this branch has been published.

Caddy configuration follows its [reverse proxy documentation](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).
Central health checking probes the login entry point over the trusted loopback
peer; it does not make `/healthz` or application APIs public. Gateway/standalone
health checking remains unchanged.

The agent entry point is `node dist/agent/index.js`. It deliberately bypasses the
Console extension installer: the agent never initializes contracts or cron
publishers. Both processes need access to an owner-only fallback secret; the
agent creates its credential atomically after enrollment. File ownership must
match the runtime user (the current image defaults to root). Creating those files
as a different host user and mounting them into a root process is intentionally
rejected, even if their permissions are 0600.

Do not switch an operating gateway to these files yet. Browser containment, signed
updater, end-to-end image checks and the remaining deployment instructions are
still incomplete. The current files are for review and isolated testing only.
