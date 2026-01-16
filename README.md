# M3tering Console Setup

## Pre-setup

- Make sure Public key is set on the M3ter contract
- Make sure the price for evergy as been set on the PriceContext contract
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


# Complete Hook Lifecycle for M3tering Console

## Initialization Phase

| Hook Name | Description | Parameters |
|-----------|-------------|------------|
| `onBeforeInit` | Called before any initialization begins | None |
| `onDatabaseSetup` | Called after SQLite tables/jobs are initialized | None |
| `onAfterInit` | Called after all initialization completes successfully | None |
| `onInitError` | Called when an error occurs during initialization | `error: any` |

## MQTT Connection Phase

| Hook Name | Description | Parameters |
|-----------|-------------|------------|
| `onMqttConnect` | Called when MQTT client successfully connects to ChirpStack | `client: MqttClient` |
| `onMqttSubscribed` | Called after subscribing to the device uplink topic | `client: MqttClient`, `topic: string` |
| `onMqttError` | Called when an MQTT connection error occurs | `error: any`, `client: MqttClient` |
| `onMqttReconnect` | Called when attempting to reconnect to the MQTT broker | `client: MqttClient` |

## Message Ingestion Phase

| Hook Name | Description | Parameters |
|-----------|-------------|------------|
| `onMessageReceived` | Called when a raw MQTT message is received (before parsing) | `blob: Buffer` |
| `onMessageDropped` | Called when a message is dropped (e.g., device already locked) | `reason: string`, `devEui: string` |

## Meter Discovery & Registration Phase

| Hook Name | Description | Parameters |
|-----------|-------------|------------|
| `onMeterCreated` | Called after a new meter is saved to the database | `newMeter: MeterRecord` |

## Nonce Synchronization Phase

| Hook Name | Description | Parameters |
|-----------|-------------|------------|
| `onSyncEpochReached` | Called when the sync interval is reached for blockchain synchronization | None |

## Downstream Distribution Phase

| Hook Name | Description | Parameters |
|-----------|-------------|------------|
| `onTransactionDistribution` | Called before sending transactions to Arweave, prover node, Streamr, or other stores/loggers | `tokenId: number`, `decodedPayload: DecodedPayload`, `pendingTransactions: TransactionRecord[]` |

## State Encoding & Device Response Phase

| Hook Name | Description | Parameters |
|-----------|-------------|------------|
| `isOnStateCompute` | Called to determine the device's on/off state (returns boolean) | `m3terId: number` |
| `onIsOnStateComputed` | Called after the on/off state has been computed | `m3terId: number`, `isOn: boolean` |
| `onIsOnStateComputeError` | Called when an error occurs during state computation | `m3terId: number`, `error: any` |
| `onStateEnqueued` | Called after the state is enqueued to gRPC for device response | `state: any`, `latitude: number`, `longitude: number` |

## Error Handling & Cleanup Phase

| Hook Name | Description | Parameters |
|-----------|-------------|------------|
| `onMessageError` | Called when any error occurs during message processing | `error: any` |
| `onDeviceUnlocked` | Called when a device lock is released (regardless of outcome) | `devEui: string` |
| `onMessageProcessingComplete` | Called when message processing finishes (success or error) | None |

---
