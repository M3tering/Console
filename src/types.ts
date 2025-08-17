// Meter interface for database operations
export interface MeterRecord {
  publicKey: string;
  tokenId: number;
  contractId: string;
  latestNonce?: number; // Optional field for tracking latest nonce
}

// transaction database record
export interface TransactionRecord {
  nonce: number;
  energy: number;
  signature: string;
  voltage?: number;
  identifier?: string;
  verified?: boolean | 0 | 1; // Optional field to indicate if the transaction is verified
  receivedAt?: number;
  longitude: number;
  latitude: number;
  raw?: string | null; // Raw transaction data in hex format
}

// Payload sent to the prover
export interface BatchTransactionPayload {
  [key: string]: string[] /* mapping meterId to transaction payload */;
}
[];

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
export interface M3terPayload {
  0: string; // encoded format: nonce | energy | signature | voltage | device_id | longitude | latitude
  1: string;
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
  } | null;
}
