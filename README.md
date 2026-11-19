# M3tering Console

A modular, extensible service console for providers on the M3tering protocol. Features a hook-based architecture for backend extensibility and a UI extension system for frontend customization.

## Pre-setup

- Make sure Public key is set on the M3ter contract
- Make sure the price for energy has been set on the PriceContext contract
- Make sure the Console has been granted publish permission on the Streamr stream

## Quick Setup

One command installs and updates every setup: a standalone gateway, a central
server, or a gateway managed by central. **Full instructions:
[docs/deployment-guide.md](docs/deployment-guide.md).**

```bash
git clone https://github.com/fluxion9/Console.git
cd Console
./auto-compose.sh      # first run creates .env from the template
nano .env              # fill in API_TOKEN, APPLICATION_ID, ETHEREUM_PRIVATE_KEY
./auto-compose.sh      # starts Console; open http://<this-machine>:3000
```

Set `CONSOLE_ROLE=central` or `CONSOLE_ROLE=gateway` in `.env` for the other
setups. Update any machine later with `git pull && ./auto-compose.sh`.

## Other Docker Commands

- `sudo docker ps` - list running containers
- `sudo docker ps -a` - list all containers  
- `sudo docker compose down` - stop container
- `sudo docker compose logs` - view logs
- `sudo docker compose logs -tf` - follow logs with timestamps
- `sudo docker system prune` - cleanup unused containers/images
- `sudo docker system prune -a` - cleanup everything unused

## Development

```bash
npm install
npm run dev
```

## ChirpStack desktop application

Open **ChirpStack** from the desktop, dock, or application launcher. Its web
interface opens inside a console window; the browser uses `/chirpstack/` on the
console's own port. The console server connects to
`http://CHIRPSTACK_HOST:8080` (localhost by default). Set
`CHEFSTACK_URL=http://your-chirpstack-host:8080` to override the web endpoint.
The existing `CHIRPSTACK_WEB_URL` remains supported, with `CHEFSTACK_URL` taking
precedence. Use an HTTP(S) origin without a path or URL credentials. This changes
the web integration only; keep the REST proxy and gRPC configuration as appropriate,
or use an HTTPS origin. Only an origin is supported, without credentials or a
subpath. In Docker this address must be reachable from the console container.

Sign in with your **ChirpStack credentials** inside the app. There is no Console
login wrapping the proxy. Its Bearer token is forwarded; Console cookies and the
server's `API_TOKEN` are never forwarded as browser credentials.
ChirpStack browser storage is namespaced so its logout cannot erase desktop
preferences. Reload restarts the embedded page; theme changes and minimizing
preserve it. The toolbar also opens the proxied interface in a new tab.

The integration targets the ChirpStack v4 hash-routed UI and gRPC-Web API,
including streamed responses. ChirpStack retains its own interface inside the
responsive console window. External SSO redirects and customized upstream builds
may need deployment-specific configuration. Configure only a trusted ChirpStack
server: its interface runs on the console origin. If the upstream cannot be
reached, the app shows a connection error with a retry link. The UI-only preview
does not connect to a real ChirpStack server.

## Console access and reliability

Console opens without a password at `http://localhost:3000` and the host's LAN IP.
The default bind address is `0.0.0.0`; remove an old `CONSOLE_HOST=127.0.0.1` setting
or change it to `0.0.0.0` for LAN access. `CONSOLE_USERNAME`, `CONSOLE_PASSWORD` and
`CONSOLE_ORIGIN` are no longer used. No replacement origin setting is needed.
Browser requests use relative URLs. Cross-site writes/upgrades are rejected using
browser Fetch Metadata, with Host matching for older clients. Forwarded headers
are not blindly trusted. The existing host-network Compose design is preserved;
port mappings are omitted because host networking ignores them. A second service
cannot bind the same host port: startup now logs an explicit `EADDRINUSE` diagnosis.

