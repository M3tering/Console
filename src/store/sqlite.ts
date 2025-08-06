import Database from "better-sqlite3";

const db = new Database("m3tering.db", { verbose: console.log });

// Meter interface for Level DB replacement
export interface MeterRecord {
  publicKey: string;
  tokenId: number;
  contractId: string;
}

export function initializeTransactionsTable() {
  db.exec(`
        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nonce INTEGER,
            voltage REAL,
            current REAL,
            energy REAL,
            signature TEXT,
            publicKey TEXT,
            receivedAt INTEGER,
            verified BOOLEAN DEFAULT FALSE,
            UNIQUE(nonce, publicKey)
        )
    `);
}

export function initializeMetersTable() {
  db.exec(`
        CREATE TABLE IF NOT EXISTS meters (
            publicKey TEXT PRIMARY KEY,
            tokenId INTEGER NOT NULL,
            contractId TEXT NOT NULL
        )
    `);
}

// Prepared statements for meter operations
const insertMeter = db.prepare(`
  INSERT OR REPLACE INTO meters (publicKey, tokenId, contractId)
  VALUES (@publicKey, @tokenId, @contractId)
`);

const getMeter = db.prepare(`
  SELECT publicKey, tokenId, contractId FROM meters WHERE publicKey = ?
`);

const getAllMeters = db.prepare(`
  SELECT publicKey, tokenId, contractId FROM meters
`);

const deleteMeter = db.prepare(`
  DELETE FROM meters WHERE publicKey = ?
`);

// Meter management functions
export function saveMeter(meterData: MeterRecord): void {
  try {
    insertMeter.run({
      publicKey: meterData.publicKey,
      tokenId: meterData.tokenId,
      contractId: meterData.contractId,
    });
    console.log("✅ Meter saved:", { publicKey: meterData.publicKey, tokenId: meterData.tokenId });
  } catch (err: any) {
    console.error("❌ Failed to save meter:", err.message);
    throw err;
  }
}

export function getMeterByPublicKey(publicKey: string): MeterRecord | null {
  try {
    const result = getMeter.get(publicKey) as MeterRecord | undefined;
    return result || null;
  } catch (err: any) {
    console.error("❌ Failed to get meter:", err.message);
    return null;
  }
}

export function getAllMeterRecords(): MeterRecord[] {
  try {
    const results = getAllMeters.all() as MeterRecord[];
    return results;
  } catch (err: any) {
    console.error("❌ Failed to get all meters:", err.message);
    return [];
  }
}

export function deleteMeterByPublicKey(publicKey: string): boolean {
  try {
    const result = deleteMeter.run(publicKey);
    const deleted = result.changes > 0;
    if (deleted) {
      console.log("✅ Meter deleted:", { publicKey });
    } else {
      console.log("⚠️ Meter not found for deletion:", { publicKey });
    }
    return deleted;
  } catch (err: any) {
    console.error("❌ Failed to delete meter:", err.message);
    return false;
  }
}

// Prepared statements for transaction verification
const getUnverifiedTransactions = db.prepare(`
  SELECT * FROM transactions WHERE verified = FALSE
`);

const updateTransactionVerified = db.prepare(`
  UPDATE transactions SET verified = TRUE WHERE id = ?
`);

const deleteVerifiedTransactions = db.prepare(`
  DELETE FROM transactions WHERE verified = TRUE
`);

// Transaction verification functions
export function getUnverifiedTransactionRecords(): any[] {
  try {
    const results = getUnverifiedTransactions.all();
    return results;
  } catch (err: any) {
    console.error("❌ Failed to get unverified transactions:", err.message);
    return [];
  }
}

export function markTransactionAsVerified(transactionId: number): boolean {
  try {
    const result = updateTransactionVerified.run(transactionId);
    const updated = result.changes > 0;
    if (updated) {
      console.log("✅ Transaction marked as verified:", { transactionId });
    } else {
      console.log("⚠️ Transaction not found for verification:", { transactionId });
    }
    return updated;
  } catch (err: any) {
    console.error("❌ Failed to mark transaction as verified:", err.message);
    return false;
  }
}

export function deleteVerifiedTransactionRecords(): number {
  try {
    const result = deleteVerifiedTransactions.run();
    const deletedCount = result.changes;
    console.log("✅ Deleted verified transactions:", { count: deletedCount });
    return deletedCount;
  } catch (err: any) {
    console.error("❌ Failed to delete verified transactions:", err.message);
    return 0;
  }
}
