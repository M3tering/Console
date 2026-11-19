import Database from 'better-sqlite3';
import type { DownlinkSink, StateDownlink } from '../services/downlink';
import type { MeterRecord, TransactionRecord } from '../types';
import type { UplinkEvent } from './protocol';
import { eventIdentity, eventFingerprint } from './operations';

/** Older gateways list readings they already sent to a prover at handover; accepted and ignored. */
export interface PublishedRecord { destination: string; tokenId: number; nonce: number; state: 'submitted' | 'uncertain' }
export interface BillingSnapshot { meter: MeterRecord | null; transactions: TransactionRecord[]; published?: PublishedRecord[] }
export interface Outcome {
  id: string; state: 'offered' | 'processing' | 'decided' | 'uncertain' | 'rejected';
  active: boolean; decision: StateDownlink | null; snapshot: BillingSnapshot | null;
}
export interface Decider {
  offer(gateway: string, event: UplinkEvent): Promise<void>;
  commit(gateway: string, id: string): Promise<Outcome>;
  outcome(gateway: string, id: string): Promise<Outcome | null>;
  reconcile?(gateway:string,event:UplinkEvent,outcome:Outcome):Promise<void>;
}
type ProcessorRow = { id:string; gateway:string; fingerprint:string; event:string; state:Outcome['state']; decision:string|null; snapshot:string|null };

/** Both central and fallback use this wrapper around the SAME billing handler.
 * Offer does no billing. A durable processing claim precedes the handler. Once
 * claimed, a missing result is never permission to recompute or change deciders. */
