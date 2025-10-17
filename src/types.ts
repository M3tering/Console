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
