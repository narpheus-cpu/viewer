const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium}=require('playwright'),JSZip=require('jszip');
const target=path.resolve(process.argv[2]||path.join(__dirname,'../index.html'));
async function epub(){
  const zip=new JSZip();zip.file('mimetype','application/epub+zip');
  zip.file('META-INF/container.xml','<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>');
  zip.file('book.opf','<package version="3.0"><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/><item id="b" href="b.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>');
  zip.file('a.xhtml','<html><body><h1>첫 장</h1><p>'+('첫 장의 문장과 <em>서식</em>입니다. '.repeat(100))+'</p></body></html>');
  zip.file('b.xhtml','<html><body><h1>둘째 장</h1><p>'+('둘째 장의 내용입니다. '.repeat(100))+'</p></body></html>');
  return zip.generateAsync({type:'nodebuffer'});
}
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});let checks=0;
 try{
 for(const width of [360,1280])for(const format of ['txt','epub']){
  const context=await browser.newContext({viewport:{width,height:844}}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(String(error)));
  await page.addInitScript(()=>{
    window.seedCache=new Promise((resolve,reject)=>{
      const request=indexedDB.open('ebookViewerLayoutCacheV1',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('pages',{keyPath:'id'}).put({id:'legacy-migration-test',updatedAt:1,pages:['legacy page']});
      request.onsuccess=()=>{request.result.close();resolve();};request.onerror=()=>request.error?.name==='VersionError'?resolve():reject(request.error);
    });
    window.AndroidReader={readSettings:()=>'',saveSettings:()=>{},readPosition:()=>localStorage.getItem('testNativePosition')||'',savePosition:raw=>localStorage.setItem('testNativePosition',raw)};
    window.bookReads=0;document.addEventListener('DOMContentLoaded',()=>{const original=getRecentBook;window.getRecentBook=async(...args)=>{bookReads++;return original(...args);};});
  });
  await page.goto(pathToFileURL(target).href);await page.evaluate(()=>readerReady);
  const migration=await page.evaluate(async()=>{
    await seedCache;const record=await readerReadCache('legacy-migration-test'),db=await readerCacheDatabase();
    const indexed=db.transaction('pages').objectStore('pages').indexNames.contains('updatedAt'),version=db.version;db.close();
    await readerDeleteCache('legacy-migration-test');return {page:record.pages[0],indexed,version};
  });assert.deepEqual(migration,{page:'legacy page',indexed:true,version:2});checks++;
  await page.evaluate(()=>{viewerSettings={...viewerSettings,fontSize:18,breakSentence:true,sentenceSpacing:true};applyViewerSettings(false);saveViewerSettings();});
  if(format==='txt')await page.locator('#inputText').fill('[첫 장]\n\n'+('첫 장 문장이다. '.repeat(200))+'\n\n[둘째 장]\n\n'+('두 번째 문장이다. '.repeat(200))+'\n\n[마지막 장]\n마지막 문장.');
  else{await page.locator('#txtFileInput').setInputFiles({name:'cached.epub',mimeType:'application/epub+zip',buffer:await epub()});await page.waitForFunction(()=>!openViewerBtn.disabled);}
  await page.locator('#openViewerBtn').click();await page.waitForFunction(()=>pages.length&&!restoreInProgress);
  await page.locator('#chapterSelect').selectOption('1',{force:true});
  const original=await page.evaluate(async()=>{await readerState.pendingCache;await readingDatabaseWrite;return {anchor:readerAnchor(),canonical:readerCanonical(),count:document.getElementById('viewerCharCount').textContent,chapterPage:document.getElementById('chapterPageCount').textContent};});
  await page.reload();await page.evaluate(()=>readerReady);
  const reopened=await page.evaluate(()=>({splits:readerStats.splits,blocks:cachedMarkdownSource,reads:bookReads,anchor:readerAnchor(),canonical:readerCanonical(),count:document.getElementById('viewerCharCount').textContent,chapterPage:document.getElementById('chapterPageCount').textContent}));
  assert.equal(reopened.splits,0);assert.equal(reopened.blocks,null);assert.equal(reopened.reads,1);
  for(const key of Object.keys(original))assert.equal(reopened[key],original[key]);checks+=7;
  // A one-pixel reduction stays within the measured reserve and must not repaginate.
  const before=await page.evaluate(()=>readerStats.splits);await page.setViewportSize({width,height:843});
  await page.waitForFunction(()=>!restoreInProgress&&readerState.layout===getLayoutSignature());
  assert.equal(await page.evaluate(()=>readerStats.splits),before);assert.ok(['exact','safe-height'].includes(await page.evaluate(()=>readerStats.lastCacheReason))); // Pixel rounding can preserve the exact measured height.
   checks+=2;
  assert.equal(await page.evaluate(()=>pageInnerLeft.scrollHeight<=pageInnerLeft.clientHeight+1),true);checks++;
  const overflow=await page.evaluate(()=>{
    const box=ensurePaginationMeasureBox();box.style.height=pageInnerLeft.getBoundingClientRect().height+'px';let worst=0;
    for(const html of pages){box.innerHTML=html;worst=Math.max(worst,box.scrollHeight-box.clientHeight);}
    box.innerHTML='';return worst;
  });assert.ok(overflow<=1);checks++;
  // Real typography changes reflow; returning to the previous typography uses the retained layout.
  await page.evaluate(async()=>{viewerSettings.fontSize=22;applyViewerSettings(false);await repaginate();await readerState.pendingCache;});
  assert.equal(await page.evaluate(()=>readerStats.splits),before+1);checks++;
  await page.evaluate(async()=>{viewerSettings.fontSize=18;applyViewerSettings(false);await repaginate();});
  assert.equal(await page.evaluate(()=>readerStats.splits),before+1);assert.equal(await page.evaluate(()=>readerAnchor()),original.anchor);checks+=2;
  // Existing v1.12 page caches are upgraded without recalculating their page breaks.
  await page.evaluate(async()=>{
    const legacy={...(await readerReadCache(activeRecentId)),signature:getLayoutSignature(),pages:pages.slice(),anchors:pageAnchors.slice()};
    for(const key of ['chapterSignature','chapterStarts','chapterCounts','totalCount','layouts','fitHeight'])delete legacy[key];
    await readerStoreCache(legacy);flushReadingSessionSave(true);await readingDatabaseWrite;
  });
  await page.reload();await page.evaluate(()=>readerReady);await page.evaluate(()=>readerState.pendingCache);
  assert.equal(await page.evaluate(()=>readerStats.splits),0);assert.equal(await page.evaluate(()=>readerAnchor()),original.anchor);checks+=2;
  await page.reload();await page.evaluate(()=>readerReady);
  assert.equal(await page.evaluate(()=>cachedMarkdownSource),null);checks++;
  // Insets settling just after a long reflow must not make the entire book reflow twice.
  const settling=await page.evaluate(async()=>{
    const before=readerStats.splits,original=splitIntoPages;let adjusted=false;
    window.splitIntoPages=text=>{
      const result=original(text);
      if(!adjusted){adjusted=true;const height=pageInnerLeft.getBoundingClientRect().height-1;pageInnerLeft.style.height=height+'px';pageInnerRight.style.height=height+'px';}
      return result;
    };
    try{viewerSettings.fontSize=24;applyViewerSettings(false);await repaginate();await readerState.pendingCache;return {splits:readerStats.splits-before,reason:readerStats.lastCacheReason,anchor:readerAnchor()};}
    finally{window.splitIntoPages=original;}
  });assert.deepEqual(settling,{splits:1,reason:'reflow-reused',anchor:original.anchor});checks++;
  // Deleting a recent item must remove all retained layouts and keep other book data intact.
  await page.evaluate(async()=>{const id=activeRecentId;await deleteRecentById(id);await readerDeleteCache(id);});
  assert.equal(await page.evaluate(()=>readerState.memory.size),0);checks++;
  const pruning=await page.evaluate(async()=>{
    let fullReads=0;const original=IDBObjectStore.prototype.getAll;
    IDBObjectStore.prototype.getAll=function(...args){fullReads++;return original.apply(this,args);};
    try{
      for(let i=0;i<RECENT_LIMIT+3;i++)await readerStoreCache({id:'prune-'+i,updatedAt:i+1,pages:[]});
      const db=await readerCacheDatabase();const count=await new Promise((resolve,reject)=>{const request=db.transaction('pages').objectStore('pages').count();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});db.close();
      return {fullReads,count,memory:readerState.memory.size};
    }finally{IDBObjectStore.prototype.getAll=original;}
  });assert.deepEqual(pruning,{fullReads:0,count:20,memory:3});checks++;
  assert.deepEqual(errors,[]);checks++;await context.close();
 }
 console.log(`${checks} cache-first TXT/EPUB, height safety, typography, upgrade and recovery checks passed: ${target}`);
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
