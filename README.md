# M3tering Console

A modular, extensible service console for providers on the M3tering protocol. Features a hook-based architecture for backend extensibility and a UI extension system for frontend customization.

## Pre-setup

- Make sure Public key is set on the M3ter contract
- Make sure the price for energy has been set on the PriceContext contract
- Make sure the Console has been granted publish permission on the Streamr stream

## Quick Setup

1. **Clone/Update**

   ```bash
   git clone https://github.com/M3tering/Console.git
   # or
   cd Console/ && git pull
   ```

2. **Environment Variables**
   Create `.env` file:

   ```
   # Server Configuration
   PORT=3000
   
   # Module Configuration
   BACKEND_MODULES="core/arweave,core/is_on,core/prover,core/streamr"
   UI_MODULES="streamr:core/streamr/ui"
   
   # ChirpStack Configuration
   API_TOKEN=...
   APPLICATION_ID=...
   CHIRPSTACK_HOST=localhost
   
   # Contract & Network Configuration
   CONTRACT_LABEL=M3ters
   MAINNET_RPC=https://sepolia.drpc.org
   ETHEREUM_PRIVATE_KEY="..."
   
   # Streamr Configuration
   STREAMR_STREAM_ID="0x567853282663b601bfdb9203819b1fbb3fe18926/m3tering/test"
   STREAMR_CRONSCHEDULE="0 * * * *"  # Every hour
   
   # Optional: Prover Node (defaults to automatic selection)
   # PREFERRED_PROVER_NODE="http://prover.m3ter.ing"
   ```

3. **Docker Build and Run**

   ```bash
   sudo docker compose down
   sudo docker compose up -d
   ```

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
// ui.ts (or index.ts)
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
