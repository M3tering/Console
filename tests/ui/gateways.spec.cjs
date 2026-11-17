const { test,expect }=require('@playwright/test');

test('central selector identifies the gateway and exposes uncertainty without sending relay commands',async({page})=>{
  let selected='gateway-one';
  const gateways=[
    {id:'gateway-one',name:'North gateway',online:true,revoked:false,health:{mqtt:'connected',queueDepth:1,uncertain:3,reconciled:2,superseded:1}},
    {id:'gateway-two',name:'South gateway',online:false,revoked:false,health:{mqtt:'disconnected',queueDepth:0,uncertain:0,reconciled:0,superseded:0}},
  ];
  await page.route('**/api/gateways',route=>route.fulfill({json:{selected,gateways}}));
  await page.route('**/api/gateways/select',route=>{selected=route.request().postDataJSON().id;return route.fulfill({json:{selected}});});
  await page.goto('/?central=1');
  await expect(page.locator('#gateway-status')).toContainText('3 uncertain seen');
  await expect(page.locator('#gateway-status')).toContainText('2 reconciled');
  await page.evaluate(()=>Desktop.launch('chirpstack'));
  await expect(page.locator('#chirpstack .window-title')).toContainText('North gateway');
  await page.locator('#gateway-select').selectOption('gateway-two');
  await expect(page.locator('#chirpstack')).toBeHidden();
  await page.evaluate(()=>Desktop.launch('chirpstack'));
  await expect(page.locator('#chirpstack .window-title')).toContainText('South gateway');
  await page.getByRole('button',{name:'Gateways',exact:true}).click();
  await expect(page.locator('#gateway-dialog')).toBeVisible();
  await expect(page.locator('#gateway-dialog')).toContainText('uncertainty never sends a relay command');
  await expect(page.locator('#gateway-list')).toContainText('3 uncertain seen');
  await page.setViewportSize({width:390,height:844});
  const bounds=await page.locator('#gateway-dialog').boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(390);
});

test('standalone desktop does not expose central enrollment or gateway controls',async({page})=>{
  await page.goto('/');
  await expect(page.locator('#gateway-select')).toHaveCount(0);
  await expect(page.locator('#gateway-dialog')).toHaveCount(0);
  await expect(page.locator('#chirpstack-icon')).toBeVisible();
});
