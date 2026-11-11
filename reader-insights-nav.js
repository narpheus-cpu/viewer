/* Long-novel navigation for previously verified, spoiler-safe reading-insight records. */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const labels={event:'사건 연표',relation:'인물 관계',character:'인물별 분석',clue:'핵심 단서'};
const confidence={fact:'확인된 사실',strong_inference:'근거 있는 해석',tentative:'잠정적 해석'};
const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const norm=value=>String(value??'').normalize('NFKC').toLocaleLowerCase('ko-KR').replace(/\s+/g,' ').trim();
let nav=null,active=false,mode='home',query='',pendingQuery='',chosen=null,recordId='',page=0;
let stack=[],records=[],byId=new Map(),entities=[],entityById=new Map(),sections=[],navPages=[],visible=0,cacheKey='',lastRead=-1;
function api(){return window.readerInsights;}
function snapshot(){return api()?.navigationSnapshot?.()||{records:[],readEnd:0,bookLength:0,currentAnchor:0,pageText:'',bookKey:''};}
function hasData(){return records.length>0;}
function setTitle(title){$('insightsNavTitle').textContent=title;}
function makeEntity(id,name,type,aliases=[]){
 const eid=String(id||name).trim(),label=String(name||id).trim();
 if(!eid||!label)return;
 let entry=entityById.get(eid);
 if(!entry){entry={id:eid,name:label,type,aliases:new Set(),recordIds:new Set()};entityById.set(eid,entry);}
 if(entry.type==='other'&&type!=='other')entry.type=type;
 for(const alias of aliases)if(alias&&alias!==label)entry.aliases.add(String(alias).slice(0,80));
 return entry;
}
function linkEntity(entry,record){if(entry)entry.recordIds.add(record.id);}
function fallbackEntities(record){
 const subject=String(record.subject||'').trim();if(!subject)return [];
 if(record.category==='character')return [{id:'person:'+subject,name:subject,type:'person',aliases:record.aliases||[]}];
 if(record.category==='relation'){
  const parts=subject.split(/\s*(?:↔|⇄|←→|→|⇢|[\\/])\s*/).map(p=>p.trim()).filter(Boolean);
  if(parts.length===2)return parts.map(name=>({id:'person:'+name,name,type:'person',aliases:[]}));
  return [{id:'relation:'+subject,name:subject,type:'other',aliases:record.aliases||[]}];
 }
 if(record.category==='clue')return [{id:'clue:'+subject,name:subject,type:'object',aliases:record.aliases||[]}];
 return [{id:'subject:'+subject,name:subject,type:'other',aliases:record.aliases||[]}];
}
function indexVisible(){
 const s=snapshot();
 cacheKey=s.bookKey+':'+s.readEnd+':'+s.records.length;
 records=s.records;
 byId=new Map(records.map(r=>[r.id,r]));
 entityById.clear();
 for(const record of records){
  const linked=Array.isArray(record.entities)&&record.entities.length?record.entities:fallbackEntities(record);
  for(const item of linked){
   linkEntity(makeEntity(item.id,item.name,item.type,item.aliases||[]),record);
  }
 }
 entities=[...entityById.values()].sort((a,b)=>{
  const size=b.recordIds.size-a.recordIds.size;
  return size||a.name.localeCompare(b.name,'ko');
 });
 if(chosen)chosen=entityById.get(chosen.id)||chosen;
 return s;
}
function forEntity(entity){
 if(!entity)return [];
 return records.filter(r=>entity.recordIds.has(r.id));
}
function onLoaded(){
 if(!nav)return;
 const s=indexVisible();
 if(!hasData()){
  active=false;mode='home';pendingQuery='';setVisibility(false);
  return;
 }
 active=true;stack=[];page=0;mode='home';
 if(pendingQuery){
  const word=pendingQuery;pendingQuery='';
  setSearch(word,true);
 }
 setVisibility(true);paint();
}
function onClose(){
 active=false;stack=[];page=0;chosen=null;recordId='';query='';
 setVisibility(false);
}
function exitToCategory(){
 if(!active)return;
 active=false;mode='home';stack=[];page=0;
 setVisibility(false);
}
function enterHome(){
 if(!hasData()){active=false;return;}
 active=true;mode='home';stack=[];page=0;chosen=null;recordId='';query='';
 setVisibility(true);paint();
}
function requestSearch(text){pendingQuery=String(text||'').trim().slice(0,100);}
function requestRender(){api()?.refresh?.();}
function setVisibility(yes){
 if(!nav)return;
 nav.hidden=!yes;
 const panel=$('insightsPanel');if(!panel)return;
 panel.classList.toggle('insights-nav-active',yes);
 const tabs=panel.querySelector('.insights-tabs');
 if(tabs)tabs.hidden=yes;
 $('insightsNavReturn').hidden=!hasData();
}
function push(next,extra){
 stack.push({mode,chosen,recordId,query,page});
 mode=next;chosen=extra?.entity||null;recordId=extra?.record||'';
 if(next==='search')query=extra?.query||query;
 page=0;setVisibility(true);paint();
}
function goBack(){
 if(!active)return;
 if(stack.length){
  const state=stack.pop();mode=state.mode;chosen=state.chosen;recordId=state.recordId;
  query=state.query;page=state.page;
 }else{mode='home';page=0;chosen=null;recordId='';}
 paint();
}
function setSearch(value,direct=false){
 query=String(value||'').trim().slice(0,100);
 const q=norm(query);
 if(direct&&q){
  const exact=entities.filter(e=>[e.name,...e.aliases].some(a=>norm(a)===q));
  if(exact.length===1){chosen=exact[0];mode='entity';page=0;return;}
 }
 mode='search';page=0;
}
function openSearch(word){
 if(!active)return;
 stack.push({mode,chosen,recordId,query,page});
 setSearch(word||'',true);paint();
}
function goRecord(id){
 if(!byId.has(id))return;push('record',{record:id});
}
function recordsForEntity(e){return e?forEntity(e):[];}
function latestForEntity(e){
 const subset=recordsForEntity(e);
 const mapped=new Map(subset.map(r=>[r.id,r]));
 const superseded=new Set();
 for(const r of subset)if(r.replaces&&mapped.has(r.replaces))superseded.add(r.replaces);
 return subset.filter(r=>!superseded.has(r.id)).sort((a,b)=>b.revealOffset-a.revealOffset);
}
function lens(s){
 const snippet=norm(s.pageText);
 const anchor=Number(s.currentAnchor)||s.readEnd;
 const matches=[];
 const namesFor=id=>{
  const r=byId.get(id);if(!r)return [];
  return [...entityById.values()].filter(e=>e.recordIds.has(id))
   .flatMap(e=>[e.name,...e.aliases]).filter(t=>norm(t).length>=2);
 };
 for(const r of records){
  const personMatch=snippet&&namesFor(r.id).some(alias=>snippet.includes(norm(alias)));
  const nearby=Math.abs(r.revealOffset-anchor)<Math.min(5000,Math.max(600,s.bookLength*.01));
  if(!personMatch&&!nearby)continue;
  const score=(personMatch?100:0)+(nearby?35:0)+(r.importance||3)*5-Math.min(20,Math.abs(r.revealOffset-anchor)/1200);
  matches.push({...r,score});
 }
 matches.sort((a,b)=>b.score-a.score||b.revealOffset-a.revealOffset);
 return matches.slice(0,40);
}
function newest(){
 const sorted=records.slice().sort((a,b)=>b.revealOffset-a.revealOffset);
 const changed=sorted.filter(r=>r.replaces);
 const sample=[...changed.slice(0,12),...sorted.slice(0,20)].filter((r,i,list)=>list.findIndex(x=>x.id===r.id)===i);
 return sample.sort((a,b)=>b.revealOffset-a.revealOffset).slice(0,35);
}
function rankSearch(queryText){
 const q=norm(queryText);if(!q)return [];
 const scored=[];
 for(const r of records){
  let score=0;
  const subject=norm(r.subject),title=norm(r.title),description=norm(r.text),proof=norm(r.evidence);
  if(subject===q)score+=130;else if(subject.includes(q))score+=75;
  if(title.includes(q))score+=65;
  if(description.includes(q))score+=25;
  if(proof.includes(q))score+=10;
  const referenced=entities.filter(e=>e.recordIds.has(r.id));
  if(referenced.some(e=>[e.name,...e.aliases].some(name=>norm(name)===q)))score+=125;
  else if(referenced.some(e=>[e.name,...e.aliases].some(name=>norm(name).includes(q))))score+=50;
  if(score)scored.push({...r,score:score+(r.importance||3)*2});
 }
 return scored.sort((a,b)=>b.score-a.score||b.revealOffset-a.revealOffset);
}
function filterPerson(){return entities.filter(e=>e.type==='person');}
function filterClue(){return entities.filter(e=>e.type==='object'||e.type==='place'||e.type==='concept');}
function asItemRecord(r){
 return {type:'record',id:r.id,title:r.title,caption:labels[r.category]+' · '+(r.subject||r.evidence.slice(0,20)),importance:r.importance||3};
}
function asItemEntity(e){
 return {type:'entity',id:e.id,title:e.name,caption:e.recordIds.size+'건의 관련 기록',importance:e.recordIds.size};
}
function homeItems(s){
 const related=lens(s);
 return [
  {type:'route',id:'lens',title:'지금 읽는 장면',caption:'현재 위치에 연결된 기록 '+related.length+'건'},
  {type:'route',id:'people',title:'인물 찾아가기',caption:'주요 인물 '+filterPerson().length+'명'},
  {type:'route',id:'timeline',title:'사건 지도',caption:'공개된 주요 사건 '+records.filter(r=>r.category==='event').length+'건'},
  {type:'route',id:'clues',title:'핵심 단서',caption:'등록된 단서 '+filterClue().length+'개'},
  {type:'route',id:'recent',title:'최근 변화',caption:'최근에 드러난 정보와 수정된 해석'},
  {type:'route',id:'search',title:'통합 검색',caption:'이름·별칭·사건·단서 검색'},
  {type:'route',id:'all',title:'전체 정보 보기',caption:'기존 네 범주로 모든 기록 확인'}
 ];
}
function itemsFor(s){
 switch(mode){
  case 'home':return homeItems(s);
  case 'lens':return lens(s).map(asItemRecord);
  case 'people':return filterPerson().map(asItemEntity);
  case 'clues':return filterClue().map(asItemEntity);
  case 'timeline':return records.filter(r=>r.category==='event').slice().sort((a,b)=>{
   if(a.story_order!=null&&b.story_order!=null&&a.story_order!==b.story_order)return a.story_order-b.story_order;
   return a.revealOffset-b.revealOffset;
  }).map(asItemRecord);
  case 'recent':return newest().map(asItemRecord);
  case 'search':return rankSearch(query).map(asItemRecord);
  case 'entity':return latestForEntity(chosen).map(asItemRecord);
  case 'history':return recordsForEntity(chosen).slice().sort((a,b)=>a.revealOffset-b.revealOffset).map(asItemRecord);
  case 'related':{
   const r=byId.get(recordId);if(!r)return [];
   return (r.related_ids||[]).map(id=>byId.get(id)).filter(Boolean).map(asItemRecord);
  }
  default:return [];
 }
}
function titleFor(){
 const map={home:'독서정보 탐색',lens:'지금 읽는 장면',people:'인물 찾아가기',clues:'핵심 단서',
  timeline:'사건 지도',recent:'최근 변화',search:'정보 검색',
  entity:chosen?.name||'인물 정보',history:(chosen?.name||'인물')+' · 변화 이력',
  related:'연관 기록',record:byId.get(recordId)?.title||'기록'};
 return map[mode]||'독서정보';
}
function listSize(){
 const paper=$('insightsPaper'),height=Math.max(150,paper?.clientHeight||400);
 return Math.max(2,Math.min(9,Math.floor((height-50)/64)));
}
function rowHtml(item){
 const display=esc(item.title),caption=esc(item.caption||'');
 return '<button class="insights-nav-item" type="button" data-nav-kind="'+esc(item.type)+'" data-nav-id="'+esc(item.id)+'">'+
 '<span class="insights-nav-name">'+display+'</span><span class="insights-nav-caption">'+caption+'</span></button>';
}
function renderList(s){
 const list=itemsFor(s),size=listSize(),total=Math.max(1,Math.ceil(list.length/size));
 page=Math.max(0,Math.min(page,total-1));
 const selected=list.slice(page*size,(page+1)*size);
 const hint=mode==='home'?'현재까지 공개된 기록 '+records.length+'건':mode==='lens'?
  '읽은 위치 가까이에서 확인된 사실':mode==='search'?
  (query?'검색 결과 '+list.length+'건':'검색어를 입력해 줘'):'총 '+list.length+'건';
 const extra=mode==='entity'?
  '<button class="insights-nav-inline" type="button" data-nav-kind="route" data-nav-id="history">변화 이력 ('+recordsForEntity(chosen).length+'건)</button>':'';
 return {html:'<div class="insights-nav-list"><div class="insights-nav-hint">'+esc(hint)+extra+'</div>'+
  selected.map(rowHtml).join('')+'</div>',count:list.length,labels:(page+1)+' / '+total,prev:page>0,next:page+1<total};
}
function cardHtml(r,content,part,total){
 return '<div class="insights-type">'+esc(labels[r.category])+' · '+esc(confidence[r.confidence])+'</div>'+
  '<h3 class="insights-title">'+esc(r.title)+(total>1?' <small>'+part+'/'+total+'</small>':'')+'</h3>'+
  '<div class="insights-body">'+esc(content)+'</div>'+
  '<div class="insights-proof">'+esc(r.evidence)+'</div>';
}
function fits(r,portion){
 const surface=$('insightsPaper');
 const probe=document.createElement('article');probe.className='insights-card insights-measure';
 probe.innerHTML=cardHtml(r,portion,1,1);surface.appendChild(probe);
 const css=getComputedStyle(surface);
 const usable=Math.max(55,surface.clientHeight-parseFloat(css.paddingTop||0)-parseFloat(css.paddingBottom||0)-7);
 const okay=probe.scrollHeight<=usable;probe.remove();return okay;
}
function splitDetail(r){
 const text=String(r.text||'');
 let offset=0,pieces=[],guard=0;
 while(offset<text.length&&guard++<300){
  const possible=Math.min(12000,text.length-offset);
  let low=1,high=possible,best=1;
  while(low<=high){
   const mid=(low+high)>>1;
   if(fits(r,text.slice(offset,offset+mid))){best=mid;low=mid+1;}else high=mid-1;
  }
  if(best>40&&offset+best<text.length){
   const sample=text.slice(offset,offset+best);
   for(const t of ['\n\n','\n',' ']){
    const cut=sample.lastIndexOf(t);
    if(cut>best*.65){best=cut;break;}
   }
  }
  let end=offset+Math.max(1,best);
  if(end<text.length&&/[\uD800-\uDBFF]/.test(text[end-1])&&/[\uDC00-\uDFFF]/.test(text[end]))end--;
  end=Math.max(end,offset+1);
  pieces.push(text.slice(offset,end));offset=end;
  while(offset<text.length&&/\s/.test(text[offset]))offset++;
 }
 return pieces.length?pieces:[''];
}
function renderRecord(){
 const r=byId.get(recordId);
 if(!r)return {html:'',labels:'0 / 0',prev:false,next:false};
 const portions=splitDetail(r),total=portions.length;
 page=Math.max(0,Math.min(page,total-1));
 const linked=(r.related_ids||[]).filter(id=>byId.has(id));
 $('insightsNavRelated').hidden=!linked.length;
 return {html:'<article class="insights-card">'+cardHtml(r,portions[page],page+1,total)+'</article>',
   labels:(page+1)+' / '+total,prev:page>0,next:page<total-1};
}
function renderIfActive(){
 if(!active||!nav)return false;
 const s=indexVisible();
 // If data have been withdrawn, return to the original blank panel.
 if(!s.records.length){exitToCategory();return false;}
 setVisibility(true);
 setTitle(titleFor());
 $('insightsNavBack').disabled=mode==='home'&&!stack.length;
 $('insightsNavQueryWrap').hidden=mode!=='search';
 $('insightsNavRelated').hidden=true;
 if(mode==='search'){
  const input=$('insightsNavSearch');
  if(input.value!==query)input.value=query;
 }
 const result=mode==='record'?renderRecord():renderList(s);
 $('insightsPaper').innerHTML=result.html;
 $('insightsPageCount').textContent=result.labels||'0 / 0';
 $('insightsPrev').disabled=!result.prev;
 $('insightsNext').disabled=!result.next;
 return true;
}
function paint(){if(active)requestRender();}
function turn(delta){
 if(!active)return false;
 const s=snapshot(),count=mode==='record'?
  Math.max(1,splitDetail(byId.get(recordId)||{text:'',title:''}).length):
  Math.max(1,Math.ceil(itemsFor(s).length/listSize()));
 const next=Math.max(0,Math.min(count-1,page+delta));
 if(next!==page){page=next;paint();}
 return true;
}
function navigateItem(kind,id){
 const s=snapshot();
 if(kind==='route'){
  if(id==='all'){exitToCategory();$('insightsPanel').querySelector('.insights-tabs').hidden=false;api()?.refresh?.();return;}
  if(id==='search'){openSearch('');$('insightsNavSearch').focus({preventScroll:true});return;}
  if(id==='history'){push('history',{entity:chosen});return;}
  if(['lens','people','timeline','clues','recent'].includes(id)){push(id);return;}
 }else if(kind==='record')goRecord(id);
 else if(kind==='entity'){
  const entity=entityById.get(id);if(entity)push('entity',{entity});
 }
}
function handleClick(event){
 const button=event.target.closest?.('[data-nav-kind]');
 if(!button||!nav.contains(button)&&!$('insightsPaper').contains(button))return;
 event.preventDefault();event.stopPropagation();
 navigateItem(button.dataset.navKind,button.dataset.navId);
}
function init(){
 const base=$('insightsPanel');if(!base||nav)return;
 nav=document.createElement('div');nav.id='insightsNavigatorBar';nav.className='insights-nav-bar';nav.hidden=true;
 nav.innerHTML='<button type="button" id="insightsNavBack" aria-label="이전 탐색 화면">〈</button>'+
  '<strong id="insightsNavTitle">독서정보 탐색</strong>'+
  '<button type="button" id="insightsNavRelated" hidden>관련</button>'+
  '<button type="button" id="insightsNavFind">검색</button>'+
  '<div id="insightsNavQueryWrap" hidden><input id="insightsNavSearch" type="search" placeholder="인물 · 사건 · 단서 검색" aria-label="독서정보 검색어" autocomplete="off"></div>';
 base.querySelector('.insights-tabs').before(nav);
 const home=document.createElement('button');home.type='button';home.id='insightsNavReturn';home.textContent='탐색';home.hidden=true;
 base.querySelector('.insights-head h2').after(home);
 home.onclick=enterHome;
 $('insightsNavBack').onclick=goBack;
 $('insightsNavFind').onclick=()=>openSearch('');
 $('insightsNavRelated').onclick=()=>push('related',{record:recordId});
 $('insightsNavSearch').addEventListener('input',e=>{query=e.target.value.slice(0,100);page=0;paint();});
 $('insightsPaper').addEventListener('click',handleClick);
 nav.addEventListener('click',handleClick);
 window.ReaderInsightsNavigator={onLoaded,onClose,exitToCategory,renderIfActive,turn,requestSearch,
  openSearch,enterHome,isActive:()=>active};
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();