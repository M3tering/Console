import fs from 'fs';
import os from 'os';
import path from 'path';
import { DurableProcessor, BillingSnapshot } from '../../src/central/processor';
import { OperationJournal } from '../../src/central/operations';
import { PublicationStore } from '../../src/central/distribution';
import { Replication } from '../../src/central/replication';
import { UplinkCoordinator } from '../../src/central/coordinator';
import type { UplinkEvent } from '../../src/central/protocol';

const report:UplinkEvent={deduplicationId:'replay-1',fPort:2,deviceInfo:{devEui:'0102030405060708',applicationId:'11111111-1111-4111-8111-111111111111'},data:Buffer.alloc(74).toString('base64')};
const transaction={nonce:1,identifier:17,raw:Buffer.alloc(74).toString('hex'),receivedAt:1700000000};
const snapshot:BillingSnapshot={meter:{devEui:report.deviceInfo.devEui,publicKey:`0x${'a'.repeat(64)}`,tokenId:17,latestNonce:1},transactions:[transaction]};
const decision={devEui:report.deviceInfo.devEui,fPort:2 as const,confirmed:false as const,bytes:[1,0,0,0,0,0,0,0,0]};

test('fallback recovery replays stored outcomes idempotently without a second decision or publication',async()=>{
  const journal=new OperationJournal(':memory:');const publications=new PublicationStore(':memory:');
  const records=new Map<string,typeof transaction>();const publish=jest.fn(async()=>{});
  const importSnapshot=jest.fn(async(s:BillingSnapshot)=>{
    for(const t of s.transactions){const key=`${t.identifier}:${t.nonce}`;const prior=records.get(key);if(prior&&prior.raw!==t.raw)throw new Error('conflict');records.set(key,t);}
    await publications.publish('fake-arweave',s.transactions,publish);
  });
  const centralCompute=jest.fn(async()=>{}),localCompute=jest.fn(async(_event,sink)=>sink(decision));
  const central=new DurableProcessor(':memory:',centralCompute,()=>snapshot,importSnapshot);
  const local=new DurableProcessor(':memory:',localCompute,()=>snapshot);
  const reconcile=central.reconcile.bind(central);
  const unavailable=jest.spyOn(central,'reconcile').mockRejectedValue(new Error('offline'));
  let healthy=false;
  const replication=new Replication(journal,central,local);
  const queue={list:jest.fn(async()=>[]),enqueue:jest.fn(async()=>'queue-1')};
  const coordinator=new UplinkCoordinator(journal,replication.guarded('central'),replication.guarded('local'),queue,
    {centralHealthy:()=>healthy,timeoutMs:50,reconcileSnapshot:(owner,outcome)=>replication.observe(owner,outcome)});
  try{
    await coordinator.receive('gateway',report);
    expect(journal.get(report.deduplicationId!)?.owner).toBe('local');
    expect(journal.replays('central')).toHaveLength(1);
    expect(publish).not.toHaveBeenCalled();
    unavailable.mockRestore();healthy=true;
    await replication.flush('central');
    const stored=await local.outcome('gateway',report.deduplicationId!);
    await reconcile('gateway',report,stored!);await reconcile('gateway',report,stored!);
    await coordinator.receive('gateway',report);
    expect(await central.commit('gateway',report.deduplicationId!)).toEqual(stored);
    expect(records.size).toBe(1);expect(publish).toHaveBeenCalledTimes(1);
    expect(centralCompute).not.toHaveBeenCalled();expect(localCompute).toHaveBeenCalledTimes(1);expect(queue.enqueue).toHaveBeenCalledTimes(1);
  }finally{await coordinator.stop();journal.close();central.close();local.close();publications.close();}
});

