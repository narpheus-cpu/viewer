const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const webData=fs.readFileSync(path.join(root,'reader-insights-data.js'),'utf8');
const win={};new Function('window',webData)(win);
const D=win.ReaderInsightsData;
let count=0;
function ok(value,label){assert.ok(value,label);count++;}
function eq(value,want,label){assert.equal(value,want,label);count++;}
const first=Array.from({length:8},(_,i)=>'초반 기록 '+(i+1)+'번째 사실이 차례대로 확인되었다.').join(' ');
const middle='두 번째 장면에서 주인공은 중요한 인물과 직접 대화를 나누었다.';
const final='마지막 장면에서 열쇠의 출처가 드디어 밝혀졌다는 사실을 확인했다.';
const body=first+'\n\n'+middle+'\n\n'+final;
const props=(id,category,title,scene,quote)=>({
 id,category,subject:category==='plot'?'현재까지 줄거리':'주인공과 조력자',title,scene_id:scene,
 reveal:{quote,occurrence:1},entities:[],aliases:[],related_ids:[],importance:5
});
const firstPlot={...props('R00001','plot','첫 발견까지','S1',first),previous_plot_id:null,
 bullets:[{text:'첫 장면에서 중요한 물건이 발견된다.',confidence:'fact'}]};
const relationship={...props('R00002','relation','관계 확인','S2',middle),body:'두 인물이 직접 대화를 나누었다.',
 confidence:'fact',evidence:middle,replaces:null};
const secondPlot={...props('R00003','plot','열쇠의 출처까지','S3',final),previous_plot_id:'R00001',
 bullets:[
  {text:'첫 장면에서 중요한 물건이 발견된다.',confidence:'fact'},
  {text:'대화 이후 열쇠의 출처가 밝혀진다.',confidence:'strong_inference'}
 ]};
