const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const dataJs=fs.readFileSync(path.join(root,'reader-insights-data.js'),'utf8');
const modules={};new Function('window',dataJs)(modules);
const data=modules.ReaderInsightsData;
let tested=0;
function eq(label,actual,expected){assert.equal(actual,expected,label);tested++;}
function yes(label,actual){assert.ok(actual,label);tested++;}
function sample(count,prefix='E'){return Array.from({length:count},(_,i)=>prefix+'근거'+(i+1)+'번째 문장은 실제 원문에서 확인된다.').join(' ');}
for(const length of [0,1,2,3,5,6,7,8,14]){
 const original=sample(length);
 const actual=data.formatEvidence(original);
 if(length<=6)eq('Keep full evidence for '+length+' sentences',actual,original);
 else{
  const sentences=data.evidenceSentences(original);
  eq('Exactly first and last three '+length,actual,
    sentences.slice(0,3).join(' ')+' (중략) '+sentences.slice(-3).join(' '));
  yes('Hide intermediate sentence for '+length,!actual.includes('E근거4번째'));
 }
}
const long=sample(14);
const quoteSource='그는 3.14개의 기록을 확인했다. 의사가 말했다. "가설입니다!" 사람들은 질문했다. 끝까지 확인해야 했다. 결과가 달라졌다. 다시 조사했다. 사실이 정리되었다.';
yes('Decimal is not a standalone sentence',!data.evidenceSentences(quoteSource).some(s=>s==='3.'));
const withNewline='원문 첫 문장.\n원문 두 번째 문장.\n원문 마지막 문장.';
eq('Under six sentences keeps original line breaks',data.formatEvidence(withNewline),withNewline);
const records=[];
const evidenceTypes=[['event',14,'E'],['relation',7,'R'],['character',6,'C'],['clue',5,'L']];
for(const [category,num,prefix] of evidenceTypes){
 const evidence=sample(num,prefix);
 const phrase=prefix+' 정보는 이 장면까지 밝혀진 사실을 설명하기 위한 근거다.';
 records.push({id:prefix,category,title:prefix+' 분석',subject:prefix+' 기록',text:phrase,
  evidence,confidence:'fact',reveal:{quote:evidence.slice(-Math.min(90,evidence.length)),occurrence:1},
  replaces:null,story_order:1});
}
const body=records.map(r=>r.evidence).join('\n\n')+'\n\n읽은 위치를 원문에 따라 제한해야 한다.';
const validated=data.validate({schema_version:2,records},body);
eq('Keep all original evidence in validated data',validated.records[0].evidence,long);
yes('Stored data includes omitted middle sentence',validated.records[0].evidence.includes('E근거8번째'));
const meta={schema_version:2,records};
const bundled=body+'\n\n<<<READER_INSIGHTS_V2_BEGIN>>>\n'+JSON.stringify(meta)+'\n<<<READER_INSIGHTS_V2_END>>>';

async function checkViewer(browser,kind){
 const android=kind==='android';
 const webAssets=android?path.join(root,'android/app/src/main/assets'):root;
 const context=await browser.newContext({viewport:{width:390,height:760}});
 const page=await context.newPage();const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route(android?'https://appassets.androidplatform.net/**':'https://reader.test/**',async route=>{
  const url=new URL(route.request().url());
  const rel=android?url.pathname.replace(/^\/assets\//,''):url.pathname.slice(1)||'index.html';
  const file=path.join(webAssets,rel);
  if(!fs.existsSync(file))return route.fulfill({status:404,body:'missing'});
  const type=file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':
    file.endsWith('.json')?'application/json':'text/html; charset=utf-8';
  await route.fulfill({body:fs.readFileSync(file),contentType:type});
 });
 await page.goto(android?'https://appassets.androidplatform.net/assets/index.html':'https://reader.test/');
 await page.evaluate(()=>readerReady);
 await page.locator('#txtFileInput').setInputFiles({
  name:'long-evidence-demo.txt',mimeType:'text/plain',buffer:Buffer.from(bundled,'utf8')
 });
 await page.waitForFunction(()=>document.querySelector('#inputText').value.includes('E근거14번째'),null,{timeout:20000});
 await page.locator('#openViewerBtn').click();
 await page.waitForFunction(()=>!restoreInProgress&&pages.length>0,null,{timeout:20000});
 await page.evaluate(()=>window.readerInsights.correctTo(readerCanonical().length));
 await page.locator('#insightsOpen').click();
 await page.waitForSelector('#insightsNavigatorBar:visible');
 const toRoute=async name=>{
  await page.locator('#insightsNavReturn').click();
  for(let n=0;n<10;n++){
   const item=page.locator('#insightsPaper [data-nav-id="'+name+'"]');
   if(await item.count()){await item.click();return;}
   if(!await page.locator('#insightsNext').isEnabled())break;
   await page.locator('#insightsNext').click();
  }
  throw Error('Route '+name+' missing');
 };
 await toRoute('all');
 const pagesText=async ()=>{
  let parts=[];
  for(let i=0;i<40;i++){
   parts.push(await page.locator('#insightsPaper').innerText());
   if(!await page.locator('#insightsNext').isEnabled())break;
   await page.locator('#insightsNext').click();
  }
  return parts.join(' ');
 };
 for(const [category,num,prefix] of evidenceTypes){
  await page.locator('[data-insight-tab="'+category+'"]').click();
  const t=await pagesText();
  yes(kind+' '+category+' shows first source sentence',t.includes(prefix+'근거1번째'));
  yes(kind+' '+category+' shows last source sentence',t.includes(prefix+'근거'+num+'번째'));
  if(num>6){
   yes(kind+' '+category+' shows explicit omission',t.includes('(중략)'));
   yes(kind+' '+category+' hides middle source sentence',!t.includes(prefix+'근거4번째'));
  }else{
   yes(kind+' '+category+' displays entire short source',t.includes(prefix+'근거4번째'));
   yes(kind+' '+category+' does not mark omitted short source',!t.includes('(중략)'));
  }
 }
 await toRoute('timeline');
 await page.locator('#insightsPaper [data-nav-kind=record]').first().click();
 const detail=await pagesText();
 yes(kind+' navigator detail has omission',detail.includes('(중략)'));
 yes(kind+' navigator detail shows last sentence',detail.includes('E근거14번째'));
 yes(kind+' navigator detail hides omitted evidence',!detail.includes('E근거8번째'));
 yes(kind+' runtime has no JavaScript errors',errors.length===0);
 await context.close();
}
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 try{
  await checkViewer(browser,'web');
  if(process.env.VERIFY_ANDROID_ASSETS==='1')await checkViewer(browser,'android');
 }finally{await browser.close();}
 console.log(tested+' evidence excerpt assertions passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
