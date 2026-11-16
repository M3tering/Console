import { randomUUID, generateKeyPairSync, sign } from 'crypto';
import setupDatabase, { deleteDatabase, saveMeter } from '../../src/store/sqlite';
import * as store from '../../src/m3ter/store';
import { ingestEvent } from '../../src/m3ter/monitor';
const app = '11111111-1111-4111-8111-111111111111', a = '0102030405060708', b = '1112131415161718';
const originalEnv = process.env;
beforeEach(() => { process.env = { ...originalEnv, APPLICATION_ID: app }; delete process.env.M3TER_TELEMETRY_LIMIT; setupDatabase('manager-test.db'); });
afterEach(() => { jest.restoreAllMocks(); deleteDatabase('manager-test.db'); process.env = originalEnv; });
function event(devEui = a, energy = 1000000, time = Date.now(), id = randomUUID(), port = 2, length = 74, nonce = 0) {
  const bytes = Buffer.alloc(length); if (length >= 74) { bytes.writeUInt32BE(nonce,0); bytes.writeUInt32BE(energy,4); bytes.writeUInt16BE(2300,72); }
  const topic = `application/${app}/device/${devEui}/event/up`;
  return { topic, body: { deduplicationId: id, time: new Date(time).toISOString(), deviceInfo: { devEui, applicationId: app }, fPort: port, data: bytes.toString('base64') } };
}
const ingest = (e: ReturnType<typeof event>) => ingestEvent(e.topic, Buffer.from(JSON.stringify(e.body)));
test('routes multiple devices correctly and deduplicates events, not equal readings', () => {
  const first = event(); expect(ingest(first)).toBe(true); expect(ingest(first)).toBe(false);
  ingest(event(a)); ingest(event(b,2000000));
  expect(store.history(app,a,0,Date.now()+1000,0,50).total).toBe(2);
  expect(store.latestReading(app,b).energy).toBe(2);
  expect(store.history('another-application',a,0,Date.now()+1000,0,50).total).toBe(0);
});
test('history survives reopening and timestamps/raw payload remain intact', () => {
  const first = event(a,1234567,Date.now()-60000); ingest(first); setupDatabase('manager-test.db');
  const history = store.history(app,a,0,Date.now()+1000,0,50);
  expect(history.rows[0]).toMatchObject({ timestamp: Date.parse(first.body.time), rawPayload:first.body.data, energy:1.234567, fPort:2 });
});
test('new nonce cycles count their own accumulator while repeats add zero', () => {
  const time = Date.now()-10000; [1,2,.1,.3].forEach((energy,index) => ingest(event(a,energy*1000000,time+index*1000,randomUUID(),2,74,index<2?7:8)));
  const result = store.history(app,a,0,Date.now(),0,50);
  expect(result.summary).toMatchObject({ observedConsumption:2, resets:1 });
  expect(result.chart.map((row:any) => row.segment)).toEqual([0,0,1,1]);
  expect(result.chart.map((row:any) => row.intervalEnergy)).toEqual([null,null,2,null]);
});
test('malformed lengths, FPorts and identity mismatches do not create readings', () => {
  ingest(event(a,1,Date.now(),randomUUID(),2,73)); ingest(event(a,1,Date.now(),randomUUID(),3));
  const mismatch = event(); mismatch.body.deviceInfo.devEui = b; expect(ingest(mismatch)).toBe(false);
  expect(ingestEvent(event().topic,Buffer.from('{'))).toBe(false);
  expect(store.latestReading(app,a)).toBeNull(); expect(store.latestReading(app,b)).toBeNull();
  expect(store.events(app,a).filter(row => row.kind === 'decode-error')).toHaveLength(2);
});
test('delivery events correlate by device and queue ID, never by selected meter or transmission alone', () => {
  const id = randomUUID(); store.insertCommand(app,a,id,{name:'Relay ON'},'fingerprint');
  const topic = `application/${app}/device/${a}/event/txack`;
  const data:any = { deviceInfo:{devEui:a,applicationId:app}, queueItemId:id, time:new Date().toISOString() };
  ingestEvent(topic,Buffer.from(JSON.stringify(data)));
  expect(store.getCommand(app,id).status).toBe('transmitted');
  store.commandStatus(app,a,id,'queued','Late HTTP response'); expect(store.getCommand(app,id).status).toBe('transmitted');
  data.deviceInfo.devEui = b; data.acknowledged = true;
  ingestEvent(topic.replace(a,b).replace('txack','ack'),Buffer.from(JSON.stringify(data))); expect(store.getCommand(app,id).status).toBe('transmitted');
  data.deviceInfo.devEui = a; ingestEvent(topic.replace('txack','ack'),Buffer.from(JSON.stringify(data))); expect(store.getCommand(app,id).status).toBe('delivered');
});
test('pagination and sampled charts stay bounded and preserve reset segments', () => {
  const start = Date.now()-1000000;
  for (let index=0;index<901;index++) ingest(event(a,(index%450)*1000,start+index*1000,randomUUID(),2,74,Math.floor(index/450)));
  const result = store.history(app,a,0,Date.now(),50,50);
  expect(result.rows).toHaveLength(50); expect(result.total).toBe(100); expect(result.chart.length).toBeLessThanOrEqual(401);
  expect((result.summary as any).resets).toBe(1);
});
test('normal uplinks reuse an existing console key without requiring another bootstrap', () => {
  const keys = generateKeyPairSync('ed25519'), key = keys.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('hex');
  saveMeter({devEui:a,publicKey:'0x'+key,tokenId:42,latestNonce:0});
  const input = event(), bytes = Buffer.from(input.body.data,'base64');
  sign(null,bytes.subarray(0,8),keys.privateKey).copy(bytes,8); input.body.data = bytes.toString('base64'); ingest(input);
  expect(store.latestReading(app,a)).toMatchObject({verification:'verified',publicKey:null});
  expect(store.deviceState(app,a).publicKey).toBe(key);
});
test('location comes from valid device events and older locations cannot overwrite newer ones', () => {
  const publish = (latitude:number, timestamp:number) => ingestEvent(`application/${app}/device/${a}/event/location`,Buffer.from(JSON.stringify({
    time:new Date(timestamp).toISOString(),deduplicationId:randomUUID(),deviceInfo:{devEui:a,applicationId:app},location:{latitude,longitude:10},
  })));
  publish(91,Date.now()); expect(store.deviceState(app,a).metadata.location).toBeUndefined();
  publish(51,Date.now()); publish(21,Date.now()-10000);
  expect(store.deviceState(app,a).metadata.location).toEqual({latitude:51,longitude:10});
});
test('activity follows actual reception; inactivity does not change the last receipt', () => {
  ingest(event(a,1,Date.now()-600000)); expect(store.deviceState(app,a).activity).toBe('active');
  ingest(event()); expect(store.deviceState(app,a).activity).toBe('active');
  const last=store.deviceState(app,a).lastUplink;
  store.markInactive(app,-1); expect(store.deviceState(app,a).activity).toBe('inactive');
  expect(store.deviceState(app,a).lastUplink).toBe(last);
  expect(store.events(app,a).find(row=>row.kind==='inactive').source).toBe('console observation');
});

