import express from 'express';
import http from 'http';
import { once } from 'events';
import WebSocket from 'ws';
import { SqliteIdentityStore } from '../../src/central/identity-store';
import { CentralAuth } from '../../src/central/auth';
import { GatewayHub } from '../../src/central/hub';
import { SocketDecider, parseOperation } from '../../src/central/rpc';
import { DurableProcessor } from '../../src/central/processor';
import { LocalDecider, fallbackServer } from '../../src/central/local-channel';
import { protectBrowserSockets, registerSocket } from '../../src/services/socket-router';
import { hashPassword } from '../../src/central/secrets';
import type { UplinkEvent } from '../../src/central/protocol';

const report:UplinkEvent={deduplicationId:'wire-report',fPort:2,deviceInfo:{applicationId:'11111111-1111-4111-8111-111111111111',devEui:'0102030405060708'},data:Buffer.alloc(74).toString('base64')};
const start=async(server:http.Server)=>{await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));return `http://127.0.0.1:${(server.address() as import('net').AddressInfo).port}`;};
const close=async(server:http.Server)=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));};

async function fixture(){
  const store=new SqliteIdentityStore(':memory:');store.addUser('test',await hashPassword('test-only-password-long'));
  const cookie=`console_dev_session=${store.createSession(store.user('test')!.id)}`;
  const auth=new CentralAuth(store,{development:true,trustedProxies:[]});
  const compute=jest.fn(async(event,sink)=>sink({devEui:event.deviceInfo.devEui,fPort:2,confirmed:false,bytes:[1,0,0,0,0,0,0,0,0]}));
  const processor=new DurableProcessor(':memory:',compute);
  const hub=new GatewayHub(store,auth,()=>processor,true),app=express(),server=http.createServer(app);
  auth.mount(app,hub.machineRoutes);app.use(express.json());protectBrowserSockets(server,auth.authorize);hub.mount(app,server);
  const terminal=new WebSocket.Server({noServer:true});registerSocket(server,'/terminal',terminal);
  const base=await start(server);
  const g=store.createGateway('Fixture gateway','test'),token=store.enrollment(g.id,'test');
  const response=await fetch(base+'/api/agent/enroll',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});
  const enrolled=await response.json() as {gateway:string;credential:string};
  const sockets:WebSocket[]=[];
  const connect=async()=>{const ws=new WebSocket(base.replace('http:','ws:')+'/agent',{headers:{authorization:`Bearer ${enrolled.credential}`}});sockets.push(ws);await once(ws,'open');return ws;};
  return {store,cookie,processor,hub,compute,base,enrolled,token,connect,close:async()=>{
    for(const ws of sockets)ws.terminate();for(const ws of hub.sockets.values())ws.terminate();
    terminal.close();await close(server);processor.close();store.close();
  }};
}

test('authenticated outbound link returns the same stored decision by ChirpStack ID; health and revocation work',async()=>{
  const f=await fixture();let client:SocketDecider|undefined;
  try{
    const ws=await f.connect();client=new SocketDecider(()=>ws,500);
    ws.on('message',bytes=>{const frame=parseOperation(bytes.toString());if(frame.type==='operation-result')client!.receive(frame);});
    await client.offer(f.enrolled.gateway,report);const first=await client.commit(f.enrolled.gateway,report.deduplicationId!);
    expect(await client.outcome(f.enrolled.gateway,report.deduplicationId!)).toEqual(first);
    expect(await client.commit(f.enrolled.gateway,report.deduplicationId!)).toEqual(first);expect(f.compute).toHaveBeenCalledTimes(1);
    ws.send(JSON.stringify({v:1,type:'health',health:{version:'test',uptime:10,mqtt:'connected',fallback:false,queueDepth:1,uncertain:2,reconciled:1,superseded:1,updatesEnabled:false,lastError:'none'}}));
    // Ordered RPC response confirms that the preceding heartbeat was handled.
    await client.outcome(f.enrolled.gateway,report.deduplicationId!);
    const response=await fetch(f.base+'/api/gateways',{headers:{cookie:f.cookie}});const body=await response.text();
    expect(JSON.parse(body).gateways[0]).toMatchObject({online:true,health:{uncertain:2,reconciled:1,superseded:1,queueDepth:1}});
    expect(body).not.toContain(f.enrolled.credential);expect(body).not.toContain(f.token);
    const closed=once(ws,'close');
    const revoked=await fetch(`${f.base}/api/gateways/${f.enrolled.gateway}/revoke`,{method:'POST',headers:{cookie:f.cookie,origin:f.base}});
    expect(revoked.status).toBe(200);await closed;
    expect(f.store.authenticateAgent(f.enrolled.credential)).toBeNull();
  }finally{client?.disconnect();await f.close();}
});

test('central routes and socket upgrades refuse missing credentials and cross-site sessions',async()=>{
  const f=await fixture();
  try{
    for(const route of ['/api/gateways','/chirpstack/','/js/desktop.js','/healthz'])expect((await fetch(f.base+route)).status).toBe(401);
    expect((await fetch(f.base+'/api/gateways',{headers:{cookie:f.cookie,origin:'https://foreign.invalid'}})).status).toBe(403);
    for(const [endpoint,headers] of [
      ['/agent',{}],['/terminal',{origin:f.base}],['/terminal',{cookie:f.cookie,origin:'https://foreign.invalid'}],
    ] as const){
      const status=await new Promise<number>(resolve=>{
        const ws=new WebSocket(f.base.replace('http:','ws:')+endpoint,{headers});
        ws.on('unexpected-response',(request,response)=>{const code=response.statusCode!;response.resume();request.destroy();resolve(code);});
        ws.on('error',()=>{});ws.on('open',()=>{ws.terminate();resolve(101);});
      });expect(status).toBe(403);
    }
  }finally{await f.close();}
});

test('loopback fallback requires its own credential and returns persisted outcomes on repeated commits',async()=>{
  const compute=jest.fn(async(event,sink)=>sink({devEui:event.deviceInfo.devEui,fPort:2,confirmed:false,bytes:[1,0,0,0,0,0,0,0,0]}));
  const processor=new DurableProcessor(':memory:',compute),server=fallbackServer(processor,'test-local-secret','gateway');
  const base=await start(server),client=new LocalDecider(Number(new URL(base).port),'test-local-secret',500);
  try{
    expect((await fetch(base+'/operation',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status).toBe(401);
    await client.offer('gateway',report);const outcome=await client.commit('gateway',report.deduplicationId!);
    expect(await client.outcome('gateway',report.deduplicationId!)).toEqual(outcome);
    expect(await client.commit('gateway',report.deduplicationId!)).toEqual(outcome);expect(compute).toHaveBeenCalledTimes(1);
  }finally{await close(server);processor.close();}
});
