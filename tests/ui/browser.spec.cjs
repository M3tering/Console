const { test, expect } = require('@playwright/test');

test('Google query is encoded in a top-level search; direct addresses still open in Browser', async ({page, context}) => {
  await context.route('https://www.google.com/**', route => route.fulfill({contentType:'text/html',body:'<h1>Search destination test fixture</h1>'}));
  await page.route(/https:\/\/(?!www.google.com)/, route => route.abort());
  await page.goto('/'); await page.evaluate(()=>Desktop.launch('browser'));
  await expect(page.frameLocator('#browser iframe').locator('h1')).toHaveText('Search with Google');
  const query='M3ter energy & voltage + café';
  await page.locator('#browser-query').fill(query);
  const opened=context.waitForEvent('page');
  await page.locator('#browser-search button').click();
  const results=await opened; await results.waitForLoadState();
  const url=new URL(results.url()); expect(url.origin+url.pathname).toBe('https://www.google.com/search');
  expect(url.searchParams.get('q')).toBe(query);
  expect(await page.locator('#browser-external').getAttribute('href')).toBe('https://www.google.com/search?q='+encodeURIComponent(query));
  await results.close();
  await page.locator('#browser-query').fill('http://127.0.0.1:4173/browser-home.html');
  await page.locator('#browser-search button').click();
  await expect(page.locator('#browser iframe')).toHaveAttribute('src','http://127.0.0.1:4173/browser-home.html');
});

test('removed Manager is absent from desktop, launcher and window registry', async ({page}) => {
  await page.route(/https:\/\//,route=>route.abort()); await page.goto('/');
  await expect(page.locator('[data-app-id="m3ters"], [data-app-id="metas"], [data-app-id="m3ter-manager"], #m3ter-manager')).toHaveCount(0);
  await expect(page).toHaveTitle('M3tering Console · Desktop');
});
