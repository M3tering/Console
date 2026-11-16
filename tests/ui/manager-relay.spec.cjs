const { test: base, expect } = require('@playwright/test');
const http = require('node:http');
const net = require('node:net');
const meter = '0102030405060708', other = '1112131415161718';
const upstream = 'http://127.0.0.1:4174';

// Exercise real browser upgrades through a relay, including rejected and stalled
// handshakes. No mocked WebSocket or changes to the production auth boundary.
const test = base.extend({
  relay: async ({}, use) => {
    const state = { mode: 'reject', histories: 0, failHttp: false }, sockets = new Set();
    const server = http.createServer((req, res) => {
      if (req.url.includes('/history?')) {
        state.histories++;
        if (state.failHttp) { res.writeHead(502); res.end('Relay unavailable'); return; }
      }
      const outgoing = http.request(upstream + req.url, { method: req.method, headers: req.headers }, response => {
        res.writeHead(response.statusCode, response.headers); response.pipe(res);
      });
      outgoing.on('error', () => { res.writeHead(502); res.end(); });
      req.pipe(outgoing);
    });
    server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    server.on('upgrade', (req, socket, head) => {
      if (state.mode === 'reject') { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return; }
      if (state.mode === 'stall') return;
      const target = net.connect(4174, '127.0.0.1', () => {
        const headers = req.rawHeaders.reduce((all, value, index, values) => index % 2 ? all : `${all}${value}: ${values[index + 1]}\r\n`, '');
        target.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${headers}\r\n`);
        if (head.length) target.write(head);
        target.pipe(socket); socket.pipe(target);
      });
      target.on('error', () => socket.destroy());
      socket.on('close', () => target.destroy());
      target.on('close', () => socket.destroy());
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    state.url = `http://127.0.0.1:${server.address().port}`;
    await use(state);
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  },
});

async function open(page, relay) {
  await page.route(/https:\/\//, route => route.abort());
  await page.goto(relay.url);
  await page.evaluate(() => Desktop.launch('m3ter-manager'));
  await page.locator('#mm-username').fill('test-manager');
  await page.locator('#mm-password').fill('test-only-manager-password');
  await page.locator('#mm-login-submit').click();
  await expect(page.locator('#mm-device option')).toHaveCount(4);
  await page.locator('#mm-device').selectOption(meter);
  await expect(page.locator('#mm-selected')).toHaveAttribute('aria-busy', 'false');
}
const publish = (request, data) => request.post(upstream + '/__test/manager', { data });
const fallback = page => expect(page.locator('#mm-feed')).toHaveText('Updates every 5s (HTTP fallback)', { timeout: 20000 });

test('rejected upgrade falls back to authenticated HTTP, filters meters, and cleans up on close', async ({ page, request, relay }) => {
  await open(page, relay); await fallback(page);
  const previous = await page.locator('#mm-energy').textContent();
  await publish(request, { devEui: other, energy: 9.123, nonce: 100 });
  const count = relay.histories;
  await expect.poll(() => relay.histories, { timeout: 10000 }).toBeGreaterThan(count);
  await expect(page.locator('#mm-energy')).toHaveText(previous);
  await publish(request, { devEui: meter, energy: 3.456789, voltage: 232.1, nonce: 100 });
  await expect(page.locator('#mm-energy')).toHaveText('3.456789', { timeout: 10000 });
  await expect(page.locator('#mm-voltage')).toHaveText('232.1');
  await expect(page.locator('#mm-mqtt')).toHaveText('MQTT connected');
  const timestamp = await page.locator('#mm-uplink-time').textContent();
  await page.clock.setFixedTime(Date.now() + 120000);
  await expect(page.locator('#mm-age')).toHaveText('2m ago');
  const before = relay.histories;
  await expect.poll(() => relay.histories, { timeout: 10000 }).toBeGreaterThan(before);
  await expect(page.locator('#mm-uplink-time')).toHaveText(timestamp);
  await page.locator('#m3ter-manager .window-close').click();
  const closed = relay.histories;
  await page.waitForTimeout(6000); // Cross a full polling interval to prove cleanup.
  expect(relay.histories).toBe(closed);
  await page.evaluate(() => Desktop.launch('m3ter-manager'));
  await fallback(page);
});

test('stalled upgrade times out and revoked sessions lock HTTP fallback', async ({ page, relay }) => {
  relay.mode = 'stall';
  await open(page, relay); await fallback(page);
  expect((await page.request.delete(relay.url + '/api/m3ter-manager/session', { headers: { origin: relay.url } })).status()).toBe(200);
  await expect(page.locator('#mm-login')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('#mm-workspace')).toBeHidden();
  await expect(page.locator('#mm-login-error')).toContainText('Your session ended');
});

test('HTTP failures are visible and WebSocket recovery stops fallback polling', async ({ page, relay }) => {
  await open(page, relay); await fallback(page);
  relay.failHttp = true;
  await expect(page.locator('#mm-feed')).toHaveText('Automatic updates unavailable · retrying', { timeout: 10000 });
  relay.failHttp = false;
  await fallback(page);
  relay.mode = 'forward';
  await expect(page.locator('#mm-feed')).toHaveText('Live feed connected', { timeout: 35000 });
  await expect(page.locator('#mm-selected')).toHaveAttribute('aria-busy', 'false');
  const count = relay.histories;
  await page.waitForTimeout(6000);
  expect(relay.histories).toBe(count);
});
