const assert = require('node:assert/strict');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium} = require('playwright');
const JSZip = require('jszip');

async function epubFixture(version=3, withToc=true) {
  const z=new JSZip();
  z.file('mimetype','application/epub+zip');
  z.file('META-INF/container.xml','<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>');
  z.file('OPS/book.opf',`<package xmlns="http://www.idpf.org/2007/opf" version="${version}.0"><manifest>
    <item id="last" href="last.xhtml" media-type="application/xhtml+xml"/>
    <item id="first" href="first.xhtml" media-type="application/xhtml+xml"/>
    ${withToc?(version===3?'<item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/>':'<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>'):''}
    <item id="image" href="cover.png" media-type="image/png"/>
    </manifest><spine toc="ncx"><itemref idref="first"/><itemref idref="last"/></spine></package>`);
  z.file('OPS/nav.xhtml','<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><a href="first.xhtml#one">첫 장</a><a href="first.xhtml#two">둘째 장</a><a href="last.xhtml">마지막 장</a></nav></body></html>');
  z.file('OPS/toc.ncx','<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap><navPoint><navLabel><text>첫 장</text></navLabel><content src="first.xhtml#one"/></navPoint><navPoint><navLabel><text>둘째 장</text></navLabel><content src="first.xhtml#two"/></navPoint><navPoint><navLabel><text>마지막 장</text></navLabel><content src="last.xhtml"/></navPoint></navMap></ncx>');
  z.file('OPS/first.xhtml','<html><body><h1 id="one">첫 장</h1><p>'+('본문 반복입니다. '.repeat(200))+'</p><h1 id="two">둘째 장</h1><p>둘째 내용 보존.</p><img src="cover.png" alt="표지"/><script>window.EPUB_EXECUTED=true</script><a href="https://example.com">링크 글자 보존.</a></body></html>');
  z.file('OPS/last.xhtml','<html><body><h1>마지막 장</h1><p>마지막 내용 보존.</p></body></html>');
  z.file('OPS/cover.png',Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1UAAAAASUVORK5CYII=','base64'));
  return z.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}

(async()=>{
  const target=path.resolve(process.argv[2]||path.join(__dirname,'../index.html'));
  const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
  let checks=0;
  try{
    for(const width of [390,1280]){
      const context=await browser.newContext({viewport:{width,height:844}});
      const page=await context.newPage();const errors=[];let remoteRequests=0;
      page.on('pageerror',e=>errors.push(String(e)));
      page.on('request',r=>{if(/^https?:/.test(r.url()))remoteRequests++;});
      await page.addInitScript(()=>{
        window.AndroidReader={readSettings:()=>'',saveSettings:()=>{},
          savePosition:raw=>localStorage.setItem('testNativePosition',raw),
          readPosition:()=>localStorage.getItem('testNativePosition')||''};
      });
      await page.goto(pathToFileURL(target).href);await page.evaluate(()=>readerReady);
      const open=async()=>{
        await page.locator('#openViewerBtn').click();
        await page.waitForFunction(()=>pages.length&&!restoreInProgress,null,{timeout:10000});
      };
      const close=()=>page.evaluate(()=>closeViewer());
      assert.equal(await page.evaluate(()=>RECENT_LIMIT),20);checks++;
      await page.locator('#inputText').fill('[가] 첫 내용 [나] 둘 내용');await open();
      assert.equal(await page.locator('#chapterNav').isVisible(),false);checks++;
      await close();
      await page.locator('#inputText').fill('앞부분\n[가] 첫 내용 '.repeat(1)+'긴 본문. '.repeat(300)+'\n[나] 둘 내용\n[다] 셋 내용');await open();
      assert.deepEqual(await page.evaluate(()=>bookChapters.map(c=>c.title)),['앞부분','가','나','다']);checks++;
      await page.locator('#chapterSelect').selectOption('2');
      assert.match(await page.locator('#pageInnerLeft').innerText(),/둘 내용/);checks++;
      const before=await page.evaluate(()=>({pageIndex,anchor:readerAnchor()}));
      await page.reload();await page.evaluate(()=>readerReady);
      assert.equal(await page.evaluate(()=>readerCurrentChapter()),2);
      assert.deepEqual(await page.evaluate(()=>({pageIndex,anchor:readerAnchor()})),before);checks++;
      await close();
      for(const [version,toc] of [[3,true],[2,true],[3,false]]){
        await page.locator('#txtFileInput').setInputFiles({name:`fixture-${version}-${toc}.epub`,mimeType:'application/epub+zip',buffer:await epubFixture(version,toc)});
        await page.waitForFunction(()=>!openViewerBtn.disabled);
        const status=await page.locator('#status').innerText();assert.match(status,/불러옴/);
        await open();
        const data=await page.evaluate(()=>({titles:bookChapters.map(c=>c.title),canonical:readerCanonical(),ran:!!window.EPUB_EXECUTED,image:bookChapters.some(c=>c.blocks?.some(b=>b.includes('data:image/png')))}));
        assert.equal(data.titles.length,toc?3:2);
        assert.equal(data.titles[0],'첫 장');
        assert.equal(data.titles.at(-1),'마지막 장');
        assert.ok(data.canonical.indexOf('둘째 내용 보존.')<data.canonical.indexOf('마지막 내용 보존.'));
        assert.ok(data.canonical.includes('링크 글자 보존.'));
        assert.equal(data.ran,false);assert.equal(data.image,true);checks++;
        await page.locator('#chapterSelect').selectOption('0');
        await page.locator('#nextChapter').click();
        const id=await page.evaluate(()=>activeRecentId);
        await close();
        await page.locator('#inputText').fill('다른 책을 읽었습니다.');await open();await close();
        await page.evaluate(id=>openRecentBook(id),id);
        assert.equal(await page.evaluate(()=>readerCurrentChapter()),1);
        await page.reload();await page.evaluate(()=>readerReady);
        assert.equal(await page.evaluate(()=>readerCurrentChapter()),1);
        assert.equal(await page.evaluate(()=>bookChapters.length),toc?3:2);checks++;
        await close();
      }
      // Invalid files leave the current book and history intact.
      const oldInput=await page.locator('#inputText').inputValue();
      await page.locator('#txtFileInput').setInputFiles({name:'bad.epub',mimeType:'application/epub+zip',buffer:Buffer.from('not a zip')});
      await page.waitForFunction(()=>!openViewerBtn.disabled);
      assert.equal(await page.locator('#inputText').inputValue(),oldInput);
      assert.equal(await page.locator('#status').evaluate(el=>el.classList.contains('error')),true);checks++;
      const retention=await page.evaluate(async()=>{
        await clearRecentHistory();inputBookChapters=[];
        for(let i=0;i<22;i++)await upsertRecentText('최근 내역 '+i,{fileName:i+'.txt'});
        return (await getRecentMetas()).map(m=>m.fileName);
      });
      assert.equal(retention.length,20);assert.ok(!retention.includes('0.txt'));assert.ok(!retention.includes('1.txt'));checks++;
      await page.reload();await page.evaluate(()=>readerReady);
      assert.equal(await page.evaluate(async()=>(await getRecentMetas()).length),20);checks++;
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      assert.equal(remoteRequests,0);assert.deepEqual(errors,[]);checks++;
      await context.close();
    }
    console.log(`${checks} reader regression checks passed: ${target}`);
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
