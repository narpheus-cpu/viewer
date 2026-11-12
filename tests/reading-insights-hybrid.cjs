const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..');
const data=fs.readFileSync(path.join(root,'reader-insights-data.js'),'utf8');
const window={};new Function('window',data)(window);
const D=window.ReaderInsightsData;
const a='첫 장면에서 재이는 복도 끝에 놓인 낡은 나무 상자를 발견하고 안을 살펴보았다.';
const b='둘째 장면에서 남자는 재이에게 상자에 관한 이야기를 들려주었지만 그 설명을 확인할 방법은 없었다.';
const c='셋째 장면에서 재이는 편지를 직접 읽고 상자가 이전에 누군가의 집에 보관되었다는 사실을 알게 되었다.';
const source=a+'\n\n'+b+'\n\n'+c;
const meta={schema_version:2,scenes:[],records:[
 {id:'R00001',category:'plot',scene_id:'s1',subject:'현재까지 줄거리',title:'처음 발견',
  reveal:{quote:'안을 살펴보았다.',occurrence:1},previous_plot_id:null,
  bullets:[{text:'재이는 낡은 상자를 발견했다.',confidence:'fact',evidence:[a],reveal:{quote:a,occurrence:1}}],
  entities:[],aliases:[],related_ids:[],importance:5},
 {id:'R00002',category:'relation',scene_id:'s2',subject:'재이 ↔ 남자',title:'상자에 관한 설명',
  reveal:{quote:b,occurrence:1},text:'남자는 상자에 대해 말하지만 진실인지는 알 수 없다.',
  confidence:'fact',evidence:[a,b],replaces:null,entities:[],aliases:[],related_ids:[],importance:4},
 {id:'R00003',category:'plot',scene_id:'s3',subject:'현재까지 줄거리',title:'편지를 확인한 지점',
  reveal:{quote:c,occurrence:1},previous_plot_id:'R00001',
  bullets:[{text:'재이는 낡은 상자를 발견했다.',confidence:'fact',evidence:[a]},
   {text:'남자의 설명을 들은 뒤 재이는 편지를 직접 확인했다.',confidence:'fact',evidence:[b,c]}],
  entities:[],aliases:[],related_ids:[],importance:5}
]};
const raw=source+'\n\n'+D.OLD_START+'\n'+JSON.stringify(meta)+'\n'+D.OLD_END+'\n';
const result=D.parse(raw);
assert.equal(result.body,source,'Exact original source must survive parsing');
assert.equal(result.metadata.schema_version,3);
assert.equal(result.metadata.records.length,3);
assert.equal(result.metadata.records[1].evidence_passages.length,2);
assert.deepEqual(result.metadata.records.filter(r=>r.category==='plot').map(r=>r.previous_plot_id),[null,'R00001']);
assert.ok(result.metadata.records[0].reveal.quote.length>=20,'Short reveal safely extended backwards');
assert.ok(result.metadata.records[1].evidence.includes(a)&&result.metadata.records[1].evidence.includes(b));
assert.throws(()=>D.parse(source+'\n\n'+D.OLD_END),/시작 표식/);
const future=structuredClone(meta);future.records[0].bullets[0].evidence=[c];
assert.throws(()=>D.validate(future,source),/공개 위치 이전|공개 위치 이후/);
const nonSource=structuredClone(meta);nonSource.records[1].evidence=['가상 증거 문구',b];
assert.throws(()=>D.validate(nonSource,source),/원문 인용을 찾지 못했습니다/);
const v3=D.parse(source+'\n\n'+D.BEGIN+'\n'+JSON.stringify(result.metadata)+'\n'+D.END+'\n');
assert.equal(v3.body,source);
assert.equal(v3.metadata.records[1].evidence_passages.length,2);
console.log('9 transitional TXT/source integrity/parser tests passed');

async function browserCheck(browser,android){
 const base=android?path.join(root,'android/app/src/main/assets'):root;
 const ctx=await browser.newContext({viewport:{width:390,height:760}}),page=await ctx.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 if(android)await page.route('https://appassets.androidplatform.net/**',async route=>{
  const url=new URL(route.request().url()),rel=url.pathname.replace(/^\/assets\//,'');
  const filename=path.join(base,rel);
  if(!fs.existsSync(filename))return route.fulfill({status:404,body:'missing'});
  await route.fulfill({body:fs.readFileSync(filename),contentType:rel.endsWith('.js')?'application/javascript':rel.endsWith('.css')?'text/css':'text/html; charset=utf-8'});
 });
 await page.goto(android?'https://appassets.androidplatform.net/assets/index.html':pathToFileURL(path.join(root,'index.html')).href);
 await page.evaluate(()=>readerReady);
 await page.locator('#txtFileInput').setInputFiles({name:'legacy-mixed-source.txt',mimeType:'text/plain',buffer:Buffer.from(raw)});
 await page.waitForFunction(expected=>!openViewerBtn.disabled&&inputText.value===expected,source,{timeout:30000});
 await page.evaluate(()=>{if(typeof hideRecentHistory==='function')hideRecentHistory();});
 await page.locator('#openViewerBtn').click();
 await page.waitForFunction(()=>readerLazySession?.opened&&!restoreInProgress||(!restoreInProgress&&pages.length>0),null,{timeout:35000});
 const got=await page.evaluate(async()=>({
  source:fullText,
  records:(await ReaderInsightsData.load(fullText))?.records,
  schema:(await ReaderInsightsData.load(fullText))?.schema_version
 }));
 assert.equal(got.source,source,'Browser TXT import must preserve original body');
 assert.equal(got.schema,3,'Imported hybrid must be saved in v3');
 assert.equal(got.records[1].evidence_passages.length,2,'Store both disconnected evidence excerpts');
 await page.evaluate(()=>window.readerInsights.correctTo(readerCanonical().length));
 await page.locator('#insightsOpen').click();
 await page.waitForSelector('#insightsNavigatorBar:visible');
 assert.equal(await page.locator('#insightsNavTitle').innerText(),'현재까지 줄거리');
 assert.deepEqual(errors,[],'No JavaScript runtime errors');
 console.log((android?'Android':'Web')+' hybrid TXT import/UI checks passed');
 await ctx.close();
}
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 try{
  await browserCheck(browser,false);
  if(process.env.VERIFY_ANDROID_ASSETS==='1')await browserCheck(browser,true);
 }finally{await browser.close();}
})().catch(err=>{console.error(err);process.exitCode=1;});
