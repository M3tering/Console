import { randomUUID } from 'crypto';
import setupDatabase, { deleteDatabase } from '../../src/store/sqlite';
import * as store from '../../src/m3ter/store';
import { electricalHistory, electricalState, electricalSnapshot } from '../../src/m3ter/electrical-store';
import { decodeElectrical } from '../../src/m3ter/electrical';
import { ingestEvent } from '../../src/m3ter/monitor';
const frame=require('../fixtures/electrical.cjs');
const application='11111111-1111-4111-8111-111111111111', a='0102030405060708', b='1112131415161718';
const env=process.env;
beforeEach(()=>{process.env={...env,APPLICATION_ID:application};delete process.env.M3TER_TELEMETRY_LIMIT;setupDatabase('electrical-test.db');});
afterEach(()=>{deleteDatabase('electrical-test.db');process.env=env;jest.restoreAllMocks();});
function event(options:any={}) {
  return {deduplicationId:randomUUID(),time:new Date(Date.now()-1000).toISOString(),deviceInfo:{devEui:a,applicationId:application,deviceName:'Meter A'},
    fPort:4,fCnt:1,data:frame().toString('base64'),rxInfo:[{gatewayId:'gateway',rssi:-80,snr:8}],...options};
}
const ingest=(e:any)=>ingestEvent(`application/${application}/device/${e.deviceInfo.devEui}/event/up`,Buffer.from(JSON.stringify(e)));
test('both ports coexist, retain raw metadata, and unsupported ports are ignored',()=>{
  const usage=Buffer.alloc(74);usage.writeUInt32BE(1500000,4);usage.writeUInt16BE(2300,72);
  ingest(event({fPort:2,data:usage.toString('base64')}));const original=store.deviceState(application,a);
  const e=event();expect(ingest(e)).toBe(true);
  expect(store.latestReading(application,a)).toMatchObject({nonce:0,energy:1.5,voltage:230});
  expect(store.deviceState(application,a).lastUplink).toBe(original.lastUplink);
  const row=electricalHistory(application,a).rows[0];expect(row).toMatchObject({timestamp:Date.parse(e.time),rawPayload:e.data,fPort:4,metadata:{fCnt:1,deduplicationId:e.deduplicationId,rssi:-80,snr:8,applicationId:application}});
  expect(electricalState(application,a)?.latest.telemetry.voltage.a).toBe(230.12);
  for(const fPort of [3,5,200,201,202])expect(ingest(event({fPort}))).toBe(false);
});
test('deduplicates identifiers, frame counters and replay after eviction without advancing receipt time',()=>{
  process.env.M3TER_TELEMETRY_LIMIT='1';setupDatabase('electrical-test.db');
  const first=event();ingest(first);expect(ingest(first)).toBe(false);
  const second=event({deduplicationId:undefined,fCnt:2,time:new Date(Date.now()).toISOString()});ingest(second);expect(ingest({...second,rxInfo:[]})).toBe(false);
  expect(ingest(first)).toBe(false);expect(electricalHistory(application,a).total).toBe(1);
});
test('codec objects and raw Base64 fallback produce equivalent telemetry; invalid objects fall back safely',()=>{
  const t=decodeElectrical(frame());ingest(event({object:t}));
  expect(electricalState(application,a)?.latest.metadata.decodedSource).toBe('ChirpStack object');
  ingest(event({deviceInfo:{devEui:b,applicationId:application},object:{type:'report'}}));
  expect(electricalState(application,b)?.latest.telemetry).toEqual(t);
  expect(electricalState(application,b)?.latest.metadata.decodedSource).toBe('raw payload');
  const later=new Date(Date.now()).toISOString();ingest(event({time:later,data:undefined,object:t}));
  expect(electricalState(application,a)?.latest.rawPayload).toBeNull();
});
test('malformed version, length and missing time never replace valid monitoring state',()=>{
  ingest(event());const prior=electricalState(application,a)?.latest;
  for(const data of [frame({version:2}).toString('base64'),Buffer.alloc(96).toString('base64'),'ABC!'])ingest(event({data}));
  ingest(event({time:undefined}));expect(electricalState(application,a)?.latest).toEqual(prior);
  expect(store.events(application,a).filter(e=>e.kind==='telemetry-error')).toHaveLength(4);
});
test('separate global cap protects usage history and persistent baselines on restart and limit changes',()=>{
  process.env.M3TER_TELEMETRY_LIMIT='3';setupDatabase('electrical-test.db');
  const now=Date.now()-100000;
  ingest(event({fPort:2,data:Buffer.alloc(74).toString('base64'),time:new Date(now).toISOString()}));
  for(let i=0;i<6;i++)ingest(event({deviceInfo:{devEui:i%2?a:b,applicationId:application},fCnt:i,time:new Date(now+i*1000).toISOString(),data:frame({uptime:100+i,forward:100000+i*1000}).toString('base64')}));
  expect(electricalHistory(application,a).total+electricalHistory(application,b).total).toBe(3);
  expect(store.history(application,a,0,Date.now(),0,50).total).toBe(1);
  expect(electricalState(application,a)?.totals.forward.total).toBe(.04);
  process.env.M3TER_TELEMETRY_LIMIT='1';setupDatabase('electrical-test.db');
  expect(electricalHistory(application,a).total+electricalHistory(application,b).total).toBe(1);
  ingest(event({time:new Date(now+6000).toISOString(),data:frame({uptime:106,forward:106000}).toString('base64')}));
  expect(electricalState(application,a)?.totals.forward.total).toBe(.05);
  expect(store.accumulatorState(application,a)?.nonce).toBe(0);
});
test('default cap keeps newest 100 monitoring records globally including decode failures',()=>{
  const now=Date.now()-200000;
  for(let i=0;i<102;i++)ingest(event({deviceInfo:{devEui:i%2?a:b,applicationId:application},time:new Date(now+i*1000).toISOString(),fCnt:i}));
  expect(electricalHistory(application,a).total+electricalHistory(application,b).total).toBe(100);
  ingest(event({data:Buffer.alloc(2).toString('base64')}));
  expect(electricalHistory(application,a).total+electricalHistory(application,b).total).toBe(99);
  setupDatabase('electrical-test.db');expect(electricalHistory(application,a).total+electricalHistory(application,b).total).toBe(99);
});
test('restart allows re-used frame counters; delayed frames never replace latest state or inflate totals',()=>{
  const now=Date.now()-5000;
  const first=event({deduplicationId:undefined,fCnt:0,time:new Date(now).toISOString(),data:frame({uptime:100}).toString('base64')});ingest(first);
  ingest({...first,fCnt:1,time:new Date(now+1000).toISOString(),data:frame({uptime:101,forward:71368}).toString('base64')});
  ingest({...first,time:new Date(now+2000).toISOString(),data:frame({uptime:1,forward:0}).toString('base64')});
  expect(electricalState(application,a)).toMatchObject({session:1,totals:{forward:{total:.01}},tracking:{status:'restart'}});
  const latest=electricalState(application,a)?.latest;
  ingest(event({time:new Date(now+500).toISOString(),data:frame({forward:9999999}).toString('base64')}));
  expect(electricalState(application,a)?.latest).toEqual(latest);expect(electricalState(application,a)?.totals.forward.total).toBe(.01);
});
test('freshness uses measurement time, estimates cadence, and never claims applied settings from queue acceptance',()=>{
  const now=Date.now()-1000;ingest(event({time:new Date(now).toISOString()}));
  expect(electricalSnapshot(application,a,now+181000).freshness).toBe('stale');
  const id=randomUUID();store.insertCommand(application,a,id,{id:'telemetry-disable'},'disable');store.commandStatus(application,a,id,'queued','Accepted');
  expect(electricalSnapshot(application,a).status).toContain('application is unverified');
  for(let i=1;i<4;i++)ingest(event({time:new Date(now+i*60000).toISOString(),data:frame({uptime:86461+i*60}).toString('base64')}));
  expect(electricalSnapshot(application,a)).toMatchObject({expectedInterval:60,intervalBasis:'observed estimate'});
});
