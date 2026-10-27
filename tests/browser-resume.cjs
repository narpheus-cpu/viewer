const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROME_PATH});let checks=0;try{
 for(const width of [360,1280]){
 const context=await browser.newContext({viewport:{width,height:700}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.addInitScript(()=>{
  window.testHidden=false;window.testViewport={width:innerWidth,height:innerHeight,offsetTop:0,offsetLeft:0};
  Object.defineProperty(document,'visibilityState',{get:()=>testHidden?'hidden':'visible'});Object.defineProperty(document,'hidden',{get:()=>testHidden});
  for(const key of ['width','height','offsetTop','offsetLeft'])Object.defineProperty(visualViewport,key,{get:()=>testViewport[key]});
 });
 await page.route('https://reader.test/**',async route=>{const p=new URL(route.request().url()).pathname,file=path.join(root,p==='/'?'index.html':p.slice(1));if(!fs.existsSync(file)){await route.fulfill({status:404,body:'missing'});return;}await route.fulfill({contentType:file.endsWith('.json')?'application/json':file.endsWith('.js')?'application/javascript':'text/html; charset=utf-8',body:fs.readFileSync(file)});});
 await page.goto('https://reader.test/');await page.evaluate(()=>readerReady);await page.locator('#inputText').fill(('다른 창을 보다가 돌아와도 읽던 위치를 유지하는 문장입니다.\n\n').repeat(500));await page.locator('#openViewerBtn').click();await page.waitForFunction(()=>pages.length>5&&!restoreInProgress);await page.evaluate(async()=>{pageIndex=4;readerChooseAnchor(pageAnchors[4]);render();await readerState.pendingCache;});
 await page.evaluate(()=>{
  window.resumeChecks={loading:0,displays:0,reads:0,splits:0};window.resumeOriginal={pages,anchors:pageAnchors,node:pageInnerLeft.firstChild,anchor:readerAnchor(),index:pageIndex,signature:readerState.layout};
  const loading=readerSetLoading,display=readerDisplay,read=getRecentBook,split=splitIntoPages;
  window.readerSetLoading=value=>{if(value)resumeChecks.loading++;return loading(value);};window.readerDisplay=(...args)=>{resumeChecks.displays++;return display(...args);};window.getRecentBook=(...args)=>{resumeChecks.reads++;return read(...args);};window.splitIntoPages=(...args)=>{resumeChecks.splits++;return split(...args);};
 });
 for(const kind of ['tab','window','bfcache']){
  await page.evaluate(kind=>{if(kind==='tab'){testHidden=true;document.dispatchEvent(new Event('visibilitychange'));}else window.dispatchEvent(new Event('blur'));testViewport.height=440;visualViewport.dispatchEvent(new Event('resize'));window.dispatchEvent(new Event('resize'));},kind);await page.waitForTimeout(180);
  await page.evaluate(kind=>{testHidden=false;testViewport.height=510;if(kind==='tab')document.dispatchEvent(new Event('visibilitychange'));else window.dispatchEvent(new Event('focus'));if(kind==='bfcache')window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));visualViewport.dispatchEvent(new Event('resize'));},kind);await page.waitForTimeout(110);
  await page.evaluate(()=>{testViewport.height=700;visualViewport.dispatchEvent(new Event('resize'));window.dispatchEvent(new Event('resize'));});await page.waitForTimeout(650);
  const state=await page.evaluate(()=>({...resumeChecks,samePages:pages===resumeOriginal.pages,sameAnchors:pageAnchors===resumeOriginal.anchors,sameNode:pageInnerLeft.firstChild===resumeOriginal.node,sameAnchor:readerAnchor()===resumeOriginal.anchor,sameIndex:pageIndex===resumeOriginal.index,sameSignature:readerState.layout===resumeOriginal.signature,busy:restoreInProgress||viewerOverlay.classList.contains('reader-loading')}));
  assert.deepEqual(state,{loading:0,displays:0,reads:0,splits:0,samePages:true,sameAnchors:true,sameNode:true,sameAnchor:true,sameIndex:true,sameSignature:true,busy:false},kind+' width '+width);checks++;
 }
 // A real resize while away reflows once after resume and preserves the text anchor.
 await page.evaluate(()=>{window.dispatchEvent(new Event('blur'));testViewport.height=550;visualViewport.dispatchEvent(new Event('resize'));});await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>resumeChecks.loading),0);checks++;
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForFunction(()=>!restoreInProgress&&readerState.layout===getLayoutSignature()&&resumeChecks.displays===1);assert.equal(await page.evaluate(()=>readerAnchor()),await page.evaluate(()=>resumeOriginal.anchor));assert.equal(await page.evaluate(()=>resumeChecks.splits),1);checks+=2;
 // Zero-sized intermediate viewport notifications cannot invalidate the open book.
 const stable=await page.evaluate(()=>({...resumeChecks,signature:readerState.layout}));await page.evaluate(()=>{testViewport.height=0;visualViewport.dispatchEvent(new Event('resize'));});await page.waitForTimeout(150);await page.evaluate(()=>{testViewport.height=550;visualViewport.dispatchEvent(new Event('resize'));});await page.waitForTimeout(450);assert.deepEqual(await page.evaluate(()=>({...resumeChecks,signature:readerState.layout})),stable);checks++;
 assert.deepEqual(errors,[]);checks++;await context.close();
 }console.log(checks+' background-tab, window-focus, bfcache, transient viewport, real resize and preserved live DOM/position checks passed.');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1;});
