import { MqttClient } from "mqtt/*";

// Application configuration type (console.config.json)
export type AppConfig = {
  modules: string[];
  streamr: {
    streamId: string[];
    cronSchedule: string;
  };
};

// Hooks type for lifecycle events
export type Hooks = {
  onBeforeInit?: () => void | Promise<void>;
  onDatabaseSetup?: () => void | Promise<void>;
  onAfterInit?: () => void | Promise<void>;
  onInitError?: (error: any) => void | Promise<void>;

  onMqttConnect?: (client: MqttClient) => void | Promise<void>;
  onMqttSubscribed?: (client: MqttClient, topic: string) => void | Promise<void>;
  onMqttError?: (error: any, client: MqttClient) => void | Promise<void>;
  onMqttReconnect?: (client: MqttClient) => void | Promise<void>;

  onMessageReceived?: (blob: Buffer) => void | Promise<void>;
  onMessageDropped?: (reason: string, devEui: string) => void | Promise<void>;

  onMeterCreated?: (newMeter: MeterRecord) => void | Promise<void>;

  onSyncEpochReached?: () => void | Promise<void>;

  onTransactionDistribution?: (
    tokenId: number,
    decodedPayload: DecodedPayload,
    pendingTransactions: TransactionRecord[]
  ) => void | Promise<void>;

  isOnStateCompute?: (m3terId: number) => boolean | Promise<boolean>;
  onIsOnStateComputed?: (m3terId: number, isOn: boolean) => void | Promise<void>;
  onIsOnStateComputeError?: (m3terId: number, error: any) => void | Promise<void>;
  onStateEnqueued?: (state: any, latitude: number, longitude: number) => void | Promise<void>;

  onMessageError?: (error: any) => void | Promise<void>;
  onDeviceUnlocked?: (devEui: string) => void | Promise<void>;
  onMessageProcessingComplete?: () => void | Promise<void>;
};

// Meter interface for database operations
export interface MeterRecord {
  publicKey: string;
  devEui: string | null; // Optional field for device EUI
  tokenId: number;
  latestNonce: number; // Optional field for tracking latest nonce
}

// transaction database record
export interface TransactionRecord {
  nonce: number;
  identifier: number; // Meter token ID
  receivedAt: number;
  raw: string; // Raw transaction data in hex format
}

// Payload sent to the prover
export interface BatchTransactionPayload {
  m3ter_id: number;
  message: string;
}

export interface State {
  app_eui: number;
  app_key: number;
  dev_eui: number;
  is_on: boolean;
  total_kwh: number;
  kwh_balance: number;
  last_block: number;
  nonce: number;
  public_key: string;
  token_id: number;
}

export interface DecodedPayload {
  nonce: number;
  energy: number;
  signature: string;
  extensions: {
    voltage?: number;
    deviceId?: string;
    longitude?: number;
    latitude?: number;
  };
  buf: Buffer;
}

export interface VerifierInfo {
  ensName: string;
  targetAddress: string;
  verifierAddress: string;
}
