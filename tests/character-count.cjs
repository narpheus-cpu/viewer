const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),{chromium}=require('playwright');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROME_PATH});let checks=0;try{
 for(const width of (root.includes('assets')?[390]:[390,1280])){const context=await browser.newContext({viewport:{width,height:800}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.route('https://reader.test/**',async route=>{const p=new URL(route.request().url()).pathname,file=path.join(root,p==='/'?'index.html':p.slice(1));await route.fulfill(fs.existsSync(file)?{contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.json')?'application/json':'text/html; charset=utf-8',body:fs.readFileSync(file)}:{status:404,body:'missing'});});
 await page.goto('https://reader.test/');await page.evaluate(()=>readerReady);
 const whitespace=' \t\r\n\v\f\u00a0\u0085\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u200b';
 assert.deepEqual(await page.evaluate(w=>[formatCharacterCount(''),formatCharacterCount(w),formatCharacterCount('한 A\t😀\n글'),formatCharacterCount('A'.repeat(1234))],whitespace),['0자','0자','4자','1,234자']);checks+=4;
 const source='[가]\nA B\tC\n😀'+whitespace+'\n\n[나]\n한 글\n\n[다]\nX\tY\n';
 await page.evaluate(t=>{inputText.value=t;updateInputCharacterCount();},source);assert.equal(await page.locator('#inputCharCount').textContent(),'17자');checks++;
 await page.locator('#openViewerBtn').click();await page.waitForFunction(()=>pages.length&&!restoreInProgress&&!readerLazyActive());await page.evaluate(()=>readerState.pendingCache);
 assert.equal(await page.locator('#viewerCharCount').textContent(),'7/17자');assert.deepEqual(await page.evaluate(()=>viewerChapterCounts),[7,5,5]);checks+=2;
 assert.equal(await page.evaluate(()=>fullText),source.replace(/\r\n?/g,'\n'));checks++;
 for(const chapter of [1,2]){await page.evaluate(c=>readerGoChapter(c),chapter);await page.waitForFunction(()=>!restoreInProgress);assert.equal(await page.locator('#viewerCharCount').textContent(),'5/17자');checks++;}
 assert.match(await page.locator('#inputCharCount').getAttribute('title'),/제외/);assert.match(await page.locator('#viewerCharCount').getAttribute('title'),/제외/);checks+=2;
 // Upgrade existing valid page layouts while rejecting old count metadata alone.
 const before=await page.evaluate(()=>({anchor:readerAnchor(),pages:pages.slice(),anchors:pageAnchors.slice(),canonical:readerCanonical()}));
 for(const version of [null,'space-including-v0']){
  await page.evaluate(async version=>{const cache=await readerReadCache(activeRecentId);cache.chapterCounts=[99,99,99];cache.totalCount=297;if(version===null)delete cache.countVersion;else cache.countVersion=version;await readerStoreCache(cache);flushReadingSessionSave(true);await readingDatabaseWrite;},version);
  await page.reload();await page.evaluate(()=>readerReady);await page.evaluate(()=>readerState.pendingCache);
  assert.equal(await page.evaluate(()=>readerStats.splits),0);assert.equal(await page.locator('#viewerCharCount').textContent(),'5/17자');assert.deepEqual(await page.evaluate(()=>({anchor:readerAnchor(),pages:pages.slice(),anchors:pageAnchors.slice(),canonical:readerCanonical()})),before);checks+=3;
  const updated=await page.evaluate(async()=>{const c=await readerReadCache(activeRecentId);return{valid:readerCountCacheValid(c),total:c.totalCount,counts:c.chapterCounts};});assert.deepEqual(updated,{valid:true,total:17,counts:[7,5,5]});checks++;
 }
 // Matching count metadata is reused without recounting or paginating on reopen.
 await page.reload();await page.evaluate(()=>readerReady);assert.equal(await page.evaluate(async()=>readerCountCacheValid(await readerReadCache(activeRecentId))),true);assert.equal(await page.evaluate(()=>readerStats.splits),0);assert.equal(await page.locator('#viewerCharCount').textContent(),'5/17자');checks+=3;
 assert.deepEqual(errors,[]);checks++;await context.close();
 }console.log(checks+' whitespace-excluded input/chapter/total counts, Unicode, unchanged text/anchors, count-only cache migration and cache reuse checks passed: '+root);
}finally{await browser.close()}})().catch(e=>{console.error(String(e.stack||e).slice(0,2000));process.exitCode=1;});
