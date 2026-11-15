import type { Database } from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type { Telemetry } from './decoder';
let db: Database;
export function initializeManagerStore(connection: Database): void {
  db = connection;
  db.exec(`
    CREATE TABLE IF NOT EXISTS manager_devices (application TEXT, devEui TEXT, metadata TEXT NOT NULL DEFAULT '{}', publicKey TEXT,
      lastUplink INTEGER, activity TEXT, PRIMARY KEY(application, devEui));
    CREATE TABLE IF NOT EXISTS manager_events (id INTEGER PRIMARY KEY, application TEXT NOT NULL, devEui TEXT,
      timestamp INTEGER NOT NULL, receivedAt INTEGER NOT NULL, kind TEXT NOT NULL, source TEXT NOT NULL,
      eventKey TEXT NOT NULL, rawPayload TEXT, fPort INTEGER, metadata TEXT NOT NULL, message TEXT NOT NULL,
      UNIQUE(application,eventKey));
    CREATE INDEX IF NOT EXISTS manager_events_device_time ON manager_events(application,devEui,timestamp DESC,id DESC);
    CREATE TABLE IF NOT EXISTS manager_readings (id INTEGER PRIMARY KEY, application TEXT NOT NULL, devEui TEXT NOT NULL,
      timestamp INTEGER NOT NULL, receivedAt INTEGER NOT NULL, fPort INTEGER NOT NULL, nonce INTEGER NOT NULL,
      rawEnergy INTEGER NOT NULL, energy REAL NOT NULL, rawVoltage INTEGER NOT NULL, voltage REAL NOT NULL,
      signature TEXT NOT NULL, publicKey TEXT, verification TEXT NOT NULL, decoded TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS manager_readings_device_time ON manager_readings(application,devEui,timestamp DESC,id DESC);
    CREATE TABLE IF NOT EXISTS manager_commands (id TEXT PRIMARY KEY, application TEXT NOT NULL, devEui TEXT NOT NULL,
      timestamp INTEGER NOT NULL, updatedAt INTEGER NOT NULL, actor TEXT NOT NULL, command TEXT NOT NULL,
      fingerprint TEXT NOT NULL, status TEXT NOT NULL, detail TEXT, queueId TEXT);
    CREATE INDEX IF NOT EXISTS manager_commands_device_time ON manager_commands(application,devEui,timestamp DESC);
    CREATE INDEX IF NOT EXISTS manager_commands_queue ON manager_commands(application,devEui,queueId);
  `);
  // A process may have stopped after the upstream accepted a command. Never resend automatically.
  db.prepare("UPDATE manager_commands SET status='unknown', detail='Console restarted during enqueue; inspect the queue before retrying' WHERE status='enqueuing'").run();
}
export type ManagerEvent = { application: string; devEui: string | null; timestamp: number; receivedAt: number;
  kind: string; source: string; eventKey: string; rawPayload?: string | null; fPort?: number | null; metadata: Record<string, unknown>; message: string };
