const {test,expect}=require('@playwright/test');
const os=require('node:os');
test('Console and Manager login work on localhost and LAN with no Console password or origin setting',async({browser,request})=>{
  const lan=Object.values(os.networkInterfaces()).flat().find(x=>x.family==='IPv4'&&!x.internal)?.address;
  expect(lan,'A LAN interface is needed for this integration check').toBeTruthy();
  for(const host of ['localhost',lan]){
    const base=`http://${host}:4174`;
    expect((await request.get(base+'/healthz')).status()).toBe(200);
    const context=await browser.newContext(),page=await context.newPage();await page.route(/https:\/\//,r=>r.abort());
    await page.goto(base);await page.evaluate(()=>Desktop.launch('m3ter-manager'));
    await expect(page.locator('#mm-login')).toBeVisible();
    await page.locator('#mm-username').fill('test-manager');await page.locator('#mm-password').fill('test-only-manager-password');await page.locator('#mm-login-submit').click();
    await expect(page.locator('#mm-workspace')).toBeVisible();await expect(page.locator('#mm-feed')).toHaveText('Live feed connected');
    await context.close();
  }
});
