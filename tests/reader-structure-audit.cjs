const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const story=[
'[첫 장]',
'첫 장의 첫 문장. 이 구절에는 설명 [1]과 참고 [보충]이라는 인라인 표시가 포함된다.',
'첫 장의 후속 문장에는 [2]라는 인용 번호가 있다.',
'',
'[둘째 장]',
'둘째 장의 서술문. 주인공이 [가짜 장]이라는 단어를 언급한다.',
'둘째 장에는 인용 [3]과 [4]가 함께 나온다.',
'',
'[셋째 장]',
'셋째 장의 결말 문장. [이야기 속 괄호]는 제목이 아니다.'].join('\n');
async function check(browser,android){
 const base=android?path.join(root,'android/app/src/main/assets'):root;
 const context=await browser.newContext({viewport:{width:390,height:760}});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const origin=android?'https://appassets.androidplatform.net/assets/':'https://reader.test/';
 await page.route(android?'https://appassets.androidplatform.net/**':'https://reader.test/**',async route=>{
  const u=new URL(route.request().url()),rel=android?u.pathname.replace(/^\/assets\//,''):u.pathname.slice(1)||'index.html';
  const f=path.join(base,rel);
  await route.fulfill(fs.existsSync(f)?{body:fs.readFileSync(f),contentType:rel.endsWith('.js')?'application/javascript':rel.endsWith('.json')?'application/json':'text/html; charset=utf-8'}:{status:404,body:'missing'});
 });
 await page.goto(origin);await page.evaluate(()=>readerReady);
 const chapters=await page.evaluate(source=>detectTextChapters(source).map(ch=>ch.title),story);
 assert.deepEqual(chapters,['첫 장','둘째 장','셋째 장'],'Inline citations must never be interpreted as chapter titles');
 const noTitles=await page.evaluate(()=>detectTextChapters('첫째 문장에 [1]과 [2]가 등장한다.\n다음 문장에 [3]과 [4]가 붙는다.'));
 assert.deepEqual(noTitles,[],'Books with inline square-bracket citations must not gain a fake TOC');
 const withTrailing=await page.evaluate(()=>detectTextChapters('[하나] 첫 문장\n[둘] 둘째 문장\n[셋] 셋째 문장').map(ch=>ch.title));
 assert.deepEqual(withTrailing,['하나','둘','셋']);
 await page.locator('#txtFileInput').setInputFiles({name:'inline-citation-chapters.txt',mimeType:'text/plain',buffer:Buffer.from(story,'utf8')});
 await page.waitForFunction(expected=>inputText.value===expected&&!openViewerBtn.disabled,story,{timeout:20000});
 await page.evaluate(()=>{if(typeof hideRecentHistory==='function')hideRecentHistory()});
 await page.locator('#openViewerBtn').click();
 await page.waitForFunction(()=>!restoreInProgress&&pages.length>0,null,{timeout:30000});
 assert.deepEqual(await page.evaluate(()=>bookChapters.map(ch=>ch.title)),['첫 장','둘째 장','셋째 장']);
 await page.locator('#openReaderChapter').click();
 assert.equal(await page.locator('#readerChapterList button').count(),3);
 await page.locator('#readerChapterList [data-chapter="2"]').click();
 await page.waitForFunction(()=>readerCurrentChapter()===2&&!restoreInProgress,null,{timeout:30000});
 assert.match(await page.locator('#pageInnerLeft').textContent(),/셋째 장/);
 assert.equal(await page.evaluate(()=>fullText),story,'Chapter navigation must never mutate source content');
 assert.deepEqual(errors,[]);
 console.log((android?'Android':'Web')+' standalone chapter and inline bracket false positives, UI selection, source integrity passed');
 await context.close();
}
(async()=>{const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 try{await check(browser,false);if(process.env.VERIFY_ANDROID_ASSETS==='1')await check(browser,true);}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
