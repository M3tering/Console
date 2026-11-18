const { test, expect } = require('@playwright/test');
const key = 'm3tering.desktop.v1';
const themes = ['retro', 'macos', 'linux', 'windows'];
const sizes = [[1440, 900], [1024, 768], [768, 1024], [390, 844], [320, 568], [844, 390]];

test.beforeEach(async ({ page }) => {
  // Browser QA is deterministic/offline; third-party fonts, frame content, and
  // terminal distribution are external integrations, not part of the fixture.
  if (!process.env.UI_EXTERNAL_ASSETS) await page.route(/https:\/\//, route => route.abort());
});
async function openSettings(page) {
  await page.evaluate(() => Desktop.launch('settings'));
  await expect(page.locator('#settings')).toBeVisible();
}
async function desktopSettings(page) {
  await openSettings(page);
  await page.locator('[data-settings-tab="desktop"]').click();
}
async function cleanGrid(page) {
  const result = await page.locator('.desktop-icon').evaluateAll(icons => {
    const parent = document.getElementById('desktop-icons').getBoundingClientRect();
    const rects = icons.map(el => el.getBoundingClientRect());
    return {
      within: rects.every(r => r.left >= parent.left - 1 && r.right <= parent.right + 1 && r.top >= parent.top - 1 && r.bottom <= parent.bottom + 1),
      overlaps: rects.some((a, i) => rects.slice(i + 1).some(b => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top)),
    };
  });
  expect(result).toEqual({ within: true, overlaps: false });
}

test('four themes across desktop, tablet, phone, and landscape keep settings and windows inside viewport', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    await openSettings(page);
    for (const theme of themes) {
      await page.locator(`[data-theme-choice="${theme}"]`).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.locator(`[data-theme-choice="${theme}"]`)).toHaveAttribute('aria-pressed', 'true');
      await cleanGrid(page);
      const bounds = await page.locator('#settings').boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(height + 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const settingsOverflow = await page.locator('.settings-content').evaluate(el => el.scrollWidth > el.clientWidth + 1);
      expect(settingsOverflow).toBe(false);
    }
  }
  expect(errors).toEqual([]);
});

test('switching theme retains application DOM, draft values, open windows, and saved preferences', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => Desktop.launch('streamr'));
  await page.getByLabel('Extension draft').fill('Keep this draft');
  await page.evaluate(() => { window.originalExtension = document.getElementById('streamr'); });
  await openSettings(page);
  await page.locator('[data-theme-choice="macos"]').click();
  await page.locator('button[data-background="dusk"]').click();
  await page.locator('[data-settings-tab="general"]').click();
  await page.locator('#reduce-motion').check();
  await page.locator('#interface-sounds').check();
  await page.locator('#clock-24').uncheck();
  await page.locator('[data-settings-tab="desktop"]').click();
  await page.locator('#icon-size').selectOption('large');
  expect(await page.evaluate(() => window.originalExtension === document.getElementById('streamr'))).toBe(true);
  await expect(page.getByLabel('Extension draft')).toHaveValue('Keep this draft');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'macos');
  expect(await page.evaluate(() => Desktop.getPreferences())).toMatchObject({ theme: 'macos', background: 'dusk', reduceMotion: true, sounds: true, clock24: false, iconSize: 'large' });
});

