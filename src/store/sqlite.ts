import Database from "better-sqlite3";
import { StreamrMessage } from "../types";

const db = new Database("gossip.db", { verbose: console.log });

export function initializeGossipTable() {
  db.exec(`
        CREATE TABLE IF NOT EXISTS gossip_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nonce INTEGER,
            voltage REAL,
            current REAL,
            energy REAL,
            signature TEXT,
            publicKey TEXT,
            receivedAt INTEGER,
            UNIQUE(nonce, publicKey)
        )
    `);
}

const insert = db.prepare(`
  INSERT INTO gossip_data (nonce, voltage, current, energy, signature, publicKey, receivedAt)
  VALUES (@nonce, @voltage, @current, @energy, @signature, @publicKey, @receivedAt)
`);

export function saveGossipMessage(data: StreamrMessage) {
  // Validate data structure
  if (
    !data ||
    !data.payload ||
    !Array.isArray(data.payload) ||
    data.payload.length !== 3
  ) {
    console.warn("⚠️ Invalid gossip message structure:", data);
    return;
  }

  try {
    const [metricsStr, signature, publicKey] = data.payload;

    if (
      typeof metricsStr !== "string" ||
      typeof signature !== "string" ||
      typeof publicKey !== "string"
    ) {
      console.warn("⚠️ Gossip payload has incorrect types:", data.payload);
      return;
    }

    // Parse JSON array string like "[71,214.6,2.25,0.008055]"
    const [nonce, voltage, current, energy] = JSON.parse(metricsStr);

    insert.run({
      nonce,
      voltage,
      current,
      energy,
      signature,
      publicKey,
      receivedAt: Date.now(),
    });

    console.log("✅ Gossip data saved:", { nonce, publicKey });
  } catch (err: any) {
    if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
      console.log("⚠️ Duplicate gossip data (nonce + publicKey) ignored.");
    } else {
      console.error("❌ Failed to save gossip data:", err.message);
    }
  }
}
