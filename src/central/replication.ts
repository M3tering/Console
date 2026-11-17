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
    for(const outcome of this.journal.replays(target)){
      const operation=this.journal.get(outcome.id);if(!operation)throw new Error('Reconciliation event is missing.');
      await decider.reconcile(operation.gateway,operation.event,outcome);
      this.journal.replayed(target,outcome.id);
    }
  }
  guarded(owner:Owner):Decider {
    const target=owner==='central'?this.central:this.local;
    return {offer:async(gateway,event)=>{await this.flush(owner);await target.offer(gateway,event);},
      commit:(gateway,id)=>target.commit(gateway,id),outcome:(gateway,id)=>target.outcome(gateway,id),reconcile:target.reconcile?.bind(target)};
  }
}