Terminal connects to the host SSH service at `127.0.0.1:22` using its own supplied
credentials. It bundles xterm locally, checks readiness, resizes the SSH PTY,
cleans up sockets/channels, and retains meaningful failure messages. There is no
Console password requirement. SSH itself must be running on the receiving device.
Paint now provides a local canvas with touch drawing, undo, clear and PNG export.
BasePaint forbids iframe embedding; its existing experience remains available
through an explicit external link.

Meter transactions and their local nonces commit atomically. Device downlinks
are attempted before external delivery hooks; a delivery failure does not block
acknowledgement or later delivery extensions. Same-nonce retransmissions, including an increased signed accumulator, can be
acknowledged without storing or distributing the same transaction twice.
Transactions remain in SQLite for chain synchronization and scheduled publishing;
this does not provide an exactly-once delivery guarantee for external services.
Scheduled batches wait for synchronization, exclude confirmed nonces, and skip
meters whose synchronization failed until a later run.

`core/is_on` compares cross-chain revenue with owed amounts using exact integers.
Bootstrap messages use the same check. Failed or incomplete balance reads produce
an off response instead of silently permitting power; configure the revenue and
price contracts for your network before using this module with live devices.

The transaction encoder matches the decoder's scales and interprets signature
and public-key strings as hexadecimal bytes. Values outside the current wire
format are rejected. In particular, its signed 24-bit coordinate fields at
`1e5` precision cover approximately ±83.886 degrees; extending that range requires
a coordinated device protocol change.

## Desktop personalization

Open **Settings** from the desktop, dock, or application launcher. All applications
share one desktop environment; changing themes preserves open windows and their
contents.

- **Appearance:** Retro 8-Bit (default), macOS Inspired, Linux Inspired, and
  Windows Inspired. Preview cards show each theme's chrome before selecting it.
  Background choices apply independently of the theme.
- **Desktop:** automatic grid arrangement, or manual positioning with grid
  snapping. Dropping onto another icon swaps their positions. On a touch screen,
  hold an icon briefly to move it; swiping before the hold scrolls the desktop.
  With an icon focused, **Alt + arrow keys** moves it in manual mode. Plain arrow
  keys navigate the grid. Icon sizing and a confirmed layout reset are included.
- **General:** reduced motion, optional interface sounds, and 24-hour time.
  The operating system's reduced-motion preference is always respected.

Preferences live in this browser's `localStorage` under `m3tering.desktop.v1`.
Invalid or incompatible values fall back to defaults. Custom positions use stable
application IDs; viewport changes reflow them without overwriting the saved
desktop layout. Unavailable applications are ignored and new applications occupy
free cells. Browser storage restrictions leave the interface usable and display
a persistence notice. Preferences are local to the browser, not account-synced.

On desktop, windows support dragging, resizing, maximizing, minimizing, and
stacking. Use the dock to switch applications or **Show desktop** to hide/restore
open windows. At 700px and below, one active application occupies the available
screen, with the dock always accessible. The desktop and launcher scroll when
there are more applications than fit on screen.

### Frontend structure

| File | Responsibility |
| --- | --- |
| `src/public/js/desktop-preferences.js` | Theme metadata, versioned preference validation, storage, and early theme application |
| `src/public/js/desktop-layout.js` | Pure grid sizing, collision handling, and placement calculations |
| `src/public/js/desktop.js` | Shared application registry, window management, icon gestures, launcher, and Settings |
| `src/public/css/global.css` | Shared design tokens, theme chrome, application styling, and responsive presentation |
| `src/public/js/toggle.js` | Existing `toggleApp` compatibility entry point for UI extensions |

Backend-provided UI icons and windows automatically join the registry. Existing
extension HTML and `invokeAction(moduleId, actionId)` continue to use the same
action endpoint. There are no new runtime dependencies for the desktop shell.

### UI development and verification

```bash
npm test                         # Type check and unit tests, including grid/preferences
npx playwright install chromium # Once, for browser tests
npm run test:ui                  # Chromium interaction and responsive-layout tests
npm run preview:ui               # http://127.0.0.1:4173
```