test('receipt time survives refresh/restart and ignores duplicates, connection events, and invalid payloads', () => {
  const now=Date.now(), clock=jest.spyOn(Date,'now').mockReturnValue(now);
  const input=event(a,1000000,now+60000); ingest(input);
  expect(store.deviceState(app,a).lastUplink).toBe(now);
  clock.mockReturnValue(now+120000);
  ingest(input); ingest(event(a,1,now+120000,randomUUID(),2,73));
  const monitor=require('../../src/m3ter/monitor'); monitor.connectionState('reconnecting'); store.markInactive(app,1);
  expect(store.deviceState(app,a).lastUplink).toBe(now);
  setupDatabase('manager-test.db'); expect(store.deviceState(app,a).lastUplink).toBe(now);
  ingest(event(a,2000000,now-100000)); expect(store.deviceState(app,a).lastUplink).toBe(now+120000);
});

test('custom global retention is enforced on insertion and restart while nonce state survives', () => {
  process.env.M3TER_TELEMETRY_LIMIT='3'; setupDatabase('manager-test.db');
  const now=Date.now()-10000;
  ingest(event(a,2000000,now,randomUUID(),2,74,1)); store.collectorAccepted(app,a,1,1500000);
  for(let i=1;i<=4;i++) ingest(event(b,i*100,now+i*1000));
  expect(store.history(app,a,0,Date.now(),0,100).total).toBe(0);
  expect(store.history(app,b,0,Date.now(),0,100).rows.map((r:any)=>r.rawEnergy)).toEqual([400,300,200]);
  process.env.M3TER_TELEMETRY_LIMIT='1'; setupDatabase('manager-test.db');
  expect(store.history(app,b,0,Date.now(),0,100)).toMatchObject({total:1,retentionLimit:1});
  ingest(event(a,100000,now+6000,randomUUID(),2,74,2));
  expect(store.history(app,a,0,Date.now(),0,100).summary).toMatchObject({observedConsumption:2,collectedEnergy:1.5});
  expect(store.history(app,b,0,Date.now(),0,100).total).toBe(0);
  process.env.M3TER_TELEMETRY_LIMIT='0'; setupDatabase('manager-test.db');
  expect(store.history(app,a,0,Date.now(),0,100)).toMatchObject({total:1,retentionLimit:100});
});

