// Compact, independently recomposed plot snapshots from transitional V2_START files.
// The model did not provide bullet-level evidence; never synthesize it.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright'),{pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..');
const moduleText=fs.readFileSync(path.join(root,'reader-insights-data.js'),'utf8'),win={};
new Function('window',moduleText)(win);
const D=win.ReaderInsightsData;
const lines=[
'첫 장면에서 해리는 병원 옆 서점에서 잃어버렸던 낡은 수첩을 발견하고 집으로 가져갔다.',
'두 번째 장면에서 해리는 수첩을 잃어버린 이유를 전혀 기억하지 못한다고 친구에게 설명했다.',
'세 번째 장면에서 친구는 수첩에 적힌 주소를 보고 어제 그곳을 방문한 적이 있다고 말했다.',
'네 번째 장면에서 해리는 친구와 다시 서점에 갔지만 주소와 관련된 의문은 아직 풀리지 않았다.'
];
const source='[첫 번째 장]\n\n'+lines.join('\n\n');
const common=(id,scene,title,quote,previous,bullets)=>({
 id,category:'plot',scene_id:scene,subject:'현재까지 줄거리',title,
 reveal:{quote,occurrence:1},previous_plot_id:previous,entities:[],aliases:[],related_ids:[],importance:5,
 bullets:bullets.map(text=>({text,confidence:'fact'}))
});
const meta={schema_version:2,source_metadata:{plot_style:'compressed_reconstructed_full_report_no_evidence'},scenes:[],records:[
 common('R00001','s1','처음 발견',lines[0],null,[
  '발견: 해리, 잃어버렸던 수첩을 서점에서 발견.',
  '회수: 수첩을 집으로 가져감.',
  '미해결: 수첩이 사라졌던 경위는 밝혀지지 않음.'
 ]),
 {id:'R00002',category:'relation',scene_id:'s2',subject:'해리 ↔ 친구',title:'친구의 설명',body:'수첩에 관한 이야기를 나누기 시작한다.',
  text:'수첩에 관한 이야기를 나누기 시작한다.',confidence:'fact',evidence:[lines[0],lines[1]],
  reveal:{quote:lines[1],occurrence:1},replaces:null,entities:[],aliases:[],related_ids:[],importance:3},
 common('R00003','s3','사건을 재구성',lines[2],'R00001',[
  '수첩과 기억: 해리, 수첩을 되찾았으나 분실한 경위는 기억하지 못함.',
  '주소: 친구가 수첩 속 장소에 방문한 적이 있다고 밝힘.'
 ]),
 common('R00004','s4','현재까지의 재정리',lines[3],'R00003',[
  '현재의 갈등: 수첩을 찾았지만 분실 경위는 여전히 불분명.',
  '새로운 연결: 친구가 수첩 속 주소에 방문한 적이 있다고 주장.',
  '다시 확인: 둘은 서점에 재방문했지만 결론을 얻지 못함.',
  '남은 의문: 주소의 의미는 아직 확인되지 않음.'
 ])
]};
const raw=source+'\n\n'+D.OLD_START+'\n'+JSON.stringify(meta)+'\n'+D.OLD_END+'\n';
const parsed=D.parse(raw);
assert.equal(parsed.body,source,'The source body must not change');
assert.equal(parsed.metadata.schema_version,3);
assert.equal(parsed.metadata.compatibility_mode,'legacy-v2-compressed-plot-no-evidence');
assert.deepEqual(parsed.metadata.records.filter(r=>r.category==='plot').map(r=>r.bullets.length),[3,2,4]);
assert.deepEqual(parsed.metadata.records.filter(r=>r.category==='plot').map(r=>r.previous_plot_id),[null,'R00001','R00003']);
assert.equal(parsed.metadata.records[0].bullets[0].evidence_status,'not_provided');
assert.deepEqual(parsed.metadata.records[0].bullets[0].evidence,[]);
assert.equal(parsed.metadata.records[1].evidence_passages.length,2);
assert.equal(D.validate(parsed.metadata,source).compatibility_mode,parsed.metadata.compatibility_mode);
const strict=structuredClone(parsed.metadata);delete strict.compatibility_mode;
assert.throws(()=>D.validate(strict,source),/원문 근거/,'Strict v3 refuses unproved bullets');
const notDeclared=structuredClone(meta);delete notDeclared.source_metadata.plot_style;
assert.throws(()=>D.validate(notDeclared,source),/근거 배열/,'Unknown hybrid does not bypass proof requirement');
const bad=structuredClone(meta);bad.records[2].reveal.quote='원문에 절대로 등장하지 않는 가상의 문장이다.';
assert.throws(()=>D.validate(bad,source),/원문 인용/,'Invented source position must fail');
const future=structuredClone(meta);future.records[0].reveal=meta.records[3].reveal;
assert.throws(()=>D.validate(future,source),/공개 위치|줄거리 공개 위치|기록이 공개 위치/,'Out of order disclosure must fail');
// Reproduce both uploaded generators verbatim: one uses a single separating
// newline, the other has two; their explicit no-evidence style labels differ.
for(const [style,separator] of [
 ['full_rewritten_compressed_reports_without_evidence','\n'],
 ['independent_compressed_reports_without_evidence','\n\n']
]){
 const variant=structuredClone(meta);
 delete variant.source_metadata;
 variant.metadata={plot_style:style};
 const text=source+separator+D.OLD_START+'\n'+JSON.stringify(variant)+'\n'+D.OLD_END+'\n';
 const reopened=D.parse(text);
 assert.equal(reopened.body,source,'The novel text cannot change at the marker boundary');
 assert.equal(reopened.metadata.compatibility_mode,'legacy-v2-compressed-plot-no-evidence');
 assert.equal(reopened.metadata.records.filter(r=>r.category==='plot').length,3);
 assert.equal(reopened.metadata.records[0].bullets[0].evidence_status,'not_provided');
}
console.log('2 uploaded generator delimiter and metadata-style variants passed');

