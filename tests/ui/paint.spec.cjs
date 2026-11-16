const {test,expect}=require('@playwright/test');
test('Paint draws pixels, survives theme changes, undoes and exports without external assets',async({page})=>{
  await page.route(/https:\/\//,route=>route.abort());await page.goto('/');await page.evaluate(()=>Desktop.launch('paint'));
  const canvas=page.locator('#paint-canvas'), box=await canvas.boundingBox();
  const pixel=()=>page.evaluate(()=>Array.from(document.getElementById('paint-canvas').getContext('2d').getImageData(300,200,1,1).data));
  expect(await pixel()).toEqual([255,255,255,255]);
  await page.mouse.move(box.x+box.width*.25,box.y+box.height*.25);await page.mouse.down();
  await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5,{steps:8});await page.mouse.up();
  expect(await pixel()).not.toEqual([255,255,255,255]);
  for(const theme of ['retro','macos','linux','windows']){
    await page.evaluate(()=>Desktop.launch('settings'));await page.locator(`[data-theme-choice="${theme}"]`).click();
    await page.evaluate(()=>Desktop.launch('paint'));expect(await pixel()).not.toEqual([255,255,255,255]);
  }
  const download=page.waitForEvent('download');await page.locator('#paint-save').click();expect((await download).suggestedFilename()).toBe('console-paint.png');
  await page.locator('#paint-undo').click();expect(await pixel()).toEqual([255,255,255,255]);
  await page.setViewportSize({width:390,height:844});expect((await canvas.boundingBox()).width).toBeLessThan(390);
});