The UI preview and browser tests render the real templates with fixture meters
and an extension. They do not connect to MQTT, Ethereum, SSH, or publishing
services, and their mutation responses are simulated. Browser tests intentionally
block third-party resources for repeatability. Live external integrations still
require the normal configured application. If using an existing Chromium binary,
set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to its absolute path.

---

# Extension System

The M3tering Console provides two complementary extension systems:

1. **Backend Hooks** - Hook into the console lifecycle (MQTT, database, message processing)
2. **UI Hooks** - Add custom icons, panels, and actions to the web interface

Both systems use an environment-driven approach where modules are loaded dynamically from paths specified in your `.env` file.

## Configuration

Modules are configured via environment variables. Modules are automatically pulled from GitHub repositories when the container starts up.

```bash
# Backend Modules (comma-separated GitHub repositories)
BACKEND_MODULES="core/arweave,core/is_on,core/prover,core/streamr,username/my-custom-module"

# UI Modules (colon-separated format: moduleId:github_repo)
UI_MODULES="streamr:core/streamr/ui,my-module:username/my-custom-module"

# Module-specific configuration
STREAMR_STREAM_ID="0x567853282663b601bfdb9203819b1fbb3fe18926/m3tering/test"
STREAMR_CRONSCHEDULE="0 * * * *"  # Every hour
```

- **`BACKEND_MODULES`**: Comma-separated list of GitHub repositories in the format `<github_username>/<repo_name>` or built-in paths like `core/arweave`
- **`UI_MODULES`**: Comma-separated list of `moduleId:<github_username>/<repo_name>` pairs
- **Module-specific variables**: Each module can have its own configuration variables (e.g., `STREAMR_STREAM_ID`)

External references resolve consistently to `src/extensions/<owner>/<repo>` and
`dist/extensions/<owner>/<repo>`. `#branch` and `#tag` select the checkout revision;
the suffix is not part of the runtime import path. Backend and UI references to
the same repository share one checkout and must use the same revision.
Built-in `core/...` modules are never cloned. The legacy `MODULES` variable may
still specify extra repositories to install, but loading is controlled by
`BACKEND_MODULES` and `UI_MODULES`.

For a local checkout, run `npm run modules:install` after setting the environment
variables. Docker runs the same installer automatically. A custom repository must
export a default extension from `index.ts` or CommonJS `index.js`. TypeScript
extensions compile with the console's `tsconfig.json`; their package dependencies
and runtime assets are copied alongside the compiled module. Installation errors
stop startup rather than leaving a silently missing backend module.

The Compose module volumes now mount only `src/extensions` and `dist/extensions`.
They no longer mask the built-in code shipped in updated images. Existing meter
data remains on the same `.data` mount; old module volumes are left untouched and
configured external modules are downloaded into the new scoped volumes.

### Publishing Custom Modules

To use your own extensions:

1. Publish your module code to a GitHub repository
2. Reference it in your `.env` file using the format `<github_username>/<repo_name>`
3. The extension code is automatically cloned from GitHub when the Docker container starts up
4. For specific versions, append `#<tag>` or `#<branch>` (e.g., `username/my-module#v1.0.0`)

---

# Backend Hooks

Backend hooks allow modules to react to console lifecycle events. Each module exports a default class implementing the `Hooks` interface.

## Creating a Backend Module

1. **Create your module repository** with the following structure:

```typescript
// index.ts
import type { Hooks } from "../../../types";

export default class implements Hooks {
  onAfterInit() {
    console.log("My module initialized!");
  }

  onTransactionDistribution(tokenId, decodedPayload, pendingTransactions) {
    // Process transactions
  }
}
```

2. **Publish to GitHub**: Push your module code to a GitHub repository (e.g., `github.com/yourusername/my-m3tering-module`)

3. **Configure in `.env`**:
```bash
BACKEND_MODULES="core/arweave,core/prover,yourusername/my-m3tering-module"
```

4. **Restart container**: The module will be automatically cloned from GitHub and loaded when the container starts

## Hook Lifecycle Reference

### Initialization Phase

