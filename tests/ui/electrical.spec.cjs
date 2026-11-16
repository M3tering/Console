const {test,expect}=require('@playwright/test');
const {randomUUID}=require('node:crypto');
test.use({baseURL:'http://127.0.0.1:4174'});
const api='/api/m3ter-manager', a='0102030405060708', b='1112131415161718', empty='2122232425262728';
test.beforeEach(async({page,request})=>{
  await page.route(/https:\/\//,route=>route.abort());
  await request.post(api+'/session',{data:{username:'test-manager',password:'test-only-manager-password'}});
});
async function open(page) {
  await page.goto('/');await page.evaluate(()=>Desktop.launch('m3ter-manager'));
  await page.locator('#mm-username').fill('test-manager');await page.locator('#mm-password').fill('test-only-manager-password');await page.locator('#mm-login-submit').click();
  await expect(page.locator('#mm-device option')).toHaveCount(4);await page.locator('#mm-device').selectOption(a);
  await expect(page.locator('#mm-selected')).toHaveAttribute('aria-busy','false');
}
const publish=(request,data)=>request.post('/__test/manager',{data});
test('FPort 4 live readings stay separate from usage and collector; objects and raw data both work',async({page,request})=>{
  await open(page);
  const usage=await page.locator('#mm-energy').textContent(), nonce=await page.locator('#mm-nonce').textContent();
  const before=(await(await publish(request,{action:'stats'})).json()).collectorCount;
  await page.locator('[data-mm-tab="live"]').click();await expect(page.locator('#mm-electrical-empty')).toBeVisible();
  await publish(request,{fPort:4,devEui:a,forward:125000});
  await expect(page.locator('#mm-electrical-data')).toBeVisible();await expect(page.locator('#mm-electrical-main')).toContainText('400.4');
  await expect(page.locator('[data-phase="a"]')).toContainText('230.12 V');await expect(page.locator('[data-phase="a"]')).toContainText('-100.1 W');
  await expect(page.locator('#mm-electrical-main')).toContainText('-12');
  await expect(page.locator('#mm-electrical-energy')).toContainText('1.25000 kWh');
  await expect(page.locator('#mm-electrical-status')).toContainText('Closed (reported)');
  expect((await(await publish(request,{action:'stats'})).json()).collectorCount).toBe(before);
  await publish(request,{fPort:4,devEui:b,power:-2000,object:true});
  await expect(page.locator('#mm-electrical-main')).toContainText('400.4');
  await page.locator('#mm-device').selectOption(b);await expect(page.locator('#mm-electrical-main')).toContainText('-200.0');
  const result=await(await request.get(`${api}/devices/${b}/telemetry`)).json();expect(result.rows[0].metadata.decodedSource).toBe('ChirpStack object');
  await page.locator('#mm-device').selectOption(a);await page.locator('[data-mm-tab="overview"]').click();
  await expect(page.locator('#mm-energy')).toHaveText(usage);await expect(page.locator('#mm-nonce')).toHaveText(nonce);
  await page.locator('[data-mm-tab="live"]').click();
  const latest=(await(await request.get(`${api}/devices/${a}/telemetry`)).json()).state.latest;
  await page.clock.setFixedTime(latest.timestamp+181000);await expect(page.locator('#mm-telemetry-freshness')).toContainText('Stale');
  await expect(page.locator('#mm-mqtt')).toHaveText('MQTT connected');
  await page.clock.setFixedTime(Date.now());await page.reload();await page.evaluate(()=>Desktop.launch('m3ter-manager'));
  await page.locator('[data-mm-tab="live"]').click();await expect(page.locator('#mm-electrical-energy')).toContainText('1.25000 kWh');
  await page.locator('#mm-device').selectOption(empty);await expect(page.locator('#mm-electrical-empty')).toBeVisible();
  await expect(page.locator('#mm-electrical-data')).toBeHidden();
});
test('new command previews and queue requests use exact bytes, selected meter, and safe pending status',async({page,request})=>{
  await open(page);await page.locator('[data-mm-tab="commands"]').click();
  for(const [id,payload] of [['telemetry-enable','IwE='],['telemetry-disable','IwA='],['telemetry-now','JQ==']]) {
    await page.locator(`[data-command-id="${id}"]`).click();await expect(page.locator('#mm-dialog-content')).toContainText(`Base64: ${payload}`);
    await expect(page.locator('#mm-dialog-content')).toContainText('FPort 2');await expect(page.locator('#mm-dialog-content')).toContainText(a);
    if(id==='telemetry-disable'){await expect(page.locator('#mm-submit')).toBeDisabled();await page.locator('#mm-confirm').check();}
    await page.locator('#mm-submit').click();await expect(page.locator('#mm-notice')).toContainText('queued');
  }
  await page.getByLabel('Telemetry interval presets').selectOption('300');await page.locator('[data-command-id="telemetry-interval"]').click();
  await expect(page.locator('#mm-dialog-content')).toContainText('JAEs');await expect(page.locator('#mm-dialog-content')).toContainText('300 seconds');await page.locator('#mm-submit').click();
  await expect(page.locator('#mm-telemetry-command-status')).toContainText('application unverified');
  const queue=(await(await request.get(`${api}/devices/${a}/queue`)).json()).items;
  for(const data of ['IwE=','IwA=','JQ==','JAEs'])expect(queue).toContainEqual(expect.objectContaining({fPort:2,data,confirmed:false}));
  const history=(await(await request.get(`${api}/devices/${a}/commands`)).json()).commands;
  expect(history.filter(r=>r.command.id.startsWith('telemetry-'))).toHaveLength(4);
  expect(history.filter(r=>r.command.id.startsWith('telemetry-')).every(r=>r.devEui===a && r.status==='queued')).toBe(true);
  for(const body of [{commandId:'telemetry-interval',value:9},{commandId:'telemetry-interval',value:65536},{commandId:'telemetry-enable',fPort:4},{commandId:'telemetry-disable'}])
    expect((await request.post(`${api}/devices/${a}/commands`,{data:{requestId:randomUUID(),...body}})).status()).toBe(400);
  await page.getByLabel('Telemetry interval presets').selectOption('10');await page.locator('[data-command-id="telemetry-interval"]').click();
  await expect(page.locator('#mm-dialog-content')).toContainText('LoRaWAN airtime');
});
test('electrical monitoring fits each desktop theme and mobile width',async({page,request})=>{
  await open(page);await publish(request,{fPort:4,devEui:a});await page.locator('[data-mm-tab="live"]').click();
  await expect(page.locator('#mm-electrical-data')).toBeVisible();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  for(const width of [1440,768,390,320]) {
    await page.setViewportSize({width,height:900});
    for(const theme of ['retro','macos','linux','windows']) {
      await page.evaluate(()=>Desktop.launch('settings'));await page.locator(`[data-theme-choice="${theme}"]`).click();await page.evaluate(()=>Desktop.launch('m3ter-manager'));
      expect(await page.locator('.mm-scroll').evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
      await expect(page.locator('[data-phase="a"]')).toContainText('230.12 V');
    }
  }
  expect(errors).toEqual([]);
});
