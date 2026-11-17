const { test,expect }=require('@playwright/test');

test('central selector identifies the gateway and exposes uncertainty without sending relay commands',async({page})=>{
  let selected='gateway-one';
  const gateways=[
    {id:'gateway-one',name:'North gateway',online:true,revoked:false,enrolled:true,health:{mqtt:'connected',queueDepth:1,uncertain:3,reconciled:2,superseded:1}},
    {id:'gateway-two',name:'South gateway',online:false,revoked:false,enrolled:true,health:{mqtt:'disconnected',queueDepth:0,uncertain:0,reconciled:0,superseded:0}},
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
  await expect(page.locator('[data-gateway="gateway-one"] .gw-stat',{hasText:'Uncertain'})).toContainText('3');
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

test('gateways can be added, renamed and deleted from the management dialog',async({page})=>{
  let gateways=[
    {id:'gateway-one',name:'North gateway',online:true,revoked:false,enrolled:true,lastHeartbeat:Date.now(),version:'2.0.0',health:{mqtt:'connected',queueDepth:0,uncertain:0,reconciled:0,superseded:0},updates:[]},
  ];
  const calls=[];
  await page.route('**/api/gateways',route=>{
    if(route.request().method()==='POST'){
      const {name}=route.request().postDataJSON();calls.push(['create',name]);
      gateways=[...gateways,{id:'gateway-new',name,online:false,revoked:false,enrolled:false,lastHeartbeat:null,version:null,health:null,updates:[]}];
      return route.fulfill({status:201,json:{id:'gateway-new',name,token:'T'.repeat(43)}});
    }
    return route.fulfill({json:{selected:null,gateways}});
  });
  await page.route('**/api/gateways/*/rename',route=>{
    const id=route.request().url().split('/').at(-2),{name}=route.request().postDataJSON();calls.push(['rename',id,name]);
    gateways=gateways.map(g=>g.id===id?{...g,name}:g);return route.fulfill({json:gateways.find(g=>g.id===id)});
  });
  await page.route('**/api/gateways/*/delete',route=>{
    const id=route.request().url().split('/').at(-2);calls.push(['delete',id]);
    gateways=gateways.filter(g=>g.id!==id);return route.fulfill({json:{deleted:true}});
  });
  await page.goto('/?central=1');
  await page.getByRole('button',{name:'Gateways',exact:true}).click();
  await expect(page.locator('#gateway-summary')).toHaveText('1 gateway · 1 online');

  await page.getByLabel('Gateway name').fill('Rooftop A');
  await page.getByRole('button',{name:'Add gateway'}).click();
  await expect(page.locator('#gateway-enrollment')).toBeVisible();
  await expect(page.locator('#gateway-enrollment-name')).toHaveText('Rooftop A');
  await expect(page.locator('#gateway-enrollment-token')).toHaveText('T'.repeat(43));
  await expect(page.locator('#gateway-enrollment-expiry')).toContainText('Expires in 9:5');
  await expect(page.locator('[data-gateway="gateway-new"] .gw-state')).toHaveText('Waiting to connect');

  await page.getByRole('button',{name:'Rename North gateway'}).click();
  const input=page.getByLabel('New name for North gateway');
  await expect(input).toBeFocused();
  await input.fill('North roof');await input.press('Enter');
  await expect(page.locator('[data-gateway="gateway-one"] .gw-name')).toHaveText('North roof');
  await expect(page.locator('#gateway-select option[value="gateway-one"]')).toHaveText('North roof');

  // Cancelling the confirmation leaves the gateway alone.
  await page.getByRole('button',{name:'Delete North roof'}).click();
  await expect(page.locator('#gateway-confirm')).toBeVisible();
  await page.locator('#gateway-confirm').getByRole('button',{name:'Cancel'}).click();
  expect(calls.filter(c=>c[0]==='delete')).toEqual([]);
  await page.getByRole('button',{name:'Delete North roof'}).click();
  await page.getByRole('button',{name:'Delete gateway'}).click();
  await expect(page.locator('[data-gateway="gateway-one"]')).toHaveCount(0);
  expect(calls).toEqual([['create','Rooftop A'],['rename','gateway-one','North roof'],['delete','gateway-one']]);

  // The enrollment secret is cleared when the dialog closes.
  await page.locator('#gateway-dialog-close').click();
  await expect(page.locator('#gateway-enrollment-token')).toHaveText('');
});

test('the account dialog changes the password and reports mistakes',async({page})=>{
  const posts=[];
  await page.route('**/api/gateways',route=>route.fulfill({json:{selected:null,gateways:[]}}));
  await page.route('**/api/account',route=>route.fulfill({json:{username:'admin'}}));
  await page.route('**/api/account/password',route=>{const body=route.request().postDataJSON();posts.push(body);
    return body.current==='right-pass'?route.fulfill({json:{changed:true}}):route.fulfill({status:400,json:{error:'Your current password is incorrect.'}});});
  await page.goto('/?central=1');
  await page.getByRole('button',{name:'Account',exact:true}).click();
  await expect(page.locator('#account-user')).toHaveText('Signed in as admin');
  await expect(page.getByLabel('Current password')).toBeFocused();
  await page.getByLabel('Current password').fill('right-pass');
  await page.getByLabel('New password',{exact:true}).fill('newpass1');
  await page.getByLabel('Confirm new password').fill('newpass2');
  await page.getByRole('button',{name:'Change password'}).click();
  await expect(page.locator('#password-message')).toHaveText('The new passwords don’t match.');
  expect(posts).toEqual([]);
  await page.getByLabel('Current password').fill('wrong-pass');
  await page.getByLabel('Confirm new password').fill('newpass1');
  await page.getByRole('button',{name:'Change password'}).click();
  await expect(page.locator('#password-message')).toHaveText('Your current password is incorrect.');
  await expect(page.getByLabel('Current password')).toHaveValue('');
  await page.getByLabel('Current password').fill('right-pass');
  await page.getByRole('button',{name:'Change password'}).click();
  await expect(page.locator('#password-message')).toContainText('Password changed.');
  expect(posts.at(-1)).toEqual({current:'right-pass',next:'newpass1'});
  await expect(page.getByLabel('New password',{exact:true})).toHaveValue('');
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await expect(page.locator('#account-dialog')).toBeHidden();
});