console.log('9 compressed plot/source position/strict-v3 assertions passed');

async function browserCheck(browser,android){
 const dir=android?path.join(root,'android/app/src/main/assets'):root;
 const ctx=await browser.newContext({viewport:{width:390,height:760}}),page=await ctx.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 if(android)await page.route('https://appassets.androidplatform.net/**',async route=>{
  const u=new URL(route.request().url()),rel=u.pathname.replace(/^\/assets\//,'');
  const filename=path.join(dir,rel);
  if(!fs.existsSync(filename))return route.fulfill({status:404,body:'missing'});
  await route.fulfill({body:fs.readFileSync(filename),contentType:rel.endsWith('.js')?'application/javascript':rel.endsWith('.css')?'text/css':'text/html; charset=utf-8'});
 });
 await page.goto(android?'https://appassets.androidplatform.net/assets/index.html':pathToFileURL(path.join(root,'index.html')).href);
 await page.evaluate(()=>readerReady);
 await page.locator('#txtFileInput').setInputFiles({name:'compressed-reconstructed.txt',mimeType:'text/plain',buffer:Buffer.from(raw)});
 await page.waitForFunction(expected=>!openViewerBtn.disabled&&inputText.value===expected,source,{timeout:30000});
 await page.evaluate(()=>{if(typeof hideRecentHistory==='function')hideRecentHistory();});
 await page.locator('#openViewerBtn').click();
 await page.waitForFunction(()=>readerLazySession?.opened&&!restoreInProgress||(!restoreInProgress&&pages.length>0),null,{timeout:35000});
 const loaded=await page.evaluate(async()=>({source:fullText,meta:await ReaderInsightsData.load(fullText)}));
 assert.equal(loaded.source,source);
 assert.equal(loaded.meta.schema_version,3);
 assert.equal(loaded.meta.compatibility_mode,'legacy-v2-compressed-plot-no-evidence','Storage roundtrip retains provenance warning');
 await page.evaluate(()=>window.readerInsights.correctTo(readerCanonical().length));
 await page.locator('#insightsOpen').click();
 await page.waitForSelector('#insightsNavigatorBar:visible');
 assert.equal(await page.locator('#insightsNavTitle').innerText(),'현재까지 줄거리');
 const current=await page.evaluate(()=>{
  const parts=[],next=document.querySelector('#insightsNext'),paper=document.querySelector('#insightsPaper');
  for(let i=0;i<100;i++){
   parts.push(paper.innerText);
   if(next.disabled)break;
   next.click();
  }
  return parts.join('\n');
 });
 assert.ok(current.includes('현재의 갈등: 수첩을 찾았지만'),'Latest snapshot appears as compact report');
 assert.ok(current.includes('남은 의문: 주소의 의미'),'Latest snapshot includes its own conclusion');
 assert.ok(!current.includes('회수: 수첩을 집으로 가져감.'),'Old bullet not blindly appended');
 assert.ok(current.includes('항목별 원문 근거가 첨부되지 않았습니다'),'Missing evidence is clearly disclosed');
 assert.ok(!current.includes('근거: undefined')&&!current.includes('근거: \n'),'No fabricated or blank citations shown');
 assert.ok(await page.locator('#insightsNavPlotHistory').isVisible(),'Previous snapshots remain accessible');
 await page.locator('#insightsNavPlotHistory').click();
 assert.ok((await page.locator('#insightsPaper').innerText()).includes('처음 발견'),'History shows earlier versions');
 assert.deepEqual(errors,[],'No JS runtime errors');
 console.log((android?'Android':'Web')+' compressed plot import/display/history checks passed');
 await ctx.close();
}
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 try{await browserCheck(browser,false);if(process.env.VERIFY_ANDROID_ASSETS==='1')await browserCheck(browser,true);}
 finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
