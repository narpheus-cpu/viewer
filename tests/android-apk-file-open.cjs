const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const assets=path.resolve(__dirname,'../android/app/src/main/assets');
const demo=fs.readFileSync(path.resolve(__dirname,'fixtures/insights-navigator-demo.txt'));
const html=fs.readFileSync(path.join(assets,'index.html'),'utf8');
assert.match(html,/const readerReady=new Promise/);
assert.equal((html.match(/const readerReady=new Promise/g)||[]).length,1,'Reader startup must not be duplicated');
assert.doesNotMatch(html,/<script\s+src=["']\.\/reader-core\.js/,'Do not load old reader-core alongside inline readerState');
async function check(){
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 let checks=0;
 try{
  const context=await browser.newContext({viewport:{width:390,height:740},userAgent:
   'Mozilla/5.0 (Linux; Android 11; eInk) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://appassets.androidplatform.net/**',async route=>{
   const u=new URL(route.request().url()),f=path.resolve(assets,'.'+u.pathname.replace(/^\/assets/,''));
   if(!f.startsWith(assets+path.sep)&&f!==path.join(assets,'index.html'))
     return route.fulfill({status:403,body:'blocked'});
   if(!fs.existsSync(f))return route.fulfill({status:404,body:'not found'});
   const mime=f.endsWith('.js')?'application/javascript':f.endsWith('.css')?'text/css':
       f.endsWith('.json')?'application/json':'text/html; charset=utf-8';
   await route.fulfill({contentType:mime,body:fs.readFileSync(f)});
  });
  await page.goto('https://appassets.androidplatform.net/assets/index.html');
  const ready=await page.evaluate(()=>Promise.race([readerReady.then(()=>true),new Promise(r=>setTimeout(()=>r(false),2500))]));
  assert.equal(ready,true,'APK startup never resolved readerReady');checks++;
  assert.equal(await page.evaluate(()=>readerState.initializing),false,'Reader stuck initializing');checks++;
  assert.deepEqual(errors,[],'JS runtime errors at startup');checks++;

  async function importTxt(name,text){
   await page.locator('#txtFileInput').setInputFiles({
     name,mimeType:'text/plain',buffer:Buffer.from(text,'utf8')
   });
   await page.waitForFunction(()=>!document.querySelector('#chooseTxtBtn').disabled
       && !document.querySelector('#openViewerBtn').disabled,null,{timeout:20000});
   assert.equal(await page.locator('#inputText').inputValue(),text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n'));
   checks++;
  }
  // Reproduction of the reported issue: the two buttons stay disabled forever
  // when an older reader-core.js redeclares readerState, aborting initialisation.
  await importTxt('그림자_01.txt','\uFEFF[제1장]\r\n첫 번째 장면이다.\r\n두 사람이 만나 대화했다.');
  assert.equal(await page.locator('#chooseTxtBtn').isEnabled(),true);checks++;
  assert.equal(await page.locator('#openViewerBtn').isEnabled(),true);checks++;
  await page.evaluate(()=>{if(typeof hideRecentHistory==='function')hideRecentHistory();});
  await page.locator('#openViewerBtn').click();
  await page.waitForFunction(()=>pages.length>0&&!restoreInProgress,null,{timeout:30000});
  assert.ok(await page.evaluate(()=>fullText.includes('두 사람이 만나')),'Imported TXT did not reach pagination');checks++;
  await page.evaluate(()=>closeViewer());
  // Repeat with long content and embedded 96 insight records.
  await importTxt('insights-navigator-demo.txt',demo.toString('utf8'));
  assert.equal(await page.evaluate(()=>window.ReaderInsightsData?.parse(document.querySelector('#inputText').value).hasInsights),false,
   'Integrated insight metadata should be extracted from displayed text');checks++;
  const loaded=await page.evaluate(async()=>!!(await window.ReaderInsightsData.load(document.querySelector('#inputText').value))?.records?.length);
  assert.equal(loaded,true,'Imported insight records are missing');checks++;
  const plain=('긴 소설 테스트에서는 페이지 로딩 중에도 버튼이 다시 활성화되어야 한다.\n').repeat(2400);
  await importTxt('long_novel.txt',plain);
  assert.equal(await page.locator('#chooseTxtBtn').isEnabled(),true);checks++;
  assert.deepEqual(errors,[],'JavaScript errors while importing TXT');checks++;
  await context.close();
  console.log(checks+' offline Android APK TXT chooser, unlock, pagination and insights smoke checks passed');
 }finally{await browser.close();}
}
check().catch(error=>{console.error(error);process.exitCode=1;});
