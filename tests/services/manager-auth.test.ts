import { managerAuthRouter, managerAuthenticated, requireManagerAuth } from '../../src/m3ter/auth';
const original = process.env;
let address = 0;
beforeEach(() => { process.env = { ...original, M3TER_MANAGER_USERNAME: 'operator', M3TER_MANAGER_PASSWORD: 'unique-password' }; address++; });
afterEach(() => { process.env = original; jest.restoreAllMocks(); });
function request(body?: any, cookie = ''): any { return { body, headers: { cookie }, socket: { remoteAddress: String(address) }, secure: false }; }
function response(): any {
  const res:any = { code: 200, headers: {}, status(n:number) { this.code=n;return this; }, json(body:any) { this.body=body;return this; },
    cookie(name:string,value:string,options:any) { this.value=name+'='+value;this.options=options; }, setHeader(name:string,value:any) { this.headers[name]=value; } };
  return res;
}
function call(method:string, req:any) {
  const res=response(), route=managerAuthRouter.stack.find((layer:any)=>layer.route?.path==='/session' && layer.route.methods[method]);
  route.route.stack[0].handle(req,res,()=>{}); return res;
}
function login() { return call('post',request({username:'operator',password:'unique-password'})); }
test('missing configuration fails closed and credentials never enter the response', () => {
  delete process.env.M3TER_MANAGER_PASSWORD;
  expect(login().code).toBe(503); expect(call('get',request()).body).toMatchObject({authenticated:false,configured:false});
  const res=response(); requireManagerAuth(request(),res,jest.fn()); expect(res.code).toBe(401);
});
test('login, HttpOnly cookie, revocation, expiry and credential rotation', () => {
  const first=login(); expect(first.code).toBe(200);
  expect(first.options).toMatchObject({httpOnly:true,sameSite:'strict',path:'/'});
  expect(JSON.stringify(first.body)).not.toContain('password');
  const req=request(undefined,first.value); expect(managerAuthenticated(req)).toBe(true);
  call('delete',req); expect(managerAuthenticated(req)).toBe(false);
  const next=login(), later=Date.now()+8*3600000+1;
  jest.spyOn(Date,'now').mockReturnValue(later); expect(managerAuthenticated(request(undefined,next.value))).toBe(false);
  jest.restoreAllMocks(); const third=login(); process.env.M3TER_MANAGER_PASSWORD='rotated';
  expect(managerAuthenticated(request(undefined,third.value))).toBe(false);
});
test('generic errors, bounded attempts and secure proxy cookies', () => {
  for(let i=0;i<10;i++) expect(call('post',request({username:'operator',password:'wrong'})).code).toBe(403);
  const locked=login(); expect(locked.code).toBe(429); expect(locked.headers['Retry-After']).toBeGreaterThan(0);
  address++; process.env.CONSOLE_ORIGIN='https://console.example.com'; expect(login().options.secure).toBe(true);
});
