// Production HTTP/WebSocket access checks, with no MQTT, chain, or SSH login.
process.env.M3TER_MANAGER_USERNAME = 'test-manager';
process.env.M3TER_MANAGER_PASSWORD = 'test-only-manager-password';
process.env.CONSOLE_USERNAME = 'test-console';
process.env.CONSOLE_PASSWORD = 'test-only-browser-password';
process.env.BACKEND_MODULES = '';
process.env.UI_MODULES = '';
process.env.CONSOLE_ORIGIN = 'http://127.0.0.1:4174';
const store = require('../../dist/store/sqlite');
const database = `auth-browser-${process.pid}.db`;
store.default(database);
process.on('exit', () => store.deleteDatabase(database));
const { server, app } = require('../../dist/services/server');
require('../../dist/services/ssh');
const upstream = require('./chirpstack-upstream.cjs');
upstream.listen(0, '127.0.0.1', async () => {
  process.env.CHIRPSTACK_WEB_URL = `http://127.0.0.1:${upstream.address().port}`;
  await require('./manager-fixture.cjs')(app);
  server.listen(4174, '127.0.0.1', () => console.log('Authentication test server ready on 4174'));
});
