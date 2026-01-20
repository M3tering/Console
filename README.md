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
   PORT=3000
   API_TOKEN=...
   APPLICATION_ID=...
   CONTRACT_LABEL=M3ters
   CHIRPSTACK_HOST=localhost
   MAINNET_RPC=https://sepolia.drpc.org
   PREFERRED_PROVER_NODE=http://34.244.149.153
   ETHEREUM_PRIVATE_KEY="..."
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

Both systems use a config-driven approach where modules are loaded dynamically from paths specified in `console.config.json`.

## Configuration

```json
{
  "modules": [
    "core/arweave",
    "core/prover",
    "core/streamr",
    "core/is_on",
    "core/prune_sync"
  ],
  "uiModules": {
    "streamr": "core/streamr/ui"
  },
  "streamr": {
    "streamId": ["0x.../m3tering/test"],
    "cronSchedule": "0 * * * *"
  }
}
```

- **`modules`**: Array of paths to backend hook modules (relative to `src/lib/`)
- **`uiModules`**: Object mapping module IDs to UI module paths (relative to `src/lib/`)

---

# Backend Hooks

Backend hooks allow modules to react to console lifecycle events. Each module exports a default class implementing the `Hooks` interface.

## Creating a Backend Module

```typescript
// src/lib/core/my-module/index.ts
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

Add to `console.config.json`:
```json
{
  "modules": ["core/my-module"]
}
```

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

```typescript
// src/lib/core/my-module/ui.ts
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

Add to `console.config.json`:
```json
{
  "uiModules": {
    "my-module": "core/my-module/ui"
  }
}
```

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
| `core/prune_sync` | Cleans up old synchronized transactions |

## UI Modules

| Module | Description |
|--------|-------------|
| `streamr` | Panel showing stream config, pending count, and "Publish Now" action |

---
