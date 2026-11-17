import type http from 'http';
import WebSocket from 'ws';
import type { Duplex } from 'stream';
import { registerSocket } from '../services/socket-router';
import { RateLimit } from '../central/auth';
import type { ConsoleRole } from '../central/config';
import { BrowserEngine } from './engine';

interface BrowserServiceOptions {
  role:ConsoleRole; executable?:string; testUnsandboxed?:boolean;
  gateway?:(request:http.IncomingMessage)=>string|null;
  owner?:(request:http.IncomingMessage)=>string;
  tunnel?:(gateway:string,host:string,port:number)=>Promise<Duplex>;
  audit?:(request:http.IncomingMessage,event:'browser-start'|'browser-end',gateway?:string)=>void;
}
export function attachBrowser(server:http.Server,options:BrowserServiceOptions):void{
  const wss=new WebSocket.Server({noServer:true,maxPayload:65536,perMessageDeflate:false});
  const engines=new Set<BrowserEngine>(),owners=new Set<string>();
  const starts=new RateLimit(12,60000);
  registerSocket(server,'/browser/live',wss);
  wss.on('connection',(ws,request)=>{
    const send=(message:Record<string,unknown>)=>{if(ws.readyState===WebSocket.OPEN&&ws.bufferedAmount<2*1024*1024)ws.send(JSON.stringify(message));};
    const gateway=options.gateway?.(request)||undefined,owner=options.owner?.(request);
    if(!starts.allow(owner||request.socket.remoteAddress||'local')||engines.size>=3||(owner&&owners.has(owner))){send({type:'error',message:'Browser session limit reached. Close another Browser window and retry.'});ws.close();return;}
    if(options.role==='central'&&!gateway){send({type:'error',message:'Select a gateway before opening Browser.'});ws.close();return;}
    const engine=new BrowserEngine({role:options.role,gateway,executable:options.executable||process.env.BROWSER_EXECUTABLE||'/usr/bin/chromium',
      tunnel:options.tunnel&&gateway?(host,port)=>options.tunnel!(gateway,host,port):undefined,testUnsandboxed:options.testUnsandboxed,emit:message=>{send(message);if(message.type==='closed')ws.close();}});
    engines.add(engine);if(owner)owners.add(owner);let audited=false;
    const limiter=new RateLimit(240,1000,1);let active=0;
    ws.on('message',data=>{
      if(!limiter.allow('input')||active>32){ws.close(1008,'Browser interaction limit');return;}
      try{const value:unknown=JSON.parse(data.toString());if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();
        active++;void engine.action(value as Record<string,unknown>).catch(()=>send({type:'notice',message:'Browser action unavailable.'})).finally(()=>active--);
      }catch{ws.close(1008,'Invalid browser interaction');}
    });
    const cleanup=()=>{engine.close();engines.delete(engine);if(owner)owners.delete(owner);if(audited){audited=false;options.audit?.(request,'browser-end',gateway);}};
    ws.once('close',cleanup);ws.on('error',cleanup);
    void engine.start().then(()=>{if(ws.readyState!==WebSocket.OPEN){cleanup();return;}audited=true;options.audit?.(request,'browser-start',gateway);})
      .catch(()=>{send({type:'error',message:'Browser engine not available. Install the optional browser image with Chromium and working sandbox support.'});cleanup();ws.close();});
  });
  server.once('close',()=>{for(const engine of engines)engine.close();for(const ws of wss.clients)ws.terminate();wss.close();});
}
