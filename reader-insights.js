/* Reader insights: pagination-only, spoiler-gated source-grounded notebook. */
(function(){
'use strict';
const $i=id=>document.getElementById(id);
const STORAGE='ebookReaderInsightRecordsV1';
const MAX_RECORDS=1200;
const MAX_CHARS=16000;
let shell=null,menu=null,paper=null,number=null,range=null,category='all',pages=[],position=0,bookKey='',lastFocus=null,pointerStart=null;
const types=[['all','전체'],['fact','주요 사실'],['person','인물'],['relationship','인물 관계'],['goal','욕망·목표'],['event','사건'],['timeline','시간순 연표']];
const names=Object.fromEntries(types);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function getCanonical(){try{return typeof readerCanonical==='function'?readerCanonical():typeof fullText==='string'?fullText:'';}catch{return typeof fullText==='string'?fullText:'';}}
function currentAnchor(){try{return Math.max(0,Number(typeof readerAnchor==='function'?readerAnchor():pageAnchors?.[pageIndex])||0);}catch{return 0;}}
function currentTitle(){return (typeof inputFileName==='string'&&inputFileName)||$i('readerDocumentTitle')?.textContent||'현재 책';}
function signature(){
 const t=getCanonical(); const name=currentTitle();
 let h=2166136261;const sample=name+'|'+t.length+'|'+t.slice(0,2048)+'|'+t.slice(-2048);
 for(let i=0;i<sample.length;i++){h^=sample.charCodeAt(i);h=Math.imul(h,16777619);}
 return 'bk-'+(h>>>0).toString(36)+'-'+t.length;
}
function loadDb(){try{return JSON.parse(localStorage.getItem(STORAGE)||'{}')||{};}catch{return {};}}
function saveDb(db){try{localStorage.setItem(STORAGE,JSON.stringify(db));return true;}catch{return false;}}
function state(){
 const db=loadDb();const key=signature();
 return {db,key,entry:db[key]&&typeof db[key]==='object'?db[key]:{maxAnchor:0,records:[]}};
}
function upperBound(){
 const t=getCanonical();const v=currentAnchor();return Math.min(t.length,Math.max(0,v));
}
function observe(){
 if(!getCanonical()||!$i('viewerOverlay')?.classList.contains('active'))return;
 const {db,key,entry}=state();
 let current=upperBound();
 // Current page is already visible; grant access to this page, but never to later pages.
 try{
  const next=pageAnchors?.[pageIndex+1];
  if(Number.isFinite(next)&&next>current)current=Math.min(getCanonical().length,next-1);
 }catch{}
 if(current>(Number(entry.maxAnchor)||0)){
  entry.maxAnchor=current;entry.records=Array.isArray(entry.records)?entry.records:[];
  db[key]=entry;saveDb(db);
 }
}
function unlocked(){
 const {entry}=state();return Math.min(getCanonical().length,Math.max(upperBound(),Number(entry.maxAnchor)||0));
}
function shortExcerpt(text,at,limit){
 const head=Math.max(0,at-64),tail=Math.min(limit,text.length,at+140);
 return text.slice(head,tail).replace(/\s+/g,' ').trim();
}
function chapterRecords(limit){
 // Read-only chapter headings are factual source locations, not inferred plot.
 const list=typeof bookChapters!=='undefined'&&Array.isArray(bookChapters)?bookChapters:[];
 const text=getCanonical(),output=[];
 for(let i=0;i<list.length;i++){
  const ch=list[i],at=Number(typeof chapterCanonicalStarts!=='undefined'?chapterCanonicalStarts[i]:ch.start);
  if(!Number.isFinite(at)||at<0||at>limit)continue;
  output.push({id:'chapter-'+i,category:'timeline',title:ch.title||'제'+(i+1)+'장',
   content:'이 장의 시작 지점까지 읽었습니다. 이 항목은 원문 차례를 표시하며, 사건을 자동으로 추론한 요약은 아닙니다.',
   anchor:at,source:'원문 차례',kind:'chapter'});
 }
 return output;
}
function sourceRecords(limit){
 // Literal source excerpts from fully read pages; no semantic fabrication.
 const text=getCanonical();if(!text)return [];
 let marks=[],parts=typeof chapterCanonicalStarts!=='undefined'&&Array.isArray(chapterCanonicalStarts)?chapterCanonicalStarts:[];
 for(let k=0;k<parts.length;k++){
  let a=Number(parts[k]);if(!Number.isFinite(a)||a<0||a>limit)continue;
  marks.push(a);
 }
 if(!marks.length)marks=[0];
 return marks.slice(-80).map((at,i)=>({id:'excerpt-'+i+'-'+at,category:'fact',title:'원문 기록 · '+(i+1),
   content:shortExcerpt(text,at,limit),anchor:at,source:'원문 직접 인용 (내용 분석 아님)',kind:'excerpt'})).filter(x=>x.content);
}
function recordAnchor(r,total){
 const a=Number(r.anchor);
 if(Number.isFinite(a)&&a>=0)return Math.min(total,Math.round(a));
 const pct=Number(r.progress);
 if(Number.isFinite(pct)&&pct>=0&&pct<=100)return Math.round(total*pct/100);
 return null;
}
function normalizedRecords(limit){
 const t=getCanonical(),{entry}=state();const data=Array.isArray(entry.records)?entry.records:[];
 return data.map((r,i)=>{
  const anchor=recordAnchor(r,t.length);
  if(anchor===null||anchor>limit)return null;
  const category=names[r.category]?r.category:'fact';
  return {id:r.id||'record-'+i,category,title:String(r.title||'정보').slice(0,150),
   content:String(r.content||'').slice(0,MAX_CHARS),source:String(r.source||'사용자 제공 기록').slice(0,200),
   anchor,kind:'manual'};
 }).filter(Boolean);
}
function data(){
 const end=unlocked(),real=normalizedRecords(end);
 // Keep the panel useful even without an imported annotated manuscript.
 const fallback=real.length?[]:sourceRecords(end);
 return [...real,...chapterRecords(end),...fallback].sort((a,b)=>a.anchor-b.anchor);
}
function splitText(str,available,measure){
 // Binary search by characters, respecting whitespace where possible.
 const raw=String(str);if(!raw)return [''];
 let a=0,out=[];
 while(a<raw.length&&out.length<250){
  let low=1,high=Math.min(raw.length-a,MAX_CHARS),best=1;
  while(low<=high){
   const mid=(low+high)>>1;
   if(measure(raw.slice(a,a+mid))<=available){best=mid;low=mid+1;}else high=mid-1;
  }
  let cut=Math.max(1,best);
  if(a+cut<raw.length&&cut>15){let white=raw.lastIndexOf(' ',a+cut);if(white>a+cut*.55)cut=white-a;}
  out.push(raw.slice(a,a+cut));a+=cut;
  while(raw[a]===' ')a++;
 }
 return out;
}
function pageSize(){
 const rect=paper.getBoundingClientRect();
 return {width:Math.max(150,rect.width-30),height:Math.max(150,rect.height-30)};
}
function measureText(text,title,source){
 const sample=document.createElement('div');
 sample.className='insights-content';sample.style.cssText='position:absolute;visibility:hidden;pointer-events:none;width:'+pageSize().width+'px;height:auto;overflow:visible;';
 sample.innerHTML='<div class="insights-category">정보</div><div class="insights-entry-title">'+esc(title)+'</div><div class="insights-entry-text" style="flex:none">'+esc(text)+'</div><div class="insights-entry-source">'+esc(source)+'</div>';
 paper.appendChild(sample);const h=sample.scrollHeight;sample.remove();return h;
}
function buildPages(){
 const selected=data().filter(r=>category==='all'||r.category===category);
 const dims=pageSize(),maxH=Math.max(100,dims.height);
 const all=[];
 for(const r of selected){
  const body=r.content||'';
  const pieces=splitText(body,maxH,part=>measureText(part,r.title,r.source));
  pieces.forEach((piece,part)=>{
   all.push({...r,content:piece,subpage:part+1,totalSubpages:pieces.length});
  });
 }
 if(!all.length)all.push({title:'아직 공개된 정보가 없습니다',content:'읽은 범위에 해당하는 정보가 없습니다. 원문 차례가 있다면 장의 시작 지점을 기록합니다. 사실·인물·관계·목표 등의 해설은 근거 데이터가 제공된 경우에만 표시합니다.',category:'all',source:'스포일러 방지',anchor:0});
 return all;
}
function paint(){
 if(!shell||!shell.classList.contains('is-open'))return;
 pages=buildPages();position=Math.max(0,Math.min(position,pages.length-1));
 const p=pages[position];
 paper.innerHTML='<article class="insights-content"><div class="insights-category">'+esc(names[p.category]||'독서 정보')+'</div><h3 class="insights-entry-title">'+esc(p.title)+(p.totalSubpages>1?' ('+p.subpage+'/'+p.totalSubpages+')':'')+'</h3><p class="insights-entry-text">'+esc(p.content)+'</p><div class="insights-entry-source">'+esc(p.source||'')+'</div></article>';
 number.textContent=(position+1)+' / '+pages.length;
 $i('insightsPrev').disabled=position===0;
 $i('insightsNext').disabled=position===pages.length-1;
 const n=getCanonical().length,limit=unlocked();
 range.textContent='읽은 지점 '+(n?Math.round(limit/n*100):0)+'%';
}
function pageMove(dir){position=Math.min(pages.length-1,Math.max(0,position+dir));paint();}
function close(){
 if(!shell||!shell.classList.contains('is-open'))return;
 shell.classList.remove('is-open');shell.setAttribute('aria-hidden','true');
 lastFocus?.focus?.({preventScroll:true});
}
function open(){
 if(!$i('viewerOverlay')?.classList.contains('active')||!getCanonical())return;
 if(typeof readerNoteIsOpen==='function'&&readerNoteIsOpen())return;
 observe();lastFocus=document.activeElement;bookKey=signature();category='all';
 menu.value='all';position=0;shell.classList.add('is-open');shell.setAttribute('aria-hidden','false');
 paint();$i('insightsClose').focus({preventScroll:true});
}
function importFile(file){
 if(!file)return;
 if(file.size>1024*1024){alert('정보 JSON은 최대 1MB입니다.');return;}
 const reader=new FileReader();
 reader.onload=()=>{
  try{
   const obj=JSON.parse(reader.result);
   const records=Array.isArray(obj)?obj:obj.records;
   if(!Array.isArray(records)||records.length>MAX_RECORDS)throw Error('records 배열(최대 1200개)이 필요합니다.');
   const text=getCanonical(),safe=[];
   records.forEach((r,i)=>{
    if(!r||typeof r!=='object')return;
    const at=recordAnchor(r,text.length);
    if(at===null)throw Error((i+1)+'번 정보에 anchor 또는 progress가 없습니다.');
    if(!String(r.source||'').trim())throw Error((i+1)+'번 정보에 근거(source)가 없습니다.');
    safe.push({id:String(r.id||i),category:names[r.category]?r.category:'fact',
     title:String(r.title||'정보').slice(0,150),content:String(r.content||'').slice(0,MAX_CHARS),
     source:String(r.source).slice(0,200),anchor:at});
   });
   if(!confirm('이 책의 기존 정보 '+normalizedRecords(getCanonical().length).length+'건을 새 정보 '+safe.length+'건으로 교체할까요?'))return;
   const {db,key,entry}=state();entry.records=safe;db[key]=entry;
   if(!saveDb(db))throw Error('저장 공간이 부족하거나 접근이 제한되었습니다.');
   position=0;paint();
  }catch(err){alert('정보 파일 오류: '+err.message);}
 };
 reader.readAsText(file,'utf-8');
}
function setup(){
 if($i('insightsOpen'))return;
 const parent=$i('openReaderSearch');if(!parent)return;
 const b=document.createElement('button');b.id='insightsOpen';b.type='button';b.className='secondary';b.textContent='독서 정보';
 parent.parentNode.insertBefore(b,parent);b.addEventListener('click',open);
 const el=document.createElement('section');el.id='insightsPanel';el.className='insights-shell';el.setAttribute('aria-hidden','true');
 el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');el.setAttribute('aria-label','독서 정보');
 el.innerHTML='<header class="insights-head"><h2>독서 정보</h2><button id="insightsClose" type="button">닫기</button></header>'+
 '<div class="insights-controls"><select id="insightsCategory" aria-label="정보 종류">'+types.map(([k,v])=>'<option value="'+k+'">'+v+'</option>').join('')+'</select><span class="insights-marker" id="insightsRange"></span><button type="button" id="insightsImportBtn" class="insights-import">정보 불러오기</button><input type="file" id="insightsFileInput" accept=".json,application/json" hidden></div>'+
 '<main id="insightsPaper" class="insights-paper" tabindex="0" aria-label="독서 정보 페이지"></main>'+
 '<footer class="insights-footer"><button id="insightsPrev" type="button">〈 이전</button><span id="insightsNumber" class="insights-count">0 / 0</span><button id="insightsNext" type="button">다음 〉</button></footer>';
 document.body.appendChild(el);shell=el;paper=$i('insightsPaper');menu=$i('insightsCategory');number=$i('insightsNumber');range=$i('insightsRange');
 $i('insightsClose').onclick=close;
 $i('insightsPrev').onclick=()=>pageMove(-1);
 $i('insightsNext').onclick=()=>pageMove(1);
 menu.onchange=()=>{category=menu.value;position=0;paint();};
 $i('insightsImportBtn').onclick=()=>$i('insightsFileInput').click();
 $i('insightsFileInput').onchange=e=>{importFile(e.target.files[0]);e.target.value='';};
 // Capture keys before original reader page keys: while open only this panel navigates.
 window.addEventListener('keydown',e=>{
  if(!shell.classList.contains('is-open'))return;
  if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close();return;}
  if(['ArrowLeft','ArrowRight','PageUp','PageDown',' '].includes(e.key)){
   if(e.target.closest('select,input'))return;
   e.preventDefault();e.stopImmediatePropagation();
   pageMove(['ArrowLeft','PageUp'].includes(e.key)?-1:1);
  }
 },true);
 paper.addEventListener('pointerdown',e=>{pointerStart={x:e.clientX,y:e.clientY};},{passive:true});
 paper.addEventListener('pointerup',e=>{
  if(!pointerStart)return;const dx=e.clientX-pointerStart.x,dy=e.clientY-pointerStart.y;pointerStart=null;
  if(Math.abs(dx)>35&&Math.abs(dx)>Math.abs(dy)*1.3){pageMove(dx<0?1:-1);return;}
  if(Math.abs(dx)<12&&Math.abs(dy)<12&&!String(window.getSelection()||'').trim()){
   const rect=paper.getBoundingClientRect();pageMove(e.clientX<rect.left+rect.width/2?-1:1);
  }
 });
 // No scroll wheel pagination: avoids accidental page storms on an e-ink screen.
 el.addEventListener('wheel',e=>e.preventDefault(),{passive:false});
 const ro=typeof ResizeObserver!=='undefined'?new ResizeObserver(()=>{if(shell.classList.contains('is-open')){position=0;paint();}}):null;
 ro?.observe(paper);
 // Follows active book and progress; remains independent of the page rendering engine.
 const observer=new MutationObserver(()=>{
  if(!shell.classList.contains('is-open'))return;
  if(!$i('viewerOverlay')?.classList.contains('active')){close();return;}
  if(bookKey!==signature()){close();return;}
 });
 observer.observe($i('viewerOverlay'),{attributes:true,attributeFilter:['class']});
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')observe();});
 // Public hook for original page rendering; no destructive monkey patches.
 window.readerInsights={open,close,observe,refresh:()=>{if(shell.classList.contains('is-open'))paint();},isOpen:()=>shell.classList.contains('is-open')};
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup,{once:true});else setup();
})();