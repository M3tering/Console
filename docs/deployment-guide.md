# Deployment guide

How to install, connect and update M3tering Console. Every setup uses the same
command, `./auto-compose.sh`. The `CONSOLE_ROLE` setting in `.env` decides what it
deploys.

- [Pick a setup](#pick-a-setup)
- [Before you start](#before-you-start)
- [Standalone gateway](#standalone-gateway)
- [Central server](#central-server)
- [Managed gateway (connect to central)](#managed-gateway-connect-to-central)
- [Managing gateways on central](#managing-gateways-on-central)
- [Updating](#updating)
- [Going back to standalone](#going-back-to-standalone)
- [`.env` reference](#env-reference)
- [Troubleshooting](#troubleshooting)

## Pick a setup

| Setup | `CONSOLE_ROLE` | Runs | Use it when |
|---|---|---|---|
| Standalone gateway | *(unset)* or `standalone` | One Console, on the gateway | A single site, managed on its own LAN |
| Central server | `central` | Console behind HTTPS (Caddy) | You want one login to reach every site |
| Managed gateway | `gateway` | Console + agent, on the gateway | A site that connects to your central server |

```
             browser ──HTTPS──▶  CENTRAL SERVER  (login, billing decisions, publishing)
                                     ▲    ▲
                       outbound wss  │    │  outbound wss
                                     │    │
        MANAGED GATEWAY ─────────────┘    └──────────── MANAGED GATEWAY
        Console (LAN UI, local fallback)                 Console + agent
        agent   (reads ChirpStack MQTT, replies to meters)
```

Gateways only make **outbound** connections to central. You never open a port on
a gateway. If central is unreachable, a managed gateway keeps billing locally and
catches up later.

## Before you start

On every machine:

- **Docker with the Compose plugin.** If it's missing:
  `curl -fsSL https://get.docker.com | sudo sh`, then
  `sudo usermod -aG docker "$USER"` and log in again.
- **Git**, to fetch this repository.
- **At least 3 GB of free disk space.** The Console image is large. Check with `df -h /`.
- **Access to the images.** They're published to GitHub Container Registry by CI
  on every push to `main`. If the package is private, log in once:
  `docker login ghcr.io -u <github-user>` with a token that has `read:packages`.

Get the code:

```sh
git clone https://github.com/fluxion9/Console.git
cd Console
```

On an existing checkout, point it at this repository once:
`git remote set-url origin https://github.com/fluxion9/Console.git && git pull`.

## Standalone gateway

1. **Create the configuration.** On a fresh checkout, run:
   ```sh
   ./auto-compose.sh
   ```
   This creates `.env` from the template, readable only by you, and lists the
   settings you must fill in. Nothing is started yet.
2. **Fill in `.env`.** At minimum:
   ```dotenv
   API_TOKEN=<ChirpStack API token>
   APPLICATION_ID=<ChirpStack application UUID>
   CHIRPSTACK_HOST=localhost
   ETHEREUM_PRIVATE_KEY=<wallet key for this Console>
   ```
   Keep the template's contract and Streamr values unless you know you need
   others. The script refuses to start while any `...` placeholder is left.
3. **Start it.**
   ```sh
   ./auto-compose.sh
   ```
4. **Open it** at `http://<gateway-ip>:3000` on the LAN. There's no login.

## Central server

You need a server with a public DNS name and free ports **80** and **443** (Caddy
uses them for HTTPS), plus port **3000**, which the Console uses on `localhost`
only. Check with `sudo ss -ltnp | grep -E ':(80|443|3000)\b'`. It should print nothing.

1. Point your domain's DNS record at the server.
2. Create `.env` as in standalone step 1, then set:
   ```dotenv
   CONSOLE_ROLE=central
   CENTRAL_DOMAIN=console.example.com
   CENTRAL_ADMIN_USERNAME=admin
   CENTRAL_ADMIN_PASSWORD=<at least 16 characters>
   ETHEREUM_PRIVATE_KEY=<wallet key>
   ```
   Central doesn't use ChirpStack, so the template's `API_TOKEN` and
   `APPLICATION_ID` lines can stay as they are.
3. Start it:
   ```sh
   ./auto-compose.sh
   ```
4. Open `https://console.example.com` and sign in.

About the admin account:

- It's created **only on the first start**. Changing `CENTRAL_ADMIN_PASSWORD`
  later does nothing.
- A password shorter than 16 characters stops the first start with a clear error.

Central holds the wallet key that signs billing decisions. Treat the server as
sensitive, and test with a test wallet first.

## Managed gateway (connect to central)

The gateway needs a working ChirpStack setup (`API_TOKEN`, `APPLICATION_ID`) and
contract settings in `.env`, just like a standalone gateway. Converting an
existing standalone gateway is the usual case: keep its `.env` and add three lines.

1. **On central**, open **Gateways**, type a name (for example the site name) and
   click **Add gateway**.
2. Click **Copy** in the panel that appears. It copies three lines:
   ```dotenv
   CONSOLE_ROLE=gateway
   CENTRAL_URL=wss://console.example.com
   AGENT_ENROLLMENT_TOKEN=…
   ```
3. **On the gateway**, paste them into `.env`, then run:
   ```sh
   git pull
   ./auto-compose.sh
   ```
   The token works **once** and expires after **10 minutes**. If it expires,
   click **New enrollment token** on the gateway's card.
4. Within a minute the card on central turns green and shows **Online**.
5. Delete the `AGENT_ENROLLMENT_TOKEN` line from the gateway's `.env`. The script
   reminds you. The gateway has stored a permanent credential in `.data/agent/`.

What the script does for a gateway:

- **Checks first:** it validates `CENTRAL_URL`, the ChirpStack settings and the
  token before touching Docker.
- **Creates secrets:** it creates the gateway's owner-only secret files in
  `.data/agent/`. It uses `sudo`, so it may ask for your password. Existing
  secrets are never replaced.
- **Switches over:** it stops the standalone Console, then starts Console and
  agent together. The two never run at the same time.
- **Waits:** it checks that the agent stays up and has enrolled.

If the first switch fails, the script restores standalone, but only if the agent
never started handling meter reports. If the agent had already started, the
script leaves things as they are and tells you, so two processes never answer the
same meter. Fix the error shown and run the script again.

The gateway's own LAN desktop at `http://<gateway-ip>:3000` keeps working, without
a login.

## Managing gateways on central

Open **Gateways** from the top bar. Each gateway is a card.

| Status | Meaning |
|---|---|
| **Online** | The agent is connected |
| **Offline** | Enrolled but not connected: check the gateway is running and can reach central |
| **Waiting to connect** | Created on central, but the gateway hasn't used its token yet |
| **Access revoked** | Its credential was cancelled; it can't connect |

The activity tiles appear once a gateway has reported in:

| Tile | Meaning |
|---|---|
| **MQTT** | The agent's connection to ChirpStack's broker |
| **Pending** | Reports waiting for a decision |
| **Uncertain** | Running total of replies whose delivery couldn't be confirmed. They are held, never resent automatically. |
| **Reconciled** | Uncertain replies later resolved |
| **Superseded** | Old replies replaced by a newer report from the same meter |

| Action | What it does |
|---|---|
| **Rename** | Changes the display name. Press Enter to save, Esc to cancel. |
| **Delete** | Disconnects the gateway, destroys its credential and removes it from the list. Billing and audit history are kept. |
| **Revoke access** | Disconnects the gateway and cancels its credential, but keeps the card |
| **Rotate credential** | Issues a new credential to an online gateway without interrupting it |
| **New enrollment token** / **Re-enroll** | Issues a fresh one-time token for a gateway that isn't connected |
| **Remote updates** | Pushes a signed image to the gateway. The gateway owner must enable this locally first; see [advanced options](centralized/deployment.md#optional-signed-updater). |

**Reconnecting a revoked or deleted gateway.** The gateway still holds its old,
now useless credential. Remove it before using a new token:

```sh
sudo rm .data/agent/credential
# add the new AGENT_ENROLLMENT_TOKEN line to .env, then:
./auto-compose.sh
```

For a deleted gateway, first add it again on central as a new gateway.

## Updating

Same command on every machine:

```sh
git pull
./auto-compose.sh
```

The script:

- pulls the newest image for the tag the machine already runs;
- replaces only the Console services and waits for them to be healthy;
- restores the previous image if they aren't;
- never touches `.env`, the database or volumes.

To run a specific build, pass its tag or digest:

```sh
./auto-compose.sh --image ghcr.io/fluxion9/console:main
./auto-compose.sh --image ghcr.io/fluxion9/console@sha256:<digest>
```

| Role | Default image on first install |
|---|---|
| Standalone | `ghcr.io/m3tering/console:main` |
| Central and managed gateways | `ghcr.io/fluxion9/console:main` |

## Going back to standalone

On the gateway:

```sh
docker compose -f compose.gateway.yaml stop agent
```

1. Check the gateway's card on central shows **Pending 0** before going
   further. If it doesn't, read [the reconciliation rules](centralized/design.md)
   first.
2. Remove `CONSOLE_ROLE`, `CENTRAL_URL` and any token line from `.env`.
3. Run `./auto-compose.sh --image ghcr.io/fluxion9/console:main`. The `--image`
   keeps the build you were running; without it, standalone uses its own default.
4. Revoke or delete the gateway on central.

Keep `.data/agent/`. It holds the operations journal, which is needed if anything
has to be reconciled later.

## `.env` reference

Settings are needed (✓), optional (opt) or not used (–) per setup.

| Setting | Standalone | Central | Gateway | Notes |
|---|---|---|---|---|
| `CONSOLE_ROLE` | – | `central` | `gateway` | Unset means standalone |
| `API_TOKEN` | ✓ | – | ✓ | ChirpStack API token |
| `APPLICATION_ID` | ✓ | – | ✓ | ChirpStack application UUID |
| `CHIRPSTACK_HOST` | ✓ | – | ✓ | Usually `localhost` |
| `MQTT_URL` | opt | – | opt | Defaults to `CHIRPSTACK_HOST:1883` |
| `ETHEREUM_PRIVATE_KEY` | ✓ | ✓ | ✓ | Wallet for this Console |
| `MAINNET_RPC`, `ROLLUP_CONTRACT_ADDRESS` | ✓ | ✓ | ✓ | Keep the template values unless told otherwise |
| `BACKEND_MODULES`, `UI_MODULES`, `STREAMR_*` | ✓ | ✓ | ✓ | Keep the template values |
| `PORT` | opt | opt | opt | Default `3000` |
| `CENTRAL_DOMAIN` | – | ✓ | – | DNS name for HTTPS |
| `CENTRAL_ADMIN_USERNAME` | – | opt | – | Default `admin` |
| `CENTRAL_ADMIN_PASSWORD` | – | ✓ first start | – | At least 16 characters |
| `CENTRAL_URL` | – | – | ✓ | `wss://` + central domain, no path |
| `AGENT_ENROLLMENT_TOKEN` | – | – | first start | From central; remove after enrolling |
| `CONSOLE_IMAGE` | opt | opt | opt | Overrides the image the script uses |

Advanced gateway settings (Browser ports, SSH port, queue size, remote updates)
are listed in [`.env.example`](../.env.example) and
[docs/centralized/deployment.md](centralized/deployment.md).

## Troubleshooting

Useful commands, using the compose file for the machine's role
(`compose.yaml`, `compose.central.yaml` or `compose.gateway.yaml`):

```sh
docker compose -f compose.gateway.yaml ps
docker compose -f compose.gateway.yaml logs -f console
docker compose -f compose.gateway.yaml logs -f agent
```

| Symptom | Cause and fix |
|---|---|
| `Replace the placeholder values in .env: …` | Template values are still in `.env`. Fill in the named settings. |
| `Set APPLICATION_ID … UUID` | Copy the application's ID from ChirpStack's Applications page. |
| `Cannot reach Docker` | Run with `sudo`, or add yourself to the `docker` group and log in again. |
| `no space left on device` while pulling | The disk is full. Free space with `docker builder prune` and `docker image prune`. Check what's unused with `docker image ls` first, because locally built images can't be pulled back. Nothing running is affected by the failed pull. |
| `unauthorized` / `denied` while pulling | The image package is private, or CI hasn't published it yet. Make the package public or `docker login ghcr.io`, and check the Actions run on `main` passed. |
| Central: Console keeps restarting on first start | Usually a short `CENTRAL_ADMIN_PASSWORD`. Check `logs console`. |
| Central: HTTPS doesn't work | DNS doesn't point at the server yet, or ports 80/443 are taken. |
| Gateway: `This gateway is not enrolled yet` | Add the `AGENT_ENROLLMENT_TOKEN` line from central. |
| Gateway: `Agent enrollment failed` in agent logs | The token expired or was already used. Get a new one from the gateway's card. |
| Gateway card stays **Waiting to connect** | The gateway can't reach central on port 443, or `CENTRAL_URL` is wrong. Try `curl -I https://console.example.com` from the gateway. |
| Gateway card shows **Offline** after a revoke/delete | Expected. To reconnect, see [Reconnecting a revoked or deleted gateway](#managing-gateways-on-central). |
| `Secret file must be owner-only` in logs | Someone changed permissions in `.data/agent/`. Run `./auto-compose.sh` again; it repairs them. |
| Script says *standalone was NOT restarted* | The agent had started handling reports when something failed. Fix the error shown and rerun; don't start standalone by hand. |
