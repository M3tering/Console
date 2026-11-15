const { test, expect } = require('@playwright/test');
const { randomUUID } = require('node:crypto');
const base = 'http://127.0.0.1:4174', api = '/api/m3ter-manager';
const a = '0102030405060708', b = '1112131415161718', empty = '2122232425262728';
test.use({ baseURL: base, httpCredentials: { username:'test-console',password:'test-only-browser-password' } });
test.beforeEach(async ({ page, request }) => { await page.route(/https:\/\//, route => route.abort());
  expect((await request.post(api+'/session',{data:{username:'test-manager',password:'test-only-manager-password'}})).status()).toBe(200);
});
async function open(page, id = a) {
  await page.goto('/'); await page.evaluate(() => Desktop.launch('m3ter-manager'));
  await page.locator('#mm-username').fill('test-manager'); await page.locator('#mm-password').fill('test-only-manager-password');
  await page.locator('#mm-login-submit').click();
  await expect(page.locator('#mm-device option')).toHaveCount(4);
  await page.locator('#mm-device').selectOption(id);
  await expect(page.locator('#mm-eui')).toHaveText(id);
  await expect(page.locator('#mm-selected')).toHaveAttribute('aria-busy','false');
}
const control = (request, body) => request.post('/__test/manager',{data:body});

test('real MQTT client receives multi-meter telemetry, reconnects, persists, and reports diagnostics', async ({ page, request }) => {
  await open(page);
  await expect(page.locator('#mm-mqtt')).toHaveText('MQTT connected');
  const before = await page.locator('#mm-energy').textContent();
  await control(request,{devEui:b,energy:22.5,nonce:5});
  await expect.poll(async () => (await (await request.get(`${api}/devices/${b}/history`)).json()).latest.energy).toBe(22.5);
  await expect(page.locator('#mm-energy')).toHaveText(before);
  const event = {devEui:a,energy:1.234567,voltage:231.2,nonce:82,eventId:randomUUID(),timestamp:Date.now()};
  await control(request,event);
  await expect(page.locator('#mm-energy')).toHaveText('1.234567'); await expect(page.locator('#mm-voltage')).toHaveText('231.2');
  const total = (await (await request.get(`${api}/devices/${a}/history`)).json()).total;
  await control(request,event);
  expect((await (await request.get(`${api}/devices/${a}/history`)).json()).total).toBe(total);
  await page.reload(); await page.evaluate(() => Desktop.launch('m3ter-manager'));
  await expect(page.locator('#mm-energy')).toHaveText('1.234567');
  await control(request,{action:'disconnect'});
  await expect(page.locator('#mm-mqtt')).toHaveText(/disconnected|reconnecting/);
  await expect(page.locator('#mm-mqtt')).toHaveText('MQTT connected',{timeout:15000});
  await control(request,{devEui:a,energy:1.3,nonce:83}); await expect(page.locator('#mm-energy')).toHaveText('1.300000');
  await page.locator('[data-mm-tab="live"]').click();
  await control(request,{devEui:a,length:73});
  await expect(page.locator('#mm-events')).toContainText('requires exactly 74 or 106 bytes');
  await control(request,{action:'malformed'}); await expect(page.locator('#mm-error')).toContainText('Unable to process');
  await page.locator('#mm-device').selectOption(b); await expect(page.locator('#mm-energy')).toHaveText('22.500000');
});

test('backend validates scope, commands, safety confirmation, idempotency and exact queue payloads', async ({ request, playwright }) => {
  expect((await fetch(base+api+'/devices')).status).toBe(401);
  expect((await request.get(api+'/devices/not-a-device/history')).status()).toBe(400);
  expect((await request.get(api+'/devices/ffffffffffffffff')).status()).toBe(403);
  const details = await (await request.get(`${api}/devices/${a}`)).json();
  expect(JSON.stringify(details)).not.toContain('must-not-leak'); expect(JSON.stringify(details)).not.toContain('fixture-backend-token');
  for (const data of [
    {commandId:'relay-on',fPort:200,data:'AA=='}, {commandId:'current-gain',value:3}, {commandId:'phase-mode',value:4},
    {commandId:'report-interval',value:9}, {commandId:'report-interval',value:65536}, {commandId:'class-b'},
    {commandId:'billing-connect'}, {commandId:'restart'},
  ]) expect((await request.post(`${api}/devices/${a}/commands`,{data:{requestId:randomUUID(),...data}})).status()).toBe(400);
  expect((await request.post(`${api}/devices/${a}/commands`,{headers:{origin:'https://foreign.example'},data:{commandId:'relay-on',requestId:randomUUID()}})).status()).toBe(403);
  const count = (await (await control(request,{action:'stats'})).json()).enqueueCount;
  const requestId = randomUUID(), body = {commandId:'report-interval',value:900,requestId};
  const accepted = await (await request.post(`${api}/devices/${a}/commands`,{data:body})).json();
  expect(accepted).toMatchObject({status:'queued',queueId:requestId,command:{fPort:2,data:'AgOE',hex:'020384',length:3}});
  await request.post(`${api}/devices/${a}/commands`,{data:body});
  expect((await (await control(request,{action:'stats'})).json()).enqueueCount).toBe(count+1);
  expect((await request.post(`${api}/devices/${a}/commands`,{data:{...body,value:60}})).status()).toBe(409);
  const queue = await (await request.get(`${api}/devices/${a}/queue`)).json();
  expect(queue.items).toEqual(expect.arrayContaining([expect.objectContaining({id:requestId,fPort:2,data:'AgOE',confirmed:false})]));
  await control(request,{kind:'txack',devEui:a,queueItemId:requestId});
  const status = async () => (await (await request.get(`${api}/devices/${a}/commands`)).json()).commands.find(item=>item.id===requestId)?.status;
  await expect.poll(status).toBe('transmitted');
  await control(request,{kind:'ack',devEui:a,queueItemId:requestId,acknowledged:true}); await expect.poll(status).toBe('delivered');
  expect((await request.delete(`${api}/devices/${a}/queue`,{data:{}})).status()).toBe(400);
  expect((await request.delete(`${api}/devices/${a}/queue`,{data:{confirmDevEui:a}})).status()).toBe(200);
  expect((await (await request.get(`${api}/devices/${a}/queue`)).json()).items).toHaveLength(0);
  expect(await status()).toBe('delivered');
});

test('command UI previews frames, protects billing and hardware controls, and clears the queue explicitly', async ({ page }) => {
  await open(page);
  await page.locator('[data-mm-command="relay-on"]').click();
  await expect(page.locator('#mm-dialog')).toBeVisible(); await expect(page.locator('#mm-dialog-content')).toContainText('Base64: Gw==');
  await page.locator('#mm-submit').click(); await expect(page.locator('#mm-notice')).toContainText('Relay ON: queued');
  await page.locator('[data-mm-tab="commands"]').click();
  await page.locator('[data-command-id="billing-disconnect"]').click();
  await expect(page.locator('#mm-submit')).toBeDisabled(); await expect(page.locator('#mm-dialog-content')).toContainText('energy accumulator will reset');
  await page.locator('#mm-confirm').check(); await page.locator('#mm-submit').click();
  await expect(page.locator('#mm-command-history')).toContainText('Disconnect (Billing)');
  await page.getByLabel('Report interval presets').selectOption('60'); await page.locator('[data-command-id="report-interval"]').click();
  await expect(page.locator('#mm-dialog-content')).toContainText('AgA8'); await expect(page.locator('#mm-dialog-content')).toContainText('Selected setting: 60 seconds'); await page.locator('#mm-cancel').click();
  await page.getByLabel('Current gain (PGA)',{exact:true}).selectOption('4'); await page.locator('[data-command-id="current-gain"]').click();
  await expect(page.locator('#mm-dialog-content')).toContainText('IAQ='); await page.locator('#mm-cancel').click();
  await page.locator('[data-mm-tab="queue"]').click(); await expect(page.locator('#mm-queue')).toContainText('Pending delivery');
  await page.locator('#mm-queue-clear').click(); await expect(page.locator('#mm-submit')).toBeDisabled();
  await expect(page.locator('#mm-dialog-content')).toContainText('ALL currently queued downlinks');
  await page.locator('#mm-confirm').check(); await page.locator('#mm-submit').click(); await expect(page.locator('#mm-queue')).toContainText('No pending downlinks');
});

test('search, empty meters, analytics, raw reading inspection and error recovery work', async ({ page, request }) => {
  await open(page);
  await page.locator('#mm-search').fill('111213'); await expect(page.locator('#mm-device option')).toHaveCount(3); // current selection stays pinned
  await page.locator('#mm-device').selectOption(b); await expect(page.locator('#mm-name')).toContainText('Solar room');
  await page.locator('#mm-search').fill(''); await expect(page.locator('#mm-device option')).toHaveCount(4);
  await page.locator('#mm-device').selectOption(empty); await expect(page.locator('#mm-energy')).toHaveText('—'); await expect(page.locator('#mm-age')).toHaveText('Never observed');
  await page.locator('#mm-device').selectOption(a); await page.locator('[data-mm-tab="analytics"]').click();
  await expect(page.locator('#mm-summary')).toContainText('new nonce cycle');
  await expect(page.locator('#mm-history-energy svg')).toBeVisible(); await page.locator('#mm-history-energy svg').focus(); await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#mm-history-energy .mm-chart-tooltip')).toContainText('kWh');
  await page.locator('#mm-history-next').click(); await expect(page.locator('#mm-history-count')).toContainText('51–');
  await page.locator('#mm-readings button').first().click(); await expect(page.locator('#mm-dialog-content')).toContainText('Raw payload (Base64)'); await page.locator('#mm-cancel').click();
  await page.locator('#mm-range').selectOption('3600000'); await expect(page.locator('#mm-history-count')).toContainText('1–');
  await control(request,{action:'list-failure',value:true});
  try { await page.locator('#mm-refresh').click(); await expect(page.locator('#mm-error')).toBeVisible(); }
  finally { await control(request,{action:'list-failure',value:false}); }
  await page.locator('#mm-refresh').click(); await expect(page.locator('#mm-error')).toBeHidden();
  await control(request,{action:'queue-failure',value:true});
  try { await page.locator('[data-mm-tab="queue"]').click(); await expect(page.locator('#mm-queue')).toContainText('rejected the request'); }
  finally { await control(request,{action:'queue-failure',value:false}); }
  await page.locator('#mm-queue-refresh').click(); await expect(page.locator('#mm-queue')).toContainText('No pending downlinks');
});

test('manager adapts to every desktop theme and desktop, tablet and phone dimensions', async ({ page }, testInfo) => {
  await open(page);
  const errors = []; page.on('pageerror',error=>errors.push(error.message));
  for (const [width,height] of [[1440,900],[768,1024],[390,844],[320,568]]) {
    await page.setViewportSize({width,height});
    for (const theme of ['retro','macos','linux','windows']) {
      await page.evaluate(()=>Desktop.launch('settings'));
      await page.locator(`[data-theme-choice="${theme}"]`).click(); await page.evaluate(()=>Desktop.launch('m3ter-manager'));
      await expect(page.locator('#mm-eui')).toHaveText(a);
      const bounds = await page.locator('#m3ter-manager').boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x+bounds.width).toBeLessThanOrEqual(width+1);
      expect(await page.locator('.mm-scroll').evaluate(element=>element.scrollWidth<=element.clientWidth+1)).toBe(true);
      await page.locator('[data-mm-tab="commands"]').click();
      expect(await page.locator('.mm-scroll').evaluate(element=>element.scrollWidth<=element.clientWidth+1)).toBe(true);
      await page.locator('[data-mm-tab="overview"]').click();
      if (width===1440 || width===390) await page.screenshot({path:testInfo.outputPath(`manager-${theme}-${width}.png`)});
    }
  }
  expect(errors).toEqual([]);
});
