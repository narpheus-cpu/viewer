const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const source=Array.from({length:14},(_,i)=>
 '['+(i+1)+'장 · '+String.fromCharCode(65+i)+']\n\n'+
 Array.from({length:160},(_,j)=>
  '이것은 '+(i+1)+'장 '+(j+1)+'번째 문장이다. 사건의 맥락과 세부 내용을 간략히 설명한다.').join('\n\n')).join('\n\n');
async function check(browser,android=false){
 const base=android?path.join(root,'android/app/src/main/assets'):root;
 const url=android?'https://appassets.androidplatform.net/assets/index.html':'https://reader.test/';
 const ctx=await browser.newContext({viewport:{width:390,height:760}}),page=await ctx.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route(android?'https://appassets.androidplatform.net/**':'https://reader.test/**',async route=>{
  const u=new URL(route.request().url());
  const rel=android?u.pathname.replace(/^\/assets\//,''):u.pathname.slice(1)||'index.html';
  const target=path.join(base,rel);
  if(!fs.existsSync(target))return route.fulfill({status:404,body:'missing'});
  await route.fulfill({body:fs.readFileSync(target),contentType:rel.endsWith('.js')?'application/javascript':rel.endsWith('.css')?'text/css':'text/html; charset=utf-8'});
 });
 await page.goto(url);await page.evaluate(()=>readerReady);
 await page.locator('#txtFileInput').setInputFiles({name:'chapters-focus.txt',mimeType:'text/plain',buffer:Buffer.from(source,'utf8')});
 await page.waitForFunction(expected=>!openViewerBtn.disabled&&inputText.value===expected,source,{timeout:30000});
 await page.evaluate(()=>{if(typeof hideRecentHistory==='function')hideRecentHistory();});
 await page.locator('#openViewerBtn').click();
 await page.waitForFunction(()=>readerLazySession?.opened&&!restoreInProgress,null,{timeout:45000});
 assert.equal(await page.evaluate(()=>bookChapters.length),14);
 await page.locator('#openReaderChapter').click();
 await page.waitForSelector('#readerChapterList button[data-chapter="7"]:visible');
 // Android sometimes sends a window blur when a floating panel/native UI is focused.
 // The chapter modal is outside viewerOverlay, so touches on it used to be ignored
 // by the layout-resume input listener.
 await page.evaluate(()=>readerBrowserPauseLayout());
 await page.locator('#readerChapterList button[data-chapter="7"]').click();
 try{
  await page.waitForFunction(()=>!restoreInProgress&&readerCurrentChapter()===7,null,{timeout:15000});
 }catch(error){
  const state=await page.evaluate(()=>({chapter:readerCurrentChapter(),anchor:readerAnchor(),away:readerBrowserResume.away,settling:readerBrowserResume.settling,paused:readerBrowserLayoutPaused(),loading:restoreInProgress,chapterMenu:readerChapterIsOpen(),queue:readerLazySession?.queue.length,priority:readerLazySession?.priority,status:statusEl.textContent}));
  throw new Error('Modal chapter jump failed after window blur: '+JSON.stringify(state));
 }
 assert.equal(await page.locator('#chapterProgress').innerText(),'8 / 14');
 assert.ok((await page.locator('#pageInnerLeft').innerText()).includes('8장'),'Selected chapter content is visible');
 // UI controls should still work, including after section calculation finishes.
 await page.locator('#nextChapter').click();
 await page.waitForFunction(()=>!restoreInProgress&&readerCurrentChapter()===8,null,{timeout:20000});
 assert.equal(await page.locator('#chapterProgress').innerText(),'9 / 14');
 await page.locator('#prevChapter').click();
 await page.waitForFunction(()=>!restoreInProgress&&readerCurrentChapter()===7,null,{timeout:20000});
 assert.equal(await page.locator('#chapterProgress').innerText(),'8 / 14');
 // Native select is hidden in the UI but its event path must remain valid.
 await page.evaluate(()=>{
  const s=document.querySelector('#chapterSelect');s.value='3';s.dispatchEvent(new Event('change',{bubbles:true}));
 });
 await page.waitForFunction(()=>!restoreInProgress&&readerCurrentChapter()===3,null,{timeout:20000});
 assert.equal(await page.locator('#chapterProgress').innerText(),'4 / 14');
 const newAnchor=await page.evaluate(()=>readerAnchor());
 assert.equal(newAnchor,await page.evaluate(()=>chapterCanonicalStarts[3]));
 assert.deepEqual(errors,[]);
 console.log((android?'Android':'Web')+' chapter modal blur/resume, next/previous, select and position passed');
 await ctx.close();
}
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 try{await check(browser,false);if(process.env.VERIFY_ANDROID_ASSETS==='1')await check(browser,true);}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
