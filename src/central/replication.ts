import { OperationJournal, Owner } from './operations';
import type { Decider, Outcome } from './processor';

/** Synchronize the receiving decider BEFORE it may accept another report. Failed
 * replication stays durable; it is not discarded when the reply was enqueued. */
export class Replication {
  constructor(private journal:OperationJournal,private central:Decider,private local:Decider) {}
  async observe(owner:Owner,outcome:Outcome):Promise<void> {
    const target=owner==='central'?'local':'central';
    this.journal.rememberReplay(target,outcome);
    try {await this.flush(target);} catch {/* durable backlog; the target cannot offer until it catches up */}
  }
  async flush(target:Owner):Promise<void> {
    const decider=target==='central'?this.central:this.local;
    if(!decider.reconcile)throw new Error('Decider does not support reconciliation.');
    for(const stored of this.journal.replays(target)){
      const operation=this.journal.get(stored.id);if(!operation)throw new Error('Reconciliation event is missing.');
      const outcome=target==='central'?await this.current(operation.gateway,stored):stored;
      await decider.reconcile(operation.gateway,operation.event,outcome);
      this.journal.replayed(target,outcome.id);
    }
  }
  /** The gateway's view of a decision it made, read at handover rather than when decided: by now it
   * can say which readings it already sent to the prover. The decision itself never changes. */
  private async current(gateway:string,stored:Outcome):Promise<Outcome>{
    try{
      const fresh=await this.local.outcome(gateway,stored.id);
      if(fresh&&fresh.id===stored.id&&!fresh.active&&fresh.snapshot)return {...stored,snapshot:fresh.snapshot};
    }catch{/* hand over what was stored */}
    return stored;
  }
  guarded(owner:Owner):Decider {
    const target=owner==='central'?this.central:this.local;
    return {offer:async(gateway,event)=>{
      // A decider must first learn the reports the other side decided; until then it cannot take new ones.
      try{await this.flush(owner);}
      catch(error){throw new Error(`replaying ${this.journal.replays(owner).length} report(s) decided elsewhere failed: ${error instanceof Error?error.message:String(error)}`);}
      await target.offer(gateway,event);},
      commit:(gateway,id)=>target.commit(gateway,id),outcome:(gateway,id)=>target.outcome(gateway,id),reconcile:target.reconcile?.bind(target)};
  }
}
