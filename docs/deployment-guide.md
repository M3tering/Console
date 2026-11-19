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
   CENTRAL_ADMIN_PASSWORD=<at least 7 characters>
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
  in `.env` later does nothing.
- A password shorter than 7 characters stops the first start with a clear error.
- **To change the password**, sign in, click your initial at the top right and choose
  **Change password**. Enter
  your current password and the new one (at least 7 characters). Any other device
  signed in to that account is signed out; you stay signed in. After five attempts
  in 15 minutes, further attempts are blocked for a while.

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

## The prover

Readings are sent to the prover (`PREFERRED_PROVER_NODE`) in two ways:

- **As each reading arrives:** once per reading. On central this covers every gateway's readings,
  including those handed over after a gateway decided them on its own.
- **On `PROVER_CRONSCHEDULE`:** every stored reading whose nonce is not yet confirmed on-chain is sent
  again, on every run, until the chain confirms it. Each run first checks the chain and prunes the
  readings that are confirmed.

While central is unreachable, a managed gateway sends the readings it decides itself to the prover, if
its own `.env` sets `PREFERRED_PROVER_NODE`. Central's scheduled runs resend them later anyway. A gateway
never publishes to Streamr or Arweave; central does that.

To send a batch now instead of waiting for the schedule, run this in the Console folder on central or
a standalone Console:

```sh
./prover-batch.sh              # each meter's lowest 100 unconfirmed nonces
./prover-batch.sh --limit 250  # each meter's lowest 250
./prover-batch.sh --all        # every unconfirmed reading, like the scheduled job
```

It prints, per meter, which nonces it sends, then the prover's answer. The lowest nonces go first because
they are the ones the prover needs next.

Logs: `Sending N transactions to prover at …`, then `Prover response (text): …`.

## The Streamr app

Every publish, the hourly `STREAMR_CRONSCHEDULE` run or **Publish Now**, sends all stored readings
whose nonce is not yet confirmed on-chain. They are sent again on every run until the chain confirms
them; then they are pruned. Only Arweave uploads happen once per reading.

| Where | What it shows | Publish Now |
|---|---|---|
| Standalone | Readings not yet confirmed on-chain | Publishes them to every configured stream |
| Central, **Central server** selected | Readings not yet confirmed on-chain, from every gateway | Publishes them, for every gateway |
| Central, a gateway selected | The same, for that gateway's meters only | Same as above: central publishes for every gateway together |
| A managed gateway's own Console | How many readings are kept locally; central publishes them | Hidden |

