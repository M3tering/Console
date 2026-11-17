import { Duplex } from 'stream';
import net from 'net';
import tls from 'tls';
import { randomUUID } from 'crypto';
import WebSocket from 'ws';
import { CentralMessage, TunnelMessage, TunnelPurpose, MAX_TUNNEL_CHUNK } from './protocol';
import { normalizeHost, resolveTarget, classifyAddress } from './destinations';
import { chirpstackTarget } from '../services/chirpstack';

type Open = Extract<CentralMessage,{type:'tunnel-open'}>;
export interface TunnelLimits { sessions:number; idleMs:number; bytesPerSecond:number }
const defaults:TunnelLimits={sessions:8,idleMs:120000,bytesPerSecond:1024*1024};
type ConnectTarget={host:string;port:number;secure?:boolean;servername?:string;origin?:string};
export type GatewayStream=Duplex&{upstreamOrigin?:string};
export async function gatewayTarget(request:Open,env:NodeJS.ProcessEnv=process.env):Promise<ConnectTarget> {
  if(request.purpose==='ssh'){
    if(request.host!=='ssh'||request.port!==22)throw new Error('SSH purpose requires the fixed SSH service.');
    const port=Number(env.AGENT_SSH_PORT||22);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid gateway SSH port.');
    return {host:'127.0.0.1',port};
  }
  if(request.purpose==='chirpstack'){
    if(request.host!=='chirpstack'||request.port!==8080)throw new Error('ChirpStack purpose requires the fixed service.');
    const target=chirpstackTarget();const resolved=await resolveTarget(target.hostname);
    return {host:resolved.address,port:Number(target.port||(target.protocol==='https:'?443:80)),secure:target.protocol==='https:',servername:normalizeHost(target.hostname),origin:target.origin};
  }
  const target=await resolveTarget(request.host);
  if(target.classification!=='local'||classifyAddress(target.address)!=='local')throw new Error('Browser tunnels are restricted to local destinations.');
  const loopback=target.address==='::1'||target.address.startsWith('127.')||/^::ffff:7f[\da-f]{2}:/.test(target.address);
  if(!loopback&&env.AGENT_BROWSER_ALLOW_LAN!=='true')throw new Error('Gateway owner has not enabled browser access to the LAN.');
  const denied=new Set([22,Number(env.AGENT_SSH_PORT||22),2375,2376,Number(env.GATEWAY_FALLBACK_PORT||3001),Number(env.GATEWAY_UPDATER_PORT||3002)]);
  if(denied.has(request.port))throw new Error('This infrastructure port is not a browser target.');
  const allowed=(env.AGENT_BROWSER_PORTS||'80,443,3000,8080,8090').split(',').map(Number);
  if(!allowed.includes(request.port))throw new Error('Gateway owner has not allowed this browser port.');
  return {host:target.address,port:request.port};
}

