const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),fixture=fs.readFileSync(path.join(root,'tests/fixtures/insights-navigator-demo.txt'));
async function pageFor(browser){
 const context=await browser.newContext({viewport:{width:390,height:740}});
 const page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(String(e)));
 await page.route('https://reader.test/**',async route=>{
  const u=new URL(route.request().url()),file=path.join(root,u.pathname==='/'?'index.html':u.pathname.slice(1));
  if(!fs.existsSync(file))return route.fulfill({status:404,body:'not found'});
  const mime=file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html; charset=utf-8';
  await route.fulfill({contentType:mime,body:fs.readFileSync(file)});
 });
 await page.goto('https://reader.test/');
 await page.evaluate(()=>readerReady);
 return {context,page,errors};
}
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 let checks=0;
 try{
  const {context,page,errors}=await pageFor(browser);
  await page.locator('#txtFileInput').setInputFiles({name:'insights-navigator-demo.txt',mimeType:'text/plain',buffer:fixture});
  await page.waitForFunction(()=>document.getElementById('inputText').value.includes('제01차 조사에서'),null,{timeout:20000});
  await page.locator('#openViewerBtn').click();
  await page.waitForFunction(()=>!restoreInProgress&&pages.length>0,null,{timeout:30000});
  await page.locator('#insightsOpen').click();
  await page.waitForSelector('#insightsNavigatorBar:visible');
  assert.ok(await page.locator('#insightsPaper [data-nav-id=lens]').count());checks++;
  assert.equal(await page.locator('#insightsPanel .insights-tabs').isVisible(),false);checks++;
  // Explicitly mark the complete demo as read; no automatic jump-based unlock.
  await page.evaluate(()=>window.readerInsights.correctTo(readerCanonical().length));
  await page.locator('#insightsPaper [data-nav-id=people]').click();
  await page.locator('#insightsPaper [data-nav-id="person:은서"]').click();
  assert.ok(await page.locator('#insightsPaper').innerText().then(t=>t.includes('현재 상태')));checks++;
  assert.equal(await page.locator('#insightsPaper [data-nav-id=CH01]').count(),0,'Old goals should not appear as current state');checks++;
  await page.locator('#insightsPaper [data-nav-id=history]').click();
  await page.waitForFunction(()=>document.querySelector('#insightsNavTitle').textContent.includes('변화 이력'));
  assert.ok(await page.locator('#insightsPageCount').textContent().then(t=>t.includes('/')));checks++;
  await page.locator('#insightsNavBack').click();
  await page.locator('#insightsNavFind').click();
  await page.locator('#insightsNavSearch').fill('은빛 열쇠');
  await page.waitForFunction(()=>document.querySelectorAll('#insightsPaper [data-nav-kind=record]').length>0);
  assert.ok(await page.locator('#insightsPaper [data-nav-kind=record]').count());checks++;
  const sourceAnchor=await page.evaluate(()=>readerAnchor());
  await page.locator('#insightsPaper [data-nav-kind=record]').first().click();
  await page.locator('#insightsNavReturn').click();
  await page.locator('#insightsPaper [data-nav-id=recent]').click();
  assert.equal(await page.locator('#insightsNext').isEnabled(),true);
  await page.locator('#insightsNext').click();
  assert.equal(await page.evaluate(()=>readerAnchor()),sourceAnchor,'The insights pager must not advance book pages');checks++;
  await page.locator('#insightsNavReturn').click();
  for(let attempt=0;attempt<5&&!await page.locator('#insightsPaper [data-nav-id=all]').count();attempt++){
    if(!await page.locator('#insightsNext').isEnabled())break;
    await page.locator('#insightsNext').click();
  }
  await page.locator('#insightsPaper [data-nav-id=all]').click();
  assert.equal(await page.locator('#insightsPanel .insights-tabs').isVisible(),true);checks++;
  await page.locator('#insightsNavReturn').click();
  assert.equal(await page.locator('#insightsNavigatorBar').isVisible(),true);checks++;
  // Drop the read cursor: names learned later must immediately disappear.
  await page.evaluate(()=>window.readerInsights.correctTo(0));
  assert.equal(await page.locator('#insightsPaper [data-nav-kind=record]').count(),0,'Unread records must all be hidden');checks++;
  assert.equal((await page.locator('#insightsPaper').innerText()).trim(),'','The no-information panel stays blank');checks++;
  assert.deepEqual(errors,[]);checks++;
  await context.close();
  console.log(checks+' navigator browser assertions passed');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});