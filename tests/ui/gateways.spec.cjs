const { test,expect }=require('@playwright/test');

// Start a tab on a gateway (main page only, and only before the tab has chosen anything itself).
const pick=(page,id)=>page.addInitScript(target=>{if(window.top!==window||sessionStorage.getItem('picked'))return;sessionStorage.setItem('picked','1');sessionStorage.setItem('m3tering.console.target',target);},id);

test('central selector identifies the gateway and exposes uncertainty without sending relay commands',async({page})=>{
  const gateways=[
    {id:'gateway-one',name:'North gateway',online:true,revoked:false,enrolled:true,health:{mqtt:'connected',queueDepth:1,uncertain:3,reconciled:2,superseded:1}},
    {id:'gateway-two',name:'South gateway',online:false,revoked:false,enrolled:true,health:{mqtt:'disconnected',queueDepth:0,uncertain:0,reconciled:0,superseded:0}},
  ];
  await page.route('**/api/gateways',route=>route.fulfill({json:{gateways}}));
  await pick(page,'gateway-one');
  await page.goto('/?central=1');
  // Status lives only in the gateway menu: nothing floats over the desktop.
  await expect(page.locator('#gateway-status')).toHaveCount(0);
  await expect(page.locator('#gateway-switcher-name')).toHaveText('North gateway');
  await expect(page.locator('#gateway-menu')).toBeHidden();
  await page.locator('#gateway-switcher').click();
  await expect(page.locator('#gateway-menu')).toBeVisible();
  await expect(page.locator('#gateway-current .gw-stat',{hasText:'Uncertain'})).toContainText('3');
  await expect(page.locator('#gateway-current .gw-stat',{hasText:'Reconciled'})).toContainText('2');
  await page.keyboard.press('Escape');await expect(page.locator('#gateway-menu')).toBeHidden();
  await expect(page.locator('#gateway-switcher')).toBeFocused();
  await page.evaluate(()=>Desktop.launch('chirpstack'));
  await expect(page.locator('#chirpstack .window-title')).toContainText('North gateway');
  await page.locator('#gateway-switcher').click();
  await page.getByRole('option',{name:/South gateway/}).click();
  await expect(page.locator('#gateway-menu')).toBeHidden();
  await expect(page.locator('#gateway-switcher-name')).toHaveText('South gateway');
  await expect(page.locator('#chirpstack')).toBeHidden();
  await page.evaluate(()=>Desktop.launch('chirpstack'));
  await expect(page.locator('#chirpstack .window-title')).toContainText('South gateway');
  await expect(page.locator('#chirpstack-frame')).toHaveAttribute('src','/chirpstack/~gateway-two/');
  await page.locator('#gateway-switcher').click();
  await page.getByRole('button',{name:'Manage gateways'}).click();
  await expect(page.locator('#gateway-dialog')).toBeVisible();
  await expect(page.locator('#gateway-dialog')).toContainText('uncertainty never sends a relay command');
  await expect(page.locator('[data-gateway="gateway-one"] .gw-stat',{hasText:'Uncertain'})).toContainText('3');
  await page.setViewportSize({width:390,height:844});
  const bounds=await page.locator('#gateway-dialog').boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(390);
});

test('the gateway can be deselected so apps open on the central server',async({page})=>{
  const gateways=[{id:'gateway-one',name:'North gateway',online:true,revoked:false,enrolled:true,health:{mqtt:'connected'},updates:[]}];
  await page.route('**/api/gateways',route=>route.fulfill({json:{gateways}}));
  await pick(page,'gateway-one');
  await page.goto('/?central=1');
  const target=()=>page.evaluate(()=>sessionStorage.getItem('m3tering.console.target'));
  await expect(page.locator('#gateway-switcher-name')).toHaveText('North gateway');
  await page.evaluate(()=>Desktop.launch('chirpstack'));
  await page.locator('#gateway-switcher').click();
  await page.getByRole('option',{name:/Central server/}).click();
  expect(await target()).toBeNull();
  await expect(page.locator('#gateway-switcher-name')).toHaveText('Central server');
  await expect(page.locator('#gateway-switcher')).toHaveAttribute('data-state','central');
  await expect(page.locator('#chirpstack')).toBeHidden();
  await page.evaluate(()=>Desktop.launch('chirpstack'));
  await expect(page.locator('#chirpstack .window-title')).toContainText('Central server');
  await expect(page.locator('#chirpstack-frame')).toHaveAttribute('src','/chirpstack/~central/');
  await page.locator('#gateway-switcher').click();
  await expect(page.locator('#gateway-current')).toContainText('open on the central server');
  await expect(page.getByRole('option',{name:/Central server/})).toHaveAttribute('aria-selected','true');
  await page.getByRole('option',{name:/North gateway/}).click();
  expect(await target()).toBe('gateway-one');
  await expect(page.locator('#gateway-switcher-name')).toHaveText('North gateway');
  // A reload keeps this tab's choice.
  await page.reload();await expect(page.locator('#gateway-switcher-name')).toHaveText('North gateway');
});

