import type { StateDownlink } from '../services/downlink';
import { OperationJournal, Owner } from './operations';
import type { Decider, Outcome } from './processor';
import type { UplinkEvent } from './protocol';

export interface QueueItem { id:string; devEui:string; fPort:number; confirmed:boolean; bytes:number[] }
export interface ChirpstackQueue {
  list(devEui:string):Promise<QueueItem[]>;
  enqueue(decision:StateDownlink):Promise<string>;
}
export interface CoordinatorOptions {
  centralHealthy:()=>boolean;
  timeoutMs:number;
  reconcileSnapshot?:(owner:Owner,outcome:Outcome)=>Promise<void>;
}
function deadline<T>(promise:Promise<T>,ms:number):Promise<T> {
  return new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('Decision deadline elapsed.')),ms);
    promise.then(value=>{clearTimeout(timeout);resolve(value);},()=>{clearTimeout(timeout);reject(new Error('Decider unavailable.'));});
  });
}
const terminal = (state:string) => ['enqueued','queue-observed','superseded','rejected'].includes(state);

/** Only this component may enqueue a managed state reply. Network code never
 * retries enqueue. New reports revoke permission to send previous replies before
 * any asynchronous work, including a pending queue-read or central response. */
export class UplinkCoordinator {
  private tasks=new Map<string,Promise<void>>();
  private stopped=false;
  constructor(readonly journal:OperationJournal, private central:Decider,private local:Decider,
    private queue:ChirpstackQueue,private options:CoordinatorOptions) {}
  receive(gateway:string,event:UplinkEvent):Promise<void> {
    if(this.stopped)throw new Error('Coordinator is stopping.');
    const {operation}=this.journal.receive(gateway,event);
    return this.run(operation.id);
  }
  async drain():Promise<void> {for(const operation of this.journal.pending()){if(this.stopped)return;await this.run(operation.id);}}
  async stop():Promise<void>{this.stopped=true;await Promise.allSettled(this.tasks.values());}
  private run(id:string):Promise<void> {
    const existing=this.tasks.get(id);if(existing)return existing;
    const task=this.process(id).finally(()=>this.tasks.delete(id));this.tasks.set(id,task);return task;
  }
  private async process(id:string):Promise<void> {
    let row=this.journal.get(id)!;if(terminal(row.state))return;
    if(!row.owner) {
      // If an older computation is still in flight, changing deciders could
      // commit conflicting records for one nonce. Drop its reply, but reconcile
      // its billing snapshot before handing the newer report to another side.
      const prior=this.journal.previous(row);
      if(prior?.owner) {
        try {
          const outcome=await deadline(this.decider(prior.owner).outcome(prior.gateway,prior.id),this.options.timeoutMs);
          if(!outcome || outcome.active)return;
          if(this.options.reconcileSnapshot)await this.options.reconcileSnapshot(prior.owner,outcome);
        } catch {return;}
      }
      let chosen:Owner|null=null;
      for(const owner of this.options.centralHealthy()?['central','local'] as const:['local'] as const) {
        try {await deadline(this.decider(owner).offer(row.gateway,row.event),this.options.timeoutMs);chosen=owner;break;}
        catch {/* Offers never process billing, so pre-commit fallback is safe. */}
      }
      if(!chosen || !this.journal.own(id,chosen))return;
      row=this.journal.get(id)!;
      try {
        const outcome=await deadline(this.decider(chosen).commit(row.gateway,id),this.options.timeoutMs);
        if(this.journal.get(id)!.state==='superseded')return;
        if(this.options.reconcileSnapshot && !outcome.active)await this.options.reconcileSnapshot(chosen,outcome);
        if(outcome.decision)this.journal.saveDecision(id,outcome.decision);
        else {this.journal.uncertain(id);return;}
      } catch {this.journal.uncertain(id);return;}
    }
    await this.reconcile(id);
  }
  async reconcile(id:string):Promise<void> {
    let row=this.journal.get(id);if(!row||!row.owner||terminal(row.state))return;
    try {
      // Always query the committed owner by the SAME deduplicationId. Never call
      // commit again or ask the other Console to recompute an uncertain report.
      const outcome=await deadline(this.decider(row.owner).outcome(row.gateway,id),this.options.timeoutMs);
      if(!outcome || outcome.active || !outcome.decision){this.journal.uncertain(id);return;}
      if(this.options.reconcileSnapshot)await this.options.reconcileSnapshot(row.owner,outcome);
      if(!row.attempted)this.journal.saveDecision(id,outcome.decision);
      row=this.journal.get(id)!;if(terminal(row.state))return;
      const pending=await this.queue.list(row.devEui);
      row=this.journal.get(id)!;if(terminal(row.state))return;
      const decision=row.decision;
      if(!decision){this.journal.uncertain(id);return;}
      const matches=pending.filter(item=>item.devEui.toLowerCase()===row!.devEui && item.fPort===2 && !item.confirmed &&
        Buffer.from(item.bytes).equals(Buffer.from(decision.bytes)));
      if(row.attempted) {
        const observed=matches.find(item=>!row!.queueBefore.includes(item.id));
        if(observed)this.journal.finish(id,'queue-observed',observed.id);
        else this.journal.uncertain(id);
        // Empty queue may mean already delivered, not permission to retry.
        return;
      }
      if(matches.length){this.journal.uncertain(id);return;} // Cannot attribute a preexisting identical manual downlink.
      if(!this.journal.beginEnqueue(id,pending.map(item=>item.id)))return;
      try {
        const queueId=await this.queue.enqueue(decision);
        this.journal.finish(id,'enqueued',queueId);
      } catch {this.journal.uncertain(id);}
    } catch {this.journal.uncertain(id);}
  }
  private decider(owner:Owner):Decider{return owner==='central'?this.central:this.local;}
}
