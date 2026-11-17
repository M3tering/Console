import fs from 'fs';
import os from 'os';
import path from 'path';
import { OperationJournal } from '../../src/central/operations';
import { DurableProcessor, Decider } from '../../src/central/processor';
import { UplinkCoordinator, QueueItem } from '../../src/central/coordinator';
import type { DownlinkSink } from '../../src/services/downlink';
import type { UplinkEvent } from '../../src/central/protocol';

const gateway='gateway-test';
function event(id='event-1',device='0102030405060708'):UplinkEvent {
  const bytes=Buffer.alloc(74);bytes.writeUInt32BE(1);bytes.writeUInt32BE(1000000,4);
  return {deduplicationId:id,fPort:2,fCnt:Number(id.split('-').at(-1))||1,time:'2026-11-17T12:00:00Z',
    deviceInfo:{applicationId:'11111111-1111-4111-8111-111111111111',devEui:device},data:bytes.toString('base64')};
}
function setup(filename=':memory:') {
  const logs:unknown[]=[];
  const journal=new OperationJournal(filename,100,entry=>logs.push(entry));
  const compute=jest.fn(async (report:UplinkEvent,sink:DownlinkSink)=>{await sink({devEui:report.deviceInfo.devEui,fPort:2,confirmed:false,bytes:[1,0,0,0,0,0,0,0,0]});});
  const localCompute=jest.fn(compute.getMockImplementation()!);
  const central=new DurableProcessor(':memory:',compute), local=new DurableProcessor(':memory:',localCompute);
  const items:QueueItem[]=[];
  const queue={list:jest.fn(async()=>items.slice()),enqueue:jest.fn(async decision=>{const id=`queue-${items.length}`;items.push({...decision,id});return id;})};
  const coordinator=new UplinkCoordinator(journal,central,local,queue,{centralHealthy:()=>true,timeoutMs:20});
  return {journal,central,local,compute,localCompute,queue,items,logs,coordinator,close:()=>{journal.close();central.close();local.close();}};
}
test('central healthy: original deduplication ID produces one stored decision and one queue entry',async()=>{
  const f=setup();try {
    await f.coordinator.receive(gateway,event());
    expect(f.journal.get('event-1')).toMatchObject({owner:'central',state:'enqueued',attempted:true});
    expect(f.compute).toHaveBeenCalledTimes(1);expect(f.localCompute).not.toHaveBeenCalled();expect(f.queue.enqueue).toHaveBeenCalledTimes(1);
    expect(f.queue.list).toHaveBeenCalledTimes(1);
    const first=await f.central.outcome(gateway,'event-1');
    expect(await f.central.commit(gateway,'event-1')).toEqual(first);
    expect(f.compute).toHaveBeenCalledTimes(1);
  }finally{f.close();}
});
test('Console down before accept: local decides; restored central never reprocesses this ID',async()=>{
  const f=setup();try {
    jest.spyOn(f.central,'offer').mockRejectedValue(new Error('offline'));
    await f.coordinator.receive(gateway,event());
    expect(f.journal.get('event-1')).toMatchObject({owner:'local',state:'enqueued'});
    expect(f.localCompute).toHaveBeenCalledTimes(1);expect(f.compute).not.toHaveBeenCalled();
    await f.coordinator.receive(gateway,event());expect(f.queue.enqueue).toHaveBeenCalledTimes(1);
  }finally{f.close();}
});
test('response lost after enqueue: query stored outcome and queue; never retry an accepted reply',async()=>{
  const f=setup();try {
    f.queue.enqueue.mockImplementationOnce(async decision=>{f.items.push({...decision,id:'accepted-but-response-lost'});throw new Error('response lost');});
    const lookup=jest.spyOn(f.central,'outcome');
    await f.coordinator.receive(gateway,event());
    expect(f.journal.get('event-1')?.state).toBe('uncertain');
    await f.coordinator.reconcile('event-1');
    expect(lookup).toHaveBeenCalledWith(gateway,'event-1');expect(f.queue.list).toHaveBeenCalledTimes(2);
    expect(f.queue.enqueue).toHaveBeenCalledTimes(1);
    expect(f.journal.get('event-1')).toMatchObject({state:'queue-observed',queueId:'accepted-but-response-lost'});
    expect(f.journal.counts(gateway)).toMatchObject({uncertain:1,reconciled:1,pending:0});
    expect(JSON.stringify(f.logs)).not.toContain(event().data);
  }finally{f.close();}
});
test('empty queue after a lost response is not evidence of failed delivery and never creates OFF',async()=>{
  const f=setup();try {
    f.queue.enqueue.mockRejectedValueOnce(new Error('response lost after delivery'));
    await f.coordinator.receive(gateway,event());await f.coordinator.reconcile('event-1');await f.coordinator.reconcile('event-1');
    expect(f.queue.enqueue).toHaveBeenCalledTimes(1);expect(f.queue.enqueue.mock.calls[0][0].bytes[0]).toBe(1);
    expect(f.journal.get('event-1')?.state).toBe('uncertain');expect(f.localCompute).not.toHaveBeenCalled();
  }finally{f.close();}
});
test('duplicate MQTT delivery, including concurrent deliveries, cannot recompute or enqueue twice',async()=>{
  const f=setup();try {
    await Promise.all([f.coordinator.receive(gateway,event()),f.coordinator.receive(gateway,event()),f.coordinator.receive(gateway,event())]);
    expect(f.compute).toHaveBeenCalledTimes(1);expect(f.queue.enqueue).toHaveBeenCalledTimes(1);
    expect(()=>f.journal.receive('another-gateway',event())).toThrow('conflicts');
    expect(()=>f.journal.receive(gateway,{...event(),data:Buffer.alloc(74,1).toString('base64')})).toThrow('conflicts');
  }finally{f.close();}
});
test('uncertain report overtaken by next report is dropped and only the new reply can enqueue',async()=>{
  const f=setup();try {
    f.queue.list.mockRejectedValueOnce(new Error('queue unavailable'));
    await f.coordinator.receive(gateway,event());expect(f.journal.get('event-1')?.state).toBe('uncertain');
    await f.coordinator.receive(gateway,event('event-2'));
    await f.coordinator.reconcile('event-1');
    expect(f.journal.get('event-1')).toMatchObject({state:'superseded',attempted:false});
    expect(f.journal.get('event-2')?.state).toBe('enqueued');
    expect(f.queue.enqueue).toHaveBeenCalledTimes(1);expect(f.journal.counts(gateway).superseded).toBe(1);
  }finally{f.close();}
});
test('new report received during an old queue read prevents the old enqueue',async()=>{
  const f=setup();let release!:(queue:QueueItem[])=>void;
  try {
    f.queue.list.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
    const old=f.coordinator.receive(gateway,event());
    for(let i=0;i<20&&!release;i++)await Promise.resolve();
    expect(release).toBeDefined();
    await f.coordinator.receive(gateway,event('event-2'));release([]);await old;
    expect(f.journal.get('event-1')?.state).toBe('superseded');expect(f.queue.enqueue).toHaveBeenCalledTimes(1);
  }finally{f.close();}
});
test('lost Console decision response is recovered by ID; local never takes committed ownership',async()=>{
  const f=setup();try {
    const commit=f.central.commit.bind(f.central);
    jest.spyOn(f.central,'commit').mockImplementationOnce(async(g,id)=>{await commit(g,id);throw new Error('lost response');});
    await f.coordinator.receive(gateway,event());expect(f.journal.get('event-1')?.state).toBe('uncertain');
    await f.coordinator.reconcile('event-1');
    expect(f.journal.get('event-1')?.state).toBe('enqueued');expect(f.compute).toHaveBeenCalledTimes(1);expect(f.localCompute).not.toHaveBeenCalled();
  }finally{f.close();}
});
test('restart after enqueue started retains the at-most-once fence and counters',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agent-journal-'));const file=path.join(dir,'state.db');
  let f=setup(file);
  try {
    f.queue.enqueue.mockRejectedValueOnce(new Error('interrupted'));
    await f.coordinator.receive(gateway,event());f.journal.close();
    const journal=new OperationJournal(file);const second=new UplinkCoordinator(journal,f.central,f.local,f.queue,{centralHealthy:()=>true,timeoutMs:20});
    await second.receive(gateway,event());expect(f.queue.enqueue).toHaveBeenCalledTimes(1);expect(journal.counts(gateway).uncertain).toBe(1);
    journal.close();f.central.close();f.local.close();
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('both Consoles down buffers reports durably and processes latest reports per device on recovery',async()=>{
  const f=setup();try {
    const c=jest.spyOn(f.central,'offer').mockRejectedValue(new Error('offline'));
    const l=jest.spyOn(f.local,'offer').mockRejectedValue(new Error('offline'));
    await f.coordinator.receive(gateway,event());await f.coordinator.receive(gateway,event('event-2','0202030405060708'));
    expect(f.queue.enqueue).not.toHaveBeenCalled();expect(f.journal.pending()).toHaveLength(2);
    c.mockRestore();l.mockRestore();await f.coordinator.drain();
    expect(f.queue.enqueue).toHaveBeenCalledTimes(2);
    expect(f.queue.enqueue.mock.calls.map(([decision])=>decision.devEui)).toEqual(['0102030405060708','0202030405060708']);
  }finally{f.close();}
});
test('processor restart returns its stored decision and never reruns the billing handler',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'decider-ledger-')),file=path.join(dir,'state.db');
  const compute=jest.fn(async(report:UplinkEvent,sink:DownlinkSink)=>sink({devEui:report.deviceInfo.devEui,fPort:2,confirmed:false,bytes:[1,0,0,0,0,0,0,0,0]}));
  let processor=new DurableProcessor(file,compute);
  try {
    await processor.offer(gateway,event());const original=await processor.commit(gateway,'event-1');processor.close();
    processor=new DurableProcessor(file,compute);await processor.offer(gateway,event());
    expect(await processor.commit(gateway,'event-1')).toEqual(original);expect(compute).toHaveBeenCalledTimes(1);
  }finally{processor.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('several newer reports cannot bypass an older committed computation while its response is held',async()=>{
  const f=setup();let release!:()=>void;
  const waiting=new Promise<void>(resolve=>{release=resolve;});
  const implementation=f.compute.getMockImplementation()!;
  f.compute.mockImplementationOnce(async(report,sink)=>{await waiting;await implementation(report,sink);});
  try{
    const old=f.coordinator.receive(gateway,event());
    for(let i=0;i<20&&!f.compute.mock.calls.length;i++)await Promise.resolve();
    await f.coordinator.receive(gateway,event('event-2'));
    await f.coordinator.receive(gateway,event('event-3'));
    expect(f.compute).toHaveBeenCalledTimes(1);
    expect(f.queue.enqueue).not.toHaveBeenCalled();
    expect(f.journal.get('event-3')?.owner).toBeNull();
    release();await old;await f.coordinator.drain();
    expect(f.compute).toHaveBeenCalledTimes(2);
    expect(f.queue.enqueue).toHaveBeenCalledTimes(1);
    expect(f.journal.get('event-1')?.state).toBe('superseded');
    expect(f.journal.get('event-2')?.state).toBe('superseded');
    expect(f.journal.get('event-3')?.state).toBe('enqueued');
  }finally{release();await f.coordinator.stop();f.close();}
});

test('a committed slow Console cannot trigger fallback after the decision deadline',async()=>{
  jest.useFakeTimers();const f=setup();let release!:()=>void;
  const waiting=new Promise<void>(resolve=>{release=resolve;});const implementation=f.compute.getMockImplementation()!;
  f.compute.mockImplementationOnce(async(report,sink)=>{await waiting;await implementation(report,sink);});
  try{
    const pending=f.coordinator.receive(gateway,event());
    await jest.advanceTimersByTimeAsync(21);await pending;
    expect(f.journal.get('event-1')).toMatchObject({state:'uncertain',owner:'central'});
    expect(f.localCompute).not.toHaveBeenCalled();expect(f.queue.enqueue).not.toHaveBeenCalled();
    release();await jest.advanceTimersByTimeAsync(0);await f.coordinator.reconcile('event-1');
    expect(f.compute).toHaveBeenCalledTimes(1);expect(f.queue.enqueue).toHaveBeenCalledTimes(1);
    expect(f.journal.counts(gateway)).toMatchObject({uncertain:1,reconciled:1});
  }finally{release();await jest.advanceTimersByTimeAsync(0);f.close();jest.useRealTimers();}
});