test('two tabs keep their own targets: switching in one never changes the other',async({context})=>{
  const gateways=[
    {id:'gateway-one',name:'North gateway',online:true,revoked:false,enrolled:true,health:{mqtt:'connected'},updates:[]},
    {id:'gateway-two',name:'South gateway',online:true,revoked:false,enrolled:true,health:{mqtt:'connected'},updates:[]},
  ];
  await context.route('**/api/gateways',route=>route.fulfill({json:{gateways}}));
  const first=await context.newPage(),second=await context.newPage();
  await first.goto('/?central=1');await second.goto('/?central=1');
  await first.locator('#gateway-switcher').click();await first.getByRole('option',{name:/North gateway/}).click();
  await second.locator('#gateway-switcher').click();await second.getByRole('option',{name:/South gateway/}).click();
  // Let the first tab refresh its gateway list: its choice must survive.
  await first.waitForTimeout(5500);
  await expect(first.locator('#gateway-switcher-name')).toHaveText('North gateway');
  await expect(second.locator('#gateway-switcher-name')).toHaveText('South gateway');
  for(const [page,id] of [[first,'gateway-one'],[second,'gateway-two']]){
    await page.evaluate(()=>Desktop.launch('chirpstack'));
    await expect(page.locator('#chirpstack-frame')).toHaveAttribute('src',`/chirpstack/~${id}/`);
    expect(await page.evaluate(()=>window.ConsoleTarget())).toBe(id);
  }
  // A third, new tab starts on the central server rather than inheriting either choice.
  const third=await context.newPage();await third.goto('/?central=1');
  await expect(third.locator('#gateway-switcher-name')).toHaveText('Central server');
});

test('on a phone the top bar fits and the gateway menu is a full-width sheet',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.route('**/api/gateways',route=>route.fulfill({json:{gateways:[{id:'g',name:'A gateway with a rather long site name',online:true,revoked:false,enrolled:true,health:{mqtt:'connected'},updates:[]}]}}));
  await pick(page,'g');
  await page.route('**/api/account',route=>route.fulfill({json:{username:'operator'}}));
  await page.goto('/?central=1');
  const topbar=await page.locator('.topbar').boundingBox();
  for(const selector of ['#gateway-switcher','#account-menu-button','[data-open-settings]']){
    const box=await page.locator('.topbar '+selector).first().boundingBox();
    expect(box.y).toBeGreaterThanOrEqual(topbar.y);expect(box.y+box.height).toBeLessThanOrEqual(topbar.y+topbar.height);
    expect(box.x+box.width).toBeLessThanOrEqual(390);
  }
  await expect(page.locator('#account-initial')).toHaveText('O');
  await page.locator('#gateway-switcher').click();
  const sheet=await page.locator('#gateway-menu').boundingBox();
  expect(sheet.x).toBeLessThanOrEqual(8);expect(sheet.x+sheet.width).toBeGreaterThanOrEqual(382);
  // Opening the account menu closes the gateway menu.
  await page.locator('#account-menu-button').click();
  await expect(page.locator('#account-menu')).toBeVisible();await expect(page.locator('#gateway-menu')).toBeHidden();
  await expect(page.getByRole('menuitem',{name:'Sign out'})).toBeVisible();
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
    return route.fulfill({json:{gateways}});
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
  await page.locator('#gateway-switcher').click();await page.getByRole('button',{name:'Manage gateways'}).click();
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
  await expect(page.locator('#gateway-options [data-gateway="gateway-one"]')).toContainText('North roof');

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
  await page.route('**/api/gateways',route=>route.fulfill({json:{gateways:[]}}));
  await page.route('**/api/account',route=>route.fulfill({json:{username:'admin'}}));
  await page.route('**/api/account/password',route=>{const body=route.request().postDataJSON();posts.push(body);
    return body.current==='right-pass'?route.fulfill({json:{changed:true}}):route.fulfill({status:400,json:{error:'Your current password is incorrect.'}});});
  await page.goto('/?central=1');
  await expect(page.locator('#account-initial')).toHaveText('A');
  await page.locator('#account-menu-button').click();
  await page.getByRole('menuitem',{name:'Change password'}).click();
  await expect(page.locator('#account-menu')).toBeHidden();
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

test('Streamr follows this tab\'s target on central and refreshes when it changes',async({page})=>{
  const gateways=[{id:'gateway-one',name:'North gateway',online:true,revoked:false,enrolled:true,health:{mqtt:'connected'},updates:[]}];
  const targets=[];
  await page.route('**/api/gateways',route=>route.fulfill({json:{gateways}}));
  await page.route('**/api/apps/streamr/status',route=>{
    const target=route.request().headers()['x-console-target'];targets.push(target);
    const gateway=target==='gateway-one';
    return route.fulfill({json:{role:'central',scope:gateway?"Showing readings from North gateway's meters. Central publishes for every gateway together.":'Showing readings from every gateway. Central publishes them on the schedule below.',
      recordCount:gateway?2:5,pendingCount:gateway?0:3,uncertainCount:gateway?0:1,canPublish:true,lastPublishTime:null,lastPublishStatus:null}});
  });
  await page.goto('/?central=1');
  await page.evaluate(()=>Desktop.launch('streamr'));
  await expect(page.locator('[data-streamr-field="scope"]')).toContainText('every gateway');
  await expect(page.locator('[data-streamr-field="pending"]')).toHaveText('3');
  await expect(page.locator('[data-streamr-field="uncertain"]')).toContainText('1 with an uncertain outcome');
  await page.locator('#gateway-switcher').click();await page.getByRole('option',{name:/North gateway/}).click();
  await page.evaluate(()=>Desktop.launch('streamr'));
  await expect(page.locator('[data-streamr-field="scope"]')).toContainText("North gateway's meters");
  await expect(page.locator('[data-streamr-field="pending"]')).toHaveText('0');
  expect(targets).toContain('central');expect(targets).toContain('gateway-one');
});
