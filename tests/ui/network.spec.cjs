const {test,expect}=require('@playwright/test');
const os=require('node:os');
test('Console opens on localhost and LAN without a login or origin setting',async({browser,request})=>{
  const lan=Object.values(os.networkInterfaces()).flat().find(x=>x.family==='IPv4'&&!x.internal)?.address;
  expect(lan,'A LAN interface is needed for this integration check').toBeTruthy();
  for(const host of ['localhost',lan]){
    const base=`http://${host}:4174`;
    expect((await request.get(base+'/healthz')).status()).toBe(200);
    const context=await browser.newContext(),page=await context.newPage();await page.route(/https:\/\//,r=>r.abort());
    await page.goto(base);await expect(page.locator('#desktop')).toBeVisible();
    await page.evaluate(()=>Desktop.launch('settings'));await expect(page.locator('#settings')).toBeVisible();
    await expect(page.locator('[data-app-id="m3ter-manager"]')).toHaveCount(0);
    await context.close();
  }
});