test('unknown publication outcomes stay fenced across restart, independently for each destination',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'publication-test-')),file=path.join(dir,'state.db');
  let store=new PublicationStore(file);const send=jest.fn(async()=>{throw new Error('reply lost after remote accepted');});
  try{
    await expect(store.publish('streamr',[transaction],send)).rejects.toThrow('uncertain');
    store.close();store=new PublicationStore(file);
    expect(await store.publish('streamr',[transaction],send)).toBeNull();
    const prover=jest.fn(async()=>{});await store.publish('prover',[transaction],prover);await store.publish('prover',[transaction],prover);
    expect(send).toHaveBeenCalledTimes(1);expect(prover).toHaveBeenCalledTimes(1);
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('reconciliation cannot attach another device decision or meter snapshot to an event ID',async()=>{
  const processor=new DurableProcessor(':memory:',async()=>{});
  const outcome={id:report.deduplicationId!,state:'decided' as const,active:false,decision,snapshot};
  try{
    await expect(processor.reconcile('gateway',report,{...outcome,decision:{...decision,devEui:'9999999999999999'}})).rejects.toThrow('another device');
    await expect(processor.reconcile('gateway',report,{...outcome,snapshot:{...snapshot,meter:{...snapshot.meter!,devEui:'9999999999999999'}}})).rejects.toThrow('another device');
    expect(await processor.outcome('gateway',report.deduplicationId!)).toBeNull();
  }finally{processor.close();}
});

test('when central cannot take a report the agent logs why, including a failed replay of earlier decisions',async()=>{
  const journal=new OperationJournal(':memory:');
  const central=new DurableProcessor(':memory:',async()=>{},()=>snapshot,async()=>{});
  const local=new DurableProcessor(':memory:',async(_event,sink)=>sink(decision),()=>snapshot);
  jest.spyOn(central,'reconcile').mockRejectedValue(new Error('meter token does not match the contract'));
  let healthy=false;const messages:string[]=[];
  const replication=new Replication(journal,central,local);
  const queue={list:jest.fn(async()=>[]),enqueue:jest.fn(async()=>'queue-1')};
  const coordinator=new UplinkCoordinator(journal,replication.guarded('central'),replication.guarded('local'),queue,
    {centralHealthy:()=>healthy,timeoutMs:50,reconcileSnapshot:(owner,outcome)=>replication.observe(owner,outcome),log:message=>messages.push(message)});
  try{
    await coordinator.receive('gateway',report);
    expect(messages).toEqual([`Report ${report.deduplicationId}: central link is not ready (offline or connected under 15 s); this gateway decides`]);
    healthy=true;messages.length=0;
    await coordinator.receive('gateway',{...report,deduplicationId:'replay-2'});
    expect(messages).toEqual(['Report replay-2: central did not take it (Decider unavailable: replaying 1 report(s) decided elsewhere failed: meter token does not match the contract); this gateway decides']);
    expect(journal.get('replay-2')?.owner).toBe('local');
  }finally{await coordinator.stop();journal.close();central.close();local.close();}
});

test('after central sends a reply and then goes away, the gateway decides the next report; an unfinished one still waits',async()=>{
  const journal=new OperationJournal(':memory:');
  const decision2={...decision};
  const central={offer:jest.fn(async()=>{}),commit:jest.fn(async(_g:string,id:string)=>({id,state:'decided' as const,active:false,decision:decision2,snapshot:null})),
    outcome:jest.fn(async(_g:string,id:string)=>{if(down)throw new Error('central unreachable');return {id,state:'decided' as const,active:false,decision:decision2,snapshot:null};}),reconcile:jest.fn(async()=>{})};
  const local={offer:jest.fn(async()=>{}),commit:jest.fn(async(_g:string,id:string)=>({id,state:'decided' as const,active:false,decision:decision2,snapshot:null})),
    outcome:jest.fn(async(_g:string,id:string)=>({id,state:'decided' as const,active:false,decision:decision2,snapshot:null})),reconcile:jest.fn(async()=>{})};
  let healthy=true,down=false;
  const queue={list:jest.fn(async()=>[]),enqueue:jest.fn(async()=>`q-${queue.enqueue.mock.calls.length}`)};
  const coordinator=new UplinkCoordinator(journal,central,local,queue,{centralHealthy:()=>healthy,timeoutMs:50});
  const event=(id:string)=>({...report,deduplicationId:id});
  try{
    await coordinator.receive('gateway',event('a'));
    expect(journal.get('a')).toMatchObject({owner:'central',state:'enqueued'});
    healthy=false;down=true;central.outcome.mockClear();
    await coordinator.receive('gateway',event('b'));
    expect(journal.get('b')).toMatchObject({owner:'local',state:'enqueued'});
    expect(central.outcome).not.toHaveBeenCalled();
    // A prior report central owns but has not finished must still be asked about first.
    healthy=true;down=false;central.commit.mockRejectedValueOnce(new Error('lost reply'));
    await coordinator.receive('gateway',event('c'));
    expect(journal.get('c')?.state).toBe('uncertain');
    healthy=false;down=true;
    await coordinator.receive('gateway',event('d'));
    expect(central.outcome).toHaveBeenCalled();
    expect(journal.get('d')?.owner).toBeNull();
  }finally{await coordinator.stop();journal.close();}
});