| Hook | Description | Parameters |
|------|-------------|------------|
| `onBeforeInit` | Before any initialization begins | None |
| `onDatabaseSetup` | After SQLite tables/jobs are initialized | None |
| `onAfterInit` | After all initialization completes successfully | None |
| `onInitError` | When an error occurs during initialization | `error: any` |

### MQTT Connection Phase

| Hook | Description | Parameters |
|------|-------------|------------|
| `onMqttConnect` | MQTT client successfully connects to ChirpStack | `client: MqttClient` |
| `onMqttSubscribed` | After subscribing to the device uplink topic | `client: MqttClient`, `topic: string` |
| `onMqttError` | MQTT connection error occurs | `error: any`, `client: MqttClient` |
| `onMqttReconnect` | Attempting to reconnect to MQTT broker | `client: MqttClient` |

### Message Processing Phase

| Hook | Description | Parameters |
|------|-------------|------------|
| `onMessageReceived` | Raw MQTT message received (before parsing) | `blob: Buffer` |
| `onMessageDropped` | Message dropped (e.g., device locked) | `reason: string`, `devEui: string` |
| `onMeterCreated` | New meter saved to database | `newMeter: MeterRecord` |
| `onTransactionDistribution` | Before sending to Arweave/prover/Streamr | `tokenId: number`, `decodedPayload: DecodedPayload`, `pendingTransactions: TransactionRecord[]` |

### State Computation Phase

| Hook | Description | Parameters |
|------|-------------|------------|
| `isOnStateCompute` | Determine device on/off state (returns `boolean`) | `m3terId: number` |
| `onIsOnStateComputed` | After on/off state computed | `m3terId: number`, `isOn: boolean` |
| `onIsOnStateComputeError` | Error during state computation | `m3terId: number`, `error: any` |
| `onStateEnqueued` | State enqueued to gRPC for device response | `state: any`, `latitude: number`, `longitude: number` |

### Error & Cleanup Phase

| Hook | Description | Parameters |
|------|-------------|------------|
| `onMessageError` | Error during message processing | `error: any` |
| `onDeviceUnlocked` | Device lock released (regardless of outcome) | `devEui: string` |
| `onMessageProcessingComplete` | Message processing finished | None |

---

# UI Hooks

UI Hooks allow modules to extend the web interface at `http://localhost:3000`. Modules can add desktop icons, app windows/panels, and trigger-able actions.

## Creating a UI Module

1. **Create your module repository** with the following structure:

```typescript
// index.ts
import type { UIHooks, UIAppIcon, UIAppWindow, UIAction } from "../../../types";

export default class implements UIHooks {
  getAppIcon(): UIAppIcon {
    return {
      id: "my-module",
      label: "My Module",
      iconHtml: '<i class="nes-icon heart is-medium"></i>',
      buttonClass: "is-primary",
    };
  }

  getAppWindow(): UIAppWindow {
    return {
      id: "my-module",
      title: "My Module Panel",
      contentHtml: `
        <p>Hello from my module!</p>
        <button class="nes-btn is-success" onclick="invokeAction('my-module', 'do-something', this)">
          Do Something
        </button>
      `,
    };
  }

  getActions(): UIAction[] {
    return [
      {
        id: "do-something",
        label: "Do Something",
        handler: async () => {
          // Perform action
          return { message: "Action completed!" };
        },
      },
    ];
  }
}
```

2. **Publish to GitHub**: Push your module code to a GitHub repository (e.g., `github.com/yourusername/my-ui-module`)

3. **Configure in `.env`**:
```bash
UI_MODULES="streamr:core/streamr/ui,my-module:yourusername/my-ui-module"
```

4. **Restart container**: The module will be automatically cloned from GitHub and loaded when the container starts

## UIHooks Interface

| Method | Return Type | Description |
|--------|-------------|-------------|
| `getAppIcon()` | `UIAppIcon` | Desktop icon displayed in the app grid |
| `getAppWindow()` | `UIAppWindow` | Window/panel shown when icon is clicked |
| `getActions()` | `UIAction[]` | Actions invokable from the frontend |
| `getStatusData()` | `Record<string, any>` | Metadata for display (optional) |

