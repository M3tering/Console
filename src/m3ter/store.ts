import type { Database } from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type { Telemetry } from './decoder';
import { advance, Accumulator } from './accumulator';
import { telemetryLimit } from './config';
let db: Database;
let retentionLimit = 100;
export function initializeManagerStore(connection: Database): void {
  retentionLimit = telemetryLimit();
  db = connection;
  db.exec(`
    CREATE TABLE IF NOT EXISTS manager_devices (application TEXT, devEui TEXT, metadata TEXT NOT NULL DEFAULT '{}', publicKey TEXT,
      lastUplink INTEGER, activity TEXT, PRIMARY KEY(application, devEui));
    CREATE TABLE IF NOT EXISTS manager_events (id INTEGER PRIMARY KEY AUTOINCREMENT, application TEXT NOT NULL, devEui TEXT,
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
  db.exec(`CREATE TABLE IF NOT EXISTS manager_accumulators (
    application TEXT NOT NULL, devEui TEXT NOT NULL, state TEXT, latest TEXT,
    PRIMARY KEY(application,devEui));
    CREATE TABLE IF NOT EXISTS manager_schema (version INTEGER PRIMARY KEY);
    CREATE INDEX IF NOT EXISTS manager_readings_retention ON manager_readings(timestamp,id);
    CREATE INDEX IF NOT EXISTS manager_events_retention ON manager_events(timestamp,id);`);
  const columns = new Set((db.prepare('PRAGMA table_info(manager_readings)').all() as any[]).map(row => row.name));
  for (const [name, type] of Object.entries({ accounting: 'TEXT', intervalEnergy: 'REAL', collectedEnergy: 'REAL', completedNonce: 'INTEGER', segment: 'INTEGER' })) {
    if (!columns.has(name)) db.exec(`ALTER TABLE manager_readings ADD COLUMN ${name} ${type}`);
  }
  // Replay existing history once before trimming. Raw readings are never rewritten.
  db.transaction(() => {
    if (!db.prepare('SELECT version FROM manager_schema WHERE version=1').get()) {
      // Finish each read before writing on this SQLite connection; bound memory
      // during migration of an installation that previously retained all history.
      let timestamp = -1, id = -1;
      for (;;) {
        const rows: any[] = db.prepare('SELECT * FROM manager_readings WHERE timestamp>? OR (timestamp=? AND id>?) ORDER BY timestamp,id LIMIT 500').all(timestamp,timestamp,id);
        if (!rows.length) break;
        for (const row of rows) account(row);
        const last = rows[rows.length-1]; timestamp = last.timestamp; id = last.id;
      }
      db.prepare('INSERT INTO manager_schema(version) VALUES(1)').run();
    }
    // Recover receipt times from persisted records, never from the startup clock.
    if (!db.prepare('SELECT version FROM manager_schema WHERE version=2').get()) {
      db.exec(`UPDATE manager_devices SET lastUplink=NULLIF(MAX(
        COALESCE((SELECT MAX(receivedAt) FROM manager_readings r WHERE r.application=manager_devices.application AND r.devEui=manager_devices.devEui),0),
        COALESCE((SELECT json_extract(latest,'$.receivedAt') FROM manager_accumulators a WHERE a.application=manager_devices.application AND a.devEui=manager_devices.devEui),0)),0);
        INSERT INTO manager_schema(version) VALUES(2);`);
    }
    trimHistory();
  })();
  // A process may have stopped after the upstream accepted a command. Never resend automatically.
  db.prepare("UPDATE manager_commands SET status='unknown', detail='Console restarted during enqueue; inspect the queue before retrying' WHERE status='enqueuing'").run();
}
// Global cap includes malformed and unsupported uplinks, so their raw payloads
// cannot bypass retention. Device state survives deletion of any history row.
function trimHistory(): void {
  db.prepare(`DELETE FROM manager_readings WHERE id IN (
      SELECT id FROM manager_events WHERE kind IN ('up','decode-error')
      ORDER BY timestamp DESC,id DESC LIMIT -1 OFFSET ?)`).run(retentionLimit);
  db.prepare(`DELETE FROM manager_events WHERE kind IN ('up','decode-error') AND id NOT IN (
      SELECT id FROM manager_events WHERE kind IN ('up','decode-error') ORDER BY timestamp DESC,id DESC LIMIT ?)`).run(retentionLimit);
}
export function accumulatorState(application: string, devEui: string): Accumulator | null {
  const row: any = db.prepare('SELECT state FROM manager_accumulators WHERE application=? AND devEui=?').get(application, devEui);
  return row?.state ? JSON.parse(row.state) : null;
}
function account(row: any): void {
  const previous = accumulatorState(row.application, row.devEui);
  const result = row.verification === 'invalid' ? { state: previous, accounting: 'invalid-signature', intervalEnergy: null, collectedEnergy: null, completedNonce: null } :
    advance(previous, row.nonce, row.rawEnergy, row.timestamp);
  const segment = result.state?.segment ?? 0;
  db.prepare('UPDATE manager_readings SET accounting=?,intervalEnergy=?,collectedEnergy=?,completedNonce=?,segment=? WHERE id=?')
    .run(result.accounting, result.intervalEnergy, result.collectedEnergy, result.completedNonce, segment, row.id);
  const old: any = db.prepare('SELECT latest FROM manager_accumulators WHERE application=? AND devEui=?').get(row.application,row.devEui);
  const latest = old?.latest ? JSON.parse(old.latest) : null;
  db.prepare(`INSERT INTO manager_accumulators(application,devEui,state,latest) VALUES(?,?,?,?)
    ON CONFLICT(application,devEui) DO UPDATE SET state=excluded.state,latest=excluded.latest`)
    .run(row.application, row.devEui, JSON.stringify(result.state), JSON.stringify(!latest || row.timestamp >= latest.timestamp ? row : latest));
}
/** Evidence from the existing collector only; this never sends an acknowledgment. */
export function collectorAccepted(application: string, devEui: string, nonce: number, rawEnergy: number): void {
  const current = accumulatorState(application,devEui);
  if (current && nonce !== 0 && current.nonce === nonce && current.acceptedRaw === null) {
    current.acceptedRaw = rawEnergy;
    db.prepare('UPDATE manager_accumulators SET state=? WHERE application=? AND devEui=?').run(JSON.stringify(current),application,devEui);
  }
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
  return row ? { ...row, metadata: JSON.parse(row.metadata), accumulation: accumulatorState(application, devEui) } : null;
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
    if (!telemetry) { trimHistory(); return true; }
    const recent = Math.max(event.receivedAt, old?.lastUplink || 0) >= Date.now() - inactiveAfter;
    if (recent && (!old?.lastUplink || old.activity === 'inactive')) applicationEvent(event.application, event.devEui, 'active', 'Uplink observed after no recent activity');
    db.prepare('UPDATE manager_devices SET lastUplink=MAX(COALESCE(lastUplink,0),?),activity=? WHERE application=? AND devEui=?')
      .run(event.receivedAt, recent ? 'active' : 'inactive', event.application, event.devEui);
    db.prepare(`INSERT INTO manager_readings(id,application,devEui,timestamp,receivedAt,fPort,nonce,rawEnergy,energy,rawVoltage,voltage,signature,publicKey,verification,decoded)
      VALUES(@id,@application,@devEui,@timestamp,@receivedAt,@fPort,@nonce,@rawEnergy,@energy,@rawVoltage,@voltage,@signature,@publicKey,@verification,@decoded)`)
      .run({ id, application: event.application, devEui: event.devEui, timestamp: event.timestamp, receivedAt: event.receivedAt, fPort: event.fPort,
        nonce: telemetry.nonce, rawEnergy: telemetry.rawEnergy, energy: telemetry.energy, rawVoltage: telemetry.rawVoltage, voltage: telemetry.voltage,
        signature: telemetry.signature, publicKey: telemetry.publicKey, verification: telemetry.verification, decoded: JSON.stringify(telemetry) });
    account(db.prepare('SELECT * FROM manager_readings WHERE id=?').get(id));
    trimHistory();
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
  const row: any = db.prepare('SELECT latest FROM manager_accumulators WHERE application=? AND devEui=?').get(application, devEui);
  return row?.latest ? JSON.parse(row.latest) : null;
}
export function history(application: string, devEui: string, from: number, to: number, offset: number, limit: number) {
  const args = { application, devEui, from, to };
  const where = 'WHERE r.application=@application AND r.devEui=@devEui AND r.timestamp>=@from AND r.timestamp<=@to';
  const rows = db.prepare(`SELECT r.*,e.rawPayload,e.metadata FROM manager_readings r JOIN manager_events e ON e.id=r.id ${where}
    ORDER BY r.timestamp DESC,r.id DESC LIMIT @limit OFFSET @offset`).all({ ...args,limit,offset });
  const chart = db.prepare(`SELECT r.* FROM manager_readings r ${where} ORDER BY timestamp,id`).all(args);
  const summary: any = db.prepare(`SELECT COUNT(*) AS reports, COALESCE(SUM(intervalEnergy),0) AS observedConsumption,
    COALESCE(SUM(collectedEnergy),0) AS collectedEnergy,
    COALESCE(SUM(accounting='cycle-advanced'),0) AS resets,
    COALESCE(SUM(accounting IN ('nonce-reset-or-gap','counter-reset-uncertain','uncertain-cycle-ended','late-report','invalid-signature')),0) AS uncertainReports,
    COALESCE(SUM(accounting='repeated-total'),0) AS repeatedReports FROM manager_readings r ${where}`).get(args);
  return { rows, chart, total: summary.reports, offset, limit, summary, sampled: false, retentionLimit };
}
export function events(application: string, devEui: string, offset = 0): any[] {
  return db.prepare(`SELECT * FROM manager_events WHERE application=? AND (devEui=? OR devEui IS NULL)
    ORDER BY timestamp DESC,id DESC LIMIT 100 OFFSET ?`).all(application, devEui, offset);
}
export function getCommand(application: string, id: string): any {
  const row: any = db.prepare('SELECT * FROM manager_commands WHERE application=? AND id=?').get(application, id);
  return row ? { ...row, actor: 'manager operator', command: JSON.parse(row.command) } : null;
}
export function commandHistory(application: string, devEui: string, offset = 0): any[] {
  return (db.prepare('SELECT * FROM manager_commands WHERE application=? AND devEui=? ORDER BY timestamp DESC LIMIT 50 OFFSET ?').all(application, devEui, offset) as any[])
    .map(row => ({ ...row, actor: 'manager operator', command: JSON.parse(row.command) }));
}
export function insertCommand(application: string, devEui: string, id: string, command: unknown, fingerprint: string): void {
  db.prepare(`INSERT INTO manager_commands(id,application,devEui,timestamp,updatedAt,actor,command,fingerprint,status,queueId)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id, application, devEui, Date.now(), Date.now(), 'manager operator', JSON.stringify(command), fingerprint, 'enqueuing', id);
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