test('configured retention can exceed 100, retaining the newest source records across meters', () => {
  process.env.M3TER_TELEMETRY_LIMIT='120'; setupDatabase('manager-test.db');
  const now=Date.now()-200000;
  for(let i=0;i<125;i++) ingest(event(i%2?a:b,i*100,now+i*1000));
  const rows=[...store.history(app,a,0,Date.now(),0,100).rows,...store.history(app,b,0,Date.now(),0,100).rows] as any[];
  expect(rows).toHaveLength(120);expect(Math.min(...rows.map(r=>r.rawEnergy))).toBe(500);
  setupDatabase('manager-test.db');expect(store.history(app,a,0,Date.now(),0,100).total+store.history(app,b,0,Date.now(),0,100).total).toBe(120);
});

test('receipt migration replaces old source clocks without touching readings', () => {
  const now=Date.now(), clock=jest.spyOn(Date,'now').mockReturnValue(now);
  ingest(event(a,1000000,now+60000));
  const Database=require('better-sqlite3'), connection=new Database('./.data/manager-test.db');
  connection.prepare('UPDATE manager_devices SET lastUplink=?').run(now+60000);
  connection.exec('DELETE FROM manager_schema WHERE version=2');connection.close();
  clock.mockReturnValue(now+300000);setupDatabase('manager-test.db');
  expect(store.deviceState(app,a).lastUplink).toBe(now);
  expect(store.latestReading(app,a).timestamp).toBe(now+60000);
});

test('hex telemetry decodes identically and raw transport survives persistence', () => {
  const input:any=event(a,1234567); const hex=Buffer.from(input.body.data,'base64').toString('hex').toUpperCase();
  delete input.body.data; input.body.dataHex=hex; expect(ingest(input)).toBe(true);
  expect(store.latestReading(app,a)).toMatchObject({energy:1.234567,voltage:230,nonce:0});
  const row:any=store.history(app,a,0,Date.now()+1000,0,50).rows[0];
  expect(row.rawPayload).toBe(hex); expect(JSON.parse(row.metadata)).toMatchObject({payloadHex:hex,payloadEncoding:'hex',payloadField:'dataHex'});
  setupDatabase('manager-test.db'); expect(store.latestReading(app,a).energy).toBe(1.234567);
  input.body.deduplicationId=randomUUID();input.body.dataHex='00GG';ingest(input);
  expect(store.events(app,a).find(r=>r.rawPayload==='00GG').message).toContain('Invalid hex');
});

test('acknowledgment cycles, high-water marks and range boundaries prevent double counting', () => {
  const time = Date.now()-20000;
  const reports = [[10,5],[10,6],[10,6],[11,8],[10,9],[11,7],[11,8],[11,9]];
  reports.forEach(([nonce,energy],index)=>ingest(event(a,energy*1e6,time+index*1000,randomUUID(),2,74,nonce)));
  const full = store.history(app,a,0,Date.now(),0,50);
  expect(full.chart.map((row:any)=>row.intervalEnergy)).toEqual([null,null,null,6,null,null,null,null]);
  expect(full.summary).toMatchObject({observedConsumption:6,resets:1,repeatedReports:1,uncertainReports:2});
  const ranged = store.history(app,a,time+2000,Date.now(),0,2);
  expect(ranged.summary.observedConsumption).toBe(6); // baseline comes from before the range
  expect(ranged.rows).toHaveLength(2);
  // A delayed report sorts into its source time and cannot create duplicate energy.
  ingest(event(a,5500000,time+500,randomUUID(),2,74,10));
  expect(store.history(app,a,0,Date.now(),0,50).summary.observedConsumption).toBe(6);
});
test('unexplained same-nonce decreases and nonce rollback are not fresh consumption', () => {
  const time=Date.now()-10000;
  [[8,2],[8,1],[8,2],[0,3],[1,4]].forEach(([nonce,energy],index)=>ingest(event(a,energy*1e6,time+index*1000,randomUUID(),2,74,nonce)));
  expect(store.history(app,a,0,Date.now(),0,50).summary).toMatchObject({observedConsumption:0,resets:0,uncertainReports:3});
});

