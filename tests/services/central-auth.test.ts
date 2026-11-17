import express from 'express';
import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';
import { CentralAuth } from '../../src/central/auth';
import { SqliteIdentityStore } from '../../src/central/identity-store';
import { hashPassword } from '../../src/central/secrets';

// In-process HTTP injection: no listening port, gateway or upstream service.
function request(app: ReturnType<typeof express>, url: string, options: { method?: string; headers?: Record<string,string>; body?: string } = {}) {
  const socket = new Socket();
  Object.defineProperty(socket, 'remoteAddress', { value:'127.0.0.1' });
  const req=new IncomingMessage(socket);
  req.url=url;req.method=options.method || 'GET';req.headers={host:'console.example',...options.headers};
  if(options.body) {req.headers['content-type']='application/x-www-form-urlencoded';req.headers['content-length']=String(Buffer.byteLength(options.body));}
  req.push(options.body || null);if(options.body)req.push(null);
  const res=new ServerResponse(req);
  return new Promise<{status:number;headers:ReturnType<ServerResponse['getHeaders']>;body:string}>(resolve=>{
    res.end=((chunk?: unknown)=>{resolve({status:res.statusCode,headers:res.getHeaders(),body:typeof chunk==='string'?chunk:Buffer.isBuffer(chunk)?chunk.toString():''});socket.destroy();return res;}) as typeof res.end;
    app(req,res);
  });
}
let store:SqliteIdentityStore, auth:CentralAuth, app:ReturnType<typeof express>;
beforeEach(async()=>{
  store=new SqliteIdentityStore(':memory:');
  store.addUser('operator',await hashPassword('test-only-long-password'));
  auth=new CentralAuth(store,{development:false,trustedProxies:['127.0.0.1']});
  app=express();auth.mount(app);app.use((_req,res)=>res.json({ok:true}));
});
afterEach(()=>store.close());
const secure={'x-forwarded-proto':'https'};
test('every central app route is protected, including static assets, proxies and health',async()=>{
  for(const url of ['/','/healthz','/api/actions/streamr/publish-now','/chirpstack/','/js/desktop.js','/api/gateways','/api/browser']) {
    const result=await request(app,url,{headers:secure});expect(result.status).toBe(url==='/'?303:401);
  }
  expect((await request(app,'/login',{headers:secure})).status).toBe(200);
  expect((await request(app,'/login')).status).toBe(400);
});
test('login creates a secure HttpOnly same-site cookie; logout invalidates it',async()=>{
  const logged=await request(app,'/login',{method:'POST',headers:{...secure,origin:'https://console.example'},body:'username=operator&password=test-only-long-password'});
  expect(logged.status).toBe(303);
  const cookie=String(logged.headers['set-cookie']);
  expect(cookie).toMatch(/^__Host-console_session=/);expect(cookie).toContain('HttpOnly');expect(cookie).toContain('SameSite=Strict');expect(cookie).toContain('Secure');
  const headers={...secure,cookie:cookie.split(';')[0]};
  expect((await request(app,'/api/gateways',{headers})).status).toBe(200);
  expect((await request(app,'/logout',{method:'POST',headers:{...headers,origin:'https://console.example'}})).status).toBe(303);
  expect((await request(app,'/api/gateways',{headers})).status).toBe(401);
});
test('foreign origins and forged forwarding headers cannot bypass central authentication',async()=>{
  expect((await request(app,'/login',{method:'POST',headers:{...secure,origin:'https://foreign.example'},body:'username=operator&password=test-only-long-password'})).status).toBe(403);
  const untrusted=new CentralAuth(store,{development:false,trustedProxies:[]});const untrustedApp=express();untrusted.mount(untrustedApp);
  expect((await request(untrustedApp,'/login',{headers:secure})).status).toBe(400);
  const req=new IncomingMessage(new Socket());req.headers={origin:'https://console.example',host:'console.example'};
  expect(auth.authorize(req)).toBe(false);
  req.socket.destroy();
});
test('bad sign-ins use generic errors, never echo secrets, and are rate limited',async()=>{
  for(let i=0;i<10;i++) {
    const reply=await request(app,'/login',{method:'POST',headers:secure,body:'username=operator&password=sensitive-fixture'});
    expect(reply.status).toBe(401);expect(reply.body).not.toContain('sensitive-fixture');
  }
  expect((await request(app,'/login',{method:'POST',headers:secure,body:'username=operator&password=sensitive-fixture'})).status).toBe(429);
});

test('the sign-in page is styled under a strict policy whose hash matches its stylesheet',async()=>{
  const page=await request(app,'/login',{headers:secure});
  const policy=String(page.headers['content-security-policy']);
  expect(policy).toContain("default-src 'none'");expect(policy).not.toContain('unsafe-inline');expect(policy).not.toMatch(/script-src/);
  const style=/<style>([\s\S]*?)<\/style>/.exec(page.body)![1];
  const { createHash } = await import('crypto');
  expect(policy).toContain(`style-src 'sha256-${createHash('sha256').update(style).digest('base64')}'`);
  expect(page.body).not.toMatch(/<script/i);
  expect(page.body).toContain('Welcome back');
  expect((await request(app,'/login?signed-out',{headers:secure})).body).toContain('You have been signed out.');
});
test('a failed sign-in shows the page again with an error, keeping only a safe username',async()=>{
  const failed=await request(app,'/login',{method:'POST',headers:secure,body:'username=operator&password=wrong-secret-value'});
  expect(failed.status).toBe(401);expect(failed.body).toContain('role="alert"');
  expect(failed.body).toContain('value="operator"');expect(failed.body).not.toContain('wrong-secret-value');
  expect(String(failed.headers['content-security-policy'])).toContain("style-src 'sha256-");
  const hostile=await request(app,'/login',{method:'POST',headers:secure,body:'username=%22%3E%3Cimg%20src%3Dx%3E&password=x'});
  expect(hostile.status).toBe(401);expect(hostile.body).not.toContain('<img src=x>');expect(hostile.body).toContain('value=""');
});
