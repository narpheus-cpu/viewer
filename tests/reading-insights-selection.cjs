const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p));
async function create(browser,userAgent){
 const context=await browser.newContext({viewport:{width:390,height:760},...(userAgent?{userAgent}:{})});
 const page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(String(e)));
 await page.route('https://reader.test/**',async route=>{
  const name=new URL(route.request().url()).pathname.slice(1)||'index.html';
  const file=path.join(root,name);
  if(!fs.existsSync(file))return route.fulfill({status:404,body:'not found'});
  await route.fulfill({contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8',body:read(name)});
 });
 await page.goto('https://reader.test/');
 await page.evaluate(()=>readerReady);
 return {page,context,errors};
}
async function setWordSelection(page){
 return page.evaluate(()=>{
  const root=document.getElementById('pageInnerLeft');
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  let node;
  while(node=walker.nextNode()){
   if(!node.textContent||!node.textContent.trim()||!node.parentElement?.closest('.page-inner'))continue;
   const match=/[가-힣A-Za-z]/.exec(node.textContent);
   if(!match)continue;
   const start=match.index,range=document.createRange();
   range.setStart(node,start);range.setEnd(node,start+1);
   getSelection().removeAllRanges();getSelection().addRange(range);
   readerGPTUpdateSelection();
   return {selected:String(getSelection()),before:ReaderInsightsData.getSeen(fullText)};
  }
  throw Error('No selectable visible book text');
 });
}
(async()=>{
 let checks=0;
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 try{
  for(const userAgent of [undefined,'Mozilla/5.0 (Linux; Android 11; eReader) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36']){
   const {page,context,errors}=await create(browser,userAgent);
   const plain=('한 사람이 작은 단어 하나를 읽고 생각했습니다. 그리고 곧 다음 문장으로 넘어갔습니다.\n\n').repeat(220);
   await page.locator('#inputText').fill(plain);
   await page.locator('#openViewerBtn').click();
   await page.waitForFunction(()=>pages.length>1&&!restoreInProgress,null,{timeout:25000});
   const {selected,before}=await setWordSelection(page);
   assert.equal(selected.length,1);checks++;
   await page.locator('#readerInsightsSelectionAction').waitFor({state:'visible'});
   assert.equal(await page.locator('#readerGPTSelectionMenu').isVisible(),!userAgent);checks++;
   await page.locator('#readerInsightsSelectionAction').click();
   const at=await page.evaluate(()=>ReaderInsightsData.getSeen(fullText));
   assert.ok(at>0&&at<before,'Word must be the new cutoff, not page end');checks++;
   assert.match(await page.locator('#readerInsightsSelectionNotice').innerText(),/읽은 지점으로 지정됨/);checks++;
   assert.equal(await page.locator('#readerInsightsSelectionAction').isVisible(),false);checks++;
   const beforeNext=await page.evaluate(()=>ReaderInsightsData.getSeen(fullText));
   const startingPage=await page.evaluate(()=>pageIndex);
   await page.evaluate(()=>goNextPage());
   await page.waitForFunction(start=>pageIndex>start&&!restoreInProgress,startingPage,{timeout:25000});
   const afterNext=await page.evaluate(()=>ReaderInsightsData.getSeen(fullText));
   assert.ok(afterNext>beforeNext,'Contiguous next page should update the cutoff');checks++;
   // A direct move to the final page must not expose unread intermediate content.
   await page.evaluate(()=>{pageIndex=pages.length-1;readerChooseAnchor(pageAnchors[pageIndex]);render();});
   const endJump=await page.evaluate(()=>ReaderInsightsData.getSeen(fullText));
   assert.equal(endJump,afterNext);checks++;
   assert.deepEqual(errors,[]);checks++;
   await context.close();
  }
  console.log(checks+' read-selection action browser checks passed');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});