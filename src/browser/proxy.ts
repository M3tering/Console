import http, { IncomingMessage, ServerResponse } from 'http';
import https from 'https';
import net from 'net';
import tls from 'tls';
import { Duplex } from 'stream';
import { randomBytes } from 'crypto';
import { resolveTarget, destinationRoute, BrowsingContext, ResolvedTarget, normalizeHost } from '../central/destinations';
import type { ConsoleRole } from '../central/config';

type ProxyTarget=ResolvedTarget|{hostname:string;address:string;family:null;classification:'local'};
interface Permit { url:string; method:string; target:ProxyTarget; route:'internet'|'local'|'agent'; expires:number }
export interface ProxyOptions {
  role:ConsoleRole; gateway?:string; key:string; cert:string;
  tunnel?:(address:string,port:number)=>Promise<Duplex>;
  resolve?:(host:string)=>Promise<ResolvedTarget>;
}
const hop=['connection','proxy-connection','proxy-authorization','proxy-authenticate','keep-alive','transfer-encoding','upgrade','te','trailer','x-console-request'];
export function browserURL(input:string):URL {
  const url=new URL(input);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.href.length>8192)throw new Error('Use an HTTP or HTTPS address without credentials.');
  url.hash='';return url;
}
export function browserAddress(input:string):URL {
  let text=input.trim();if(!text)text='https://www.google.com/';
  if(!/^https?:\/\//i.test(text))text=/^(localhost|[\w.-]+\.[\w.-]+|\[[a-f\d:]+\])(:\d+)?([/?#]|$)/i.test(text)?`http://${text}`:`https://www.google.com/search?q=${encodeURIComponent(text)}`;
  return browserURL(text);
}
/** The proxy, not page JavaScript, owns one-use request permits and pinned DNS
 * results. TLS CONNECT terminates here; it is never a blind route into a LAN. */
export class BrowserProxy {
  private permits=new Map<string,Permit>();
  private sockets=new Set<net.Socket>();
  private contexts=new WeakMap<Duplex,string>();
  private origins=new Map<string,Set<'public'|'local'>>();
  private server=http.createServer((req,res)=>void this.request(req,res));
  private inner=http.createServer((req,res)=>void this.request(req,res));
  private secure:tls.SecureContext;
  private closed=false;
  constructor(private options:ProxyOptions){
    this.secure=tls.createSecureContext({key:options.key,cert:options.cert,minVersion:'TLSv1.2'});
    for(const server of [this.server,this.inner]){
      server.maxHeadersCount=100;server.headersTimeout=15000;server.requestTimeout=60000;
      server.on('upgrade',(req,socket,head)=>void this.upgrade(req,socket as net.Socket,head));
      server.on('clientError',(_error,socket)=>socket.destroy());
    }
    this.server.on('connection',socket=>{if(this.sockets.size>=32){socket.destroy();return;}this.sockets.add(socket);socket.once('close',()=>this.sockets.delete(socket));socket.setTimeout(120000,()=>socket.destroy());});
    this.server.on('connect',(req,socket,head)=>{
      try{
        const target=browserURL(`https://${req.url}/`);
        if(target.pathname!=='/'||head.length)throw new Error();
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        const secured=new tls.TLSSocket(socket,{isServer:true,secureContext:this.secure,ALPNProtocols:['http/1.1']});
        this.contexts.set(secured,target.origin);
        secured.on('error',()=>secured.destroy());this.inner.emit('connection',secured);
      }catch{socket.destroy();}
    });
  }
  async listen():Promise<number>{await new Promise<void>(resolve=>this.server.listen(0,'127.0.0.1',resolve));return (this.server.address() as net.AddressInfo).port;}
  async permit(raw:string,method:string,context:BrowsingContext):Promise<{token:string;classification:'public'|'local';url:string}>{
    if(this.closed)throw new Error('Browser session closed.');
    const url=browserURL(raw),hostname=normalizeHost(url.hostname);
    // Local service names belong to the selected gateway's DNS namespace. Its
    // tunnel endpoint resolves, classifies and pins the address before connect;
    // it refuses public results and still applies the owner's LAN/port policy.
    const gatewayName=this.options.role==='central'&&(/\.(local|lan)$/.test(hostname)||hostname==='localhost'||hostname.endsWith('.localhost'));
    const target:ProxyTarget=gatewayName?{hostname,address:hostname==='localhost'||hostname.endsWith('.localhost')?'127.0.0.1':hostname,family:null,classification:'local'}:await (this.options.resolve||resolveTarget)(hostname);
    const route=destinationRoute(this.options.role,target,context,this.options.gateway);
    for(const [token,p] of this.permits)if(p.expires<Date.now())this.permits.delete(token);
    if(this.permits.size>=256)throw new Error('Too many browser requests.');
    const token=randomBytes(24).toString('base64url');
    this.permits.set(token,{url:url.href,method,target,route,expires:Date.now()+20000});
    return {token,classification:target.classification as 'public'|'local',url:url.href};
  }
  registerOrigin(raw:string,classification:'public'|'local'):void{
    const origin=browserURL(raw).origin;
    const classes=this.origins.get(origin)||new Set();classes.add(classification);this.origins.set(origin,classes);
    if(this.origins.size>256)this.origins.delete(this.origins.keys().next().value!);
  }
  private url(req:IncomingMessage):URL {
    const origin=this.contexts.get(req.socket);
    const url=browserURL(origin?new URL(req.url||'/',origin).href:(req.url||'').replace(/^ws:/i,'http:').replace(/^wss:/i,'https:'));
    if(origin&&url.origin!==origin)throw new Error('CONNECT authority mismatch.');
    return url;
  }
  private take(req:IncomingMessage,url:URL):Permit{
    const token=req.headers['x-console-request'];if(typeof token!=='string')throw new Error('Missing request provenance.');
    const permit=this.permits.get(token);this.permits.delete(token);
    if(!permit||permit.expires<Date.now()||permit.url!==url.href||permit.method!==req.method)throw new Error('Invalid request provenance.');
    return permit;
  }
  private headers(req:IncomingMessage,url:URL):http.OutgoingHttpHeaders{
    const headers:http.OutgoingHttpHeaders={...req.headers,host:url.host};
    for(const name of [...hop,...String(req.headers.connection||'').toLowerCase().split(',')])delete headers[name.trim()];
    return headers;
  }
  private async connect(permit:Permit,url:URL):Promise<Duplex>{
    const port=Number(url.port||(url.protocol==='https:'?443:80));
    if(permit.route==='agent'){
      if(!this.options.tunnel)throw new Error('Selected gateway is unavailable.');
      return this.options.tunnel(permit.target.address,port);
    }
    // Central private addresses can never fall through to net.connect.
    if(this.options.role==='central'&&permit.target.classification!=='public')throw new Error('Central private network is inaccessible.');
    return new Promise((resolve,reject)=>{
      const socket=net.connect({host:permit.target.address,port});
      socket.setTimeout(10000,()=>socket.destroy(new Error('Connection timed out.')));
      socket.once('error',reject);socket.once('connect',()=>{socket.setTimeout(0);resolve(socket);});
    });
  }
  private async upstream(req:IncomingMessage,url:URL,permit:Permit,upgrade=false):Promise<http.ClientRequest>{
    const raw=await this.connect(permit,url);
    let socket:Duplex=raw;
    if(url.protocol==='https:')socket=tls.connect({socket:raw as net.Socket,servername:net.isIP(permit.target.hostname)?undefined:permit.target.hostname,checkServerIdentity:(_host,cert)=>tls.checkServerIdentity(permit.target.hostname,cert),rejectUnauthorized:true});
    const agent=new http.Agent({keepAlive:false});agent.createConnection=()=>socket;
    const headers=this.headers(req,url);if(upgrade){headers.connection='Upgrade';headers.upgrade='websocket';}
    // TLS is already on the provided stream, so the HTTP client must not wrap it again.
    const upstream=http.request({method:req.method,path:url.pathname+url.search,host:'browser-stream.invalid',agent,headers});
    upstream.setTimeout(60000,()=>upstream.destroy(new Error('Browser upstream timed out.')));
    upstream.once('close',()=>agent.destroy());req.once('aborted',()=>upstream.destroy());
    return upstream;
  }
  private async request(req:IncomingMessage,res:ServerResponse):Promise<void>{
    try{
      const url=this.url(req),permit=this.take(req,url),upstream=await this.upstream(req,url,permit);
      upstream.on('response',response=>{const headers={...response.headers};for(const name of hop)delete headers[name];res.writeHead(response.statusCode||502,headers);response.pipe(res);response.on('error',()=>res.destroy());});
      upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('Browser destination unavailable.');});
      res.once('close',()=>upstream.destroy());req.pipe(upstream);
    }catch{res.writeHead(403,{'Content-Type':'text/plain'});res.end('Browser network policy refused this request.');req.resume();}
  }
  private async upgrade(req:IncomingMessage,socket:net.Socket,head:Buffer):Promise<void>{
    try{
      const url=this.url(req);let permit:Permit;
      if(req.headers['x-console-request'])permit=this.take(req,url);
      else{
        // WebSocket handshakes bypass CDP Fetch. Chromium owns the Origin header;
        // a script cannot choose it. Only previously classified document origins
        // may use this route; a public origin never authorizes private traffic.
        const origin=typeof req.headers.origin==='string'?req.headers.origin:'';
        const classes=this.origins.get(origin);if(!classes||classes.size!==1)throw new Error();
        const issued=await this.permit(url.href,req.method||'GET',{pageClass:[...classes][0],userNavigation:false,topLevel:false});
        req.headers['x-console-request']=issued.token;permit=this.take(req,url);
      }
      const upstream=await this.upstream(req,url,permit,true);
      upstream.on('upgrade',(response,remote,extra)=>{
        const headers={...response.headers};delete headers['x-console-request'];
        socket.write(`HTTP/1.1 ${response.statusCode} Switching Protocols\r\n`+Object.entries(headers).map(([k,v])=>`${k}: ${v}`).join('\r\n')+'\r\n\r\n');
        if(extra.length)socket.write(extra);if(head.length)remote.write(head);
        remote.pipe(socket).pipe(remote);socket.once('close',()=>remote.destroy());remote.once('error',()=>socket.destroy());
      });
      upstream.on('response',()=>socket.destroy());upstream.on('error',()=>socket.destroy());upstream.end();
    }catch{socket.destroy();}
  }
  close():void{this.closed=true;this.permits.clear();for(const socket of this.sockets)socket.destroy();this.server.close();this.inner.close();}
}