test('manual mouse drag swaps occupied cells, suppresses launching, persists, and resets with confirmation', async ({ page }) => {
  await page.goto('/');
  await desktopSettings(page);
  await page.locator('input[value="manual"]').check();
  await page.locator('#settings .window-close').click();
  const before = await page.evaluate(() => Desktop.getPreferences().positions);
  const meter = await page.locator('#paint-icon').boundingBox();
  const terminal = await page.locator('#terminal-icon').boundingBox();
  await page.mouse.move(meter.x + meter.width / 2, meter.y + meter.height / 2);
  await page.mouse.down();
  await page.mouse.move(terminal.x + terminal.width / 2, terminal.y + terminal.height / 2, { steps: 12 });
  await expect(page.locator('#drop-target')).toBeVisible();
  await page.mouse.up();
  await expect(page.locator('#paint')).toBeHidden();
  await expect(page.locator('#drop-target')).toBeHidden();
  await cleanGrid(page);
  const saved = await page.evaluate(() => Desktop.getPreferences().positions);
  expect(saved.paint).toEqual(before.terminal);
  expect(saved.terminal).toEqual(before.paint);
  await page.reload();
  expect(await page.evaluate(() => Desktop.getPreferences().positions)).toEqual(saved);
  await desktopSettings(page);
  await page.locator('#reset-layout').click();
  await expect(page.locator('#reset-dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Keep my layout' }).click();
  expect(await page.evaluate(() => Desktop.getPreferences().mode)).toBe('manual');
  await page.locator('#reset-layout').click();
  await page.locator('#reset-dialog').getByRole('button', { name: 'Reset layout', exact: true }).click();
  // The native dialog dispatches its close event asynchronously after the click.
  await expect.poll(() => page.evaluate(() => {
    const { mode, positions } = Desktop.getPreferences();
    return { mode, positions };
  })).toEqual({ mode: 'auto', positions: {} });
  await page.locator('input[value="manual"]').check();
  await page.locator('#reset-layout').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#reset-dialog')).toBeHidden();
  expect(await page.evaluate(() => Desktop.getPreferences().mode)).toBe('manual');
});

test('keyboard movement, theme switching, and viewport reflow preserve the custom layout', async ({ page }) => {
  await page.goto('/');
  await desktopSettings(page); await page.locator('input[value="manual"]').check();
  await page.locator('#settings .window-close').click();
  await page.locator('#paint-icon').focus();
  await page.keyboard.press('Alt+ArrowRight');
  await expect(page.locator('#desktop-announcement')).toContainText('column 2');
  const saved = await page.evaluate(() => Desktop.getPreferences().positions);
  await openSettings(page);
  await page.locator('[data-settings-tab="appearance"]').click();
  await page.locator('[data-theme-choice="linux"]').click();
  expect(await page.evaluate(() => Desktop.getPreferences().positions)).toEqual(saved);
  await page.setViewportSize({ width: 320, height: 568 });
  await cleanGrid(page);
  expect(await page.evaluate(() => Desktop.getPreferences().positions)).toEqual(saved);
  await page.setViewportSize({ width: 1440, height: 900 });
  await cleanGrid(page);
  expect(await page.evaluate(() => Desktop.getPreferences().positions)).toEqual(saved);
});

test('launcher search, extension actions, Paint routing, minimize, restore, close, and window resizing work', async ({ page }) => {
  await page.goto('/');
  await page.locator('.taskbar [data-launcher-toggle]').click();
  await page.getByRole('searchbox').fill('streamr');
  await expect(page.locator('.launcher-app:visible')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(page.locator('#streamr')).toBeVisible();
  const request = page.waitForRequest('**/api/actions/streamr/publish-now');
  await page.getByRole('button', { name: 'Publish Now' }).click();
  expect((await request).method()).toBe('POST');
  await expect(page.locator('#streamr .app-notification-area')).toContainText('Published 2');
  await page.locator('#streamr .window-minimize').click();
  await expect(page.locator('#streamr')).toBeHidden();
  await page.locator('.dock-app[data-app-id="streamr"]').click();
  await expect(page.locator('#streamr')).toBeVisible();
  await page.locator('#streamr .window-maximize').click();
  await expect(page.locator('#streamr')).toHaveClass(/is-maximized/);
  await page.locator('#streamr .window-maximize').click();
  const before = await page.locator('#streamr').boundingBox();
  await page.locator('#streamr .window-resize').focus(); await page.keyboard.press('ArrowLeft');
  expect((await page.locator('#streamr').boundingBox()).width).toBeLessThan(before.width);
  await page.locator('#show-desktop').click(); await expect(page.locator('#streamr')).toBeHidden();
  await page.locator('#show-desktop').click(); await expect(page.locator('#streamr')).toBeVisible();
  await page.locator('#streamr .window-close').click();
  await page.locator('#paint-icon').click();
  await expect(page.locator('#paint-canvas')).toBeVisible();
  await page.locator('#paint .window-close').click();
  await expect(page.locator('#paint-icon')).toBeFocused();
});

test('many applications, stale saved IDs, and corrupt storage recover without overlapping', async ({ page }) => {
  await page.addInitScript(key => localStorage.setItem(key, '{invalid'), key);
  await page.goto('/?apps=60');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'retro');
  await page.setViewportSize({ width: 320, height: 568 });
  await cleanGrid(page);
  expect(await page.locator('#desktop-scroll').evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  await page.evaluate(key => localStorage.setItem(key, JSON.stringify({ version: 1, mode: 'manual', positions: { removed: { col: 0, row: 0 }, streamr: { col: 999, row: 999 } } })), key);
  // The init script intentionally resets corrupt storage on reload; use a new page navigation
  // without reloading to inspect stale-ID behavior through the storage event instead.
  await page.evaluate(key => dispatchEvent(new StorageEvent('storage', { key })), key);
  await cleanGrid(page);
});

test('blocked storage remains usable and reports persistence limits', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new Error('blocked'); };
    Storage.prototype.setItem = () => { throw new Error('blocked'); };
  });
  await page.goto('/'); await openSettings(page);
  await page.locator('[data-theme-choice="windows"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'windows');
  await expect(page.locator('#notification-area')).toContainText('Browser storage is unavailable');
});

