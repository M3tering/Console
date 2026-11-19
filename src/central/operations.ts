import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import type { StateDownlink } from '../services/downlink';
import type { Outcome } from './processor';
import { parseMessage, UplinkEvent } from './protocol';

export type Owner = 'central' | 'local';
export type OperationState = 'received' | 'owned' | 'decided' | 'enqueue-started' | 'uncertain' | 'enqueued' | 'queue-observed' | 'superseded' | 'rejected';
export interface Operation {
  id: string; gateway: string; devEui: string; event: UplinkEvent; owner: Owner | null;
  state: OperationState; decision: StateDownlink | null; attempted: boolean;
  queueBefore: string[]; queueId: string | null; sequence: number; uncertainCounted: boolean;
}
export interface GatewayCounts { uncertain: number; reconciled: number; superseded: number; pending: number }
export type OperationLog = (event: { gateway: string; id: string; state: OperationState; owner?: Owner | null }) => void;
type Row = Omit<Operation, 'event' | 'decision' | 'attempted' | 'queueBefore' | 'uncertainCounted'> & {
  event: string; decision: string | null; attempted: number; queueBefore: string; uncertainCounted: number;
};

export function eventIdentity(event: UplinkEvent): string {
  // No generated IDs: transport retries must carry the original ChirpStack ID.
  const id = event.deduplicationId;
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id) || /\s/.test(id)) throw new Error('A ChirpStack deduplicationId is required for managed billing.');
  parseMessage(JSON.stringify({ v:1, type:'uplink', id, event }), 'agent');
  return id;
}
export function eventFingerprint(event: UplinkEvent): string {
  // Gateway/radio metadata can vary on redelivery; signed report identity cannot.
  const { uplinkPayload } = require('../lib/uplink-payload') as typeof import('../lib/uplink-payload');
  return createHash('sha256').update(JSON.stringify([event.deviceInfo.applicationId.toLowerCase(), event.deviceInfo.devEui.toLowerCase(), event.fPort,
    event.fCnt ?? null, uplinkPayload(event).hex])).digest('hex');
}

/** Agent-side durable ownership and enqueue journal. Terminal entries are kept as
 * tombstones: deleting them would turn an old MQTT delivery into a new command.
 * Capacity is a hard bound, never an instruction to silently evict idempotency. */
