const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const quote='그녀는 열쇠를 발견하고 그것이 어디서 왔는지 아직 알 수 없다고 말했다.';
const source='[1장]\n\n'+quote+'\n\n'+('그날의 일들은 아직 완전히 밝혀지지 않았다.\n\n'.repeat(70));
const bullets=Array.from({length:240},(_,i)=>({
 text:'기록 '+String(i+1)+'번: 주인공은 앞선 선택을 돌아보면서도 사건의 원인을 단정하지 않는다. '+(i%9===0?'📚 뒤따르는 소식은 아직 확인되지 않았다.':'관련 사실과 추론을 구분한다.'),
 confidence:'fact',evidence:[{quote,occurrence:1}]
}));
const metadata={schema_version:3,records:[{
 id:'R00001',category:'plot',subject:'현재까지 줄거리',title:'처음부터 여기까지의 누적 줄거리',
 scene_id:'S001',bullets,reveal:{quote,occurrence:1},previous_plot_id:null,
 entities:[],aliases:[],related_ids:[],importance:5
}]};
const expected=bullets.map((b,i)=>(i+1)+'. '+b.text+'\n[확인된 사실]\n근거: '+quote).join('\n\n');
async function browserCheck(browser,kind,width){
 const assets=kind==='android'?path.join(root,'android/app/src/main/assets'):root;
 const url=kind==='android'?'https://appassets.androidplatform.net/assets/index.html':'https://reader.test/';
 const ctx=await browser.newContext({viewport:{width,height:720}}),page=await ctx.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route(kind==='android'?'https://appassets.androidplatform.net/**':'https://reader.test/**',async route=>{
  const u=new URL(route.request().url());
  const rel=kind==='android'?u.pathname.replace(/^\/assets\//,''):u.pathname.slice(1)||'index.html';
  const f=path.join(assets,rel);
  if(!fs.existsSync(f))return route.fulfill({status:404,body:'missing'});
  await route.fulfill({body:fs.readFileSync(f),contentType:rel.endsWith('.js')?'application/javascript':rel.endsWith('.css')?'text/css':'text/html; charset=utf-8'});
 });
 await page.goto(url);await page.evaluate(()=>readerReady);
 await page.locator('#inputText').fill(source);
 await page.locator('#openViewerBtn').click();
 await page.waitForFunction(()=>pages.length>0&&!restoreInProgress,null,{timeout:45000});
 const begin=Date.now();
 await page.evaluate(async data=>{
  await ReaderInsightsData.save(fullText,data);
  window.readerInsights.correctTo(readerCanonical().length);
 },metadata);
 await page.locator('#insightsOpen').click();
 await page.waitForSelector('#insightsNavigatorBar:visible');
 assert.equal(await page.locator('#insightsClose').innerText(),'독서정보 닫기');
 assert.equal(await page.locator('#insightsClose').getAttribute('aria-label'),'독서정보 닫기');
 const colors=await page.locator('#insightsClose').evaluate(e=>({background:getComputedStyle(e).backgroundColor,color:getComputedStyle(e).color,rect:e.getBoundingClientRect().toJSON()}));
 assert.equal(colors.background,'rgb(0, 0, 0)');
 assert.equal(colors.color,'rgb(255, 255, 255)');
 assert.ok(colors.rect.width>=90&&colors.rect.height>=38,'Close button must be usable on narrow screens');
 assert.equal(await page.locator('#insightsNavTitle').innerText(),'현재까지 줄거리');
 assert.equal(await page.locator('#insightsNext').isEnabled(),true,'Large plot must expose next page immediately');
 assert.ok((await page.locator('#insightsPageCount').innerText()).includes('…'),'Long plot should not eagerly paginate everything');
 const firstPaintMs=Date.now()-begin;
 assert.ok(firstPaintMs<12000,'First view of a 240-bullet cumulative plot must not freeze');
 const result=await page.evaluate(()=>{
  const collected=[];let times=0;
  const next=document.querySelector('#insightsNext'),paper=document.querySelector('#insightsPaper');
  for(let i=0;i<2000;i++){
   collected.push(paper.querySelector('.insights-body')?.textContent||'');
   times++;
   if(next.disabled)break;
   next.click();
  }
  return {joined:collected.join(''),pages:times,unfinished:!next.disabled,nav:document.querySelector('#insightsNavTitle')?.textContent,
   overflow:document.documentElement.scrollWidth-innerWidth};
 });
 assert.equal(result.unfinished,false,'Every bullet can be reached without a fixed page cap');
 assert.equal(result.joined,expected,'Incremental page split preserves EVERY displayed character including whitespace/emoji');
 assert.ok(result.pages>10&&result.pages<2000);
 assert.ok(result.overflow<=1,'No horizontal overflow on mobile');
 await page.locator('#insightsClose').click();
 assert.equal(await page.locator('#insightsPanel').getAttribute('aria-hidden'),'true');
 assert.equal(await page.locator('#insightsPanel').isVisible(),false);
 assert.deepEqual(errors,[],'No runtime errors');
 console.log(JSON.stringify({kind,width,bullets:bullets.length,plotChars:expected.length,parts:result.pages,firstPaintMs,closeButton:colors.background+' / '+colors.color}));
 await ctx.close();
}
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 try{
  await browserCheck(browser,'web',320);
  await browserCheck(browser,'web',390);
  if(process.env.VERIFY_ANDROID_ASSETS==='1')await browserCheck(browser,'android',320);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
