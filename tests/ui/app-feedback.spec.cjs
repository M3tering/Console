const {test,expect}=require('@playwright/test');
test.beforeEach(async({page})=>{await page.route(/https:\/\//,r=>r.abort());await page.goto('/');});
async function contained(page, child, parent) {
  const a=await page.locator(child).boundingBox(), b=await page.locator(parent).boundingBox();
  expect(a).not.toBeNull();expect(a.x).toBeGreaterThanOrEqual(b.x);expect(a.y).toBeGreaterThanOrEqual(b.y);
  expect(a.x+a.width).toBeLessThanOrEqual(b.x+b.width+1);expect(a.y+a.height).toBeLessThanOrEqual(b.y+b.height+1);
}
test('delayed action feedback belongs to its originating app, even after switching apps',async({page})=>{
  let release;const gate=new Promise(resolve=>release=resolve);
  await page.route('**/api/actions/streamr/publish-now',async route=>{await gate;await route.fulfill({json:{success:true,message:'Published in originating app'}});});
  await page.evaluate(()=>Desktop.launch('streamr'));
  await page.getByRole('button',{name:'Publish Now'}).click();
  await page.evaluate(()=>Desktop.launch('settings'));release();
  await expect(page.locator('#streamr .app-notification-area')).toContainText('Published in originating app');
  await expect(page.locator('#settings .app-notification-area')).toHaveCount(0);
  await expect(page.locator('#notification-area')).toBeEmpty();
  await page.evaluate(()=>Desktop.launch('streamr'));
  await contained(page,'#streamr .notification','#streamr');
  await page.locator('#streamr [aria-label="Dismiss notification"]').click();
  await expect(page.locator('#streamr .app-notification-area')).toBeEmpty();
  await page.evaluate(()=>showNotification('Desktop notice','error',null));
  await expect(page.locator('#notification-area')).toContainText('Desktop notice');
});
test('Paint confirms inside its window, traps focus locally, cancels on close, and preserves undo',async({page})=>{
  page.on('dialog',()=>{throw new Error('Unexpected native browser dialog');});
  await page.evaluate(()=>{Desktop.launch('paint');const ctx=document.getElementById('paint-canvas').getContext('2d');ctx.fillStyle='#ff0000';ctx.fillRect(0,0,30,30);});
  const pixel=()=>page.evaluate(()=>Array.from(document.getElementById('paint-canvas').getContext('2d').getImageData(10,10,1,1).data));
  await page.locator('#paint-clear').click();
  await expect(page.locator('#paint-confirmation')).toBeVisible();
  await contained(page,'#paint-confirmation','#paint');
  await expect(page.locator('#paint-confirmation button[value="cancel"]')).toBeFocused();
  await page.keyboard.press('Shift+Tab');await expect(page.locator('#paint-confirmation button[value="confirm"]')).toBeFocused();
  await page.evaluate(()=>Desktop.launch('settings'));
  await page.evaluate(()=>Desktop.launch('paint'));await expect(page.locator('#paint-confirmation')).toBeFocused();await page.locator('#paint-confirmation button[value="cancel"]').click();
  expect(await pixel()).toEqual([255,0,0,255]);
  await page.locator('#paint-clear').click();await page.locator('#paint-confirmation button[value="confirm"]').click();
  await expect.poll(pixel).toEqual([255,255,255,255]);
  await page.locator('#paint-undo').click();expect(await pixel()).toEqual([255,0,0,255]);
  await page.locator('#paint-clear').click();await page.locator('#paint .window-close').click();
  await page.evaluate(()=>Desktop.launch('paint'));await expect(page.locator('#paint-confirmation')).toHaveCount(0);
  expect(await pixel()).toEqual([255,0,0,255]);
  await page.locator('#paint-clear').click();await page.keyboard.press('Escape');
  await expect(page.locator('#paint-clear')).toBeFocused();
});
test('app dialogs fit desktop and phone windows, inherit modes, and hide with their app',async({page})=>{
  for(const width of [1440,390]) {
    await page.setViewportSize({width,height:844});
    for(const theme of ['retro','macos','linux','windows']) {
      await page.evaluate(()=>Desktop.launch('settings'));await page.locator(`[data-theme-choice="${theme}"]`).click();
      await page.evaluate(()=>Desktop.launch('paint'));await page.locator('#paint .window-color-mode').selectOption('dark');
      await page.locator('#paint-clear').click();
      await contained(page,'#paint-confirmation','#paint');
      expect(await page.locator('#paint-confirmation').evaluate(el=>getComputedStyle(el).getPropertyValue('--surface'))).toBe(await page.locator('#paint').evaluate(el=>getComputedStyle(el).getPropertyValue('--surface')));
      await page.locator('#paint .window-minimize').click();await expect(page.locator('#paint-confirmation')).not.toBeVisible();
      await page.evaluate(()=>Desktop.launch('paint'));await expect(page.locator('#paint-confirmation')).toBeVisible();
      await page.locator('#paint-confirmation button[value="cancel"]').click();
    }
  }
});