test('nonce zero snapshots remain pending; only advance closes the previous observed cycle', () => {
  const time=Date.now()-10000;
  [1,1.5,2].forEach((energy,i)=>ingest(event(a,energy*1e6,time+i*1000)));
  expect(store.history(app,a,0,Date.now(),0,100).summary.observedConsumption).toBe(0);
  expect(store.accumulatorState(app,a)).toMatchObject({nonce:0,highWater:2000000});
  setupDatabase('manager-test.db');
  ingest(event(a,100000,time+4000,randomUUID(),2,74,1));
  expect(store.history(app,a,0,Date.now(),0,100).summary).toMatchObject({observedConsumption:2,collectedEnergy:0});
});
test('100 telemetry records globally, persistent state and collector evidence survive eviction', () => {
  const time=Date.now()-1000000;
  ingest(event(a,2000000,time,randomUUID(),2,74,1));
  store.collectorAccepted(app,a,1,1500000);
  const commandId=randomUUID();store.insertCommand(app,a,commandId,{name:'Relay ON'},'preserve-history');
  store.applicationEvent(app,a,'command-queued','Preserve this command activity');
  for(let i=1;i<101;i++) ingest(event(b,i*100,time+i*1000));
  expect(store.history(app,a,0,Date.now(),0,100).total).toBe(0);
  expect(store.history(app,b,0,Date.now(),0,100).total).toBe(100);
  expect(store.latestReading(app,a).energy).toBe(2);
  expect(store.getCommand(app,commandId)).toMatchObject({fingerprint:'preserve-history',actor:'manager operator'});
  expect(store.events(app,a).some(row=>row.message==='Preserve this command activity')).toBe(true);
  setupDatabase('manager-test.db');
  ingest(event(a,100000,time+102000,randomUUID(),2,74,2));
  expect(store.history(app,a,0,Date.now(),0,100).summary).toMatchObject({observedConsumption:2,collectedEnergy:1.5});
  expect(store.history(app,b,0,Date.now(),0,100).total).toBe(99);
  const delayed=event(a,9000000,time+500,randomUUID(),2,74,1);ingest(delayed);ingest(delayed);
  expect(store.accumulatorState(app,a)).toMatchObject({nonce:2,highWater:100000,completedObserved:2});
  expect(store.history(app,a,0,Date.now(),0,100).total+store.history(app,b,0,Date.now(),0,100).total).toBe(100);
});

test('startup migration trims legacy rows, reconstructs cycle state and preserves Console tables',()=>{
  const Database=require('better-sqlite3');const connection=new Database('./.data/manager-test.db');
  const time=Date.now()-200000;
  connection.prepare('INSERT INTO meters(publicKey,devEui,tokenId,latestNonce) VALUES(?,?,?,?)').run('preserve-console',b,7,4);
  for(let i=0;i<120;i++){
    const id=connection.prepare(`INSERT INTO manager_events(application,devEui,timestamp,receivedAt,kind,source,eventKey,rawPayload,fPort,metadata,message) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(app,a,time+i*1000,time+i*1000,'up','ChirpStack','legacy-'+i,'AAAA',2,'{}','legacy').lastInsertRowid;
    connection.prepare(`INSERT INTO manager_readings(id,application,devEui,timestamp,receivedAt,fPort,nonce,rawEnergy,energy,rawVoltage,voltage,signature,verification,decoded) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,app,a,time+i*1000,time+i*1000,2,0,i*1000,i/1000,2300,230,'','unverified','{}');
  }
  connection.exec('DELETE FROM manager_schema; DELETE FROM manager_accumulators;');connection.close();
  setupDatabase('manager-test.db');
  expect(store.history(app,a,0,Date.now(),0,100).total).toBe(100);
  expect(store.accumulatorState(app,a)).toMatchObject({nonce:0,highWater:119000,completedObserved:0});
  const check=new Database('./.data/manager-test.db');
  expect(check.prepare('SELECT COUNT(*) AS n FROM manager_events WHERE kind=\'up\'').get().n).toBe(100);
  expect(check.prepare('SELECT latestNonce FROM meters WHERE publicKey=?').get('preserve-console').latestNonce).toBe(4);check.close();
});