export class DurableProcessor implements Decider {
  private db: Database.Database;
  private active = new Map<string,Promise<Outcome>>();
  private devices = new Map<string,Promise<unknown>>();
  constructor(filename:string, private compute:(event:UplinkEvent,sink:DownlinkSink)=>Promise<void>,
    private snapshot:(event:UplinkEvent)=>BillingSnapshot = ()=>({meter:null,transactions:[]}),
    private importSnapshot?:(snapshot:BillingSnapshot)=>Promise<void>) {
    this.db=new Database(filename);
    this.db.pragma('journal_mode = WAL');this.db.pragma('synchronous = FULL');this.db.pragma('busy_timeout = 5000');
    this.db.exec(`CREATE TABLE IF NOT EXISTS managed_operations (id TEXT PRIMARY KEY, gateway TEXT NOT NULL,
      fingerprint TEXT NOT NULL,event TEXT NOT NULL,state TEXT NOT NULL,decision TEXT,snapshot TEXT);
      UPDATE managed_operations SET state='uncertain' WHERE state='processing';`);
  }
  async offer(gateway:string,event:UplinkEvent):Promise<void> {
    const id=eventIdentity(event),fingerprint=eventFingerprint(event);
    const row=this.row(id);
    if(row) {
      if(row.gateway!==gateway || row.fingerprint!==fingerprint) throw new Error('Event identity conflicts with an existing report.');
      return;
    }
    this.db.prepare("INSERT INTO managed_operations (id,gateway,fingerprint,event,state) VALUES (?,?,?,?,'offered')").run(id,gateway,fingerprint,JSON.stringify(event));
  }
  async commit(gateway:string,id:string):Promise<Outcome> {
    const row=this.authorized(gateway,id);
    const existing=this.active.get(id);if(existing)return existing;
    if(row.state!=='offered')return this.result(row);
    const event=JSON.parse(row.event) as UplinkEvent;
    // Serialize by device as well as event. A newer report can supersede the
    // reply, but cannot race an older handler's nonce/database updates.
    const device=`${gateway}:${event.deviceInfo.devEui.toLowerCase()}`;
    const previous=this.devices.get(device) || Promise.resolve();
    const task=previous.catch(()=>{}).then(async()=>{
      const claim=this.db.prepare("UPDATE managed_operations SET state='processing' WHERE id=? AND state='offered'").run(id);
      if(!claim.changes)return this.result(this.authorized(gateway,id));
      try {
        await this.compute(event,async decision=>{
          if(decision.devEui.toLowerCase()!==event.deviceInfo.devEui.toLowerCase())throw new Error('Decision belongs to a different device.');
          const updated=this.db.prepare("UPDATE managed_operations SET decision=?,state='decided' WHERE id=? AND state='processing' AND decision IS NULL")
            .run(JSON.stringify(decision),id);
          if(!updated.changes)throw new Error('An event may store only one decision.');
        });
      } catch {
        // The handler may already have committed billing data. No automatic rerun.
      } finally {
        this.db.prepare("UPDATE managed_operations SET state='uncertain' WHERE id=? AND state='processing'").run(id);
        const snapshot=this.snapshot(event);
        this.db.prepare('UPDATE managed_operations SET snapshot=? WHERE id=?').run(JSON.stringify(snapshot),id);
      }
      return this.result(this.authorized(gateway,id),false);
    });
    this.active.set(id,task);this.devices.set(device,task);
    try {return await task;} finally {this.active.delete(id);if(this.devices.get(device)===task)this.devices.delete(device);}
  }
  async outcome(gateway:string,id:string):Promise<Outcome|null> {
    const row=this.row(id);if(!row)return null;
    if(row.gateway!==gateway)throw new Error('Gateway cannot inspect this event.');
    const result=this.result(row);
    // After a process crash, return the durable billing state even if the last
    // result snapshot was never written. Do not run the decision handler again.
    if(!result.active && !result.snapshot && row.state!=='offered') result.snapshot=this.snapshot(JSON.parse(row.event) as UplinkEvent);
    return result;
  }
  async reconcile(gateway:string,event:UplinkEvent,outcome:Outcome):Promise<void> {
    if(eventIdentity(event)!==outcome.id || outcome.active)throw new Error('Invalid reconciliation identity or active operation.');
    if(outcome.decision && outcome.decision.devEui.toLowerCase()!==event.deviceInfo.devEui.toLowerCase())throw new Error('Reconciliation decision belongs to another device.');
    if(outcome.snapshot?.meter && outcome.snapshot.meter.devEui?.toLowerCase()!==event.deviceInfo.devEui.toLowerCase())throw new Error('Reconciliation meter belongs to another device.');
    await this.offer(gateway,event);
    const row=this.authorized(gateway,outcome.id);
    if(this.active.has(outcome.id))throw new Error('Cannot reconcile an active operation.');
    if(row.decision && JSON.stringify(JSON.parse(row.decision))!==JSON.stringify(outcome.decision))throw new Error('Conflicting stored decisions.');
    if(outcome.snapshot && this.importSnapshot)await this.importSnapshot(outcome.snapshot);
    if(row.state==='offered')this.db.prepare('UPDATE managed_operations SET state=?,decision=?,snapshot=? WHERE id=?')
      .run(outcome.state==='decided'?'decided':'uncertain',outcome.decision?JSON.stringify(outcome.decision):null,JSON.stringify(outcome.snapshot),outcome.id);
  }
  private row(id:string):ProcessorRow|undefined {return this.db.prepare('SELECT * FROM managed_operations WHERE id=?').get(id) as ProcessorRow|undefined;}
  private authorized(gateway:string,id:string):ProcessorRow {
    const row=this.row(id);if(!row||row.gateway!==gateway)throw new Error('An authorized offer is required before commit.');return row;
  }
  private result(row:ProcessorRow,active=this.active.has(row.id)):Outcome {
    return {id:row.id,state:row.state,active,decision:row.decision?JSON.parse(row.decision) as StateDownlink:null,snapshot:row.snapshot?JSON.parse(row.snapshot) as BillingSnapshot:null};
  }
  close():void {if(this.active.size)throw new Error('Cannot close a processor with active operations.');this.db.close();}
}
