import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { once } from 'events';
import { WebSocketServer } from 'ws';
import Database from 'better-sqlite3';
import { connect } from 'mqtt';
import { runAgent } from '../../src/agent';
import { managedQueue } from '../../src/services/grpc';
import { fallbackServer } from '../../src/central/local-channel';
import { parseOperation, serveOperation } from '../../src/central/rpc';
import { DurableProcessor } from '../../src/central/processor';
import { writeOwnerSecret } from '../../src/central/secrets';
import type { UplinkEvent } from '../../src/central/protocol';

jest.mock('mqtt',()=>({connect:jest.fn(()=>{
  const {EventEmitter}=require('events');
  return Object.assign(new EventEmitter(),{
    subscribe:jest.fn((topic:string,_options:unknown,callback:(error:null,grants:unknown[])=>void)=>callback(null,[{topic,qos:1}])),
    endAsync:jest.fn(async()=>{}),stream:{destroy:jest.fn()},handleMessage:jest.fn(),
  });
})}));
jest.mock('../../src/services/grpc',()=>({managedQueue:{list:jest.fn(async()=>[]),enqueue:jest.fn(async()=> 'fixture-queue-id')}}));
const gateway='11111111-1111-4111-8111-111111111111',application='22222222-2222-4222-8222-222222222222';
const event:UplinkEvent={deduplicationId:'runtime-report',fPort:2,deviceInfo:{applicationId:application,devEui:'0102030405060708'},data:Buffer.alloc(74).toString('base64')};

test('agent persists before MQTT ack, filters ports, reconnects its own session and preserves deduplication across restart',async()=>{
  const environment={...process.env},directory=fs.mkdtempSync(path.join(os.tmpdir(),'agent-runtime-'));
  writeOwnerSecret(path.join(directory,'credential'),`${gateway}:${'a'.repeat(43)}`);writeOwnerSecret(path.join(directory,'fallback-secret'),'fixture-loopback-secret-not-for-production');
  const compute=jest.fn(async(report,sink)=>sink({devEui:report.deviceInfo.devEui,fPort:2,confirmed:false,bytes:[0,0,0,0,0,0,0,0,0]}));
  const processor=new DurableProcessor(':memory:',compute),fallback=fallbackServer(processor,'fixture-loopback-secret-not-for-production',gateway);
  await new Promise<void>(resolve=>fallback.listen(0,'127.0.0.1',resolve));
  const remote=new DurableProcessor(':memory:',async()=>{throw new Error('Central must not decide during recovery hysteresis');});
  const central=http.createServer(),wss=new WebSocketServer({server:central});
  wss.on('connection',socket=>socket.on('message',data=>{
    if(JSON.parse(data.toString()).type!=='operation')return;const message=parseOperation(data.toString());
    if(message.type==='operation')void serveOperation(remote,gateway,message).then(reply=>socket.send(JSON.stringify(reply)));
  }));await new Promise<void>(resolve=>central.listen(0,'127.0.0.1',resolve));
  Object.assign(process.env,{CONSOLE_ROLE:'gateway',CENTRAL_ALLOW_INSECURE_DEVELOPMENT:'true',CENTRAL_URL:`ws://127.0.0.1:${(central.address() as import('net').AddressInfo).port}`,
    APPLICATION_ID:application,MQTT_URL:'mqtt://fixture.invalid:1883',AGENT_CREDENTIAL_PATH:path.join(directory,'credential'),FALLBACK_SECRET_PATH:path.join(directory,'fallback-secret'),
    GATEWAY_FALLBACK_PORT:String((fallback.address() as import('net').AddressInfo).port),CENTRAL_DECISION_TIMEOUT_MS:'500'});
  let stop:undefined|(()=>Promise<void>);
  try{
    const connected=once(wss,'connection');stop=await runAgent();await connected;
    const client=jest.mocked(connect).mock.results.at(-1)!.value as ReturnType<typeof connect>;
    expect(connect).toHaveBeenLastCalledWith('mqtt://fixture.invalid:1883',expect.objectContaining({clientId:`m3tering-agent-${gateway}`,clean:false,resubscribe:false}));
    client.emit('connect',{});client.emit('reconnect');client.emit('connect',{});
    expect(client.subscribe).toHaveBeenCalledTimes(2);expect(client.subscribe).toHaveBeenLastCalledWith(`application/${application}/device/+/event/up`,{qos:1},expect.any(Function));
    const packet=(value:unknown)=>({cmd:'publish' as const,qos:1 as const,retain:false,dup:false,messageId:1,topic:`application/${application}/device/${event.deviceInfo.devEui}/event/up`,payload:Buffer.from(JSON.stringify(value))});
    const ignored=jest.fn();client.handleMessage(packet({...event,fPort:4}),ignored);expect(ignored).toHaveBeenCalledWith();expect(compute).not.toHaveBeenCalled();
    for(const malformed of [null,[],42,{fPort:2,deviceInfo:{devEui:42,applicationId:application}}]){const ack=jest.fn();client.handleMessage(packet(malformed),ack);expect(ack).toHaveBeenCalledWith();}
    expect(client.stream.destroy).not.toHaveBeenCalled();
    let acked=false;client.handleMessage(packet(event),error=>{
      expect(error).toBeUndefined();const db=new Database(path.join(directory,'operations.db'),{readonly:true});
      expect(db.prepare('SELECT id FROM agent_operations').get()).toEqual({id:event.deduplicationId});db.close();acked=true;
    });expect(acked).toBe(true);
    // Wait for local fixture RPC, never for a real broker or chain.
    for(let tries=0;tries<100&&!jest.mocked(managedQueue.enqueue).mock.calls.length;tries++)await new Promise(resolve=>setTimeout(resolve,5));
    expect(managedQueue.enqueue).toHaveBeenCalledTimes(1);expect(compute).toHaveBeenCalledTimes(1);
    await stop();stop=undefined;
    const reconnected=once(wss,'connection');stop=await runAgent();await reconnected;
    const restored=jest.mocked(connect).mock.results.at(-1)!.value as ReturnType<typeof connect>;
    restored.handleMessage(packet(event),error=>expect(error).toBeUndefined());
    await stop();stop=undefined;expect(managedQueue.enqueue).toHaveBeenCalledTimes(1);expect(compute).toHaveBeenCalledTimes(1);
  }finally{
    await stop?.();for(const client of wss.clients)client.terminate();wss.close();
    await new Promise<void>(resolve=>central.close(()=>resolve()));fallback.closeAllConnections();await new Promise<void>(resolve=>fallback.close(()=>resolve()));
    processor.close();remote.close();process.env=environment;fs.rmSync(directory,{recursive:true,force:true});
  }
});
