import type http from 'http';
import express, { Express } from 'express';
import WebSocket from 'ws';
import { registerSocket } from '../services/socket-router';
import { CentralAuth, RateLimit } from './auth';
import type { IdentityStore } from './identity-store';
import { parseMessage, MAX_MESSAGE_BYTES } from './protocol';
import { parseOperation, serveOperation } from './rpc';
import type { Decider } from './processor';
import { TunnelMux, GatewayStream } from './tunnels';
import type { Duplex } from 'stream';
import type { TunnelPurpose } from './protocol';

export class GatewayHub {
  readonly sockets=new Map<string,WebSocket>();
  private tunnels=new Map<string,TunnelMux>();
  private connections=new WeakMap<http.IncomingMessage,string>();
  private enrollmentLimit=new RateLimit(5,60000);
  private upgradeLimit=new RateLimit(30,60000);
  constructor(readonly identities:IdentityStore,readonly auth:CentralAuth,private processor:()=>Decider,private development=false) {}
  machineRoutes=(app:Express):void=>{
    app.post('/api/agent/enroll',(req,res,next)=>{
      if(!this.enrollmentLimit.allow(req.socket.remoteAddress||'unknown')){res.status(429).json({error:'Try enrollment later.'});return;}next();
    },express.json({limit:'1kb'}),(req,res)=>{
      if(typeof req.body?.token!=='string'){res.status(400).json({error:'Enrollment token required.'});return;}
      const identity=this.identities.exchange(req.body.token);
      if(!identity){res.status(401).json({error:'Invalid or expired enrollment token.'});return;}
      res.json(identity);
    });
  };
  mount(app:Express,server:http.Server):void {
    const wss=new WebSocket.Server({noServer:true,maxPayload:MAX_MESSAGE_BYTES,perMessageDeflate:false});
    registerSocket(server,'/agent',wss,req=>{
      if((!this.development&&!this.auth.secure(req))||!this.upgradeLimit.allow(req.socket.remoteAddress||'unknown'))return false;
      const token=req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
      const gateway=token?this.identities.authenticateAgent(token):null;
      if(!gateway)return false;this.connections.set(req,gateway);return true;
    },true);
    wss.on('connection',(socket,req)=>{
      const gateway=this.connections.get(req)!;
      // Replacement of an authenticated session fences the old socket first.
      this.sockets.get(gateway)?.close(1008,'Session replaced');this.sockets.set(gateway,socket);
      const token=req.headers.authorization!.slice(7);this.identities.acknowledgeRotation(gateway,token);
      const tunnels=new TunnelMux(socket);this.tunnels.set(gateway,tunnels);
      let alive=true;const rate=new RateLimit(512,1000,1);let inFlight=0;
      socket.on('pong',()=>{alive=true;});
      const heartbeat=setInterval(()=>{if(!alive){socket.terminate();return;}alive=false;socket.ping();},30000);heartbeat.unref();
      socket.on('message',data=>{
        if(this.sockets.get(gateway)!==socket)return;
        if(!rate.allow('frames')||inFlight>=64){socket.close(1008,'Agent rate limit exceeded');return;}
        let value:unknown;try{value=JSON.parse(data.toString());}catch{socket.close(1008,'Invalid frame');return;}
        if(typeof value==='object'&&value!==null&&'type' in value&&value.type==='operation'){
          let message;try{message=parseOperation(data.toString());if(message.type!=='operation')throw new Error();}catch{socket.close(1008,'Invalid operation');return;}
          inFlight++;
          void serveOperation(this.processor(),gateway,message).then(reply=>{if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify(reply));}).finally(()=>inFlight--);
          return;
        }
        try {
          const message=parseMessage(data.toString(),'agent');
          if(message.type==='tunnel-data'||message.type==='tunnel-credit'||message.type==='tunnel-ready'||message.type==='tunnel-close'||message.type==='tunnel-end')tunnels.receive(message);
          else if(message.type==='health')this.identities.heartbeat(gateway,message.health);
          else if(message.type==='ping')socket.send(JSON.stringify({v:1,type:'pong',id:message.id}));
          else if(message.type==='rotated'){
            // Agent confirms possession by reconnecting with the new credential.
            socket.close(1012,'Reconnect with rotated credential');
          } else if(message.type==='result')this.identities.audit('agent','state-downlink',gateway,message.id);
        }catch{socket.close(1008,'Invalid agent frame');}
      });
      socket.once('close',()=>{clearInterval(heartbeat);tunnels.close();if(this.sockets.get(gateway)===socket){this.sockets.delete(gateway);this.tunnels.delete(gateway);}});
      socket.on('error',()=>socket.terminate());
    });
    server.once('close',()=>{for(const socket of this.sockets.values())socket.terminate();wss.close();});
    app.get('/api/gateways',(req,res)=>res.json({selected:this.selected(req),gateways:this.identities.gateways().map(g=>({...g,online:this.sockets.get(g.id)?.readyState===WebSocket.OPEN,health:this.identities.health(g.id)}))}));
    app.post('/api/gateways/select',(req,res)=>{
      if(typeof req.body?.id!=='string'||!this.identities.gateways().some(g=>g.id===req.body.id&&!g.revoked)){res.status(400).json({error:'Choose an available gateway.'});return;}
      res.setHeader('Set-Cookie',`console_gateway=${req.body.id}; Path=/; HttpOnly; SameSite=Strict${this.development?'':'; Secure'}`);res.json({selected:req.body.id});
    });
    app.post('/api/gateways',(req,res)=>{
      try{const g=this.identities.createGateway(String(req.body?.name||''),res.locals.centralUser.id);res.status(201).json({...g,token:this.identities.enrollment(g.id,res.locals.centralUser.id)});}
      catch{res.status(400).json({error:'Provide a valid gateway name.'});}
    });
    app.post('/api/gateways/:id/revoke',(req,res)=>{this.identities.revoke(req.params.id,res.locals.centralUser.id);this.sockets.get(req.params.id)?.terminate();res.json({revoked:true});});
    app.post('/api/gateways/:id/enrollment',(req,res)=>{
      try{res.json({token:this.identities.enrollment(req.params.id,res.locals.centralUser.id)});}catch{res.status(409).json({error:'Revoke the previous identity before enrolling again.'});}
    });
    app.post('/api/gateways/:id/rotate',(req,res)=>{
      const socket=this.sockets.get(req.params.id);if(!socket||socket.readyState!==WebSocket.OPEN){res.status(409).json({error:'Gateway must be connected for rotation.'});return;}
      try{const credential=this.identities.rotate(req.params.id,res.locals.centralUser.id);socket.send(JSON.stringify({v:1,type:'rotate',credential}));res.json({pending:true});}
      catch{res.status(409).json({error:'Credential rotation is already pending or unavailable.'});}
    });
  }
  selected(req:http.IncomingMessage):string|null {
    const id=(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('console_gateway='))?.slice(16);
    return id&&this.identities.gateways().some(g=>g.id===id&&!g.revoked)?id:null;
  }
  open(gateway:string,purpose:TunnelPurpose,host:string,port:number):Promise<GatewayStream>{
    const tunnels=this.tunnels.get(gateway);if(!tunnels)return Promise.reject(new Error('Gateway is offline.'));return tunnels.open(purpose,host,port);
  }
}