class TunnelStream extends Duplex {
  upstreamOrigin?:string;
  private httpTimeout=0;
  private txCredit=0;private rxCredit=0;private pending?:{bytes:Buffer;offset:number;done:(error?:Error|null)=>void};
  private sending=false;private peerClosed=false;private rateStart=Date.now();private received=0;private sent=0;
  private retry?:ReturnType<typeof setTimeout>;private activity=Date.now();private idle:ReturnType<typeof setInterval>;
  constructor(readonly id:string,private send:(message:TunnelMessage,done?:(error?:Error)=>void)=>void,private release:()=>void,private limits:TunnelLimits){
    super({readableHighWaterMark:65536,writableHighWaterMark:65536,allowHalfOpen:true});
    this.on('error',()=>{});
    this.idle=setInterval(()=>{if(this.httpTimeout&&Date.now()-this.activity>this.httpTimeout)this.emit('timeout');if(Date.now()-this.activity>limits.idleMs)this.destroy(new Error('Tunnel idle timeout.'));},Math.min(1000,limits.idleMs));this.idle.unref();
    this.on('end',()=>{if(this.writableFinished)this.destroy();});this.on('finish',()=>{if(this.readableEnded)this.destroy();});
  }
  start():void{this._read();}
  setTimeout(ms:number,callback?:()=>void):this{this.httpTimeout=ms;if(callback)this.once('timeout',callback);return this;}
  setNoDelay():this{return this;}
  setKeepAlive():this{return this;}
  _read():void {
    const grant=65536-this.readableLength-this.rxCredit;
    if(grant>0&&!this.destroyed){this.rxCredit+=grant;this.send({v:1,type:'tunnel-credit',id:this.id,bytes:grant});}
  }
  _write(bytes:Buffer,_encoding:BufferEncoding,done:(error?:Error|null)=>void):void {this.pending={bytes:Buffer.from(bytes),offset:0,done};this.flush();}
  _final(done:(error?:Error|null)=>void):void {this.send({v:1,type:'tunnel-end',id:this.id},done);}
  _destroy(error:Error|null,done:(error?:Error|null)=>void):void {
    clearInterval(this.idle);clearTimeout(this.retry);
    if(!this.peerClosed)this.send({v:1,type:'tunnel-close',id:this.id,reason:error?'error':'closed'});
    const pending=this.pending;this.pending=undefined;pending?.done(error||new Error('Tunnel closed.'));this.release();done(error);
  }
  receive(message:TunnelMessage):void {
    this.activity=Date.now();this.resetRate();
    if(message.type==='tunnel-credit'){
      if(this.txCredit+message.bytes>65536){this.destroy(new Error('Invalid tunnel credit.'));return;}
      this.txCredit+=message.bytes;this.flush();
    }else if(message.type==='tunnel-data'){
      const bytes=Buffer.from(message.data,'base64');this.received+=bytes.length;
      if(bytes.length>this.rxCredit||this.received>this.limits.bytesPerSecond){this.destroy(new Error('Tunnel receive limit exceeded.'));return;}
      this.rxCredit-=bytes.length;if(this.push(bytes))this._read();
    }else if(message.type==='tunnel-end')this.push(null);
    else if(message.type==='tunnel-close'){this.peerClosed=true;this.destroy(message.reason==='closed'?undefined:new Error('Remote tunnel closed.'));}
  }
  private resetRate():void{if(Date.now()-this.rateStart>=1000){this.rateStart=Date.now();this.received=0;this.sent=0;}}
  private flush():void {
    if(this.sending||!this.pending||!this.txCredit||this.destroyed)return;
    this.resetRate();const available=this.limits.bytesPerSecond-this.sent;
    if(available<=0){if(!this.retry)this.retry=setTimeout(()=>{this.retry=undefined;this.flush();},Math.max(1,1000-(Date.now()-this.rateStart)));return;}
    const pending=this.pending,len=Math.min(MAX_TUNNEL_CHUNK,this.txCredit,available,pending.bytes.length-pending.offset);
    if(!len){this.pending=undefined;pending.done();return;}
    const bytes=pending.bytes.subarray(pending.offset,pending.offset+len);pending.offset+=len;this.txCredit-=len;this.sent+=len;this.activity=Date.now();this.sending=true;
    this.send({v:1,type:'tunnel-data',id:this.id,data:bytes.toString('base64')},error=>{
      this.sending=false;if(error){this.destroy(error);return;}
      if(pending.offset===pending.bytes.length&&this.pending===pending){this.pending=undefined;pending.done();}this.flush();
    });
  }
}

