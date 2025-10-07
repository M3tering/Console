import fs from "fs";
import Database from "better-sqlite3";
import type { Database as DatabaseType, Statement as DatabaseStatementType } from "better-sqlite3";
import { MeterRecord, TransactionRecord } from "../types";

// meter queries
let db: DatabaseType;
let insertMeterQuery: DatabaseStatementType;
let getMeterByPublicKeyQuery: DatabaseStatementType;
let getMeterByDevEuiQuery: DatabaseStatementType;
let getMeterByTokenIdQuery: DatabaseStatementType;
let getAllMetersQuery: DatabaseStatementType;
let deleteMeterByPublicKeyQuery: DatabaseStatementType;
let updateMeterNonceQuery: DatabaseStatementType;
let updateMeterDevEuiQuery: DatabaseStatementType;
// transaction queries
let createTransactionQuery: DatabaseStatementType;
let getTransactionByNonceQuery: DatabaseStatementType;

/**
 * setup database
 *
 * @param databaseName name of the database file
 */
export default function setupDatabase(databaseName = "m3tering.db") {
  db = new Database(databaseName, {});

  initializeTransactionsTable();
  initializeMetersTable();
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
            nonce INTEGER,
            identifier INTEGER, -- Meter token ID
            receivedAt INTEGER,
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
            publicKey TEXT,
            devEui TEXT,
            tokenId INTEGER,
            latestNonce INTEGER DEFAULT -1,

            UNIQUE(publicKey, tokenId)
        )
    `);
}

// Prepared statements for meter operations
function prepareQueries() {
  // meter queries
  insertMeterQuery = db.prepare(`
    INSERT OR REPLACE INTO meters (publicKey, devEui, tokenId, latestNonce)
    VALUES (@publicKey, @devEui, @tokenId, @latestNonce)
  `);

  getMeterByPublicKeyQuery = db.prepare(`
    SELECT publicKey, devEui, tokenId, latestNonce FROM meters WHERE publicKey = ?
  `);

  getMeterByDevEuiQuery = db.prepare(`
    SELECT publicKey, devEui, tokenId, latestNonce FROM meters WHERE devEui = ?
  `);

  getMeterByTokenIdQuery = db.prepare(`
    SELECT publicKey, devEui, tokenId, latestNonce FROM meters WHERE tokenId = ?
  `);

  getAllMetersQuery = db.prepare(`
    SELECT publicKey, devEui, tokenId, latestNonce FROM meters
  `);

  deleteMeterByPublicKeyQuery = db.prepare(`
    DELETE FROM meters WHERE publicKey = ?
  `);

  updateMeterNonceQuery = db.prepare(`
    UPDATE meters SET latestNonce = ? WHERE publicKey = ?
  `);

  updateMeterDevEuiQuery = db.prepare(`
    UPDATE meters SET devEui = ? WHERE publicKey = ?
  `);

  // transaction queries
  createTransactionQuery = db.prepare(`
    INSERT INTO transactions (nonce, identifier, receivedAt, raw)
    VALUES (@nonce, @identifier, @receivedAt, @raw)
  `);

  getTransactionByNonceQuery = db.prepare(`
    SELECT * FROM transactions WHERE nonce = ? AND identifier = ?
  `);
}

// Meter management functions
export function saveMeter(meterData: MeterRecord): void {
  try {
    insertMeterQuery.run({
      publicKey: meterData.publicKey,
      tokenId: meterData.tokenId,
      latestNonce: meterData.latestNonce,
      devEui: meterData.devEui ?? null,
    });
  } catch (err: any) {
    console.error("Failed to save meter:", err);
    throw err;
  }
}

export function getMeterByPublicKey(publicKey: string): MeterRecord | null {
  try {
    const result = getMeterByPublicKeyQuery.get(publicKey) as MeterRecord | undefined;
    return result || null;
  } catch (err: any) {
    console.error("Failed to get meter:", err);
    return null;
  }
}

export function getMeterByDevEui(devEui: string): MeterRecord | null {
  try {
    const result = getMeterByDevEuiQuery.get(devEui) as MeterRecord | undefined;
    return result || null;
  } catch (err: any) {
    console.error("Failed to get meter by DevEui:", err);
    return null;
  }
}

export function getMeterByTokenId(tokenId: number): MeterRecord | null {
  try {
    const result = getMeterByTokenIdQuery.get(tokenId) as MeterRecord | undefined;
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

export function updateMeterDevEui(publicKey: string, devEui: string): boolean {
  try {
    const result = updateMeterDevEuiQuery.run(devEui, publicKey);
    const updated = result.changes > 0;
    if (!updated) {
      console.log("Meter not found for DevEui update:", { publicKey });
    }
    return updated;
  } catch (err: any) {
    console.error("Failed to update meter DevEui:", err);
    return false;
  }
}

// Transaction insertion function
export function insertTransaction(transactionData: TransactionRecord): void {
  try {
    const existingTransaction = getTransactionByNonceQuery.get(
      transactionData.nonce,
      transactionData.identifier
    ) as TransactionRecord | undefined;

    if (existingTransaction) {
      throw new Error(`Transaction with nonce ${transactionData.nonce} already exists`);
    }

    createTransactionQuery.run(transactionData);
  } catch (err: any) {
    console.error("Failed to insert transaction:", err);
    throw err;
  }
}

export function getAllTransactionRecords(): TransactionRecord[] {
  try {
    const results = db.prepare(`SELECT * FROM transactions`).all() as TransactionRecord[];
    return results;
  } catch (err: any) {
    console.error("Failed to get all transactions:", err);
    return [];
  }
}

export function pruneTransactionsBefore(nonce: number, meterNumber: number) {
  try {
    const result = db
      .prepare(`DELETE FROM transactions WHERE identifier = ? AND nonce < ?`)
      .run(meterNumber, nonce);
    console.log(
      `Pruned ${result.changes} transactions for meter ${meterNumber} with nonce < ${nonce}`
    );
  } catch (err: any) {
    console.error("Failed to prune transactions:", err);
  }
}
