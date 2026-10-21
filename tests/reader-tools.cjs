const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
const target=path.resolve(process.argv[2]||path.join(__dirname,'../index.html'));
const first='최소한 이 점에서라면 21세기의 사회 혁명이라고 다를 게 없을 것이다';
const second='자본의 사회적 형태에 내재하는 발전 경향은 무엇인가?';
let checks=0;
(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
  try{
    for(const viewport of [{width:320,height:568},{width:390,height:844},{width:1280,height:900}]){
      const context=await browser.newContext({viewport});const page=await context.newPage(),errors=[];
      page.on('pageerror',error=>errors.push(String(error)));
      await page.goto(pathToFileURL(target).href);await page.evaluate(()=>readerReady);
      const parse=await page.evaluate(()=>{
        const sample='다른 사람보다 일을 더 해 보고 싶다 하지만 쉰다';
        const suffix=readerBreakOffsets(sample,{breakSentence:true});
        const punctuation='Dr. Lee paid 3.14. 그는 간다. 다음이다';
        const ends=readerBreakOffsets(punctuation,{breakSentence:true}).map(i=>punctuation.slice(0,i));
        return {suffix,ends};
      });
      assert.deepEqual(parse.suffix,[]);assert.deepEqual(parse.ends,['Dr. Lee paid 3.14.','Dr. Lee paid 3.14. 그는 간다.']);checks+=2;
      const spacing=await page.evaluate(()=>{
        viewerSettings={...viewerSettings,breakSentence:true,sentenceSpacing:true};
        const inputs=['<p>첫 문장이다. 둘째 문장이다.</p>','<p>첫 문장이다.<br>둘째 문장이다.</p>','<p>첫 문장이다.<br><br>둘째 문장이다.</p>'];
        return inputs.map(html=>{const result=readerApplyBreaks(html),root=document.createElement('div');root.innerHTML=result;
          return {generated:root.querySelectorAll('br[data-reader-break]').length,all:root.querySelectorAll('br').length,stable:htmlToStableText(html)===htmlToStableText(result)};});
      });
      assert.deepEqual(spacing.map(x=>x.generated),[2,1,0]);assert.deepEqual(spacing.map(x=>x.all),[2,2,2]);assert.ok(spacing.every(x=>x.stable));checks+=3;
      // Exact user examples at multiple sizes, both with and without display-only sentence spacing.
      for(const option of [false,true]){
        await page.evaluate(option=>{viewerSettings={...viewerSettings,breakSentence:option,sentenceSpacing:option,fontSize:18};},option);
        const text='이것은 앞의 본문이다. '.repeat(100)+first+'\n\n'+second+'\n\n다음 문단도 이 페이지를 채울 수 있다. 😀';
        await page.locator('#inputText').fill(text);await page.locator('#openViewerBtn').click();
        await page.waitForFunction(()=>pages.length&&!restoreInProgress,null,{timeout:15000});
        const pagesText=await page.evaluate(()=>pages.map(htmlToStableText));
        assert.ok(pagesText.some(t=>t.includes(first)));assert.ok(pagesText.some(t=>t.includes(second)));
        assert.ok(!pagesText.some(t=>['것이다','무엇인가?'].includes(t.trim())));
        assert.equal(pagesText.join('').replace(/\s/g,''),text.replace(/\s/g,''));checks+=4;
        await page.evaluate(()=>closeViewer());
      }
      const book='[시작]\n처음 기록.\n[중간]\n'+('반복 검색 본문이다. '.repeat(130))+'\n[마지막]\n'+first+'\n'+second+'\n특수한 [표식]과 .* 그리고 (괄호) a+b는 글자다.\nAlpha와 alpha.';
      await page.evaluate(()=>{viewerSettings={...viewerSettings,breakSentence:false,sentenceSpacing:false};});
      await page.locator('#inputText').fill(book);await page.locator('#openViewerBtn').click();
      await page.waitForFunction(()=>pages.length&&!restoreInProgress,null,{timeout:15000});
      const canonical=await page.evaluate(()=>readerCanonical());
      async function search(value){
        await page.locator('#openReaderSearch').click();await page.locator('#readerSearchInput').fill(value);
        await page.locator('#readerSearchForm').evaluate(form=>form.requestSubmit());
      }
      await search('혁명');assert.equal(await page.locator('.reader-search-result').count(),1);
      assert.match(await page.locator('.reader-search-result-label').innerText(),/마지막/);checks+=2;
      await page.locator('.reader-search-result').click();
      const jumped=await page.evaluate(()=>({anchor:readerAnchor(),pageIndex,chapter:readerCurrentChapter(),mark:[...document.querySelectorAll('mark.reader-search-hit')].map(x=>x.textContent).join('')}));
      assert.equal(jumped.anchor,canonical.indexOf('혁명'));assert.equal(jumped.mark,'혁명');
      assert.equal(await page.locator('#readerSearchPanel').isVisible(),false);
      assert.match(await page.locator('#chapterSelect option:checked').innerText(),/마지막/);checks+=4;
      // Font/spacing changes keep the searched anchor and search highlighting.
      await page.locator('#toggleViewerSettings').click();await page.locator('#sentenceSpacing').check();await page.locator('#toggleViewerSettings').click();
      await page.waitForFunction(()=>!restoreInProgress&&readerState.layout===getLayoutSignature(),null,{timeout:10000});
      assert.equal(await page.evaluate(()=>readerAnchor()),jumped.anchor);
      assert.equal(await page.evaluate(()=>readerCanonical()),canonical);checks+=2;
      await page.reload();await page.evaluate(()=>readerReady);
      assert.equal(await page.evaluate(()=>readerAnchor()),jumped.anchor);
      assert.equal(await page.evaluate(()=>viewerSettings.sentenceSpacing),true);checks+=2;
      // Search syntax is literal, case-insensitive, and spans source line breaks.
      for(const query of ['[표식]','.*','(괄호)','a+b','alpha',first+' '+second]){
        await search(query);
        assert.equal(await page.locator('.reader-search-result').count(),query==='alpha'?2:1);checks++;
        await page.locator('.reader-search-result').first().click();
        const marked=await page.locator('mark.reader-search-hit').allTextContents();assert.ok(marked.length);checks++;
      }
      await search('검색');assert.equal(await page.locator('.reader-search-result').count(),100);
      assert.match(await page.locator('#readerSearchCount').innerText(),/130/);checks+=2;
      await page.locator('.search-more').click();assert.equal(await page.locator('.reader-search-result').count(),130);checks++;
      const expectedSearchAnchor=await page.evaluate(()=>readerSearchMatches[120].start);
      await page.locator('[data-result="120"]').click();assert.equal(await page.evaluate(()=>readerAnchor()),expectedSearchAnchor);checks++;
      await search('찾을 수 없는 문자열');assert.equal(await page.locator('.reader-search-result').count(),0);
      await page.keyboard.press('Escape');assert.equal(await page.locator('#readerSearchPanel').isVisible(),false);
      assert.equal(await page.locator('#viewerOverlay').evaluate(el=>el.classList.contains('active')),true);checks+=3;
      await page.keyboard.press('Control+f');assert.equal(await page.locator('#readerSearchPanel').isVisible(),true);
      await page.keyboard.press('Escape');checks++;
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);checks+=2;
      await context.close();
    }
    console.log(`${checks} search, sentence, pagination and spacing checks passed: ${target}`);
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
