import type { Database } from 'better-sqlite3';
import type { ManagerEvent } from './store';
import { ElectricalState, ElectricalTelemetry, trackElectrical } from './electrical';
let db: Database, limit = 100;

export function initializeElectricalStore(connection: Database, retentionLimit: number): void {
  db = connection; limit = retentionLimit;
  db.exec(`CREATE TABLE IF NOT EXISTS manager_electrical_state (
    application TEXT NOT NULL, devEui TEXT NOT NULL, state TEXT NOT NULL, PRIMARY KEY(application,devEui));
    CREATE TABLE IF NOT EXISTS manager_electrical_readings (
    id INTEGER PRIMARY KEY, application TEXT NOT NULL, devEui TEXT NOT NULL,
    timestamp INTEGER NOT NULL, receivedAt INTEGER NOT NULL, decoded TEXT NOT NULL, tracking TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS manager_electrical_device_time ON manager_electrical_readings(application,devEui,timestamp DESC,id DESC);`);
  db.transaction(trim)();
}
function trim(): void {
  // Separate global cap using the SAME setting: FPort 4 cannot evict usage reports.
  db.prepare(`DELETE FROM manager_electrical_readings WHERE id IN (
    SELECT id FROM manager_events WHERE kind IN ('telemetry','telemetry-error') ORDER BY timestamp DESC,id DESC LIMIT -1 OFFSET ?)`).run(limit);
  db.prepare(`DELETE FROM manager_events WHERE kind IN ('telemetry','telemetry-error') AND id NOT IN (
    SELECT id FROM manager_events WHERE kind IN ('telemetry','telemetry-error') ORDER BY timestamp DESC,id DESC LIMIT ?)`).run(limit);
}
export function electricalState(application: string, devEui: string): ElectricalState | null {
  const row: any = db.prepare('SELECT state FROM manager_electrical_state WHERE application=? AND devEui=?').get(application, devEui);
  return row ? JSON.parse(row.state) : null;
}
export function recordElectrical(event: ManagerEvent, telemetry: ElectricalTelemetry | undefined, add: () => number | null): boolean {
  return db.transaction(() => {
    const previous = electricalState(event.application, event.devEui!);
    if (previous?.seen.includes(event.eventKey)) return false;
    const id = add(); if (id === null) return false;
    if (telemetry) {
      const state = trackElectrical(previous, { telemetry, timestamp: event.timestamp, receivedAt: event.receivedAt,
        rawPayload: event.rawPayload ?? null, metadata: event.metadata }, event.eventKey);
      const late = previous && event.timestamp <= previous.latest.timestamp;
      db.prepare(`INSERT INTO manager_electrical_readings(id,application,devEui,timestamp,receivedAt,decoded,tracking) VALUES(?,?,?,?,?,?,?)`)
        .run(id, event.application, event.devEui, event.timestamp, event.receivedAt, JSON.stringify(telemetry), JSON.stringify(late ? { status: 'late-frame', forward: null, reverse: null } : state.tracking));
      db.prepare(`INSERT INTO manager_electrical_state(application,devEui,state) VALUES(?,?,?)
        ON CONFLICT(application,devEui) DO UPDATE SET state=excluded.state`).run(event.application,event.devEui,JSON.stringify(state));
    }
    trim(); return true;
  })();
}
function request(application: string, devEui: string, ids: string[]): any {
  const row: any = db.prepare(`SELECT timestamp,status,command FROM manager_commands WHERE application=? AND devEui=?
    AND json_extract(command,'$.id') IN (${ids.map(() => '?').join(',')})
    ORDER BY timestamp DESC,rowid DESC LIMIT 1`).get(application,devEui,...ids);
  return row ? { ...row, command: JSON.parse(row.command), applied: false } : null;
}
export function electricalSnapshot(application: string, devEui: string, now = Date.now()) {
  const state = electricalState(application,devEui);
  const intervalRequest = request(application,devEui,['telemetry-interval']);
  const modeRequest = request(application,devEui,['telemetry-enable','telemetry-disable']);
  const immediateRequest = request(application,devEui,['telemetry-now']);
  const spacing = [...(state?.spacing || [])].sort((a,b) => a-b);
  const median = spacing.length ? spacing[Math.floor(spacing.length / 2)] : 60;
  const regular = spacing.length >= 3 && spacing.every(n => Math.abs(n-median) <= median * 0.2);
  const pendingInterval = intervalRequest && !['failed','cleared'].includes(intervalRequest.status) ? intervalRequest.command.value : null;
  const interval = regular ? median : pendingInterval || 60;
  const staleAfter = interval * 3 * 1000;
  const freshness = !state ? 'unavailable' : now - state.latest.timestamp > staleAfter ? 'stale' : 'fresh';
  let status = 'Unknown · no FPort 4 telemetry observed. It may be disabled or unsupported by this firmware.';
  if (state) status = 'Telemetry observed · periodic enable/disable state is unverified.';
  if (regular && freshness === 'fresh') status = 'Regular telemetry observed · periodic operation inferred, not acknowledged.';
  if (modeRequest && !['failed','cleared'].includes(modeRequest.status)) {
    if (modeRequest.command.id === 'telemetry-disable') status = 'Disable requested · application is unverified; silence alone is not confirmation.';
    else status = state && state.latest.receivedAt > modeRequest.timestamp ?
      'Enable requested · subsequent telemetry observed; periodic operation is not definitively confirmed.' : 'Enable requested · awaiting telemetry evidence.';
  }
  return { state: state ? { latest: state.latest, totals: state.totals, tracking: state.tracking, startedAt: state.startedAt } : null, freshness, status, expectedInterval: interval,
    staleAfter, intervalRequest, modeRequest, immediateRequest, retentionLimit: limit,
    intervalBasis: regular ? 'observed estimate' : pendingInterval ? 'requested interval; application unverified' : 'provisional firmware default; cadence unknown' };
}
export function electricalHistory(application: string, devEui: string, offset = 0) {
  const rows = db.prepare(`SELECT r.*,e.rawPayload,e.metadata,e.fPort FROM manager_electrical_readings r JOIN manager_events e ON e.id=r.id
    WHERE r.application=? AND r.devEui=? ORDER BY r.timestamp DESC,r.id DESC LIMIT 50 OFFSET ?`).all(application,devEui,offset) as any[];
  const count: any = db.prepare('SELECT COUNT(*) AS total FROM manager_electrical_readings WHERE application=? AND devEui=?').get(application,devEui);
  return { rows: rows.map(row => ({ ...row, decoded: JSON.parse(row.decoded), tracking: JSON.parse(row.tracking), metadata: JSON.parse(row.metadata) })), total: count.total, offset, limit: 50, retentionLimit: limit };
}
