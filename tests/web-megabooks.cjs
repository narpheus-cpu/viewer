// Multi-million-character reader acceptance test: TXT import, chapter-first pagination,
// random access, read position persistence, source integrity, and cancellation.
// NODE: Run with CHROME_PATH=/usr/bin/chromium npm run test:megabooks.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const sizes=(process.env.MEGABOOK_SIZES||'1200000,3200000,6200000').split(',').map(Number);
const cases=sizes.map((min,i)=>({min,chapters:[48,68,96][i]||80}));
const sentence='등장인물은 과거의 말을 떠올리고 현재의 선택을 조심스럽게 검토했다. 어떤 이유인지 이 시점에서는 알 수 없었다.';
const para=sentence+'\n\n'+sentence+'\n\n';
const giantParagraph=process.env.MEGABOOK_LONG_PARAGRAPHS==='1';
function generate(min,chapters){
 const per=Math.ceil(min/chapters);
 let all=[];
 for(let n=0;n<chapters;n++){
  const marker='고유장면_'+String(n).padStart(3,'0');
  const chapter='['+String(n+1).padStart(3,'0')+'장]\n\n'+marker+'\n\n';
  const filler=giantParagraph?sentence:para;
  const count=Math.ceil((per-chapter.length)/filler.length);
  all.push(chapter+filler.repeat(Math.max(1,count)));
 }
 return all.join('\n\n');
}
async function runCase(browser,c,kind){
 const isAndroid=kind==='android',webAssets=isAndroid?path.join(root,'android/app/src/main/assets'):root;
 const source=generate(c.min,c.chapters);
 assert.ok(source.length>=c.min&&source.length<c.min+c.chapters*para.length);
 const context=await browser.newContext({viewport:{width:390,height:720},
  ...(isAndroid?{userAgent:'Mozilla/5.0 (Linux; Android 11; eInk) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'}:{})});
 const page=await context.newPage(),errors=[];
 if(process.env.MEGABOOK_CPU_THROTTLE){const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:Number(process.env.MEGABOOK_CPU_THROTTLE)});}
 page.on('pageerror',e=>errors.push(e.message));
 const prefix=isAndroid?'https://appassets.androidplatform.net/assets/':'https://reader.test/';
 await page.route(isAndroid?'https://appassets.androidplatform.net/**':'https://reader.test/**',async route=>{
  const url=new URL(route.request().url());
  const rel=isAndroid?url.pathname.replace(/^\/assets\//,''):url.pathname.slice(1)||'index.html';
  const file=path.join(webAssets,rel);
  if(!fs.existsSync(file))return route.fulfill({status:404,body:'missing'});
  const contentType=rel.endsWith('.js')?'application/javascript':rel.endsWith('.css')?'text/css':rel.endsWith('.json')?'application/json':'text/html; charset=utf-8';
  await route.fulfill({contentType,body:fs.readFileSync(file)});
 });
 const t=Date.now();await page.goto(prefix+(isAndroid?'index.html':''));
 await page.evaluate(()=>readerReady);
 const startupMs=Date.now()-t;
 const uploadStart=Date.now();
 await page.locator('#txtFileInput').setInputFiles({name:'megabook-'+c.min+'.txt',mimeType:'text/plain',buffer:Buffer.from(source)});
 await page.waitForFunction(expected=>!openViewerBtn.disabled&&inputText.value.length===expected,source.length,{timeout:240000});
 const importMs=Date.now()-uploadStart;
 console.log(JSON.stringify({stage:'imported',kind,characters:source.length,chapters:c.chapters,importMs}));
 const bookLength=await page.evaluate(()=>inputText.value.length);
 assert.equal(bookLength,source.length,'TXT bytes and characters survive import');
 await page.evaluate(()=>{if(typeof hideRecentHistory==='function')hideRecentHistory();});
 const firstStart=Date.now();await page.locator('#openViewerBtn').click();
 await page.waitForFunction(()=>readerLazySession?.opened&&!restoreInProgress&&!readerState.initializing,null,{timeout:240000});
 const firstMs=Date.now()-firstStart;
 console.log(JSON.stringify({stage:'first-visible',kind,characters:source.length,chapters:c.chapters,firstMs}));
 const state=await page.evaluate(()=>({
  chapters:bookChapters.length,done:readerLazySession.done,visible:pageInnerLeft.textContent,
  active:readerLazyActive(),canonical:readerCanonical().length,
  firstVisibleMs:readerLazyStats.firstVisibleMs,session:readerLazySession.results.length
 }));
 assert.equal(state.chapters,c.chapters,'All expected chapters are addressable');
 assert.ok(state.done<c.chapters,'First page must not wait for full book');
 assert.ok(state.visible.includes('고유장면_000'),'First chapter is visible');
 assert.ok(state.active,'Large book remains lazily paginated');
 assert.ok(state.canonical>0,'Canonical source computed');
 const integrity=await page.evaluate(n=>({blockTextParity:cachedOriginalBlocks.length===cachedBlockTexts.length,chapterStartsStrict:chapterCanonicalStarts.every((v,i)=>!i||v>chapterCanonicalStarts[i-1]),markers:Array.from({length:n},(_,i)=>readerCanonical().includes('고유장면_'+String(i).padStart(3,'0'))).every(Boolean)}),c.chapters);
 assert.ok(integrity.blockTextParity&&integrity.chapterStartsStrict&&integrity.markers,'All chapter markers, canonical offsets, and stable text blocks are preserved');
 const farChapter=c.chapters-2,farMarker='고유장면_'+String(farChapter).padStart(3,'0');
 const navStart=Date.now();
 await page.evaluate(c=>readerGoChapter(c),farChapter);
 await page.waitForFunction(target=>!restoreInProgress&&readerCurrentChapter()===target,farChapter,{timeout:180000});
 const farMs=Date.now()-navStart;
 console.log(JSON.stringify({stage:'far-jump',kind,characters:source.length,chapter:farChapter,farMs}));
 assert.ok((await page.locator('#pageInnerLeft').innerText()).includes(farMarker),'Far chapter shows its exact marker');
 const farAnchor=await page.evaluate(()=>readerAnchor());
 assert.ok(farAnchor>source.length*.70,'Far chapter anchor is near book end');
 const responseStart=Date.now();
 await page.evaluate(()=>{document.getElementById('insightsOpen')?.click();});
 await page.waitForFunction(()=>window.readerInsights?.isOpen?.(),null,{timeout:15000});
 const responseMs=Date.now()-responseStart;
 await page.locator('#insightsClose').click();
 // Allow pending storage writes to commit; verify navigation not reset by bookkeeping.
 await page.evaluate(async()=>{flushReadingSessionSave(true);await Promise.race([readingDatabaseWrite,new Promise((_,reject)=>setTimeout(()=>reject(Error('position store timeout')),20000))]);});
 if(!isAndroid){
  const reloadStart=Date.now();await page.reload();await page.evaluate(()=>readerReady);
  await page.waitForFunction(()=>readerLazySession?.opened&&!restoreInProgress,null,{timeout:240000});
  assert.equal(await page.evaluate(()=>readerCurrentChapter()),farChapter,'Reopen returns to far chapter');
  assert.equal(await page.evaluate(()=>readerAnchor()),farAnchor,'Reopen preserves original canonical offset');
  console.log(JSON.stringify({kind,characters:source.length,chapters:c.chapters,startupMs,importMs,firstMs,farMs,responseMs,reopenMs:Date.now()-reloadStart}));
 }else{
  console.log(JSON.stringify({kind,characters:source.length,chapters:c.chapters,startupMs,importMs,firstMs,farMs,responseMs}));
 }
 await page.evaluate(()=>closeViewer());
 assert.equal(await page.evaluate(()=>readerLazySession),null,'Close cancels running background pagination');
 assert.deepEqual(errors,[],'No uncaught browser errors');
 await context.close();
}
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 try{
  for(const c of cases)await runCase(browser,c,'web');
  if(process.env.MEGABOOK_ANDROID==='1')await runCase(browser,{min:3200000,chapters:68},'android');
 }finally{await browser.close();}
})().catch(err=>{console.error(err);process.exitCode=1;});
