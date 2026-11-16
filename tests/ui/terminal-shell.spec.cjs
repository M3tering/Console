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
