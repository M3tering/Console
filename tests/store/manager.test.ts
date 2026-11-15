import { randomUUID, generateKeyPairSync, sign } from 'crypto';
import setupDatabase, { deleteDatabase, saveMeter } from '../../src/store/sqlite';
import * as store from '../../src/m3ter/store';
import { ingestEvent } from '../../src/m3ter/monitor';
const app = '11111111-1111-4111-8111-111111111111', a = '0102030405060708', b = '1112131415161718';
const originalEnv = process.env;
beforeEach(() => { process.env = { ...originalEnv, APPLICATION_ID: app }; setupDatabase('manager-test.db'); });
afterEach(() => { deleteDatabase('manager-test.db'); process.env = originalEnv; });
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
  expect(result.summary).toMatchObject({ observedConsumption:1.3, resets:1 });
  expect(result.chart.map((row:any) => row.segment)).toEqual([0,0,1,1]);
  expect(result.chart.map((row:any) => row.intervalEnergy)).toEqual([null,1,.1,.2]);
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
  expect(result.rows).toHaveLength(50); expect(result.total).toBe(901); expect(result.chart.length).toBeLessThanOrEqual(401);
  expect((result.summary as any).resets).toBe(2);
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
test('inactivity is an observation and late historical events do not make a meter active', () => {
  ingest(event(a,1,Date.now()-600000)); expect(store.deviceState(app,a).activity).toBe('inactive');
  ingest(event()); expect(store.deviceState(app,a).activity).toBe('active');
  store.markInactive(app,-1); expect(store.deviceState(app,a).activity).toBe('inactive');
  expect(store.events(app,a).find(row=>row.kind==='inactive').source).toBe('console observation');
});

test('acknowledgment cycles, high-water marks and range boundaries prevent double counting', () => {
  const time = Date.now()-20000;
  const reports = [[10,5],[10,6],[10,6],[11,8],[10,9],[11,7],[11,8],[11,9]];
  reports.forEach(([nonce,energy],index)=>ingest(event(a,energy*1e6,time+index*1000,randomUUID(),2,74,nonce)));
  const full = store.history(app,a,0,Date.now(),0,50);
  expect(full.chart.map((row:any)=>row.intervalEnergy)).toEqual([null,1,0,8,null,0,0,1]);
  expect(full.summary).toMatchObject({observedConsumption:10,resets:1,repeatedReports:2,uncertainReports:2});
  const ranged = store.history(app,a,time+2000,Date.now(),0,2);
  expect(ranged.summary.observedConsumption).toBe(9); // baseline comes from before the range
  expect(ranged.rows).toHaveLength(2);
  // A delayed report sorts into its source time and cannot create duplicate energy.
  ingest(event(a,5500000,time+500,randomUUID(),2,74,10));
  expect(store.history(app,a,0,Date.now(),0,50).summary.observedConsumption).toBe(10);
});
test('unexplained same-nonce decreases and nonce rollback are not fresh consumption', () => {
  const time=Date.now()-10000;
  [[8,2],[8,1],[8,2],[0,3],[1,4]].forEach(([nonce,energy],index)=>ingest(event(a,energy*1e6,time+index*1000,randomUUID(),2,74,nonce)));
  expect(store.history(app,a,0,Date.now(),0,50).summary).toMatchObject({observedConsumption:0,resets:0,uncertainReports:3});
});
