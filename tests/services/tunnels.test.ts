import { EventEmitter } from 'events';
import { once } from 'events';
import http from 'http';
import { Client, Server } from 'ssh2';
import { generateKeyPairSync } from 'crypto';
import WebSocket from 'ws';
import { TunnelMux, gatewayTarget } from '../../src/central/tunnels';
import { parseMessage } from '../../src/central/protocol';

function pair(resolveTarget:ConstructorParameters<typeof TunnelMux>[1],idleMs=10000){
  class Link extends EventEmitter {
    readyState=WebSocket.OPEN;bufferedAmount=0;peer?:Link;
    send(body:string,done?:(error?:Error)=>void){queueMicrotask(()=>{if(this.readyState===WebSocket.OPEN)this.peer?.emit('message',body);done?.();});}
    close(){this.readyState=WebSocket.CLOSED;this.emit('close');}
  }
  const a=new Link(),b=new Link();a.peer=b;b.peer=a;
  const central=new TunnelMux(a as unknown as WebSocket,undefined,{sessions:2,idleMs,bytesPerSecond:1024*1024});
  const agent=new TunnelMux(b as unknown as WebSocket,resolveTarget,{sessions:2,idleMs,bytesPerSecond:1024*1024});
  a.on('message',text=>{const msg=parseMessage(text,'agent');if(msg.type.startsWith('tunnel-'))central.receive(msg as Parameters<TunnelMux['receive']>[0]);});
  b.on('message',text=>{const msg=parseMessage(text,'central');if(msg.type.startsWith('tunnel-'))agent.receive(msg as Parameters<TunnelMux['receive']>[0]);});
  return {central,agent,close:()=>{a.close();b.close();central.close();agent.close();}};
}
test('SSH2 over the multiplexed stream authenticates, exchanges bytes, resizes and cleans up',async()=>{
  const key=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs1',format:'pem'});
  let resized!:()=>void;const resizedEvent=new Promise<void>(resolve=>{resized=resolve;});
  const resize=jest.fn();const connections=new Set<import('ssh2').Connection>();
  const sshServer=new Server({hostKeys:[key]},connection=>{
    connections.add(connection);connection.on('error',()=>{});connection.once('close',()=>connections.delete(connection));
    connection.on('authentication',ctx=>{if(ctx.method==='password'&&ctx.username==='test'&&ctx.password==='test-only-password')ctx.accept();else ctx.reject();});
    connection.on('ready',()=>connection.on('session',accept=>{
      const session=accept();session.on('pty',accept=>accept());session.on('window-change',(accept,_reject,info)=>{resize(info);resized();accept?.();});
      session.on('shell',accept=>{const channel=accept();channel.on('data',bytes=>channel.write(bytes));});
    }));
  });
  await new Promise<void>(resolve=>sshServer.listen(0,'127.0.0.1',resolve));
  const port=(sshServer.address() as import('net').AddressInfo).port;
  const link=pair(async request=>{if(request.purpose!=='ssh'||request.host!=='ssh'||request.port!==22)throw new Error('not allowed');return {host:'127.0.0.1',port};});
  const client=new Client();client.on('error',()=>{});
  try {
    const sock=await link.central.open('ssh','ssh',22);
    const ready=once(client,'ready');client.connect({sock,username:'test',password:'test-only-password',readyTimeout:2000});await ready;
    const channel=await new Promise<import('ssh2').ClientChannel>((resolve,reject)=>client.shell({cols:80,rows:24},(e,c)=>e?reject(e):resolve(c)));
    const reply=once(channel,'data');channel.write('hello through agent');expect((await reply)[0].toString()).toBe('hello through agent');
    channel.setWindow(31,92,0,0);
    await resizedEvent;
    await expect(link.central.open('ssh','ssh',2375)).rejects.toThrow();
    channel.end();client.end();
    expect(resize).toHaveBeenCalledWith(expect.objectContaining({cols:92,rows:31}));
  }finally{client.destroy();link.close();for(const c of connections)c.end();await new Promise<void>(resolve=>sshServer.close(()=>resolve()));}
});
test('HTTP and gRPC-Web bytes travel through the same stream with backpressure',async()=>{
  const body=Buffer.alloc(180000,42);
  const upstream=http.createServer((req,res)=>{res.setHeader('Content-Type','application/grpc-web+proto');req.pipe(res);});
  await new Promise<void>(resolve=>upstream.listen(0,'127.0.0.1',resolve));
  const port=(upstream.address() as import('net').AddressInfo).port;
  const link=pair(async()=>({host:'127.0.0.1',port,origin:`http://127.0.0.1:${port}`}));
  try {
    const stream=await link.central.open('chirpstack','chirpstack',8080);
    expect(stream.upstreamOrigin).toBe(`http://127.0.0.1:${port}`);
    const agent=new http.Agent({keepAlive:false});agent.createConnection=()=>stream;
    const result=await new Promise<Buffer>((resolve,reject)=>{
      const request=http.request({hostname:'not-resolved.invalid',port:8080,path:'/test',method:'POST',agent,headers:{'Content-Length':body.length}},response=>{
        const chunks:Buffer[]=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>resolve(Buffer.concat(chunks)));response.on('error',reject);
      });request.on('error',reject);request.end(body);
    });
    expect(result).toEqual(body);agent.destroy();
  }finally{link.close();upstream.closeAllConnections();await new Promise<void>(resolve=>upstream.close(()=>resolve()));}
});
test('gateway allowlists are purpose-specific and metadata, Docker and fallback ports are refused',async()=>{
  const request={v:1 as const,type:'tunnel-open' as const,id:'t',purpose:'ssh' as const,host:'ssh',port:22};
  expect(await gatewayTarget(request,{})).toEqual({host:'127.0.0.1',port:22});
  await expect(gatewayTarget({...request,port:2375},{})).rejects.toThrow();
  for(const [host,port] of [['169.254.169.254',80],['127.0.0.1',2375],['127.0.0.1',3001],['192.168.1.2',80]] as const){
    await expect(gatewayTarget({...request,purpose:'browser',host,port},{})).rejects.toThrow();
  }
  expect(await gatewayTarget({...request,purpose:'browser',host:'192.168.1.2',port:80},{AGENT_BROWSER_ALLOW_LAN:'true'})).toEqual({host:'192.168.1.2',port:80});
});

test('closing the agent link destroys active streams and refuses new sessions',async()=>{
  const upstream=http.createServer((_req,_res)=>{});
  await new Promise<void>(resolve=>upstream.listen(0,'127.0.0.1',resolve));
  const port=(upstream.address() as import('net').AddressInfo).port;
  const link=pair(async()=>({host:'127.0.0.1',port}));
  try{
    const stream=await link.central.open('browser','localhost',80);
    const closed=once(stream,'close');link.close();await closed;
    expect(stream.destroyed).toBe(true);
    await expect(link.central.open('browser','localhost',80)).rejects.toThrow('unavailable');
  }finally{link.close();upstream.closeAllConnections();await new Promise<void>(resolve=>upstream.close(()=>resolve()));}
});