export class TunnelMux {
  private streams=new Map<string,TunnelStream>();
  private closed=false;
  private openings=new Map<string,{resolve:(stream:Duplex)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  private sockets=new Set<net.Socket>();private accepting=new Set<string>();
  private pendingSockets=new Map<string,net.Socket>();
  constructor(private link:WebSocket,private resolveTarget?: (request:Open)=>Promise<ConnectTarget>,private limits:TunnelLimits=defaults){link.once('close',()=>this.close());}
  open(purpose:TunnelPurpose,host:string,port:number):Promise<GatewayStream> {
    if(this.closed||this.streams.size+this.accepting.size>=this.limits.sessions||this.link.readyState!==WebSocket.OPEN)return Promise.reject(new Error('Gateway tunnel unavailable or at capacity.'));
    const id=randomUUID(),stream=this.create(id);
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.openings.delete(id);stream.destroy();reject(new Error('Gateway tunnel timed out.'));},15000);
      this.openings.set(id,{resolve,reject,timer});this.send({v:1,type:'tunnel-open',id,purpose,host,port});
    });
  }
  receive(message:Open|TunnelMessage):void {
    if(message.type==='tunnel-open'){
      if(!this.resolveTarget||this.streams.has(message.id)||this.accepting.has(message.id)||this.streams.size+this.accepting.size>=this.limits.sessions){this.send({v:1,type:'tunnel-close',id:message.id,reason:'refused'});return;}
      this.accepting.add(message.id);void this.accept(message);return;
    }
    if(message.type==='tunnel-close'&&this.accepting.has(message.id)){this.accepting.delete(message.id);this.pendingSockets.get(message.id)?.destroy();return;}
    const stream=this.streams.get(message.id);if(!stream)return;
    if(message.type==='tunnel-ready'){
      const pending=this.openings.get(message.id);if(!pending)return;
      clearTimeout(pending.timer);this.openings.delete(message.id);stream.upstreamOrigin=message.origin;stream.start();pending.resolve(stream);
    }else stream.receive(message);
  }
  private async accept(message:Open):Promise<void>{
    try {
      const target=await this.resolveTarget!(message);
      if(this.link.readyState!==WebSocket.OPEN||!this.accepting.has(message.id)){this.accepting.delete(message.id);return;}
      const socket=target.secure?tls.connect({host:target.host,port:target.port,servername:target.servername,rejectUnauthorized:true}):net.connect({host:target.host,port:target.port,allowHalfOpen:true});
      this.sockets.add(socket);this.pendingSockets.set(message.id,socket);socket.setTimeout(15000,()=>socket.destroy(new Error('Tunnel connect timeout.')));
      socket.on('error',()=>{this.streams.get(message.id)?.destroy(new Error('Gateway service unavailable.'));this.send({v:1,type:'tunnel-close',id:message.id,reason:'error'});});
      socket.once(target.secure?'secureConnect':'connect',()=>{
        this.accepting.delete(message.id);this.pendingSockets.delete(message.id);socket.setTimeout(0);const stream=this.create(message.id);
        this.send({v:1,type:'tunnel-ready',id:message.id,...(target.origin?{origin:target.origin}:{})});stream.start();
        socket.pipe(stream).pipe(socket);stream.once('close',()=>socket.destroy());
      });
      socket.once('close',()=>{this.sockets.delete(socket);this.pendingSockets.delete(message.id);this.streams.get(message.id)?.destroy();this.accepting.delete(message.id);});
    }catch{this.accepting.delete(message.id);this.send({v:1,type:'tunnel-close',id:message.id,reason:'refused'});}
  }
  private create(id:string):TunnelStream {
    const stream=new TunnelStream(id,(message,done)=>this.send(message,done),()=>{
      this.streams.delete(id);const pending=this.openings.get(id);if(pending){clearTimeout(pending.timer);this.openings.delete(id);pending.reject(new Error('Gateway tunnel closed.'));}
    },this.limits);this.streams.set(id,stream);return stream;
  }
  private send(message:CentralMessage|TunnelMessage,done?:(error?:Error)=>void):void {
    if(this.closed||this.link.readyState!==WebSocket.OPEN||this.link.bufferedAmount>512*1024){
      done?.(new Error('Tunnel link unavailable or congested.'));this.close();return;
    }
    this.link.send(JSON.stringify(message),error=>{if(error)this.close();done?.(error||undefined);});
  }
  close():void {if(this.closed)return;this.closed=true;this.accepting.clear();for(const socket of this.sockets)socket.destroy();for(const stream of this.streams.values())stream.destroy();this.streams.clear();}
}
