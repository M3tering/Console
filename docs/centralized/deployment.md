# Deployment status

This feature branch is **not deployable as a central system yet**. Do not set the
new role variables on an operating gateway. No real gateway has been contacted,
enrolled or updated during development.

The implemented compatibility work removes Manager while preserving standalone
collection and the default deployment interfaces. The central configuration,
identity and protocol modules are currently tested components, not connected
services. Agent, tunnels, updater and browser-engine deployment still require
integration. Do not mistake example configuration for a working rollout recipe.

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
The connection integration is not implemented yet.

The future signing trust policy must constrain registry/repository, workflow
identity and allowed refs; enabling a test ref must be explicit on the gateway.
No unsigned updater fallback is acceptable. Automatic rollout and systemd
installation instructions will be added only with their tested implementations.
