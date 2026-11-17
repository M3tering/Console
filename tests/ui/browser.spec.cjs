const { test, expect } = require('@playwright/test');

test('unavailable engine stays inside the app and never opens a search tab',async({page,context})=>{
  await page.goto('/');await page.evaluate(()=>Desktop.launch('browser'));
  await expect(page.locator('#browser-status')).toContainText(/unavailable|not available/);
  await page.locator('#browser-query').fill('energy and voltage');await page.locator('#browser-search button').click();
  expect(context.pages()).toHaveLength(1);await expect(page.locator('#browser iframe')).toHaveCount(0);
});

test('non-frameable pages, history and target-blank links stay inside the remote Browser',async({page,context})=>{
  await page.goto('http://127.0.0.1:4174');await page.evaluate(()=>Desktop.launch('browser'));
  await expect(page.locator('#browser-status')).toContainText('Ready.',{timeout:20000});
  await page.locator('#browser-query').fill('http://127.0.0.1:4174/browser-fixture/home');await page.locator('#browser-search button').click();
  await expect(page.locator('#browser .window-title')).toContainText('Remote Home');
  await expect.poll(()=>page.locator('#browser-canvas').evaluate(canvas=>canvas.width)).toBeGreaterThan(300);
  await page.locator('#browser-canvas').click({position:{x:60,y:96}});
  await expect(page.locator('#browser .window-title')).toContainText('Remote Next');
  await expect(page.locator('#browser-query')).toHaveValue('http://127.0.0.1:4174/browser-fixture/next');
  expect(context.pages()).toHaveLength(1);
  await page.locator('#browser-back').click();await expect(page.locator('#browser .window-title')).toContainText('Remote Home');
  await page.locator('#browser-forward').click();await expect(page.locator('#browser .window-title')).toContainText('Remote Next');
  await page.setViewportSize({width:390,height:844});
  await expect.poll(()=>page.locator('#browser').evaluate(el=>el.getBoundingClientRect().right)).toBeLessThanOrEqual(390);
  await page.evaluate(()=>Desktop.close('browser'));
});

test('removed Manager is absent from desktop, launcher and window registry', async ({page}) => {
  await page.route(/https:\/\//,route=>route.abort()); await page.goto('/');
  await expect(page.locator('[data-app-id="m3ters"], [data-app-id="metas"], [data-app-id="m3ter-manager"], #m3ter-manager')).toHaveCount(0);
  await expect(page).toHaveTitle('M3tering Console · Desktop');
});
