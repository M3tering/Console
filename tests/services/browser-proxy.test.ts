import http from 'http';
import { WebSocketServer } from 'ws';
import net from 'net';
import tls from 'tls';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { BrowserProxy, browserAddress } from '../../src/browser/proxy';
import type { ResolvedTarget } from '../../src/central/destinations';

let dir:string,key:string,cert:string;
beforeAll(()=>{dir=fs.mkdtempSync(path.join(os.tmpdir(),'browser-proxy-test-'));execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',dir+'/key','-out',dir+'/cert','-days','1','-subj','/CN=test'],{stdio:'ignore'});key=fs.readFileSync(dir+'/key','utf8');cert=fs.readFileSync(dir+'/cert','utf8');});
afterAll(()=>fs.rmSync(dir,{recursive:true,force:true}));
const typed={pageClass:'none' as const,userNavigation:true,topLevel:true};
function get(port:number,url:string,token?:string):Promise<{status:number;body:string}>{return new Promise((resolve,reject)=>{
  const req=http.get({host:'127.0.0.1',port,path:url,headers:token?{'X-Console-Request':token}:{}},response=>{let body='';response.on('data',chunk=>body+=chunk);response.on('end',()=>resolve({status:response.statusCode!,body}));});req.on('error',reject);
});}

test('proxy consumes one-use provenance, pins DNS and blocks public-to-local requests',async()=>{
  let hits=0;const server=http.createServer((req,res)=>{hits++;expect(req.headers['x-console-request']).toBeUndefined();res.end('fixture page');});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const upstream=(server.address() as net.AddressInfo).port;
  const resolve=jest.fn(async(host:string):Promise<ResolvedTarget>=>({hostname:host,address:'127.0.0.1',family:4,classification:host==='public.test'?'public':'local'}));
  const proxy=new BrowserProxy({role:'standalone',key,cert,resolve});const port=await proxy.listen();
  try{
    const target=`http://public.test:${upstream}/`,local=`http://127.0.0.1:${upstream}/`;
    const permit=await proxy.permit(target,'GET',typed);
    expect(await get(port,target,permit.token)).toEqual({status:200,body:'fixture page'});expect(resolve).toHaveBeenCalledTimes(1);
    expect((await get(port,target,permit.token)).status).toBe(403);
    await expect(proxy.permit(local,'GET',{pageClass:'public',topLevel:false,userNavigation:false})).rejects.toThrow('Public pages');
    await expect(proxy.permit(local,'POST',{pageClass:'public',topLevel:true,userNavigation:false})).rejects.toThrow('Public pages');
    const localPermit=await proxy.permit(local,'GET',{pageClass:'public',topLevel:true,userNavigation:true});
    expect((await get(port,local,localPermit.token)).status).toBe(200);expect(hits).toBe(2);
  }finally{proxy.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('central private requests go only through the selected agent tunnel',async()=>{
  const upstream=http.createServer((_req,res)=>res.end('gateway fixture'));
  await new Promise<void>(resolve=>upstream.listen(0,'127.0.0.1',resolve));const localPort=(upstream.address() as net.AddressInfo).port;
  const tunnel=jest.fn(async()=>net.connect({host:'127.0.0.1',port:localPort}));
  const proxy=new BrowserProxy({role:'central',gateway:'g1',key,cert,tunnel});const port=await proxy.listen();
  try{
    const url='http://192.168.2.4:8080/',permit=await proxy.permit(url,'GET',typed);
    expect((await get(port,url,permit.token)).body).toBe('gateway fixture');expect(tunnel).toHaveBeenCalledWith('192.168.2.4',8080);
    await expect(proxy.permit('http://169.254.169.254/','GET',typed)).rejects.toThrow();
    expect(tunnel).toHaveBeenCalledTimes(1);
    const named='http://meter.lan:8080/',namedPermit=await proxy.permit(named,'GET',typed);
    expect((await get(port,named,namedPermit.token)).body).toBe('gateway fixture');expect(tunnel).toHaveBeenLastCalledWith('meter.lan',8080);
    await expect(proxy.permit(named,'GET',{pageClass:'public',topLevel:false,userNavigation:false})).rejects.toThrow();
  }finally{proxy.close();upstream.closeAllConnections();await new Promise<void>(resolve=>upstream.close(()=>resolve()));}
});

test('CONNECT is inspected TLS, not a blind tunnel to central private services',async()=>{
  const tunnel=jest.fn();const proxy=new BrowserProxy({role:'central',gateway:'g1',key,cert,tunnel});const port=await proxy.listen();
  let socket:net.Socket|undefined,secured:tls.TLSSocket|undefined;
  try{
    socket=net.connect(port,'127.0.0.1');await new Promise<void>((resolve,reject)=>{socket!.once('connect',resolve);socket!.once('error',reject);});
    const connected=new Promise<void>(resolve=>socket!.once('data',()=>resolve()));socket.write('CONNECT 127.0.0.1:3000 HTTP/1.1\r\nHost: 127.0.0.1:3000\r\n\r\n');await connected;
    secured=tls.connect({socket,rejectUnauthorized:false});
    const result=new Promise<string>((resolve,reject)=>{let text='';secured!.on('data',chunk=>{text+=chunk;if(text.includes('refused'))resolve(text);});secured!.on('error',reject);});
    secured.write('GET / HTTP/1.1\r\nHost: 127.0.0.1:3000\r\nConnection: close\r\n\r\n');
    expect(await result).toContain('403');expect(tunnel).not.toHaveBeenCalled();
  }finally{secured?.destroy();socket?.destroy();proxy.close();}
});

test('address bar searches Google with encoded text and preserves explicit addresses',()=>{
  expect(browserAddress('energy & voltage').href).toBe('https://www.google.com/search?q=energy%20%26%20voltage');
  expect(browserAddress('localhost:8080/devices').href).toBe('http://localhost:8080/devices');
  expect(browserAddress('[::1]:8080').href).toBe('http://[::1]:8080/');
});

test('WebSocket forwarding allows classified local pages and denies public-to-local',async()=>{
  const upstream=new WebSocketServer({host:'127.0.0.1',port:0});
  await new Promise<void>(resolve=>upstream.once('listening',resolve));
  upstream.on('connection',ws=>ws.on('message',data=>ws.send(data)));
  const port=(upstream.address() as net.AddressInfo).port;
  const proxy=new BrowserProxy({role:'standalone',key,cert}),proxyPort=await proxy.listen();
  proxy.registerOrigin('http://local.test','local');proxy.registerOrigin('https://public.test','public');
  // ws normally emits a relative request when using a custom socket; a forward
  // proxy requires absolute-form. Exercise its actual HTTP upgrade wire format.
  const wire=(origin:string)=>new Promise<net.Socket>((resolve,reject)=>{
    const sock=net.connect(proxyPort,'127.0.0.1');sock.once('error',reject);sock.once('connect',()=>{sock.write(`GET ws://127.0.0.1:${port}/ HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\nOrigin: ${origin}\r\n\r\n`);});sock.once('data',data=>{if(data.toString().includes('101'))resolve(sock);else reject(new Error('Upgrade refused'));});sock.once('end',()=>reject(new Error('Upgrade refused')));sock.once('close',()=>reject(new Error('Upgrade refused')));
  });
  try{
    const socket=await wire('http://local.test');
    const echo=new Promise<Buffer>((resolve,reject)=>{socket.once('data',resolve);socket.once('error',reject);});
    socket.write(Buffer.from([0x81,0x82,1,2,3,4,'o'.charCodeAt(0)^1,'k'.charCodeAt(0)^2]));
    expect((await echo).subarray(-2).toString()).toBe('ok');socket.destroy();
    await expect(wire('https://public.test')).rejects.toThrow('Upgrade refused');
  }finally{proxy.close();for(const client of upstream.clients)client.terminate();await new Promise<void>(resolve=>upstream.close(()=>resolve()));}
});