test('touch hold moves an icon without launching; mobile shows one active window and keeps dock navigation', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.route(/https:\/\//, route => route.abort());
  await page.goto('http://127.0.0.1:4173/');
  await desktopSettings(page); await page.locator('input[value="manual"]').check();
  await page.locator('#settings .window-close').click();
  const before = await page.evaluate(() => Desktop.getPreferences().positions);
  const a = await page.locator('#paint-icon').boundingBox();
  const b = await page.locator('#terminal-icon').boundingBox();
  const session = await context.newCDPSession(page);
  const point = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await page.waitForTimeout(400);
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('#paint')).toBeHidden();
  expect(await page.evaluate(() => Desktop.getPreferences().positions.paint)).toEqual(before.terminal);
  await cleanGrid(page);
  await page.evaluate(() => { Desktop.launch('paint'); Desktop.launch('settings'); });
  await expect(page.locator('#settings')).toBeVisible();
  await expect(page.locator('#paint')).not.toBeVisible();
  await page.locator('.dock-app[data-app-id="paint"]').click();
  await expect(page.locator('#paint')).toBeVisible();
  await expect(page.locator('#settings')).not.toBeVisible();
  await page.locator('#show-desktop').click();
  await expect(page.locator('#desktop-icons')).toBeVisible();
  await context.close();
});

