const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const fixture=p=>fs.readFileSync(path.join(root,'tests','fixtures',p));
async function launchPage(browser,width=360,height=640){
 const context=await browser.newContext({viewport:{width,height}});
 const page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://reader.test/**',async route=>{
  const url=new URL(route.request().url());
  const file=path.join(root,url.pathname==='/'?'index.html':url.pathname.slice(1));
  if(!fs.existsSync(file))return route.fulfill({status:404,body:'missing'});
  const type=file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':
   file.endsWith('.json')?'application/json':'text/html; charset=utf-8';
  await route.fulfill({body:fs.readFileSync(file),contentType:type});
 });
 await page.goto('https://reader.test/');
 await page.evaluate(()=>readerReady);
 await page.waitForSelector('#insightsOpen');
 return {context,page,errors};
}
async function openReader(page){
 await page.locator('#openViewerBtn').click();
 await page.waitForFunction(()=>!restoreInProgress&&pages.length>0,null,{timeout:20000});
}
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 let checks=0;
 try{
  // Unified TXT must show only body, keep early information, and prevent late spoilers.
  {
   const {context,page,errors}=await launchPage(browser);
   await page.locator('#txtFileInput').setInputFiles({
    name:'insights-sample-integrated-v2.txt',mimeType:'text/plain',
    buffer:fixture('insights-sample-integrated-v2.txt')
   });
   const raw=fixture('insights-sample-plain.txt').toString('utf8');
   assert.equal(await page.locator('#inputText').inputValue(),raw);checks++;
   await openReader(page);
   assert.equal(await page.evaluate(()=>fullText.includes('READER_INSIGHTS_V2_BEGIN')),false);checks++;
   assert.ok(await page.evaluate(async()=>{const d=await window.ReaderInsightsData.load(fullText);return d.records.length===6;}));checks++;
   await page.locator('#insightsOpen').click();
   assert.equal(await page.locator('[data-insight-tab]').count(),4);checks++;
   await page.locator('[data-insight-tab=character]').click();
   assert.equal((await page.locator('#insightsPaper').innerText()).includes('의심보다 협력으로 바뀐 목표'),false);checks++;
   const anchorBefore=await page.evaluate(()=>readerAnchor());
   await page.locator('#insightsNext').click();
   assert.equal(await page.evaluate(()=>readerAnchor()),anchorBefore);checks++;
   await page.locator('#insightsClose').click();
   await page.evaluate(()=>readerGoChapter(2));
   await page.waitForFunction(()=>!restoreInProgress);
   // Advance through the last chapter to make its final quote visible.
   await page.evaluate(async()=>{
    for(let n=0;n<30;n++){
     if(readerLazyActive())await readerLazyTurn(1);
     else goNextPage();
     if(!restoreInProgress&&readerAnchor()>=readerCanonical().length-1)break;
    }
    window.readerInsights?.observe();
   });
   await page.locator('#insightsOpen').click();
   await page.locator('[data-insight-tab=character]').click();
   assert.ok(await page.locator('#insightsPageCount').innerText().then(t=>t!=='0 / 0'));checks++;
   await page.locator('#insightsClose').click();
   assert.deepEqual(errors,[]);checks++;
   await context.close();
  }
  // Plain TXT is blank until a separate JSON is loaded.
  {
   const {context,page,errors}=await launchPage(browser,390,760);
   await page.locator('#txtFileInput').setInputFiles({
    name:'insights-sample-plain.txt',mimeType:'text/plain',buffer:fixture('insights-sample-plain.txt')
   });
   await openReader(page);
   await page.locator('#insightsOpen').click();
   assert.equal((await page.locator('#insightsPaper').innerText()).trim(),'');checks++;
   assert.equal((await page.locator('#insightsPageCount').innerText()).trim(),'0 / 0');checks++;
   page.once('dialog',dialog=>dialog.accept());
   await page.locator('#insightsImportInput').setInputFiles({
    name:'insights-sample-v2.json',mimeType:'application/json',buffer:fixture('insights-sample-v2.json')
   });
   await page.waitForFunction(async()=>!!(await window.ReaderInsightsData.load(fullText))?.records?.length);
   await page.locator('[data-insight-tab=event]').click();
   assert.notEqual((await page.locator('#insightsPageCount').innerText()).trim(),'0 / 0');checks++;
   await page.locator('#insightsClose').click();
   assert.deepEqual(errors,[]);checks++;
   await context.close();
  }
  console.log('reader insights v2 passed '+checks+' browser regression assertions');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