const meta={schema_version:3,records:[firstPlot,relationship,secondPlot]};
const embedded=body+'\n\n'+D.BEGIN+'\n'+JSON.stringify(meta)+'\n'+D.END;
const parsed=D.parse(embedded);
eq(parsed.body,body,'Integrated TXT preserves source exactly');
eq(parsed.metadata.schema_version,3,'Schema v3 accepted');
eq(parsed.metadata.records[2].bullets.length,2,'Independent latest plot');
ok(!('evidence' in parsed.metadata.records[0].bullets[0]),'Official v3 plot has no evidence field');
ok(!('evidence_status' in parsed.metadata.records[0].bullets[0]),'Official v3 plot has no evidence_status');
const older=JSON.parse(JSON.stringify(meta));
older.records[0].bullets[0].evidence=[{quote:first,occurrence:1}];
const normalizedLegacy=D.validate(older,body);
ok(!('evidence' in normalizedLegacy.records[0].bullets[0]),'Old v3 plot proof not copied into normalized report');
eq(D.formatEvidence(first).includes('(중략)'),true,'Seven or more evidence sentences abbreviated');
eq(D.formatEvidence(middle),middle,'Short evidence unchanged');
for(const [name,transform] of [
 ['event rejected',m=>m.records[0].category='event'],
 ['missing bullet confidence',m=>delete m.records[0].bullets[0].confidence],
 ['malformed legacy plot proof',m=>m.records[0].bullets[0].evidence='not a list'],
 ['future spoiler evidence',m=>m.records[0].bullets[0].evidence=[{quote:final,occurrence:1}]],
 ['broken plot pointer',m=>m.records[2].previous_plot_id=null],
 ['duplicate ID',m=>m.records[2].id='R00001'],
 ['unread related ID',m=>m.records[0].related_ids=['R00003']],
 ['unordered reveal',m=>m.records.reverse()],
 ['missing scene',m=>delete m.records[0].scene_id]
]){
 const bad=JSON.parse(JSON.stringify(meta));transform(bad);
 assert.throws(()=>D.validate(bad,body),/독서정보 검증 실패/,name);count++;
}
const legacy=fs.readFileSync(path.join(root,'tests/fixtures/insights-sample-integrated-v2.txt'),'utf8');
eq(D.parse(legacy).metadata.schema_version,2,'Legacy schema v2 remains readable');
async function checkViewer(browser,android){
 const base=android?path.join(root,'android/app/src/main/assets'):root;
 const origin=android?'https://appassets.androidplatform.net/assets/':'https://reader.test/';
 const context=await browser.newContext({viewport:{width:390,height:760}});
 const page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route(android?'https://appassets.androidplatform.net/**':'https://reader.test/**',async route=>{
  const url=new URL(route.request().url());
  const rel=android?url.pathname.replace(/^\/assets\//,''):url.pathname.slice(1)||'index.html';
  const file=path.join(base,rel);
  if(!fs.existsSync(file))return route.fulfill({status:404,body:'missing'});
  const type=rel.endsWith('.js')?'application/javascript':rel.endsWith('.css')?'text/css':
   rel.endsWith('.json')?'application/json':'text/html; charset=utf-8';
  await route.fulfill({body:fs.readFileSync(file),contentType:type});
 });
 await page.goto(origin+(android?'index.html':''));
 await page.evaluate(()=>readerReady);
 await page.locator('#txtFileInput').setInputFiles({name:'plot-test.txt',mimeType:'text/plain',buffer:Buffer.from(embedded)});
 await page.waitForFunction(expected=>document.querySelector('#inputText').value===expected,body,{timeout:25000});
 await page.evaluate(()=>{if(typeof hideRecentHistory==='function')hideRecentHistory();});
 await page.waitForFunction(()=>!document.querySelector('#openViewerBtn').disabled,null,{timeout:25000});
 await page.locator('#openViewerBtn').click();
 await page.waitForFunction(()=>!restoreInProgress&&pages.length>0,null,{timeout:25000});
 await page.evaluate(offset=>window.readerInsights.correctTo(offset),first.length);
 await page.locator('#insightsOpen').click();
 await page.waitForSelector('#insightsNavigatorBar:visible');
 eq(await page.locator('#insightsNavTitle').innerText(),'현재까지 줄거리','Plot is first screen');
 async function readText(){
  let parts=[];
  for(let i=0;i<30;i++){
   parts.push(await page.locator('#insightsPaper').innerText());
   if(!await page.locator('#insightsNext').isEnabled())break;
   await page.locator('#insightsNext').click();
  }
  return parts.join(' ');
 }
 const early=await readText();
 ok(early.includes('첫 발견까지'),'Early snapshot displayed');
 ok(!early.includes('열쇠의 출처까지'),'Future snapshot hidden');
 ok(!early.includes('대화 이후 열쇠의 출처'),'Later bullet hidden');
 ok(!early.includes('근거:')&&!early.includes('(중략)'),'Plot detail never displays source proof');
 await page.locator('#insightsClose').click();
 await page.evaluate(()=>window.readerInsights.correctTo(readerCanonical().length));
 await page.locator('#insightsOpen').click();
 await page.waitForSelector('#insightsNavTitle:visible');
 const current=await readText();
 ok(current.includes('열쇠의 출처까지'),'Latest cumulative snapshot visible');
 ok(current.includes('첫 장면에서 중요한 물건이 발견된다'),'Snapshot repeats earliest important event');
 ok(current.includes('대화 이후 열쇠의 출처가 밝혀진다'),'Snapshot includes later event');
 ok(await page.locator('#insightsNavPlotHistory').isVisible(),'Prior plot version control visible');
 await page.locator('#insightsNavPlotHistory').click();
 const history=await readText();
 ok(history.includes('첫 발견까지'),'Earlier plot remains in history');
 ok(history.includes('열쇠의 출처까지'),'Current plot listed in history');
 eq(errors.length,0,'No browser runtime errors');
 await context.close();
}
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 try{
  await checkViewer(browser,false);
  if(process.env.VERIFY_ANDROID_ASSETS==='1')await checkViewer(browser,true);
 }finally{await browser.close();}
 console.log(count+' schema v3 and plot-first browser assertions passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
