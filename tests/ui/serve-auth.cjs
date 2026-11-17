process.env.NODE_ENV='test';
process.env.BROWSER_UNSANDBOXED_TEST='true';
const fs=require('fs'),path=require('path');
let executable=require('@playwright/test').chromium.executablePath();
if(!fs.existsSync(executable)){
 const root=process.env.PLAYWRIGHT_BROWSERS_PATH;
 const directory=root&&fs.readdirSync(root).find(name=>name.startsWith('chromium_headless_shell-'));
 if(directory)executable=path.join(root,directory,'chrome-headless-shell-linux64','chrome-headless-shell');
}
process.env.BROWSER_EXECUTABLE=executable;
// Production HTTP/WebSocket access checks, with no MQTT, chain, or SSH login.
delete process.env.CONSOLE_USERNAME;
delete process.env.CONSOLE_PASSWORD;
process.env.BACKEND_MODULES = '';
process.env.UI_MODULES = '';
delete process.env.CONSOLE_ORIGIN;
const store = require('../../dist/store/sqlite');
const database = `auth-browser-${process.pid}.db`;
store.default(database);
process.on('exit', () => store.deleteDatabase(database));
const { server, app } = require('../../dist/services/server');
app.get('/browser-fixture/:page',(req,res)=>{
 res.setHeader('X-Frame-Options','DENY');res.setHeader('Content-Security-Policy',"frame-ancestors 'none'");
 res.type('html').send(`<title>Remote ${req.params.page==='next'?'Next':'Home'}</title><body style="font:20px sans-serif"><h1>Remote browser fixture</h1><a href="/browser-fixture/next" target="_blank" style="position:absolute;left:20px;top:80px;width:140px;height:44px">Next page</a><input style="position:absolute;left:20px;top:150px" placeholder="Type here"></body>`);
});
const { attachTerminal } = require('../../dist/services/ssh');
const upstream = require('./chirpstack-upstream.cjs');
upstream.listen(0, '127.0.0.1', async () => {
  process.env.CHEFSTACK_URL = `http://127.0.0.1:${upstream.address().port}`;
  const ssh = await require('./ssh-fixture.cjs')();
  attachTerminal(server,ssh.target);
  server.on('close',()=>ssh.server.close());
  server.listen(4174, '0.0.0.0', () => console.log('Authentication test server ready on 4174'));
});
