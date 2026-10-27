const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
const target=path.resolve(process.argv[2]||path.join(__dirname,'../index.html'));
(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
  let checks=0;
  try{
    for(const width of [320,390,1280]){
      const context=await browser.newContext({viewport:{width,height:844}}),page=await context.newPage(),errors=[];
      page.on('pageerror',error=>errors.push(String(error)));
      await page.goto(pathToFileURL(target).href);await page.evaluate(()=>readerReady);
      const text='[ALPHA]\n\n'+('ALPHA 본문 문장입니다. '.repeat(160))+'\n\n[BETA]\n\nBETA 짧은 문장.\n\n[GAMMA]\n\n'+('GAMMA 마지막 문장입니다. '.repeat(160));
      await page.locator('#inputText').fill(text);await page.locator('#openViewerBtn').click();
      await page.waitForFunction(()=>pages.length&&!restoreInProgress);
      async function checkChapter(chapter,token){
        await page.locator('#openReaderChapter').click();await page.locator('#readerChapterList [data-chapter="'+chapter+'"]').click();
        await page.waitForFunction(()=>!restoreInProgress&&!readerLazyActive());
        const indices=await page.evaluate(token=>pages.flatMap((html,index)=>htmlToStableText(html).includes(token)?[index]:[]),token);
        assert.ok(indices.length);checks++;
        for(const index of [indices[0],indices.at(-1)]){
          await page.locator('#pageJumpInput').fill(String(index+1));await page.locator('#pageJumpBtn').click();
          const currentIndex=await page.evaluate(()=>pageIndex);
          assert.equal(await page.locator('#chapterPageCount').innerText(),`[${indices.indexOf(currentIndex)+1} / ${indices.length}]`);checks++;
          assert.match(await page.locator('#viewerCharCount').innerText(),/^[\d,]+\/[\d,]+자$/);checks++;
        }
      }
      await checkChapter(0,'ALPHA');await checkChapter(1,'BETA');await checkChapter(2,'GAMMA');
      const position=await page.evaluate(()=>({page:pageIndex,anchor:readerAnchor(),splits:readerStats.splits,text:readerCanonical(),counter:counter.textContent}));
      for(const action of ['button','escape',...(target.includes('assets')?['back']:[])]){
        await page.locator('#openReaderChapter').click();assert.equal(await page.locator('#readerChapterList button').count(),3);checks++;
        const visible=await page.locator('#closeReaderChapter').evaluate(el=>{const r=el.getBoundingClientRect(),v=visualViewport;return r.top>=v.offsetTop&&r.left>=v.offsetLeft&&r.bottom<=v.offsetTop+v.height&&r.right<=v.offsetLeft+v.width});assert.equal(visible,true);checks++;
        if(action==='button')await page.locator('#closeReaderChapter').click();else if(action==='escape')await page.keyboard.press('Escape');else assert.equal(await page.evaluate(()=>__androidBack()),true);
        assert.equal(await page.evaluate(()=>readerChapterIsOpen()),false);assert.equal(await page.evaluate(()=>viewerOverlay.classList.contains('active')),true);assert.deepEqual(await page.evaluate(()=>({page:pageIndex,anchor:readerAnchor(),splits:readerStats.splits,text:readerCanonical(),counter:counter.textContent})),position);checks+=3;
      }
      const placement=await page.evaluate(()=>{
        const footer=document.getElementById('chapterPageCount').getBoundingClientRect(),title=document.getElementById('readerDocumentTitle').getBoundingClientRect();
        const content=document.getElementById('pageInnerLeft').getBoundingClientRect(),book=document.getElementById('book').getBoundingClientRect();
        return {above:footer.bottom<=title.top,clear:content.bottom<=footer.top,center:Math.abs((footer.left+footer.right-book.left-book.right)/2)<1,header:!!counter.closest('.bookhead'),overflow:document.querySelector('.bookhead').scrollWidth>document.querySelector('.bookhead').clientWidth};
      });
      assert.deepEqual(placement,{above:true,clear:true,center:true,header:true,overflow:false});checks++;
      const before=await page.locator('#chapterPageCount').innerText();
      await page.reload();await page.evaluate(()=>readerReady);assert.equal(await page.locator('#chapterPageCount').innerText(),before);checks++;
      // Reflow must rebuild the chapter page totals and keep the same chapter.
      await page.evaluate(async()=>{viewerSettings.fontSize=24;applyViewerSettings(false);await repaginate();});
      await page.waitForFunction(()=>!restoreInProgress);
      await checkChapter(1,'BETA');await checkChapter(2,'GAMMA');
      await page.evaluate(()=>closeViewer());await page.locator('#inputText').fill('챕터 구분이 없는 문장. '.repeat(130));
      await page.locator('#openViewerBtn').click();await page.waitForFunction(()=>pages.length&&!restoreInProgress);
      const total=await page.evaluate(()=>pages.length);assert.equal(await page.locator('#chapterPageCount').innerText(),`[1 / ${total}]`);checks++;
      assert.deepEqual(errors,[]);checks++;await context.close();
    }
    console.log(`${checks} chapter footer, navigation, reflow, restore and layout checks passed: ${target}`);
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