## Type Definitions

### UIAppIcon

```typescript
interface UIAppIcon {
  id: string;          // Unique identifier
  label: string;       // Display label below icon
  iconHtml: string;    // HTML content (supports NES.css icons)
  buttonClass?: string; // Optional button class (e.g., "is-primary")
}
```

### UIAppWindow

```typescript
interface UIAppWindow {
  id: string;           // Must match icon id
  title: string;        // Window title bar text
  contentHtml: string;  // HTML content for window body
  containerClass?: string; // Optional container class
}
```

### UIAction

```typescript
interface UIAction {
  id: string;           // Action identifier
  label: string;        // Button label
  buttonClass?: string; // Optional button class
  handler: () => void | Promise<{ message?: string; data?: any }>;
}
```

## Frontend API

### Invoking Actions

From your panel HTML, use the global `invokeAction()` function:

```javascript
// invokeAction(moduleId, actionId, buttonElement?)
invokeAction('my-module', 'do-something', this);
```

The function:
- Shows loading state on the button (if provided)
- Calls `POST /api/actions/:moduleId/:actionId`
- Displays success/error notification using NES.css styling

### REST Endpoint

```
POST /api/actions/:moduleId/:actionId

Response: { success: boolean, message?: string, data?: any }
```

---

# Built-in Modules

## Backend Modules

| Module | Description |
|--------|-------------|
| `core/arweave` | Uploads transaction data to Arweave permanent storage |
| `core/prover` | Sends batched transactions to the prover node |
| `core/streamr` | Publishes transactions to Streamr streams on a cron schedule |
| `core/is_on` | Computes device on/off state based on balance |

## UI Modules

| Module | Description |
|--------|-------------|
| `streamr` | Panel showing stream config, pending count, and "Publish Now" action |

---

# Guides

## Extracting Transaction data from running console docker container

## 1) Find the running container name/ID

```bash
docker ps --format "table {{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}"
```

Look for `ghcr.io/m3tering/console:main`.

## 2) Copy the SQLite file OUT of the container (backup)

```bash
docker cp <container_name_or_id>:/opt/app/.data/m3tering.db ./m3tering.db
```

Now you must have the sqlite database in the directory you are working from. if you want to get the transactions in json or csv format, go ahead with the following steps

## 3) Extract in readable format

## Option 1: Use `sqlite3` + `.mode json` (fastest)

If you have `sqlite3` installed:

1. Export `transactions` table to JSON:

```bash
sqlite3 m3tering.db ".mode json" ".once transactions.json" "SELECT * FROM transactions;"
```

## Option 2: Export to CSV then convert to JSON (works everywhere)

Export a table to CSV:

```bash
sqlite3 m3tering.db ".headers on" ".mode csv" ".once transactions.csv" "SELECT * FROM transactions;"
```

## Option 3: Export the whole DB (all tables) into one JSON file (best)

This produces a single JSON like:

```json
{ "table1": [...], "table2": [...] }
```

```bash
python3 - <<'PY'
import sqlite3, json

db_path = "m3tering.db"
out_path = "db_export.json"

con = sqlite3.connect(db_path)
con.row_factory = sqlite3.Row
cur = con.cursor()

tables = [r[0] for r in cur.execute("""
  SELECT name FROM sqlite_master
  WHERE type='table' AND name NOT LIKE 'sqlite_%'
  ORDER BY name
""")]

export = {}
for t in tables:
    rows = cur.execute(f'SELECT * FROM "{t}"').fetchall()
    export[t] = [dict(r) for r in rows]

with open(out_path, "w", encoding="utf-8") as f:
    json.dump(export, f, indent=2, ensure_ascii=False)

print(f"Exported {len(tables)} tables to {out_path}")
PY
```

## Updating code for Running Console Code (Docker)

“updating code” means **pulling a newer image tag** (or switching to a `build:` config) or updating the console's environment variables.

---

