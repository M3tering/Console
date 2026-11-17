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
const { attachTerminal } = require('../../dist/services/ssh');
const upstream = require('./chirpstack-upstream.cjs');
upstream.listen(0, '127.0.0.1', async () => {
  process.env.CHEFSTACK_URL = `http://127.0.0.1:${upstream.address().port}`;
  const ssh = await require('./ssh-fixture.cjs')();
  attachTerminal(server,ssh.target);
  server.on('close',()=>ssh.server.close());
  server.listen(4174, '0.0.0.0', () => console.log('Authentication test server ready on 4174'));
});