test('terminal resizes on phones, preserves the session on theme changes, and does not duplicate input after reconnecting', async ({ page }) => {
  await page.route('**/vendor/xterm/xterm.js', route => route.fulfill({
    contentType: 'application/javascript',
    body: `window.testTerminals = []; window.testSockets = [];
      window.Terminal = class {
        constructor(options) { this.options = options; this.cols = 80; this.rows = 24; this.inputs = []; this.resizes = []; testTerminals.push(this); }
        open() {} write() {} focus() {} reset() {} dispose() { this.disposed = true; }
        onData(fn) { this.inputs.push(fn); return { dispose: () => this.inputs.splice(this.inputs.indexOf(fn), 1) }; }
        onResize(fn) { this.resizes.push(fn); return { dispose: () => this.resizes.splice(this.resizes.indexOf(fn), 1) }; }
        resize(cols, rows) { this.cols = cols; this.rows = rows; this.resizes.forEach(fn => fn({cols, rows})); }
      };
      window.WebSocket = class {
        static OPEN = 1; static CONNECTING = 0;
        constructor() { this.readyState = 0; this.sent = []; testSockets.push(this); setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 0); }
        send(data) { this.sent.push(data); if (data.startsWith('{') && JSON.parse(data).type === 'auth') setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: 'ready' }) }), 0); }
        close() { this.readyState = 3; this.onclose?.(); }
      };`,
  }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.evaluate(() => Desktop.launch('terminal'));
  await page.locator('#password').fill('fixture-only');
  await page.getByRole('button', { name: /Connect to terminal/ }).click();
  await expect(page.locator('#terminal-container')).toBeVisible();
  expect(await page.evaluate(() => testTerminals[0].cols)).toBeLessThan(80);
  await openSettings(page); await page.locator('[data-theme-choice="linux"]').click();
  await page.locator('.dock-app[data-app-id="terminal"]').click();
  expect(await page.evaluate(() => testSockets.length)).toBe(1);
  await expect(page.locator('#terminal-container')).toBeVisible();
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await page.locator('#password').fill('fixture-only');
  await page.getByRole('button', { name: /Connect to terminal/ }).click();
  await expect(page.locator('#terminal-container')).toBeVisible();
  expect(await page.evaluate(() => testTerminals[0].inputs.length)).toBe(1);
  const inputs = await page.evaluate(() => {
    testTerminals[0].inputs.forEach(fn => fn('a'));
    return testSockets[1].sent.filter(value => value === 'a').length;
  });
  expect(inputs).toBe(1);
  await page.locator('#terminal .window-close').click();
  expect(await page.evaluate(() => testTerminals[0].disposed)).toBe(true);
  expect(await page.evaluate(() => testTerminals[0].inputs.length)).toBe(0);
});

test('desktop visual references and large/small icon layouts remain usable', async ({ page }, testInfo) => {
  await page.goto('/');
  for (const theme of themes) {
    await openSettings(page);
    await page.locator('[data-theme-choice="' + theme + '"]').click();
    await page.screenshot({ path: testInfo.outputPath(theme + '-desktop.png'), animations: 'disabled' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: testInfo.outputPath(theme + '-mobile.png'), animations: 'disabled' });
    await page.locator('[data-settings-tab="desktop"]').click();
    for (const size of ['large', 'small']) {
      await page.locator('#icon-size').selectOption(size);
      await cleanGrid(page);
    }
    await page.locator('#icon-size').selectOption('medium');
    await page.locator('[data-settings-tab="appearance"]').click();
    await page.setViewportSize({ width: 1440, height: 900 });
  }
});

test('icon selection clears outside the desktop and applications retain independent color modes', async ({page})=>{
  await page.goto('/');await page.locator('[data-app-id="paint"].desktop-icon').click();
  await page.locator('#paint .window-titlebar').click();await expect(page.locator('.desktop-icon.selected')).toHaveCount(0);
  await page.locator('#paint .window-color-mode').selectOption('dark');
  await openSettings(page);await page.locator('#settings .window-color-mode').selectOption('light');
  await page.locator('[data-theme-choice="linux"]').click();
  await expect(page.locator('#paint')).toHaveAttribute('data-color-mode','dark');await expect(page.locator('#settings')).toHaveAttribute('data-color-mode','light');
  expect(await page.locator('#settings').evaluate(el=>getComputedStyle(el).colorScheme)).toBe('light');
  expect(await page.locator('#paint').evaluate(el=>getComputedStyle(el).colorScheme)).toBe('dark');
  await page.reload();await page.evaluate(()=>{Desktop.launch('paint');Desktop.launch('settings');});
  await expect(page.locator('#paint')).toHaveAttribute('data-color-mode','dark');await expect(page.locator('#settings')).toHaveAttribute('data-color-mode','light');
  await page.locator('#settings .window-color-mode').selectOption('theme');
  expect(await page.locator('#settings').evaluate(el=>getComputedStyle(el).colorScheme)).toBe('dark');
  for(const width of [320,390,768,1440]) {
    await page.setViewportSize({width,height:844});
    for (const theme of themes) {
      await page.locator(`[data-theme-choice="${theme}"]`).click();
      expect(await page.locator('#settings .window-titlebar').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
      expect(await page.locator('#settings .window-color-mode').evaluate(el=>{const r=el.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===el;})).toBe(true);
    }
  }
});
