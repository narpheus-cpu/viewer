const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROME_PATH});let checks=0;try{
 for(const width of [390,1280]){const context=await browser.newContext({viewport:{width,height:800}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.addInitScript(()=>{window.testHidden=false;Object.defineProperty(document,'visibilityState',{get:()=>testHidden?'hidden':'visible'});});
 await page.route('https://reader.test/**',async route=>{const p=new URL(route.request().url()).pathname,file=path.join(root,p==='/'?'index.html':p.slice(1));await route.fulfill(fs.existsSync(file)?{contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.json')?'application/json':'text/html; charset=utf-8',body:fs.readFileSync(file)}:{status:404,body:'missing'});});
 await page.goto('https://reader.test/');await page.evaluate(()=>readerReady);
 const source='[첫째]\n\n'+('첫째 내용과 서식을 확인합니다.\n\n'.repeat(220))+'\n\n[둘째]\n\n둘째 짧은 내용.\n\n[셋째]\n\n'+('셋째 내용입니다.\n\n'.repeat(220))+'\n\n[넷째]\n\n'+('넷째 긴 내용은 뒤에서 처리합니다.\n\n'.repeat(2500));
 await page.locator('#txtFileInput').setInputFiles({name:'spread.txt',mimeType:'text/plain',buffer:Buffer.from(source)});await page.waitForFunction(()=>!openViewerBtn.disabled&&inputText.value.length>50000);await page.locator('#openViewerBtn').click();await page.waitForFunction(()=>readerLazySession?.opened&&!restoreInProgress);await page.evaluate(()=>testHidden=true);
 assert.equal(await page.evaluate(()=>readerLazyActive()),true);assert.equal(await page.locator('#pageJumpInput').isDisabled(),true);checks+=2;
 const allFit=await page.evaluate(()=>{const s=readerLazySession;return s.results[0].pages.every(html=>{const box=ensurePaginationMeasureBox();box.innerHTML=html;const ok=box.scrollHeight<=box.clientHeight+1;box.innerHTML='';return ok;});});assert.equal(allFit,true);checks++;
 // A turn from the last spread of a section requests only the next section.
 await page.evaluate(()=>{const s=readerLazySession,r=s.results[0];readerChooseAnchor(r.anchors.at(-1));pageIndex=findPageIndexForAnchor(readerAnchor());render();testHidden=false;goNextPage();});
 await page.waitForFunction(()=>!restoreInProgress&&readerCurrentChapter()===1);assert.match(await page.locator('#pageInnerLeft').textContent(),/둘째/);assert.equal(await page.evaluate(()=>readerAnchor()),await page.evaluate(()=>chapterCanonicalStarts[1]));checks+=2;
 await page.evaluate(()=>goPrevPage());await page.waitForFunction(()=>!restoreInProgress&&readerCurrentChapter()===0);assert.equal(await page.evaluate(()=>pageIndex%readerVisiblePageCount()),0);checks++;
 await page.evaluate(()=>readerGoChapter(2));await page.waitForFunction(()=>!restoreInProgress&&readerCurrentChapter()===2);assert.match(await page.locator('#pageInnerLeft').textContent(),/셋째/);checks++;
 // Completing other sections updates metadata without replacing either visible page.
 await page.evaluate(()=>{window.liveBefore={left:pageInnerLeft.firstChild,right:pageInnerRight.firstChild,anchor:readerAnchor()};});
 await page.waitForFunction(()=>readerLazySession?.complete,{},{timeout:120000});assert.deepEqual(await page.evaluate(()=>({left:liveBefore.left===pageInnerLeft.firstChild,right:liveBefore.right===pageInnerRight.firstChild,anchor:liveBefore.anchor===readerAnchor(),pending:!!document.querySelector('#pageInnerLeft [data-reader-pending],#pageInnerRight [data-reader-pending]')})),{left:true,right:true,anchor:true,pending:false});checks++;
 const layout=await page.evaluate(()=>({expected:readerCanonical().replace(/\s/g,''),actual:pages.map(htmlToStableText).join('').replace(/\s/g,''),starts:chapterCanonicalStarts.map(a=>findPageIndexForAnchor(a)),spacers:pages.filter(p=>p.includes('class="chapter-spacer"')).length,spread:readerVisiblePageCount()}));assert.equal(layout.actual,layout.expected);assert.ok(layout.starts.every(i=>i%layout.spread===0));if(width===1280)assert.ok(layout.spacers>0);checks+=2;
 assert.equal(await page.locator('#pageJumpInput').isEnabled(),true);checks++;
 // Changing between mobile and PC layouts rebuilds sections around the same text anchor.
 const anchor=await page.evaluate(()=>readerAnchor());await page.setViewportSize({width:width===1280?390:1280,height:800});await page.waitForFunction(()=>!restoreInProgress&&readerState.layout===getLayoutSignature(),{},{timeout:120000});assert.equal(await page.evaluate(()=>readerAnchor()),anchor);assert.equal(await page.evaluate(()=>pageIndex%readerVisiblePageCount()),0);checks+=2;
 await page.evaluate(()=>closeViewer());assert.equal(await page.evaluate(()=>readerLazySession),null);assert.deepEqual(errors,[]);checks+=2;await context.close();
 }console.log(checks+' section turns, spread alignment, visible DOM preservation, complete text and mobile/PC reflow checks passed.');
}finally{await browser.close()}})().catch(e=>{console.error(String(e).slice(0,2000));process.exitCode=1;});
