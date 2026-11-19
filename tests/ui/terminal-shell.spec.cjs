const {test,expect}=require('@playwright/test');
test('Terminal uses real SSH and a working shell, reports bad credentials and reconnects',async({page})=>{
  await page.route(/https:\/\//,route=>route.abort());await page.goto('http://127.0.0.1:4174/');await page.evaluate(()=>Desktop.launch('terminal'));
  await page.locator('#username').fill('fixture');await page.locator('#password').fill('wrong');await page.getByRole('button',{name:/Connect to terminal/}).click();
  await expect(page.locator('#status-message')).toContainText('SSH connection failed');
  for(let i=0;i<2;i++){
    await page.locator('#password').fill('fixture-password');await page.getByRole('button',{name:/Connect to terminal/}).click();
    await expect(page.locator('#terminal-container')).toBeVisible();
    await page.locator('.xterm-helper-textarea').fill('');await page.locator('.xterm-helper-textarea').pressSequentially(`printf 'shell-pass-${i}\\n'`);await page.keyboard.press('Enter');
    await expect(page.locator('.xterm-rows')).toContainText(`shell-pass-${i}`);
    await page.getByRole('button',{name:'Disconnect',exact:true}).click();
  }
});

test('a terminal session survives a dropped connection and a page reload, like a phone switching apps',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.route(/https:\/\//,route=>route.abort());await page.goto('http://127.0.0.1:4174/');await page.evaluate(()=>Desktop.launch('terminal'));
  await page.locator('#username').fill('fixture');await page.locator('#password').fill('fixture-password');
  await page.getByRole('button',{name:/Connect to terminal/}).click();
  await expect(page.locator('#terminal-container')).toBeVisible();
  const type=async text=>{await page.locator('.xterm-helper-textarea').pressSequentially(text);await page.keyboard.press('Enter');};
  // Remember something in this shell, so we can tell it is the same one afterwards.
  await type(`export MARK=same-shell-$$`);
  // The browser drops the connection (backgrounded page); the page reconnects on its own.
  await page.evaluate(()=>socket.close());
  await expect(page.locator('.xterm-rows')).toContainText('Reconnected to your terminal session');
  await type(`printf 'after-drop:%s\\n' "$MARK"`);
  await expect(page.locator('.xterm-rows')).toContainText(/after-drop:same-shell-\d+/);
  // The browser reloads the page (phones discard background tabs): opening Terminal picks the shell back up.
  await page.reload();await page.evaluate(()=>Desktop.launch('terminal'));
  await expect(page.locator('#terminal-container')).toBeVisible();
  await expect(page.locator('#terminal-auth')).toBeHidden();
  await type(`printf 'after-reload:%s\\n' "$MARK"`);
  await expect(page.locator('.xterm-rows')).toContainText(/after-reload:same-shell-\d+/);
  // Disconnect ends it for real: a reload now asks for credentials.
  await page.getByRole('button',{name:'Disconnect',exact:true}).click();
  await page.reload();await page.evaluate(()=>Desktop.launch('terminal'));
  await expect(page.locator('#terminal-auth')).toBeVisible();
});