export function addEvent(event: ManagerEvent): number | null {
  const result = db.prepare(`INSERT OR IGNORE INTO manager_events(application,devEui,timestamp,receivedAt,kind,source,eventKey,rawPayload,fPort,metadata,message)
    VALUES(@application,@devEui,@timestamp,@receivedAt,@kind,@source,@eventKey,@rawPayload,@fPort,@metadata,@message)`)
    .run({ ...event, rawPayload: event.rawPayload ?? null, fPort: event.fPort ?? null, metadata: JSON.stringify(event.metadata) });
  return result.changes ? Number(result.lastInsertRowid) : null;
}
export function applicationEvent(application: string, devEui: string | null, kind: string, message: string): void {
  addEvent({ application, devEui, kind, message, source: 'console observation', eventKey: randomUUID(), timestamp: Date.now(), receivedAt: Date.now(), metadata: {} });
}
export function deviceState(application: string, devEui: string): any {
  const row: any = db.prepare('SELECT * FROM manager_devices WHERE application=? AND devEui=?').get(application, devEui);
  return row ? { ...row, metadata: JSON.parse(row.metadata) } : null;
}
export function updateDevice(application: string, devEui: string, metadata: Record<string, unknown>): void {
  const previous = deviceState(application, devEui);
  db.prepare(`INSERT INTO manager_devices(application,devEui,metadata) VALUES(?,?,?)
    ON CONFLICT(application,devEui) DO UPDATE SET metadata=excluded.metadata`).run(application, devEui, JSON.stringify({ ...previous?.metadata, ...metadata }));
}
export function recordUplink(event: ManagerEvent, telemetry?: Telemetry, inactiveAfter = 300000): boolean {
  return db.transaction(() => {
    const id = addEvent(event); if (id === null) return false;
    const old = deviceState(event.application, event.devEui!);
    updateDevice(event.application, event.devEui!, event.metadata);
    const recent = Math.max(event.timestamp, old?.lastUplink || 0) >= Date.now() - inactiveAfter;
    if (recent && (!old?.lastUplink || old.activity === 'inactive')) applicationEvent(event.application, event.devEui, 'active', 'Uplink observed after no recent activity');
    db.prepare('UPDATE manager_devices SET lastUplink=MAX(COALESCE(lastUplink,0),?),activity=? WHERE application=? AND devEui=?')
      .run(event.timestamp, recent ? 'active' : 'inactive', event.application, event.devEui);
    if (!telemetry) return true;
    db.prepare(`INSERT INTO manager_readings(id,application,devEui,timestamp,receivedAt,fPort,nonce,rawEnergy,energy,rawVoltage,voltage,signature,publicKey,verification,decoded)
      VALUES(@id,@application,@devEui,@timestamp,@receivedAt,@fPort,@nonce,@rawEnergy,@energy,@rawVoltage,@voltage,@signature,@publicKey,@verification,@decoded)`)
      .run({ id, application: event.application, devEui: event.devEui, timestamp: event.timestamp, receivedAt: event.receivedAt, fPort: event.fPort,
        nonce: telemetry.nonce, rawEnergy: telemetry.rawEnergy, energy: telemetry.energy, rawVoltage: telemetry.rawVoltage, voltage: telemetry.voltage,
        signature: telemetry.signature, publicKey: telemetry.publicKey, verification: telemetry.verification, decoded: JSON.stringify(telemetry) });
    if (telemetry.verificationKey && telemetry.verification === 'verified' && !old?.publicKey) {
      db.prepare('UPDATE manager_devices SET publicKey=? WHERE application=? AND devEui=?').run(telemetry.verificationKey, event.application, event.devEui);
      applicationEvent(event.application, event.devEui, 'public-key', telemetry.publicKey ? 'Public key received; signature over nonce and energy verified (first-seen key)' : 'Existing console public key reused to verify nonce and energy');
    }
    return true;
  })();
}
export function markInactive(application: string, threshold: number): void {
  db.transaction(() => {
    const rows: any[] = db.prepare("SELECT devEui FROM manager_devices WHERE application=? AND activity='active' AND lastUplink<?").all(application, Date.now() - threshold);
    for (const row of rows) {
      db.prepare("UPDATE manager_devices SET activity='inactive' WHERE application=? AND devEui=?").run(application, row.devEui);
      applicationEvent(application, row.devEui, 'inactive', 'No recent uplink observed. This does not prove the meter is offline.');
    }
  })();
}
export function latestReading(application: string, devEui: string): any {
  return db.prepare('SELECT * FROM manager_readings WHERE application=? AND devEui=? ORDER BY timestamp DESC,id DESC LIMIT 1').get(application, devEui) || null;
}
export function history(application: string, devEui: string, from: number, to: number, offset: number, limit: number) {
  const args = { application, devEui, from, to };
  // Compute baselines BEFORE date filtering/pagination. The nonce identifies an
  // accumulation cycle; repeated reports are snapshots, never new consumption.
  // A same-nonce decrease or a regressed nonce is ambiguous, not an acknowledgment.
  const ledger = `WITH prior AS (
    SELECT *, MAX(nonce) OVER preceding AS previousNonce,
      LAG(nonce) OVER chronology AS lastNonce, LAG(rawEnergy) OVER chronology AS lastEnergy,
      MAX(rawEnergy) OVER(PARTITION BY nonce ORDER BY timestamp,id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS highWater
    FROM manager_readings WHERE application=@application AND devEui=@devEui AND timestamp<=@to
    WINDOW chronology AS (ORDER BY timestamp,id),
      preceding AS (ORDER BY timestamp,id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING)
  ), calculated AS (
    SELECT *, CASE WHEN previousNonce IS NULL OR nonce<previousNonce THEN NULL
      WHEN nonce>previousNonce THEN rawEnergy/1000000.0
      ELSE MAX(0,rawEnergy-highWater)/1000000.0 END AS intervalEnergy,
      CASE WHEN previousNonce IS NULL THEN 'initial-baseline'
        WHEN nonce<previousNonce THEN 'nonce-regression'
        WHEN nonce>previousNonce THEN 'new-cycle'
        WHEN rawEnergy<highWater THEN 'below-high-water'
        WHEN rawEnergy=highWater THEN 'repeated-total' ELSE 'increase' END AS accounting,
      SUM(CASE WHEN nonce!=lastNonce OR rawEnergy<lastEnergy THEN 1 ELSE 0 END) OVER(ORDER BY timestamp,id) AS segment
    FROM prior
  ), selected AS (
    SELECT *, ROW_NUMBER() OVER(ORDER BY timestamp,id) AS rn, COUNT(*) OVER() AS total
    FROM calculated WHERE timestamp>=@from
  ) `;
  const rows = db.prepare(ledger + `SELECT r.*,e.rawPayload,e.metadata FROM selected r JOIN manager_events e ON e.id=r.id
    ORDER BY r.timestamp DESC,r.id DESC LIMIT @limit OFFSET @offset`).all({ ...args, limit, offset });
  const chart = db.prepare(ledger + `SELECT timestamp,energy,voltage,nonce,segment,intervalEnergy,accounting FROM selected
    WHERE (rn-1) % MAX(1,CAST((total+399)/400 AS INTEGER))=0 OR rn=total ORDER BY timestamp,id`).all(args);
  const summary: any = db.prepare(ledger + `SELECT COUNT(*) AS reports, COALESCE(SUM(intervalEnergy),0) AS observedConsumption,
    COALESCE(SUM(accounting='new-cycle'),0) AS resets,
    COALESCE(SUM(accounting IN ('nonce-regression','below-high-water')),0) AS uncertainReports,
    COALESCE(SUM(accounting='repeated-total'),0) AS repeatedReports FROM selected`).get(args);
  const total = summary.reports;
  return { rows, chart, total, offset, limit, summary, sampled: total > chart.length };
}
export function events(application: string, devEui: string, offset = 0): any[] {
  return db.prepare(`SELECT * FROM manager_events WHERE application=? AND (devEui=? OR devEui IS NULL)
    ORDER BY timestamp DESC,id DESC LIMIT 100 OFFSET ?`).all(application, devEui, offset);
}
export function getCommand(application: string, id: string): any {
  const row: any = db.prepare('SELECT * FROM manager_commands WHERE application=? AND id=?').get(application, id);
  return row ? { ...row, command: JSON.parse(row.command) } : null;
}
export function commandHistory(application: string, devEui: string, offset = 0): any[] {
  return (db.prepare('SELECT * FROM manager_commands WHERE application=? AND devEui=? ORDER BY timestamp DESC LIMIT 50 OFFSET ?').all(application, devEui, offset) as any[])
    .map(row => ({ ...row, command: JSON.parse(row.command) }));
}
export function insertCommand(application: string, devEui: string, id: string, command: unknown, fingerprint: string): void {
  db.prepare(`INSERT INTO manager_commands(id,application,devEui,timestamp,updatedAt,actor,command,fingerprint,status,queueId)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id, application, devEui, Date.now(), Date.now(), process.env.M3TER_MANAGER_USERNAME || 'manager', JSON.stringify(command), fingerprint, 'enqueuing', id);
}
export function commandStatus(application: string, devEui: string, queueId: string, status: string, detail: string): void {
  const predicate = status === 'queued' ? "status='enqueuing'" : "status NOT IN ('delivered','failed')";
  db.prepare(`UPDATE manager_commands SET status=?,detail=?,updatedAt=? WHERE application=? AND devEui=? AND queueId=?
    AND ${predicate}`).run(status, detail, Date.now(), application, devEui, queueId);
}
export function clearedCommands(application: string, devEui: string): void {
  db.prepare("UPDATE manager_commands SET status='cleared',detail='Queue cleared; any earlier transmission cannot be recalled',updatedAt=? WHERE application=? AND devEui=? AND status IN ('queued','pending','unknown')")
    .run(Date.now(), application, devEui);
}
