const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
const target=path.resolve(process.argv[2]||path.join(__dirname,'../index.html'));
(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
  let checks=0;
  try{
    const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(String(error)));
    await page.goto(pathToFileURL(target).href);await page.evaluate(()=>readerReady);
    for(const prefix of [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ','NASA','fooZ']){
      for(const suffix of [' 다음 문장','\t계속','” 다음','1 계속']){
        const input=prefix+'.'+suffix;
        const result=await page.evaluate(text=>({ends:readerSentenceEnds(text),breaks:readerBreakOffsets(text,{breakSentence:true})}),input);
        assert.deepEqual(result,{ends:[],breaks:[]},input);checks++;
      }
    }
    for(const text of ['a. 다음','문장이다. 다음','A . 다음','A? 다음','A! 다음','3.14 값. 다음']){
      const ends=await page.evaluate(text=>readerSentenceEnds(text),text);
      assert.deepEqual(ends,[text.indexOf(' 다음')]);checks++;
    }
    for(const spacing of [false,true]){
      const result=await page.evaluate(spacing=>{
        viewerSettings={...viewerSettings,breakSentence:true,breakQuotes:false,breakAdverbs:false,sentenceSpacing:spacing};
        const html='<p><strong>A</strong><em>.</em> 이어 읽기 NASA. 계속 읽기.</p>';
        const output=readerApplyBreaks(html),host=document.createElement('div');host.innerHTML=output;
        return {count:host.querySelectorAll('br[data-reader-break]').length,stable:htmlToStableText(output)===htmlToStableText(html)};
      },spacing);
      assert.deepEqual(result,{count:0,stable:true});checks++;
    }
    // Original line breaks stay intact; only automatically generated breaks change.
    const source=await page.evaluate(()=>{
      const result=readerApplyBreaks('<p>A.<br>원래 줄바꿈</p>'),host=document.createElement('div');host.innerHTML=result;
      return host.querySelectorAll('br:not([data-reader-break])').length;
    });assert.equal(source,1);checks++;
    await page.locator('#inputText').fill('A. 이어 읽기 NASA. 계속 읽기.');await page.locator('#openViewerBtn').click();
    await page.waitForFunction(()=>pages.length&&!restoreInProgress);
    assert.equal(await page.locator('#pageInnerLeft br[data-reader-break]').count(),0);checks++;
    // Upgrade from an old cached layout must re-render with the new sentence rule.
    await page.evaluate(async()=>{
      await readerState.pendingCache;
      await readerStoreCache({id:activeRecentId,version:7,signature:readerState.layout,length:fullText.length,
        pages:['<p>OLD_LAYOUT</p>'],anchors:[0],canonical:readerCanonical(),updatedAt:Date.now()});
    });
    await page.reload();await page.evaluate(()=>readerReady);
    assert.ok(await page.evaluate(()=>readerStats.splits>0));
    assert.equal(await page.locator('#pageInnerLeft').innerText(),'A. 이어 읽기 NASA. 계속 읽기.');
    assert.equal(await page.locator('#pageInnerLeft br[data-reader-break]').count(),0);checks+=3;
    assert.deepEqual(errors,[]);checks++;
    await context.close();console.log(`${checks} uppercase period, spacing, formatting and upgrade cache checks passed: ${target}`);
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
