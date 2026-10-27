const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright');
const root=path.resolve(process.argv[2]||path.join(__dirname,'../android/app/src/main/assets'));
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROME_PATH});let checks=0;try{
 const context=await browser.newContext({viewport:{width:360,height:640}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));await page.addInitScript(()=>{window.testHidden=false;Object.defineProperty(document,'visibilityState',{get:()=>testHidden?'hidden':'visible'});});
 await page.route('https://reader.test/**',async route=>{const p=new URL(route.request().url()).pathname,file=path.join(root,p==='/'?'index.html':p.slice(1));if(!fs.existsSync(file)){await route.fulfill({status:404,body:'missing'});return;}await route.fulfill({contentType:file.endsWith('.json')?'application/json':file.endsWith('.js')?'application/javascript':'text/html; charset=utf-8',body:fs.readFileSync(file)});});
 await page.goto('https://reader.test/');await page.evaluate(()=>readerReady);const cdp=await context.newCDPSession(page);if(process.env.SLOW_CPU)await cdp.send('Emulation.setCPUThrottlingRate',{rate:Number(process.env.SLOW_CPU)});
 
 const source=Array.from({length:52},(_,c)=>'['+String(c+1).padStart(2,'0')+'장]\n\n고유표식'+String(c).padStart(3,'0')+'\n\n'+('읽던 위치와 문장 구분을 유지하면서 큰 책을 구간별로 계산합니다.\n\n'.repeat(800)).slice(0,24980)).join('\n\n');assert.ok(source.length>=1290000&&source.length<=1310000);checks++;
 await page.locator('#txtFileInput').setInputFiles({name:'large-52.txt',mimeType:'text/plain',buffer:Buffer.from(source)});await page.waitForFunction(()=>!openViewerBtn.disabled&&inputText.value.length>1290000,{},{timeout:180000});const started=Date.now();await page.locator('#openViewerBtn').click();await page.waitForFunction(()=>!restoreInProgress&&readerLazySession?.opened,{},{timeout:180000});
 const first=await page.evaluate(()=>{testHidden=true;return{done:readerLazySession.done,chapters:bookChapters.length,source:fullText.length,ms:readerLazyStats.firstVisibleMs,shown:pageInnerLeft.textContent,partial:readerLazyActive(),counter:counter.textContent}});assert.equal(first.chapters,52);assert.ok(first.done<52);assert.ok(first.partial);assert.ok(first.shown.includes('고유표식000'));assert.match(first.counter,/전체 계산/);checks+=5;
 
 // Completed chapter data reaches disk before the other 51 chapters are required.
 await page.waitForFunction(async()=>{const s=readerLazySession,r=await readerLazyRead(s,0);return r?.pages?.length>0;});checks++;
 const anchor=await page.evaluate(()=>{const r=readerLazySession.results[0],i=Math.min(3,r.anchors.length-1);readerChooseAnchor(r.anchors[i]);pageIndex=findPageIndexForAnchor(r.anchors[i]);render();flushReadingSessionSave(true);return readerAnchor();});
 await page.evaluate(async()=>{await readingDatabaseWrite;await window.__androidFlushState?.();});await page.reload();await page.evaluate(()=>readerReady);await page.waitForFunction(()=>!restoreInProgress&&readerLazySession?.opened,{},{timeout:180000});
 assert.equal(await page.evaluate(()=>readerAnchor()),anchor);assert.ok(await page.evaluate(()=>readerLazyStats.chapterCacheHits>0));checks+=2;
 
 // A far-away chapter is prioritized while the full global page total remains pending.
 await page.evaluate(()=>readerGoChapter(50));await page.waitForFunction(()=>!restoreInProgress&&readerCurrentChapter()===50,{},{timeout:180000});assert.ok(await page.locator('#pageInnerLeft').textContent().then(s=>s.includes('고유표식050')));assert.ok(await page.evaluate(()=>readerLazySession.done<10));checks+=2;
 
 // Search uses canonical book offsets even while most chapters have no page layout yet.
 await page.evaluate(()=>{const a=readerCanonical().indexOf('고유표식025');readerSearchMatches=[{start:a,end:a+9}];readerGoSearchResult(0);});await page.waitForFunction(()=>!restoreInProgress&&readerCurrentChapter()===25,{},{timeout:180000});assert.ok(await page.locator('#pageInnerLeft').textContent().then(s=>s.includes('고유표식025')));assert.ok(await page.evaluate(()=>readerLazySession.done<15));checks+=2;
 await page.evaluate(()=>{testHidden=true;});
 
 // A chapter generator preserves the complete canonical text and its offsets.
 const exact=await page.evaluate(()=>{const s=readerLazySession,c=25,r=s.results[c],first=s.bounds[c],last=s.bounds[c+1]??cachedOriginalBlocks.length;return{actual:r.pages.map(htmlToStableText).join('').replace(/\s/g,''),expected:cachedBlockTexts.slice(first,last).join('').replace(/\s/g,''),anchors:r.anchors.every((a,i)=>a>=chapterCanonicalStarts[c]&&(!i||a>r.anchors[i-1]))}});assert.equal(exact.actual,exact.expected);assert.equal(exact.anchors,true);checks+=2;
 const before=await page.evaluate(()=>readerLazyStats.chapterBuilds);await page.locator('#closeViewer').click();await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>readerLazySession),null);assert.equal(await page.evaluate(()=>readerLazyStats.chapterBuilds),before);checks+=2;
 assert.deepEqual(errors,[]);checks++;console.log(JSON.stringify({checks,characters:source.length,chapters:52,firstVisibleMs:Math.round(first.ms),firstCompletedChapters:first.done,wallMs:Date.now()-started,cpuThrottle:process.env.SLOW_CPU||1}));await context.close();
}finally{await browser.close()}})().catch(e=>{console.error(String(e).slice(0,1500));process.exitCode=1;});