### A) Update only `.env` (no image change)

1. Edit `.env` in the Console directory.

2. Recreate the container so it reloads `env_file`:

```bash
docker compose up -d --force-recreate console
```

3. Confirm env actually changed:

```bash
docker compose exec console sh -lc 'env | sort | head'
```

---

### B) Update the app “code” (i.e., get latest `ghcr.io/m3tering/console:main`)

Because you’re using an image, you update by pulling and recreating.

1. Pull the latest image:

```bash
docker compose pull console
```

2. Recreate using the new image:

```bash
docker compose up -d --force-recreate console
```

3. Verify the container is on the new image:

```bash
docker compose images
docker compose ps
docker image ls | grep ghcr.io/m3tering/console
```

Optional (clean up old images):

```bash
docker image prune -f
```

---

## C) If you changed BOTH `.env` and want latest image

Do it in one go:

```bash
docker compose pull console
docker compose up -d --force-recreate console
```

## Application appearance and local Docker updates

Each application title bar has a **Theme / Light / Dark** selector. Preferences
are saved by application ID through the shared desktop preference store, and
survive desktop theme changes and reloads. Native content, dialogs, and terminal
colors follow the chosen palette. Embedded external websites retain their own
appearance controls; the containing window follows the application setting.

To update the existing Docker deployment from GitHub Actions images (see
[docs/deployment-guide.md](docs/deployment-guide.md) for central and managed gateways):

```sh
./auto-compose.sh
./auto-compose.sh --project-name your-existing-project
# To select a fork/branch image published by the existing workflow:
./auto-compose.sh --image ghcr.io/fluxion9/console:feat-revamp
```

Docker and its Compose plugin must already be installed. The script identifies
this checkout's Compose project and running Console image, preserves its GHCR tag
when it comes from this checkout's GitHub repository (otherwise it uses
`ghcr.io/<owner>/<repo>:main` from the `origin` remote), and lets Docker select the
native architecture from the published manifest. It pulls before stopping Console,
then stops/removes only that service, starts the updated image and waits for
`/healthz`. Failed readiness prints logs and restores the previous image when
available. Old images are removed only after success and only if no container
still uses them; Docker refuses removal if other tags reference them. No packages,
volumes, database files or `.env` are removed. Other services are never brought down.
`compose.local.yaml` remains available for deliberate developer builds; the update
script does not use it. Readiness does not certify broker or blockchain availability.
Use the original project name and data directory to preserve the same volumes.

## Targeted desktop refinements

The old **M3ters** meter-list application has been removed from the desktop,
along with its exclusive `/delete-meter` UI endpoint. The collector's database,
MQTT service, and meter records are preserved. The removed M3ter Manager is no longer available.

The Browser app has been removed, along with its optional Chromium image.

`compose.yaml` passes the existing `.env` into the single Console container,
which hosts the collector. The update script leaves that file and persistent
volumes intact, including `MQTT_URL` and `CHEFSTACK_URL`. Obsolete Manager settings
are ignored with one startup warning; their values are never logged.

Application feedback is scoped to its owning window. Extension actions preserve
the originating window even if another app is focused while a request completes.
Use `showNotification(message, type, appElementOrId)` for extension feedback, and
pass `null` for a desktop-wide notice. `AppFeedback.showDialog(dialog, appElement)`
provides an app-contained dialog; `AppFeedback.confirm(appElement, title, message)`
returns a promise for confirmations. These dialogs allow switching to other apps
and inherit the owning application's light/dark mode.

## Changes on the centralized Console feature branch

M3ter Manager has been removed in every role. This removes its meter command
controls (relay, interval, class, gain and phase), telemetry history, charts and
raw event inspector. Use the ChirpStack app's device queue for technician downlinks
and your monitoring platform for telemetry. The Console billing collector and
its protocol remain intact.

Existing Manager database tables are not dropped or modified during startup.
To remove them manually, first stop Console and back up `.data/m3tering.db`, then
run the following only against the backup-reviewed deployment database:

