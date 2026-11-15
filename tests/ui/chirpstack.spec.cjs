const { test, expect } = require('@playwright/test');
const base = 'http://127.0.0.1:4174';
const credentials = { username: 'test-console', password: 'test-only-browser-password' };

test('ChirpStack launches inside the desktop, proxies assets and Bearer requests, and isolates logout', async ({ browser }) => {
  const context = await browser.newContext({ httpCredentials: credentials });
  const page = await context.newPage();
  await page.route(/https:\/\//, route => route.abort());
  await page.goto(base);
  await expect(page.locator('#chirpstack-frame')).not.toHaveAttribute('src', /./);
  await page.locator('#chirpstack-icon').dblclick();
  const frame = page.frameLocator('#chirpstack-frame');
  await expect(frame.locator('body')).toHaveAttribute('data-ready', 'yes');
  await expect(frame.getByAltText('Network logo')).toHaveAttribute('src', base + '/chirpstack/logo.svg');
  await expect(frame.locator('h1')).toHaveCSS('color', 'rgb(1, 2, 3)');
  await frame.locator('#draft').fill('Keep this network draft');
  await frame.getByRole('button', { name: 'Sign in' }).click();
  await expect(frame.locator('#result')).toHaveText(JSON.stringify({ authorization: 'Bearer fixture-token', cookie: null, bytes: [0,255,13,10], url: '/api.InternalService/Login' }));
  const appFrame = page.frames().find(f => f.url().includes('/chirpstack/'));
  expect(await appFrame.evaluate(() => localStorage.getItem('token'))).toBe('fixture-token');
  await page.evaluate(() => Desktop.launch('settings'));
  await page.locator('[data-theme-choice="linux"]').click();
  await page.evaluate(() => Desktop.launch('chirpstack'));
  const desktopPreferences = await page.evaluate(() => localStorage.getItem('m3tering.desktop.v1'));
  await expect(frame.locator('#draft')).toHaveValue('Keep this network draft');
  await frame.getByRole('button', { name: 'Sign out' }).click();
  expect(await page.evaluate(() => localStorage.getItem('m3tering.desktop.v1'))).toBe(desktopPreferences);
  expect(await appFrame.evaluate(() => localStorage.getItem('token'))).toBeNull();
  await page.setViewportSize({ width: 390, height: 844 });
  const bounds = await page.locator('#chirpstack').boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: 'Reload ChirpStack', exact: true }).click();
  await expect(frame.locator('#draft')).toHaveValue('');
  const cookies = await context.cookies(base + '/chirpstack/');
  expect(cookies.find(cookie => cookie.name === 'console_chirpstack')).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/chirpstack' });
  await context.close();
});

test('proxy scopes authorization, preserves binary transport and redirects, and reports unavailable upstream', async ({ playwright }) => {
  const anonymous = await playwright.request.newContext();
  expect((await anonymous.get(base + '/chirpstack/')).status()).toBe(401);
  const auth = await playwright.request.newContext({ httpCredentials: credentials });
  const html = await auth.get(base + '/chirpstack/');
  expect(html.status()).toBe(200);
  expect(html.headers()['x-frame-options']).toBe('SAMEORIGIN');
  const cookie = html.headers()['set-cookie'].split(';')[0];
  const headers = { cookie, authorization: 'Bearer fixture-token', origin: base, 'content-type': 'application/grpc-web+proto' };
  const binary = await anonymous.post(base + '/chirpstack/api.InternalService/Test?limit=2', { headers, data: Buffer.from([0,255,0,10]) });
  expect(await binary.json()).toEqual({ authorization: 'Bearer fixture-token', cookie: null, bytes: [0,255,0,10], url: '/api.InternalService/Test?limit=2' });
  expect((await anonymous.post(base + '/chirpstack/api.InternalService/Test', { headers: { ...headers, origin: 'https://foreign.example' } })).status()).toBe(403);
  expect((await anonymous.get(base + '/', { headers: { cookie } })).status()).toBe(401);
  expect((await anonymous.get(base + '/chirpstack/', { headers: { cookie: cookie + 'broken' } })).status()).toBe(401);
  const noLeak = await auth.post(base + '/chirpstack/api.InternalService/Test', { headers: { origin: base } });
  expect((await noLeak.json()).authorization).toBeNull();
  const redirect = await auth.get(base + '/chirpstack/redirect', { maxRedirects: 0 });
  expect(redirect.headers().location).toBe('/chirpstack/#/tenants');
  const unavailable = await auth.get(base + '/chirpstack/unavailable');
  expect(unavailable.status()).toBe(502); expect(await unavailable.text()).toContain('Try again');
  await auth.dispose(); await anonymous.dispose();
});

test('embedded fetch receives streaming responses without buffering the stream', async ({ browser }) => {
  const context = await browser.newContext({ httpCredentials: credentials });
  const page = await context.newPage();
  await page.goto(base + '/chirpstack/');
  const chunks = await page.evaluate(async () => {
    const response = await fetch('/events');
    const reader = response.body.getReader();
    const chunks = [];
    for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(new TextDecoder().decode(value)); }
    return chunks;
  });
  expect(chunks).toEqual(['first', 'last']);
  await context.close();
});
