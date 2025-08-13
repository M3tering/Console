import fs from "fs";
import Database from "better-sqlite3";
import type {
  Database as DatabaseType,
  Statement as DatabaseStatementType,
} from "better-sqlite3";
import { MeterRecord, TransactionRecord } from "../types";

// meter queries
let db: DatabaseType;
let insertMeterQuery: DatabaseStatementType;
let getMeterByPublicKeyQuery: DatabaseStatementType;
let getAllMetersQuery: DatabaseStatementType;
let deleteMeterByPublicKeyQuery: DatabaseStatementType;
let updateMeterNonceQuery: DatabaseStatementType;
// transaction queries
let createTransactionQuery: DatabaseStatementType;
let getUnverifiedTransactionRecordsQuery: DatabaseStatementType;
let markTransactionAsVerifiedQuery: DatabaseStatementType;
let deleteVerifiedTransactionRecordsQuery: DatabaseStatementType;

/**
 * setup database
 *
 * @param databaseName name of the database file
 */
export default function setupDatabase(databaseName = "m3tering.db") {
  db = new Database(databaseName, {  });

  initializeMetersTable();
  initializeTransactionsTable();
  prepareQueries();
}

export function deleteDatabase(databaseName = "m3tering.db") {
  try {
    db.exec(`DROP TABLE IF EXISTS meters`);
    db.exec(`DROP TABLE IF EXISTS transactions`);
    db.close();
    fs.unlinkSync(databaseName);
  } catch (err: any) {
    console.error("Failed to delete database:", err);
  }
}

/**
 * Initialize the transactions table.
 *
 * @notice `identifier` can be either its public key or a specific Token ID.
 */
function initializeTransactionsTable() {
  return db.exec(`
        CREATE TABLE IF NOT EXISTS transactions (
            nonce INTEGER PRIMARY KEY,
            energy REAL,
            signature TEXT,
            voltage REAL,
            identifier TEXT,
            longitude REAL,
            latitude REAL,
            receivedAt INTEGER,
            verified BOOLEAN DEFAULT FALSE,
            raw TEXT,

            UNIQUE(nonce, identifier)
        )
    `);
}

/**
 * Initialize the meters table.
 */
function initializeMetersTable() {
  return db.exec(`
        CREATE TABLE IF NOT EXISTS meters (
            publicKey TEXT PRIMARY KEY,
            tokenId INTEGER NOT NULL,
            contractId TEXT NOT NULL,
            latestNonce INTEGER DEFAULT 0
        )
    `);
}

// Prepared statements for meter operations
function prepareQueries() {
  // meter queries
  insertMeterQuery = db.prepare(`
    INSERT OR REPLACE INTO meters (publicKey, tokenId, contractId, latestNonce)
    VALUES (@publicKey, @tokenId, @contractId, @latestNonce)
  `);

  getMeterByPublicKeyQuery = db.prepare(`
    SELECT publicKey, tokenId, contractId, latestNonce FROM meters WHERE publicKey = ?
  `);

  getAllMetersQuery = db.prepare(`
    SELECT publicKey, tokenId, contractId, latestNonce FROM meters
  `);

  deleteMeterByPublicKeyQuery = db.prepare(`
    DELETE FROM meters WHERE publicKey = ?
  `);

  updateMeterNonceQuery = db.prepare(`
    UPDATE meters SET latestNonce = ? WHERE publicKey = ?
  `);

  // transaction queries
  createTransactionQuery = db.prepare(`
    INSERT INTO transactions (nonce, energy, signature, voltage, identifier, longitude, latitude, verified, receivedAt, raw)
    VALUES (@nonce, @energy, @signature, @voltage, @identifier, @longitude, @latitude, @verified, @receivedAt, @raw)
  `);

  getUnverifiedTransactionRecordsQuery = db.prepare(`
    SELECT * FROM transactions WHERE verified = FALSE
  `);

  markTransactionAsVerifiedQuery = db.prepare(`
    UPDATE transactions SET verified = TRUE WHERE nonce = ?
  `);

  deleteVerifiedTransactionRecordsQuery = db.prepare(`
    DELETE FROM transactions WHERE verified = TRUE
  `);
}

// Meter management functions
export function saveMeter(meterData: MeterRecord): void {
  try {
    insertMeterQuery.run({
      publicKey: meterData.publicKey,
      tokenId: meterData.tokenId,
      contractId: meterData.contractId,
      latestNonce: meterData.latestNonce || 0,
    });
  } catch (err: any) {
    console.error("Failed to save meter:", err);
    throw err;
  }
}

export function getMeterByPublicKey(publicKey: string): MeterRecord | null {
  try {
    const result = getMeterByPublicKeyQuery.get(publicKey) as
      | MeterRecord
      | undefined;
    return result || null;
  } catch (err: any) {
    console.error("Failed to get meter:", err);
    return null;
  }
}

export function getAllMeterRecords(): MeterRecord[] {
  try {
    const results = getAllMetersQuery.all() as MeterRecord[];
    return results;
  } catch (err: any) {
    console.error("Failed to get all meters:", err);
    return [];
  }
}

export function deleteMeterByPublicKey(publicKey: string): boolean {
  try {
    const result = deleteMeterByPublicKeyQuery.run(publicKey);
    const deleted = result.changes > 0;
    if (!deleted) {
      console.log("Meter not found for deletion:", { publicKey });
    }
    return deleted;
  } catch (err: any) {
    console.error("Failed to delete meter:", err);
    return false;
  }
}

export function updateMeterNonce(publicKey: string, nonce: number): boolean {
  try {
    const result = updateMeterNonceQuery.run(nonce, publicKey);
    const updated = result.changes > 0;
    if (!updated) {
      console.log("Meter not found for nonce update:", { publicKey });
    }
    return updated;
  } catch (err: any) {
    console.error("Failed to update meter nonce:", err);
    return false;
  }
}

// Transaction insertion function
export function insertTransaction(transactionData: TransactionRecord): void {
  try {
    transactionData.verified = +Boolean(transactionData.verified) as 0 | 1; // Ensure verified is set
    createTransactionQuery.run(transactionData);
  } catch (err: any) {
    console.error("Failed to insert transaction:", err);
    throw err;
  }
}

// Transaction verification functions
export function getUnverifiedTransactionRecords(): TransactionRecord[] {
  try {
    const results =
      getUnverifiedTransactionRecordsQuery.all() as TransactionRecord[];
    return results;
  } catch (err: any) {
    console.error("Failed to get unverified transactions:", err);
    return [];
  }
}

export function markTransactionAsVerified(nonce: number): boolean {
  try {
    const result = markTransactionAsVerifiedQuery.run(nonce);
    const updated = result.changes > 0;
    if (!updated) {
      console.log("Transaction not found for verification:", {
        nonce,
      });
    }
    return updated;
  } catch (err: any) {
    console.error("Failed to mark transaction as verified:", err);
    return false;
  }
}

export function deleteVerifiedTransactionRecords(): number {
  try {
    const result = deleteVerifiedTransactionRecordsQuery.run();
    const deletedCount = result.changes;
    return deletedCount;
  } catch (err: any) {
    console.error("Failed to delete verified transactions:", err);
    return 0;
  }
}
