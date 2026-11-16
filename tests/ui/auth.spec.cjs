const { test, expect } = require('@playwright/test');
const base = 'http://127.0.0.1:4174';
const credentials = { username: 'test-console', password: 'test-only-browser-password' };

test('Console and its assets are public; only Manager data is protected', async ({ browser, request }) => {
  for (const route of ['/', '/healthz', '/js/desktop.js', '/vendor/xterm/xterm.js', '/api/m3ter-manager/session']) {
    expect((await request.get(base + route)).status()).toBe(200);
  }
  expect((await request.get(base + '/api/m3ter-manager/devices')).status()).toBe(401);
  const context = await browser.newContext({ httpCredentials: credentials });
  expect((await context.request.get(base + '/js/desktop.js')).status()).toBe(200);
  expect((await context.request.post(base + '/api/actions/streamr/publish-now', { headers: { origin: 'https://foreign.example' } })).status()).toBe(403);
  expect((await context.request.delete(base + '/delete-meter', { headers: { origin: base } })).status()).toBe(404);
  await context.close();
});

test('authenticated browser can upgrade the terminal without URL credentials and legacy query URLs are rejected', async ({ browser }) => {
  const context = await browser.newContext({ httpCredentials: credentials });
  const page = await context.newPage();
  await page.route(/https:\/\//, route => route.abort());
  await page.goto(base);
  const valid = await page.evaluate(() => new Promise(resolve => {
    let opened = false;
    const ws = new WebSocket('ws://127.0.0.1:4174/terminal');
    ws.onopen = () => { opened = true; ws.send('{}'); }; // Invalid auth frame: never contacts SSH.
    ws.onclose = event => resolve({ opened, code: event.code });
  }));
  expect(valid).toEqual({ opened: true, code: 1008 });
  const legacy = await page.evaluate(() => new Promise(resolve => {
    let opened = false;
    const ws = new WebSocket('ws://127.0.0.1:4174/?username=user&password=fixture');
    ws.onopen = () => { opened = true; ws.close(); };
    ws.onclose = () => resolve(opened);
  }));
  expect(legacy).toBe(false);
  await context.close();
});

test('real-time upgrades reject missing credentials, missing origins, and foreign origins', async () => {
  const WebSocket = require('ws');
  const authorization = 'Basic ' + Buffer.from(credentials.username + ':' + credentials.password).toString('base64');
  for (const path of ['/terminal', '/m3ter-manager/live']) for (const headers of [{ authorization }, { authorization, origin: 'https://foreign.example' }]) {
    const status = await new Promise(resolve => {
      const ws = new WebSocket('ws://127.0.0.1:4174' + path, { headers });
      ws.on('unexpected-response', (request, response) => { response.resume(); request.destroy(); resolve(response.statusCode); });
      ws.on('error', () => resolve(0));
      ws.on('open', () => { ws.close(); resolve(101); });
    });
    expect(status).toBe(403);
  }
});