```sh
sqlite3 .data/m3tering.db 'BEGIN; DROP TABLE IF EXISTS manager_readings; DROP TABLE IF EXISTS manager_electrical_readings; DROP TABLE IF EXISTS manager_events; DROP TABLE IF EXISTS manager_commands; DROP TABLE IF EXISTS manager_accumulators; DROP TABLE IF EXISTS manager_electrical_state; DROP TABLE IF EXISTS manager_devices; DROP TABLE IF EXISTS manager_schema; COMMIT;'
```

This optional cleanup deletes historical Manager data permanently. It does not
touch `meters` or `transactions`. No update or startup runs it automatically.

The feature's [architecture inventory](docs/centralized/current-architecture.md)
and [design decisions](docs/centralized/design.md) track the central/agent work.
The feature is not ready for deployment until its documented safety gates and
integration tests are complete.


## Central Console and gateway agent (opt-in test branch)

Managed gateways also transfer stored billing history to central, including
readings collected before enrollment. Every five seconds, while the central
connection is healthy, the agent can transfer one batch of up to 100 readings
from one meter, oldest nonces first. Central verifies signatures and nonce
continuity and merges missing rows without overwriting conflicting transactions.
Accepted batches are acknowledged durably on the gateway. Lost responses are
retried idempotently; historical transfers do not send device replies or create
new agent operation records. A rejected batch stays on the gateway for correction
and retry. Central's existing chain pruning and publishing policies still apply
to imported history; this is not a permanent archive of confirmed readings.

The gateway Console runs a pruning cron job every five minutes (UTC). Set
`GATEWAY_PRUNE_CRONSCHEDULE="0 * * * *"` for hourly pruning, for example. For each
meter, it reads the confirmed nonce from the chain and removes transaction rows
with `nonce <= confirmedNonce` only when the exact record was accepted by the
configured central/enrollment. Unconfirmed readings and readings awaiting central
acceptance remain. Chain failures or failed transfers preserve data for a later
run. A separate checkpoint retains at most one last confirmed reading per meter
so a device retry can still be acknowledged after its transaction row is pruned.
The checkpoint is not part of the pending `transactions` table.

Update central and both gateway services (`console` and `agent`) to enable this
policy. The agent negotiates history support with central; an older central keeps
the existing live billing connection and no new history acknowledgments are
created. Existing databases gain the receipt/checkpoint tables automatically.
This policy does not prune the agent's duplicate-detection operation journal or
change `AGENT_QUEUE_LIMIT`.

The default `standalone` role preserves the local collector and LAN desktop.
`central` adds authenticated multi-gateway access; `gateway` keeps a local fallback
Console while an outbound agent owns MQTT. The same default multi-architecture
image contains both entry points. The signed updater is an optional Docker target.

The central selector identifies each gateway and displays uncertain, reconciled
and pending operation counts. Stored decisions are keyed by ChirpStack event ID.
Once ownership or enqueueing has begun, ambiguous outcomes are held for
reconciliation; uncertainty never generates an OFF reply or automatic second
attempt. The next report supersedes an unresolved old reply. Existing revenue
checks remain fail-closed for actual new decisions.

Central Terminal and ChirpStack use purpose-limited gateway tunnels.
With **Central server** selected (no gateway), Terminal and ChirpStack work on
the central machine itself; see the [deployment guide](docs/deployment-guide.md#working-on-the-central-server-itself). The
separate, owner-enabled updater verifies provenance and replaces Console/agent by
digest together, with rollback and persistent data preservation.

- [Existing architecture and application inventory](docs/centralized/current-architecture.md)
- [Design, consistency guarantees and limitations](docs/centralized/design.md)
- [Test deployment, enrollment, updates and rollback](docs/centralized/deployment.md)
- [Executed verification and real-gateway test plan](docs/centralized/test-plan.md)

This remains a test branch until the documented release gates are satisfied. No
real gateway or blockchain has been used to validate these changes. M3ter Manager
is removed in every role; use ChirpStack's own device queue for technician
commands and an external monitoring tool for telemetry history/charts.