export class OperationJournal {
  readonly db: Database.Database;
  constructor(filename: string, private capacity = 100000, private log: OperationLog = () => {}) {
    this.db = new Database(filename);
    this.db.pragma('journal_mode = WAL'); this.db.pragma('synchronous = FULL'); this.db.pragma('busy_timeout = 5000');
    this.db.exec(`CREATE TABLE IF NOT EXISTS agent_operations (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, gateway TEXT NOT NULL,
      devEui TEXT NOT NULL, fingerprint TEXT NOT NULL, event TEXT NOT NULL, owner TEXT, state TEXT NOT NULL,
      decision TEXT, attempted INTEGER NOT NULL DEFAULT 0, queueBefore TEXT NOT NULL DEFAULT '[]',
      queueId TEXT, uncertainCounted INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS agent_operations_device ON agent_operations(gateway,devEui,sequence);
      CREATE TABLE IF NOT EXISTS agent_counters (gateway TEXT PRIMARY KEY, uncertain INTEGER NOT NULL DEFAULT 0,
        reconciled INTEGER NOT NULL DEFAULT 0, superseded INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS agent_result_acks(id TEXT NOT NULL,outcome TEXT NOT NULL,PRIMARY KEY(id,outcome));
      CREATE TABLE IF NOT EXISTS agent_replays(id TEXT NOT NULL,target TEXT NOT NULL,outcome TEXT NOT NULL,
        PRIMARY KEY(id,target));`);
    // A process restart cannot turn a possibly delivered enqueue into a retry.
    const interrupted = this.db.prepare("SELECT id FROM agent_operations WHERE state IN ('owned','enqueue-started')").all() as Array<{ id: string }>;
    for (const row of interrupted) this.uncertain(row.id);
  }
  get(id: string): Operation | null {
    const row = this.db.prepare('SELECT * FROM agent_operations WHERE id=?').get(id) as Row | undefined;
    return row ? { ...row, event: JSON.parse(row.event) as UplinkEvent, decision: row.decision ? JSON.parse(row.decision) as StateDownlink : null,
      attempted: !!row.attempted, queueBefore: JSON.parse(row.queueBefore) as string[], uncertainCounted: !!row.uncertainCounted } : null;
  }
  receive(gateway: string, event: UplinkEvent): { operation: Operation; fresh: boolean } {
    const id = eventIdentity(event), fingerprint = eventFingerprint(event);
    return this.db.transaction(() => {
      const existing = this.db.prepare('SELECT fingerprint,gateway FROM agent_operations WHERE id=?').get(id) as { fingerprint: string; gateway: string } | undefined;
      if (existing) {
        if (existing.fingerprint !== fingerprint || existing.gateway !== gateway) throw new Error('Event identity conflicts with an existing report.');
        return { operation: this.get(id)!, fresh: false };
      }
      const count = this.db.prepare('SELECT COUNT(*) AS n FROM agent_operations').get() as { n: number };
      if (count.n >= this.capacity) throw new Error('Agent journal is full; retain idempotency records and stop ingestion.');
      this.db.prepare('INSERT OR IGNORE INTO agent_counters(gateway) VALUES (?)').run(gateway);
      const devEui = event.deviceInfo.devEui.toLowerCase();
      // The next distinct report cancels permission to send all older unsent replies.
      const supersededIds=this.db.prepare("SELECT id FROM agent_operations WHERE gateway=? AND devEui=? AND state IN ('received','owned','decided','enqueue-started','uncertain')").all(gateway,devEui) as Array<{id:string}>;
      const superseded = this.db.prepare(`UPDATE agent_operations SET state='superseded' WHERE gateway=? AND devEui=?
        AND state IN ('received','owned','decided','enqueue-started','uncertain')`).run(gateway, devEui).changes;
      if (superseded) this.db.prepare('UPDATE agent_counters SET superseded=superseded+? WHERE gateway=?').run(superseded,gateway);
      this.db.prepare("INSERT INTO agent_operations(id,gateway,devEui,fingerprint,event,state) VALUES (?,?,?,?,?,'received')")
        .run(id,gateway,devEui,fingerprint,JSON.stringify(event));
      for(const previous of supersededIds)this.emit(previous.id);
      return { operation: this.get(id)!, fresh: true };
    })();
  }
  own(id: string, owner: Owner): boolean {
    const changed = this.db.prepare("UPDATE agent_operations SET owner=?,state='owned' WHERE id=? AND state='received' AND owner IS NULL").run(owner,id).changes;
    if (changed) this.emit(id); return !!changed;
  }
  saveDecision(id: string, decision: StateDownlink): boolean {
    const row = this.get(id);
    if (!row || row.devEui !== decision.devEui.toLowerCase() || !row.owner || row.state === 'superseded' || row.attempted) return false;
    parseMessage(JSON.stringify({v:1,type:'decision',id,devEui:decision.devEui,fPort:decision.fPort,confirmed:decision.confirmed,data:Buffer.from(decision.bytes).toString('base64')}),'central');
    if (row.decision && JSON.stringify(row.decision) !== JSON.stringify(decision)) throw new Error('A committed event cannot acquire a different decision.');
    const changed = this.db.prepare("UPDATE agent_operations SET decision=?,state='decided' WHERE id=? AND state IN ('owned','uncertain','decided') AND attempted=0")
      .run(JSON.stringify(decision),id).changes;
    if (changed) this.emit(id); return !!changed;
  }
  beginEnqueue(id: string, queueBefore: string[]): boolean {
    const changed = this.db.prepare("UPDATE agent_operations SET attempted=1,state='enqueue-started',queueBefore=? WHERE id=? AND state='decided' AND attempted=0")
      .run(JSON.stringify(queueBefore),id).changes;
    if (changed) this.emit(id); return !!changed;
  }
  uncertain(id: string): void {
    const changed=this.db.transaction(() => {
      const row = this.get(id);
      if (!row || ['superseded','enqueued','queue-observed','rejected'].includes(row.state)) return false;
      if (!row.uncertainCounted) this.db.prepare('UPDATE agent_counters SET uncertain=uncertain+1 WHERE gateway=?').run(row.gateway);
      this.db.prepare("UPDATE agent_operations SET state='uncertain',uncertainCounted=1 WHERE id=?").run(id);
      return row.state!=='uncertain';
    })();
    if(changed)this.emit(id);
  }
  finish(id: string, state: 'enqueued' | 'queue-observed' | 'rejected', queueId?: string): void {
    this.db.transaction(() => {
      const row = this.get(id);
      if (!row || ['superseded','enqueued','queue-observed','rejected'].includes(row.state)) return;
      if (row.uncertainCounted && state !== 'rejected') this.db.prepare('UPDATE agent_counters SET reconciled=reconciled+1 WHERE gateway=?').run(row.gateway);
      this.db.prepare('UPDATE agent_operations SET state=?,queueId=? WHERE id=?').run(state,queueId ?? null,id);
    })(); this.emit(id);
  }
  results():Array<{id:string;outcome:'enqueued'|'uncertain'}>{
    return this.db.prepare(`SELECT o.id,CASE WHEN o.state='enqueued' THEN 'enqueued' ELSE 'uncertain' END AS outcome
      FROM agent_operations o WHERE o.attempted=1 AND o.state IN ('enqueued','queue-observed','uncertain','superseded')
      AND NOT EXISTS(SELECT 1 FROM agent_result_acks a WHERE a.id=o.id AND a.outcome=CASE WHEN o.state='enqueued' THEN 'enqueued' ELSE 'uncertain' END)
      ORDER BY o.sequence LIMIT 32`).all() as Array<{id:string;outcome:'enqueued'|'uncertain'}>;
  }
  acknowledgeResult(id:string,outcome:string):void{if(!['enqueued','uncertain'].includes(outcome)||!this.get(id)?.attempted)return;this.db.prepare('INSERT OR IGNORE INTO agent_result_acks VALUES (?,?)').run(id,outcome);}
  pending(): Operation[] {
    return (this.db.prepare("SELECT id FROM agent_operations WHERE state IN ('received','owned','decided','enqueue-started','uncertain') ORDER BY sequence").all() as Array<{id:string}>).map(row=>this.get(row.id)!);
  }
  previous(operation: Operation): Operation | null {
    const row = this.db.prepare('SELECT id FROM agent_operations WHERE gateway=? AND devEui=? AND sequence<? AND owner IS NOT NULL ORDER BY sequence DESC LIMIT 1')
      .get(operation.gateway,operation.devEui,operation.sequence) as {id:string} | undefined;
    return row ? this.get(row.id) : null;
  }
  counts(gateway: string): GatewayCounts {
    const row = this.db.prepare('SELECT uncertain,reconciled,superseded FROM agent_counters WHERE gateway=?').get(gateway) as Omit<GatewayCounts,'pending'> | undefined;
    const pending = this.db.prepare("SELECT COUNT(*) AS n FROM agent_operations WHERE gateway=? AND state IN ('owned','decided','enqueue-started','uncertain','received')").get(gateway) as {n:number};
    return {uncertain:0,reconciled:0,superseded:0,...row,pending:pending.n};
  }
  rememberReplay(target:Owner,outcome:Outcome):void {
    if(outcome.active||!outcome.snapshot)return;
    this.db.prepare('INSERT INTO agent_replays(id,target,outcome) VALUES (?,?,?) ON CONFLICT(id,target) DO UPDATE SET outcome=excluded.outcome')
      .run(outcome.id,target,JSON.stringify(outcome));
  }
  replays(target:Owner):Outcome[] {return (this.db.prepare('SELECT outcome FROM agent_replays WHERE target=? ORDER BY rowid').all(target) as Array<{outcome:string}>).map(row=>JSON.parse(row.outcome) as Outcome);}
  replayed(target:Owner,id:string):void {this.db.prepare('DELETE FROM agent_replays WHERE id=? AND target=?').run(id,target);}
  private emit(id: string): void { const row=this.get(id); if(row) this.log({gateway:row.gateway,id:row.id,state:row.state,owner:row.owner}); }
  close(): void { this.db.close(); }
}
