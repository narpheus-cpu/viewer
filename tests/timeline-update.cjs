const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright');
const target=path.resolve(process.argv[2]||path.join(__dirname,'..')),old=path.resolve(process.argv[3]||path.join(__dirname,'../../../timeline-units-v125/repo'));
const index=JSON.parse(fs.readFileSync(path.join(target,'timelines/default/index.json'))),oldIndex=JSON.parse(fs.readFileSync(path.join(old,'timelines/default/index.json')));
function body(root,meta,year){const e=meta.entries.find(e=>e.from===year&&e.to===year);return JSON.parse(fs.readFileSync(path.join(root,'timelines/default/part-'+String(e.chunk).padStart(3,'0')+'.json'))).records[e.id];}
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROME_PATH});let checks=0;try{
 const context=await browser.newContext({viewport:{width:360,height:640}}),page=await context.newPage();let root=old,requests=[];const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.route('https://reader.test/**',async route=>{const u=new URL(route.request().url()),p=u.pathname,chosen=root===target&&p.endsWith('.json')&&!u.searchParams.has('v')?old:root;requests.push(u.pathname+u.search);const file=path.join(chosen,p==='/'?'index.html':p.slice(1));if(!fs.existsSync(file)){await route.fulfill({status:404,body:'missing'});return;}await route.fulfill({contentType:file.endsWith('.json')?'application/json':file.endsWith('.js')?'application/javascript':'text/html; charset=utf-8',body:fs.readFileSync(file)});});
 await page.goto('https://reader.test/');await page.evaluate(()=>readerReady);await page.waitForFunction(v=>readerTimelineMeta?.version===v,oldIndex.version);
 await page.locator('#inputText').fill(('기원전 332년과 서기 2026년의 기록을 읽습니다.\n\n').repeat(100));await page.locator('#openViewerBtn').click();await page.waitForFunction(()=>pages.length>3&&!restoreInProgress);
 await page.evaluate(()=>{pageIndex=2;readerChooseAnchor(pageAnchors[pageIndex]);render();});
 const position=await page.evaluate(()=>({page:pageIndex,anchor:readerAnchor(),canonical:readerCanonical()}));
 const original=await page.evaluate(async()=>{const i=readerTimelineMeta.entries.findIndex(e=>e.from===2026&&e.to===2026);return readerTimelineRead(i);});assert.equal(original,body(old,oldIndex,2026));checks++;
 await page.evaluate(async()=>{await window.__browserCheckpoint?.();await readerState.pendingCache;});root=target;requests=[];
 await page.reload();await page.evaluate(()=>readerReady);await page.waitForFunction(v=>readerTimelineMeta?.version===v,index.version);
 assert.equal(requests.filter(p=>p.includes('/part-')).length,0);assert.deepEqual(await page.evaluate(()=>({page:pageIndex,anchor:readerAnchor(),canonical:readerCanonical()})),position);assert.equal(await page.evaluate(()=>readerStats.splits),0);checks+=3;
 const updated=await page.evaluate(async()=>{const i=readerTimelineMeta.entries.findIndex(e=>e.from===2026&&e.to===2026);return readerTimelineRead(i);});assert.equal(updated,body(target,index,2026));assert.notEqual(updated,original);checks+=2;
 assert.ok(requests.some(p=>p.includes('index.json?v='+index.version)));assert.ok(requests.some(p=>p.includes('/part-')&&p.includes('?v='+index.version)));checks+=2;
 await page.evaluate(()=>readerTimelineImport([new File(['서기 2026년\n내가 등록한 연표'], 'custom.txt',{type:'text/plain'})]));const custom=await page.evaluate(()=>readerTimelineMeta.version);await page.reload();await page.evaluate(()=>readerReady);await page.waitForFunction(v=>readerTimelineMeta?.version===v,custom);assert.equal(await page.evaluate(()=>readerTimelineMeta.kind),'custom');checks++;
 assert.deepEqual(errors,[]);checks++;await context.close();console.log(checks+' previous-default cache upgrade, stale HTTP cache isolation, exact source body, custom preservation and book-position checks passed: '+target);
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1;});
