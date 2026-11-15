// UI-only fixture server: real templates/assets, deterministic data, no device or chain connections.
const express = require('express');
const { create } = require('express-handlebars');
const app = express();
app.engine('hbs', create({ partialsDir: './src/views/partials', defaultLayout: 'main', extname: 'hbs', helpers: { encodeURIComponent } }).engine);
app.set('view engine', 'hbs');
app.set('views', './src/views');
app.use(express.static('./src/public'));
app.use(express.json());
app.get('/chirpstack/', (req, res) => res.type('html').send('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font:16px system-ui;padding:24px"><h1>ChirpStack</h1><p>This UI preview uses sample data. Open ChirpStack in the running console to connect to your server.</p></body></html>'));
app.get('/', (req, res) => {
  const count = Math.min(100, Math.max(1, Number(req.query.apps) || 1));
  const icons = [], windows = [];
  for (let i = 0; i < count; i++) {
    const id = i ? `extension-${i}` : 'streamr';
    icons.push({ id, label: i ? `Extension ${i}` : 'Streamr', iconHtml: '<span aria-hidden="true">✦</span>' });
    windows.push({ id, title: i ? `Extension ${i}` : 'Streamr Publisher', contentHtml: '<div class="nes-container with-title"><p class="title">Configuration</p><p>Pending transactions: 2</p><label>Draft<input class="nes-input" aria-label="Extension draft" /></label><button class="nes-btn is-warning" onclick="invokeAction(\'streamr\', \'publish-now\', this)">Publish Now</button></div>' });
  }
  res.render('index', { managerDemo: true, icons, windows, m3ters: [{ tokenId: 42, publicKey: '0x' + 'ab'.repeat(32) }] });
});
app.post('/api/actions/:moduleId/:actionId', (req, res) => res.json({ success: true, message: 'Published 2 transactions (test fixture)' }));
app.delete('/delete-meter', (req, res) => res.json({ message: 'deleted meter (test fixture)' }));
const server = require('node:http').createServer(app);
require('./manager-preview.cjs')(app, server).then(() => {
  server.listen(4173, '127.0.0.1', () => console.log('UI preview (simulated meters): http://127.0.0.1:4173'));
}).catch(error => { console.error(error); process.exit(1); });
