const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium}=require('playwright'),JSZip=require('jszip');
const target=path.resolve(process.argv[2]||path.join(__dirname,'../index.html'));
const sample='지금까지 발견된 가장 유명한 화석 가운데 하나인 루시〔인물 각주: 1974년 에티오피아에서 발견된 약 320만 년 전 오스트랄로피테쿠스 화석 개체의 이름〕는 오스트랄로피테쿠스 아파렌시스Australopithecus afarensis의 머리뼈 화석이다. 1974년〔연도 비교 각주: 대한민국은 유신체제와 그 종식을 겪던 시기〕에 에티오피아〔지명 각주: 오늘날 아프리카 동북부의 고원 국가〕에서 발견된 루시는 320만 년 전에 살았고 직립보행에 적응한 발을 가진 원시인류였다.';
const visible=sample.replace(/〔[^〕]*〕/g,'');
let checks=0;
async function hold(page,locator){
 const box=await locator.boundingBox(),x=box.x+Math.min(box.width/2,15),y=box.y+box.height/2;
 await page.mouse.move(x,y);await page.mouse.down();await page.waitForTimeout(650);await page.mouse.up();
}
async function epub(){
 const zip=new JSZip();zip.file('mimetype','application/epub+zip');zip.file('META-INF/container.xml','<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>');
 zip.file('book.opf','<package version="3.0"><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/><item id="b" href="b.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>');
 zip.file('a.xhtml','<html><body><h1>첫 장</h1><p>루시〔인물 각주: 루시의 설명〕는 유명하다.</p></body></html>');
 zip.file('b.xhtml','<html><body><h1>둘째 장</h1><p>에티오피아〔지명 각주: 나라의 설명〕에서 발견되었다.</p></body></html>');
 return zip.generateAsync({type:'nodebuffer'});
}
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 try{
 for(const viewport of [{width:320,height:480},{width:360,height:640},{width:568,height:320},{width:1280,height:900}]){
  const context=await browser.newContext({viewport,hasTouch:true,isMobile:viewport.width<700}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(String(error)));
  await page.addInitScript(()=>{window.AndroidReader={readSettings:()=>'',saveSettings:()=>{},readPosition:()=>localStorage.getItem('testNativePosition')||'',savePosition:raw=>localStorage.setItem('testNativePosition',raw)};});
  await page.goto(pathToFileURL(target).href);await page.evaluate(()=>readerReady);
  async function open(text){await page.locator('#inputText').fill(text);await page.locator('#openViewerBtn').click();await page.waitForFunction(()=>pages.length&&!restoreInProgress);}
  async function note(title){
   await page.evaluate(title=>{const i=pages.findIndex(html=>{const root=document.createElement('div');root.innerHTML=html;return [...root.querySelectorAll('[data-reader-note]')].some(el=>el.getAttribute('data-reader-note-title')===title);});if(i<0)throw Error('Missing note '+title);pageIndex=i;readerChooseAnchor(pageAnchors[i]);render();},title);
   const actual=page.locator('#pageSpread [data-reader-note-title="'+title+'"]').first();await hold(page,actual);
   await page.waitForFunction(()=>readerNoteIsOpen());return actual;
  }
  async function bounds(){
   await page.waitForFunction(()=>{const layer=readerNoteLayer.getBoundingClientRect(),v=visualViewport;return Math.abs(layer.width-(v?.width||innerWidth))<1&&Math.abs(layer.height-(v?.height||innerHeight))<1;});
   const result=await page.evaluate(()=>{
    const d=document.querySelector('.reader-note-dialog').getBoundingClientRect(),c=document.getElementById('closeReaderNote').getBoundingClientRect(),b=document.getElementById('readerNoteContent'),v=visualViewport||{width:innerWidth,height:innerHeight,offsetLeft:0,offsetTop:0};
    const fits=r=>r.left>=v.offsetLeft-1&&r.top>=v.offsetTop-1&&r.right<=v.offsetLeft+v.width+1&&r.bottom<=v.offsetTop+v.height+1;
    return {dialog:fits(d),close:fits(c)&&c.left>=d.left&&c.right<=d.right&&c.bottom<=d.bottom,horizontal:b.scrollWidth<=b.clientWidth+1,external:!document.getElementById('book').contains(document.getElementById('readerNoteLayer'))};
   });assert.deepEqual(result,{dialog:true,close:true,horizontal:true,external:true});checks++;
  }
  const parsing=await page.evaluate(()=>{
   const cases=['제목〔길고 긴 각주\n\n# 각주 안 제목\n[가짜1] [가짜2] [가짜3] 끝〕은 본문이다.','단어〔바깥〔안〕끝〕다.','단어〔닫히지 않은 내용',String.fromCharCode(96)+'코드〔그대로〕'+String.fromCharCode(96)];
   return cases.map(text=>{const html=readerMarkdownNoteBlocks(text).join(''),root=document.createElement('div');root.innerHTML=html;return {body:htmlToStableText(html),count:root.querySelectorAll('[data-reader-note]').length,payload:root.querySelector('[data-reader-note]')?.getAttribute('data-reader-note')};});
  });
  assert.equal(await page.evaluate(()=>detectTextChapters('제목〔[가짜1] [가짜2] [가짜3]〕은 본문이다.').length),0);checks++;
  assert.equal(parsing[0].body,'제목은 본문이다.');assert.equal(parsing[0].count,1);assert.ok(parsing[0].payload.includes('\n\n#'));
  assert.equal(parsing[1].body,'단어다.');assert.equal(parsing[1].payload,'바깥〔안〕끝');
  assert.equal(parsing[2].body,'단어〔닫히지 않은 내용');assert.equal(parsing[3].body,'코드〔그대로〕');checks+=7;
  const inline=await page.evaluate(()=>{const html=readerFootnoteHTML('<p>루<em>시</em>〔설명〕는 유명하다.</p>'),host=document.createElement('div');host.innerHTML=html;return {text:htmlToStableText(html),label:host.querySelector('[data-reader-note]')?.textContent};});
  assert.deepEqual(inline,{text:'루시는 유명하다.',label:'루시'});checks++;
  await open(sample);
  assert.equal(await page.locator('#inputText').inputValue(),sample);assert.equal(await page.evaluate(()=>pages.map(htmlToStableText).join('')),visible);checks+=2;
  for(const title of ['루시','1974년','에티오피아']){
   const trigger=await note(title);assert.equal(await trigger.evaluate(el=>getComputedStyle(el).fontStyle),'italic');checks++;
   const before=await page.evaluate(()=>({index:pageIndex,anchor:readerAnchor(),splits:readerStats.splits}));
   await bounds();assert.ok((await page.locator('#readerNoteContent').innerText()).includes('각주:'));checks++;
   await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowLeft');await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');
   assert.equal(await page.evaluate(()=>readerNoteLayer.contains(document.activeElement)),true);checks++;
   await page.locator('#closeReaderNote').tap();assert.equal(await page.evaluate(()=>readerNoteIsOpen()),false);
   assert.deepEqual(await page.evaluate(()=>({index:pageIndex,anchor:readerAnchor(),splits:readerStats.splits})),before);checks+=2;
  }
  const expectedSearch=await page.evaluate(()=>readerCanonical().indexOf('에티오피아'));
  await page.locator('#openReaderSearch').click();await page.locator('#readerSearchInput').fill('에티오피아');await page.locator('#readerSearchForm').evaluate(form=>form.requestSubmit());
  await page.waitForFunction(()=>readerSearchMatches.length===1&&(typeof readerSearchBusy==='undefined'||!readerSearchBusy));
  await page.locator('.reader-search-result').first().click();assert.equal(await page.evaluate(()=>readerAnchor()),expectedSearch);checks++;
  await hold(page,page.locator('#pageSpread [data-reader-note-title="에티오피아"]').first());await page.locator('#closeReaderNote').tap();
  assert.equal(await page.evaluate(()=>readerAnchor()),expectedSearch);checks++;
  await page.locator('#openReaderSearch').click();await page.locator('#readerSearchInput').fill('유신체제');await page.locator('#readerSearchForm').evaluate(form=>form.requestSubmit());
  await page.waitForFunction(()=>readerSearchMatches.length===0&&(typeof readerSearchBusy==='undefined'||!readerSearchBusy));
  assert.equal(await page.locator('.reader-search-result').count(),0);checks++;await page.locator('#closeReaderSearch').click();

  await page.evaluate(()=>closeViewer());
  const payload='긴 각주: '+('스크롤로 읽는 긴 설명과 주소 https://example.com/'+('가나다'.repeat(30))+'\n').repeat(180)+'끝문장';
  await open('긴각주〔'+payload+'〕는 팝업에서 읽는다. 다른 본문은 그대로다.');
  await page.evaluate(async()=>{viewerSettings.fontSize=40;viewerSettings.lineHeight=2;applyViewerSettings(false);await repaginate();});
  await note('긴각주');await bounds();
  const anchor=await page.evaluate(()=>readerAnchor());
  const scroller=page.locator('#readerNoteContent');assert.equal(await scroller.evaluate(el=>el.scrollHeight>el.clientHeight),true);checks++;
  await scroller.hover();await page.mouse.wheel(0,1000);await page.waitForTimeout(150);assert.ok(await scroller.evaluate(el=>el.scrollTop>0));checks++;
  await scroller.evaluate(el=>{el.scrollTop=0;});
  if(viewport.width<700){
   const rect=await scroller.boundingBox(),cdp=await context.newCDPSession(page),x=rect.x+rect.width/2,y=rect.y+rect.height*.7,move=Math.min(100,rect.height*.45);
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
   for(let i=1;i<=5;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-move*i/5}]});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(150);
   assert.ok(await scroller.evaluate(el=>el.scrollTop>0));checks++;
  }
  await scroller.evaluate(el=>{el.scrollTop=el.scrollHeight;});
  const endVisible=await scroller.evaluate(el=>{const node=el.firstChild,range=document.createRange();range.setStart(node,node.length-3);range.setEnd(node,node.length);const r=range.getBoundingClientRect(),box=el.getBoundingClientRect();return r.top>=box.top-1&&r.bottom<=box.bottom+1;});
  assert.equal(endVisible,true);assert.equal(await page.evaluate(()=>readerAnchor()),anchor);checks+=2;await bounds();
  if(viewport.width<700){
   const zoom=await context.newCDPSession(page);await zoom.send('Emulation.setPageScaleFactor',{pageScaleFactor:2});await bounds();
   assert.equal(await page.evaluate(()=>readerAnchor()),anchor);checks++;
   await zoom.send('Emulation.setPageScaleFactor',{pageScaleFactor:1});await bounds();
  }
  await page.setViewportSize({width:320,height:240});await bounds();assert.equal(await page.evaluate(()=>readerAnchor()),anchor);checks++;
  await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>viewerOverlay.classList.contains('active')),true);checks++;
  await page.waitForFunction(()=>!restoreInProgress&&readerState.layout===getLayoutSignature());
  await note('긴각주');await page.mouse.click(1,1);assert.equal(await page.evaluate(()=>readerNoteIsOpen()),false);checks++;
  await page.setViewportSize(viewport);await page.waitForFunction(()=>!restoreInProgress&&readerState.layout===getLayoutSignature());
  await page.evaluate(()=>closeViewer());await page.evaluate(()=>{viewerSettings.fontSize=18;viewerSettings.lineHeight=1.8;applyViewerSettings(false);});
  await open('루시〔안전한 각주 <img src=x onerror="window.NOTE_XSS=1"> <script>window.NOTE_XSS=2</script>〕는 본문이다.');
  await note('루시');assert.equal(await page.locator('#readerNoteContent img,#readerNoteContent script').count(),0);assert.equal(await page.evaluate(()=>!!window.NOTE_XSS),false);checks+=2;
  await page.keyboard.press('Escape');await page.evaluate(async()=>{await readerState.pendingCache;await readingDatabaseWrite;});await page.reload();await page.evaluate(()=>readerReady);
  assert.equal(await page.evaluate(()=>readerStats.splits),0);assert.equal(await page.evaluate(()=>cachedMarkdownSource),null);checks+=2;
  await note('루시');assert.ok((await page.locator('#readerNoteContent').innerText()).includes('<img'));checks++;await page.keyboard.press('Escape');
  await page.evaluate(()=>closeViewer());
  await page.locator('#txtFileInput').setInputFiles({name:'notes.epub',mimeType:'application/epub+zip',buffer:await epub()});await page.waitForFunction(()=>!openViewerBtn.disabled);
  await page.locator('#openViewerBtn').click();await page.waitForFunction(()=>pages.length&&!restoreInProgress);
  await page.locator('#chapterSelect').selectOption('1');await note('에티오피아');assert.equal(await page.locator('#readerNoteContent').innerText(),'지명 각주: 나라의 설명');checks++;await page.keyboard.press('Escape');
  if(target.includes('assets')){
   await note('에티오피아');assert.equal(await page.evaluate(()=>window.__androidBack()),true);assert.equal(await page.evaluate(()=>readerNoteIsOpen()),false);assert.equal(await page.evaluate(()=>viewerOverlay.classList.contains('active')),true);checks+=3;
  }
  assert.deepEqual(errors,[]);checks++;await context.close();
 }
 // An old cache containing inline notes must migrate the saved text position.
 const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
 await page.goto(pathToFileURL(target).href);await page.evaluate(()=>readerReady);
 const oldText='시작. 루시〔'+('아주 긴 예전 각주. '.repeat(80))+'〕는 유명하다. 목표문장으로 이동한다. 끝.';
 await page.locator('#inputText').fill(oldText);await page.locator('#openViewerBtn').click();await page.waitForFunction(()=>pages.length&&!restoreInProgress);
 const expected=await page.evaluate(async()=>{
  await readerState.pendingCache;const raw=fullText,anchor=raw.indexOf('목표문장'),current=readerCanonical().indexOf('목표문장');
  const signature=JSON.stringify(JSON.parse(getLayoutSignature()).filter(value=>value!=='footnotes-v1'));
  const legacy={id:activeRecentId,version:READER_CACHE_VERSION,signature,length:fullText.length,pages:['<p>예전 본문</p>'],anchors:[0],canonical:raw,updatedAt:Date.now()};
  await readerStoreCache(legacy);readerState.canonical=raw;readerState.canonicalSource=fullText;readerState.layout=signature;readerChooseAnchor(anchor);
  flushReadingSessionSave(true);flushActiveRecentPositionSave();await readingDatabaseWrite;return current;
 });
 await page.reload();await page.evaluate(()=>readerReady);assert.equal(await page.evaluate(()=>readerAnchor()),expected);checks++;
 await context.close();console.log(checks+' inline note, popup bounds, touch isolation, scroll, EPUB, cache and migration checks passed: '+target);
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