The window refreshes when you open it, after **Publish Now**, when you switch gateway and every 30
seconds while open. **Last publish** covers both the hourly job and **Publish Now**.

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
| **Remote updates** | Pushes a signed image to the gateway. The gateway owner enables it by adding `REMOTE_UPDATES_ENABLED=true` to `.env` and running `./auto-compose.sh`; see [advanced options](centralized/deployment.md#optional-signed-updater). |

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
- never touches the database or volumes, and in `.env` only updates its own `COMPOSE_FILE` and
  `COMPOSE_PROJECT_NAME` lines (so plain `docker compose logs -f` follows the role).

To run a specific build, pass its tag or digest:

```sh
./auto-compose.sh --image ghcr.io/fluxion9/console:main
./auto-compose.sh --image ghcr.io/fluxion9/console@sha256:<digest>
```

**Which image is used.** The script follows the GitHub repository this checkout
was cloned from (its `origin` remote). CI publishes each repository's images
under its own name: a checkout of `fluxion9/Console` uses
`ghcr.io/fluxion9/console:main`, and a checkout of `M3tering/Console` uses
`ghcr.io/m3tering/console:main`.

The image is chosen in this order:

1. `--image` on the command line
2. The image already running, if it comes from the same repository and runs the
   same role. This keeps a branch tag or digest you chose earlier.
3. `ghcr.io/<owner>/<repo>:main` from the `origin` remote

Images are never read from `.env`. If an old `CONSOLE_IMAGE` line is there, the
script says it's ignored; delete it. The optional updater
(`ghcr.io/<owner>/<repo>-updater:main`) and the repository it trusts for signed
remote updates follow the same remote.

To switch a machine to another repository's builds, change its remote and
update:
`git remote set-url origin https://github.com/<owner>/Console.git && git pull && ./auto-compose.sh`.

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

## Working on the central server itself

The gateway menu at the top starts with **Central server**. Choose it (or never pick
a gateway) and Terminal and ChirpStack work on the central machine instead of a gateway:

| App | With **Central server** selected |
|---|---|
| **Terminal** | SSH into the central server itself. Sign in with a Linux user and password on that server. |
| **ChirpStack** | Opens the dashboard set in `CENTRAL_CHIRPSTACK_URL`. |

Choosing a gateway switches both back to that gateway. Each browser tab keeps its own choice, so you can work on one gateway in one tab and another gateway (or central) in a second tab; a new tab starts on **Central server**. Open windows close when
you switch, so you never type into the wrong machine.

Settings in central's `.env` (run `./auto-compose.sh` after changing them):

```dotenv
CENTRAL_CHIRPSTACK_URL=https://chirpstack.example.com   # address only, no path
CENTRAL_SSH_PORT=22                                      # only if sshd uses another port
```

**Terminal sessions survive switching apps.** If the browser drops the connection (a phone putting
the page in the background, switching tabs, a network blip), the shell keeps running for 10 minutes
(`TERMINAL_RESUME_MS`). When you come back, Terminal reconnects to the same session by itself and shows
what you missed, even if the browser reloaded the page. **Disconnect** or closing the Terminal window
ends the session at once. On central, only the same signed-in user on the same target can resume it.

**Terminal needs password login if your server doesn't already use it.** The Terminal signs in with a username and password,
and many cloud servers allow SSH keys only. To use it, the user needs a password
(`sudo passwd <user>`) and sshd must accept passwords for it. For example, add this
to `/etc/ssh/sshd_config` and run `sudo systemctl reload ssh`:

```text
Match User <user> Address 127.0.0.1
    PasswordAuthentication yes
```

The `Address 127.0.0.1` line allows passwords only from the Console on the same
machine, so the internet still needs a key.

Useful commands in the central Terminal (from the Console folder):

```sh
docker compose -f compose.central.yaml logs -f console     # central's log
docker compose -f compose.central.yaml logs -f tls-proxy   # HTTPS / Caddy
docker compose -f compose.central.yaml ps
```

Each gateway's agent logs its enqueue results. To follow them, select that gateway,
open Terminal and run `docker compose -f compose.gateway.yaml logs -f agent` in its
Console folder.

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
| `CENTRAL_ADMIN_PASSWORD` | – | ✓ first start | – | At least 7 characters |
| `CENTRAL_CHIRPSTACK_URL` | – | opt | – | Dashboard the ChirpStack app opens with no gateway selected |
| `CENTRAL_SSH_PORT` | – | opt | – | Central's own SSH port for Terminal; default `22` |
| `CENTRAL_URL` | – | – | ✓ | `wss://` + central domain, no path |
| `AGENT_ENROLLMENT_TOKEN` | – | – | first start | From central; remove after enrolling |
| `REMOTE_UPDATES_ENABLED` | – | – | opt | `true` makes the script run the signed updater |

Advanced gateway settings (SSH port, queue size, remote updates)
are listed in [`.env.example`](../.env.example) and
[docs/centralized/deployment.md](centralized/deployment.md).

## Troubleshooting

**Logs on any machine.** In the Console folder, plain Compose commands follow whatever role is
running there: central (Console and HTTPS proxy), a managed gateway (Console and agent) or standalone.

```sh
docker compose logs -f            # every service of this role
docker compose logs -f agent      # one service
docker compose ps
```

This works because `./auto-compose.sh` keeps two lines in `.env` up to date after each successful
deploy: `COMPOSE_FILE` (the role's compose file) and `COMPOSE_PROJECT_NAME`. It doesn't change
anything else in the file. The explicit form still works and is what you need for the gateway
updater, whose compose file is only added by the script:

```sh
docker compose -f compose.gateway.yaml logs -f agent
docker compose -f compose.gateway.yaml -f compose.updater.yaml logs -f updater
```

**Following a meter report.** Each step logs one line with the reading and the reply:

| Where | Lines |
|---|---|
| Gateway `logs -f agent` | `Listening for meter reports on …`, `Report received from ChirpStack: devEui=… nonce=… energy=…kWh …`, `Report … is now …`, `Reply enqueued to ChirpStack for … (queue id …): state=ON …` |
| Central `logs -f console` | `Report received: …`, `Reading recorded: …`, `Reply decided (the gateway agent enqueues it): state=…` or `Report rejected: <reason>` |
| Gateway `logs -f console` | The same as central, but only while central is unreachable and the gateway decides locally |
| Standalone `logs -f console` | `Report received: …`, `Reading recorded: …`, `Reply enqueued: state=…` |

Messages on ports other than 2 (telemetry, network-control frames) aren't billed and are dropped without a log line.
The full signature and meter key are shortened in the logs; keys and tokens never appear.

| Symptom | Cause and fix |
|---|---|
| `Replace the placeholder values in .env: …` | Template values are still in `.env`. Fill in the named settings. |
| `Set APPLICATION_ID … UUID` | Copy the application's ID from ChirpStack's Applications page. |
| `Cannot reach Docker` | Run with `sudo`, or add yourself to the `docker` group and log in again. |
| `no space left on device` while pulling | The disk is full. Free space with `docker builder prune` and `docker image prune`. Check what's unused with `docker image ls` first, because locally built images can't be pulled back. Nothing running is affected by the failed pull. |
| `unauthorized` / `denied` while pulling | The image package is private, or CI hasn't published it yet. Make the package public or `docker login ghcr.io`, and check the Actions run on `main` passed. |
| Central: Console keeps restarting on first start | Usually a short `CENTRAL_ADMIN_PASSWORD`. Check `logs console`. |
| Central: HTTPS doesn't work | DNS doesn't point at the server yet, or ports 80/443 are taken. |
| Central Terminal: `SSH connection failed` | With **Central server** selected, the server's sshd refused the password. Allow password login for that user from `127.0.0.1` (see [Working on the central server itself](#working-on-the-central-server-itself)). |
| Central ChirpStack: `No ChirpStack dashboard set` | Set `CENTRAL_CHIRPSTACK_URL` in `.env` and rerun `./auto-compose.sh`, or select a gateway. |
| Gateway: `Port 3011 is already used by …` | Another program uses the gateway Console's local fallback port. Add `GATEWAY_FALLBACK_PORT=3101` (any free port) to `.env` and rerun. Older setups used 3001, which clashes with ChirpStack's Basic Station bridge. |
| Gateway shows **Offline** after a reboot although the gateway has internet; agent log says `Cannot reach central (EAI_AGAIN)` | Docker started the containers before the network (often Wi-Fi) had DNS, so they got empty DNS settings. They now restart themselves after 3 minutes without DNS and connect. To fix it at once: `docker compose restart console agent`. |
| Gateway: agent online once, then **Offline** for good | Usually the gateway Console couldn't start, often because of a port clash. Check `logs console` and rerun `./auto-compose.sh`; it now says what's wrong. |
| Gateway: `This gateway is not enrolled yet` | Add the `AGENT_ENROLLMENT_TOKEN` line from central. |
| Every reply is `state=OFF`; logs show `Failed to resolve ENS name: base-sepolia.verifier.unruggable.eth` | Known issue, see [Every meter is switched OFF](#known-issue-every-meter-is-switched-off). |
| Gateway: `Agent enrollment failed` in agent logs | The token expired or was already used. Get a new one from the gateway's card. |
| Gateway card stays **Waiting to connect** | The gateway can't reach central on port 443, or `CENTRAL_URL` is wrong. Try `curl -I https://console.example.com` from the gateway. |
| Gateway card shows **Offline** after a revoke/delete | Expected. To reconnect, see [Reconnecting a revoked or deleted gateway](#managing-gateways-on-central). |
| `Secret file must be owner-only` in logs | Someone changed permissions in `.data/agent/`. Run `./auto-compose.sh` again; it repairs them. |
| Script says *standalone was NOT restarted* | The agent had started handling reports when something failed. Fix the error shown and rerun; don't start standalone by hand. |

## Known issue: every meter is switched OFF

**Status:** open, not fixed in this repository (checked 2026-11-18).

**Symptom.** Every state reply is OFF (`hex=000000000000000000`), whoever decides it. The deciding
Console logs:

```text
[error] [utils] Extension hook isOnStateCompute failed: Failed to resolve ENS name: base-sepolia.verifier.unruggable.eth
[error] [Device-…] Could not determine meter power state, so the reply is OFF: 1 extension(s) failed in isOnStateCompute
```

**Cause.** The ON/OFF rule (`core/is_on`) switches a meter ON only when its revenue covers what it
owes. Revenue is read through the verifiers listed in the CCIP revenue reader contract
(`CCIP_REVENUE_READER_ADDRESS`, default `0xD648cdF47e9534B2FCfb18C1E94CA9AAff07BA0E` on Sepolia).
That contract lists exactly one verifier, `base-sepolia.verifier.unruggable.eth` (target
`0xC08E39789A93230069c956e76B0c10cbC83D903e`). That ENS name has no address record, neither
on Sepolia (no resolver) nor on Ethereum mainnet (a resolver, but no address for any chain), so
the revenue lookup fails and the safe default, OFF, is used.

This is not a Console bug and not specific to one machine: central and gateways give the same
result. Check it from any Console with:

```sh
docker compose -f compose.central.yaml exec console node -e "const {JsonRpcProvider}=require('ethers');new JsonRpcProvider(process.env.MAINNET_RPC).resolveName('base-sepolia.verifier.unruggable.eth').then(a=>console.log('resolved',a))"
```

`resolved null` means the issue is still present.

**Possible fixes (not done yet).**

- Have the revenue reader contract's owner update its verifier entry to a name (or verifier) that
  currently resolves. Unruggable's [verifier deployments](https://gateway-docs.unruggable.com/verifiers/deployments)
  page says its verifiers are deployed on Ethereum mainnet and Sepolia.
- Point `CCIP_REVENUE_READER_ADDRESS` at a revenue reader whose verifiers resolve.
- Add a Console setting that maps a verifier name to a known verifier address, so a broken ENS
  record can be bypassed.

Until then, meters stay OFF. Billing still records every reading; only the state reply is affected.

