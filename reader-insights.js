/* Reading insights panel v3: cumulative plot first, individual bullet evidence and legacy v2 support. */
(function(){
'use strict';
const D=()=>window.ReaderInsightsData;
const el=id=>document.getElementById(id);
const tabs=[['plot','현재까지 줄거리'],['relation','인물 관계'],['character','인물별 분석'],['clue','핵심 단서']];
const tabNames=Object.fromEntries(tabs),confLabels={fact:'확인된 사실',strong_inference:'근거 있는 해석',tentative:'잠정적 해석'};
const escape=s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
let overlay=null,paper=null,category='plot',entries=[],shown=[],insightPages=[],pageNumber=0;
let currentKey='',latestToken=0,focused=null,gesture=null,layoutKey='',offsetCache=new Map(),unmatched=0;
function bookText(){try{return fullText||'';}catch{return '';}}
function evidenceDisplay(r){
 const quotes=Array.isArray(r.evidence_passages)&&r.evidence_passages.length?
  r.evidence_passages.map(e=>e.quote):[r.evidence];
 return quotes.map(q=>D().formatEvidence(q)).join('\n근거: ');
}
function bookCanonical(){try{return readerCanonical();}catch{return bookText();}}
function panelOpen(){return !!overlay?.classList.contains('is-open');}
function readerOpen(){return !!el('viewerOverlay')?.classList.contains('active');}
/* Only the real rendered spread is eligible. An unloaded chapter placeholder
   or a direct jump cannot certify unseen content. */
function pageWindow(){
 const text=bookCanonical();
 if(!text||!readerOpen()||typeof pageIndex==='undefined'||!Array.isArray(pages)||!pages.length)return null;
 const count=typeof visiblePageCount==='function'?visiblePageCount():1;
 const shown=pages.slice(pageIndex,pageIndex+count);
 if(!shown.length||shown.some(html=>!html||html.includes('data-reader-pending=')))return null;
 const realIndices=[];
 for(let i=0;i<shown.length;i++)if(!shown[i].includes('chapter-spacer'))realIndices.push(pageIndex+i);
 if(!realIndices.length)return null;
 const first=realIndices[0],last=realIndices[realIndices.length-1];
 const start=Math.max(0,Number(pageAnchors[first])||0),lastStart=Math.max(start,Number(pageAnchors[last])||start);
 const next=Number(pageAnchors[last+1]);
 let end=lastStart;
 if(Number.isFinite(next)&&next>lastStart)end=next;
 else{
  // Use only visible text if a lazy chapter has no subsequent measured page.
  const rendered=typeof htmlToStableText==='function'?htmlToStableText(pages[last]):'';
  end=lastStart+rendered.length;
 }
 return {first,last,start,end:Math.min(text.length,Math.max(end,start))};
}
function visibleEnd(){return pageWindow()?.end??0;}
function observe(){
 const text=bookText();
 if(!D()||!readerOpen()||!text||typeof restoreInProgress!=='undefined'&&restoreInProgress)return;
 const view=pageWindow();
 if(!view)return;
 const progress=D().getReadState(text);
 // First visible page of a new book only. Do not interpret a restored late page
 // or a jump-to-end as proof of reading the preceding chapters.
 if(!progress.hasRecord&&view.start===0&&view.first===0)D().markSeen(text,view.end);
 if(panelOpen()){
  if(currentKey!==D().key(text)){close();return;}
  layoutKey='';paint();
 }
}
function prepareAdvance(){
 const text=bookText(),view=pageWindow();
 if(!D()||!view||!text)return null;
 const progress=D().getReadState(text);
 return {key:D().key(text),start:view.start,end:view.end,
  permitted:view.start<=progress.seen+1&&(progress.hasRecord||view.start===0)};
}
function finishAdvance(ticket){
 if(!ticket||!ticket.permitted||!D()||ticket.key!==D().key(bookText()))return;
 const next=pageWindow();
 if(!next||next.start<=ticket.start||next.start>ticket.end+2)return;
 D().markSeen(bookText(),next.end);
 if(panelOpen()){layoutKey='';paint();}
}
function correctTo(offset){
 if(!D()||!bookText())return;
 D().setSeen(bookText(),Math.min(bookCanonical().length,Math.max(0,Math.round(offset))));
 layoutKey='';pageNumber=0;
 if(panelOpen())paint();
}
/* Only vetted visible records may enter the navigator's search/index. */
function navigationSnapshot(){
 const canonical=bookCanonical(),limit=Math.min(canonical.length,D()?.getSeen(bookText())||0);
 const known=entries.map(record=>({...record,revealOffset:revealEnd(record,canonical)}))
  .filter(record=>record.revealOffset>=0&&record.revealOffset<=limit);
 const view=pageWindow();
 const eligible=view&&view.start<limit?view:null;
 return {records:known,readEnd:limit,bookLength:canonical.length,
  currentAnchor:eligible?eligible.start:limit,
  pageText:eligible?canonical.slice(eligible.start,Math.min(limit,eligible.end)):'',
  bookKey:D()?.key(bookText())||''};
}
function openForSelection(text){
 const query=String(text||'').trim().slice(0,120);
 if(!query||!bookText())return false;
 window.ReaderInsightsNavigator?.requestSearch?.(query);
 void open();
 return true;
}
function lookupEnd(text,phrase,occ){
 let end=D().occurrenceEnd(text,phrase,occ);
 if(end>=0)return end;
 // Source excerpts may cross paragraph boundaries after rendering.
 const parts=phrase.trim().split(/\s+/).map(p=>[...p].map(ch=>'\\.^$*+?()[]{}|'.includes(ch)?'\\'+ch:ch).join(''));
 if(parts.length<2)return -1;
 try{
  const rx=new RegExp(parts.join('\\s+'),'gu');
  let found;for(let i=0;i<occ;i++){found=rx.exec(text);if(!found)return -1;}
  return found.index+found[0].length;
 }catch{return -1;}
}
function revealEnd(record,canonicalText){
 const key=record.reveal.quote+'\x00'+record.reveal.occurrence;
 if(offsetCache.has(key))return offsetCache.get(key);
 const offset=lookupEnd(canonicalText,record.reveal.quote,record.reveal.occurrence);
 offsetCache.set(key,offset);return offset;
}
function currentEntries(){
 const text=bookCanonical(),limit=Math.min(text.length,D().getSeen(bookText()));
 const mapped=[],missing=[];
 for(const record of entries){
  const end=revealEnd(record,text);
  if(end<0)missing.push(record);
  else if(end<=limit)mapped.push({...record,revealOffset:end});
 }
 unmatched=missing.length;
 const known=new Map(mapped.map(r=>[r.id,r]));
 shown=mapped.filter(r=>r.category===category);
 if(category==='plot')shown=shown.slice().sort((a,b)=>a.revealOffset-b.revealOffset).slice(-1);
 shown.sort((a,b)=>category==='event'&&a.story_order!=null&&b.story_order!=null&&a.story_order!==b.story_order?
  a.story_order-b.story_order:a.revealOffset-b.revealOffset);
 shown=shown.map(r=>{
  const prev=r.replaces?known.get(r.replaces):null;
  return {...r,display:r.category==='plot'?r.bullets.map((b,i)=>(i+1)+'. '+b.text+'\n['+confLabels[b.confidence]+']\n근거: '+b.evidence.map(e=>D().formatEvidence(e.quote)).join('\n근거: ')).join('\n\n'):(r.body??r.text)+(prev?'\n\n이전 판단: '+(prev.body??prev.text):'')+'\n\n근거: '+evidenceDisplay(r)};
 });
 const pct=text.length?Math.floor(limit/text.length*100):0;
 el('insightsSeen').textContent='읽은 범위 '+pct+'%';
 el('insightsStatus').textContent=unmatched?'위치 검증 실패 '+unmatched+'건':'';
}
function cardHtml(entry,portion,part=1,total=1){
 return '<div class="insights-type">'+escape(tabNames[entry.category])+(entry.subject?' · '+escape(entry.subject):'')+'</div>'+
 '<h3 class="insights-title">'+escape(entry.title)+(total>1?' <small>('+part+'/'+total+')</small>':'')+'</h3>'+
 '<div class="insights-body">'+escape(portion)+'</div>'+
 '<div class="insights-proof">'+escape(entry.category==='plot'?'항목별 근거·확실성 확인':confLabels[entry.confidence])+'</div>';
}
function fits(entry,string){
 const probe=document.createElement('article');probe.className='insights-card insights-measure';
 probe.innerHTML=cardHtml(entry,string);paper.append(probe);
 const style=getComputedStyle(paper);const usable=Math.max(30,paper.clientHeight-parseFloat(style.paddingTop||0)-parseFloat(style.paddingBottom||0)-5);
 const okay=probe.scrollHeight<=usable;probe.remove();return okay;
}
function split(entry){
 const text=entry.display;
 if(!text)return [{...entry,portion:'',part:1,total:1}];
 const result=[];let offset=0,loop=0;
 while(offset<text.length&&loop++<20000){
  let length=Math.min(text.length-offset,12000),best=1;
  if(fits(entry,text.slice(offset,offset+length)))best=length;
  else{
   let lo=1,hi=length;
   while(lo<=hi){const n=(lo+hi)>>1;
    if(fits(entry,text.slice(offset,offset+n))){best=n;lo=n+1;}else hi=n-1;
   }
  }
  if(offset+best<text.length&&best>30){
   const bit=text.slice(offset,offset+best);
   const stops=[bit.lastIndexOf('\n\n'),bit.lastIndexOf('\n'),bit.lastIndexOf(' ')];
   for(const p of stops)if(p>best*.65){best=p;break;}
  }
  let end=offset+Math.max(1,best);
  if(end<text.length&&/[\uD800-\uDBFF]/.test(text[end-1])&&/[\uDC00-\uDFFF]/.test(text[end]))end--;
  end=Math.max(offset+1,end);
  result.push(text.slice(offset,end));offset=end;
  while(offset<text.length&&/\s/.test(text[offset]))offset++;
 }
 return result.map((portion,index)=>({...entry,portion,part:index+1,total:result.length}));
}
function layout(){
 const key=currentKey+'|'+category+'|'+D().getSeen(bookText())+'|'+paper.clientWidth+'x'+paper.clientHeight+'|'+entries.length;
 if(layoutKey===key)return;
 currentEntries();insightPages=shown.flatMap(split);layoutKey=key;
 pageNumber=Math.max(0,Math.min(pageNumber,insightPages.length-1));
}
function paint(){
 if(!panelOpen())return;
 if(window.ReaderInsightsNavigator?.renderIfActive?.())return;
 layout();paper.replaceChildren();
 if(insightPages.length){
  const p=insightPages[pageNumber],card=document.createElement('article');
  card.className='insights-card';card.innerHTML=cardHtml(p,p.portion,p.part,p.total);paper.append(card);
 }
 el('insightsPageCount').textContent=insightPages.length?(pageNumber+1)+' / '+insightPages.length:'0 / 0';
 el('insightsPrev').disabled=!insightPages.length||pageNumber===0;
 el('insightsNext').disabled=!insightPages.length||pageNumber===insightPages.length-1;
}
function turn(dir){if(window.ReaderInsightsNavigator?.turn?.(dir))return;const next=Math.max(0,Math.min(insightPages.length-1,pageNumber+dir));if(next!==pageNumber){pageNumber=next;paint();}}
function setTab(tab){
 window.ReaderInsightsNavigator?.exitToCategory?.();
 category=tab;pageNumber=0;layoutKey='';
 overlay?.querySelectorAll('[data-insight-tab]').forEach(b=>{
  const is=b.dataset.insightTab===tab;b.classList.toggle('selected',is);b.setAttribute('aria-pressed',String(is));
 });
 paint();
}
function close(){
 ++latestToken;
 window.ReaderInsightsNavigator?.onClose?.();
 if(!panelOpen())return;
 overlay.classList.remove('is-open');overlay.setAttribute('aria-hidden','true');
 focused?.focus?.({preventScroll:true});
}
async function open(){
 if(!readerOpen()||!bookText()||!D())return;
 cancelCorrection();
 if(typeof readerNoteIsOpen==='function'&&readerNoteIsOpen())return;
 observe();const token=++latestToken;
 currentKey=D().key(bookText());entries=[];offsetCache.clear();layoutKey='';pageNumber=0;
 focused=document.activeElement;overlay.classList.add('is-open');overlay.setAttribute('aria-hidden','false');
 setTab('plot');paper.replaceChildren();el('insightsPageCount').textContent='0 / 0';
 el('insightsClose').focus({preventScroll:true});
 const loaded=await D().load(bookText());
 if(!panelOpen()||token!==latestToken||currentKey!==D().key(bookText()))return;
 entries=loaded?.records||[];
  const isLegacy=!entries.some(r=>r.category==='plot')&&entries.some(r=>r.category==='event');
  const first=overlay.querySelector('[data-insight-tab=plot], [data-insight-tab=event]');
  if(first){first.dataset.insightTab=isLegacy?'event':'plot';first.textContent=isLegacy?'기존 사건 연표':'현재까지 줄거리';}
  if(isLegacy)setTab('event');
  layoutKey='';window.ReaderInsightsNavigator?.onLoaded?.();paint();
}
async function importJson(file){
 if(!file||!bookText())return;
 if(file.size>32*1024*1024){alert('독서정보 JSON은 32MB 이하여야 합니다.');return;}
 try{
  const obj=JSON.parse(await file.text());
  const checked=D().validate(obj,bookText());
  if(!confirm('현재 책의 독서정보를 '+checked.records.length+'건으로 교체할까요?'))return;
  await D().save(bookText(),checked);
  entries=checked.records;offsetCache.clear();layoutKey='';pageNumber=0;
   const isLegacy=!entries.some(r=>r.category==='plot')&&entries.some(r=>r.category==='event');
   const first=overlay.querySelector('[data-insight-tab=plot], [data-insight-tab=event]');
   if(first){first.dataset.insightTab=isLegacy?'event':'plot';first.textContent=isLegacy?'기존 사건 연표':'현재까지 줄거리';}
   setTab(isLegacy?'event':'plot');
   window.ReaderInsightsNavigator?.onLoaded?.();paint();
 }catch(e){alert(e.message||String(e));}
}

/* A reader can explicitly correct an accidental jump, including backward.
   A selected sentence is mapped to the canonical text of that displayed page. */
let markDialog=null,selectedCursor=null;
function getSelectedCursor(){
 const sel=window.getSelection();
 if(!sel||sel.isCollapsed||!sel.rangeCount)return null;
 const range=sel.getRangeAt(0);
 const node=range.endContainer.nodeType===1?range.endContainer:range.endContainer.parentElement;
 const pageEl=node?.closest?.('#pageInnerLeft, #pageInnerRight');
 if(!pageEl)return null;
 const index=pageIndex+(pageEl.id==='pageInnerRight'?1:0);
 if(!pages[index]||pages[index].includes('data-reader-pending=')||pages[index].includes('chapter-spacer'))return null;
 const novel=bookCanonical();
 const start=Math.max(0,Number(pageAnchors[index])||0);
 const next=Number(pageAnchors[index+1]);
 const upper=Number.isFinite(next)&&next>start?Math.min(novel.length,next):novel.length;
 const startNode=range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement;
 if(!startNode?.closest?.('#pageInnerLeft, #pageInnerRight'))return null;
 const quote=String(range.toString()||'').trim();
 // Selection may be a single Korean character or a short word.
 if(quote.length<1||quote.length>1000)return null;
 const prefix=document.createRange();
 prefix.setStart(pageEl,0);
 try{prefix.setEnd(range.endContainer,range.endOffset);}catch{return null;}
 const guessed=start+prefix.toString().length;
 let match=null,distance=Infinity,scanned=0;
 for(let at=novel.indexOf(quote,start);at>=0&&at<upper&&scanned++<10000;at=novel.indexOf(quote,at+1)){
  const end=at+quote.length;
  if(end>upper)break;
  const delta=Math.abs(end-guessed);
  if(delta<distance){distance=delta;match=end;}
  if(end>guessed&&delta>distance)break;
 }
 if(match===null)return null;
 return {end:match,quote:quote.length>75?quote.slice(-75):quote};
}
function selectToRead(){
 // Called directly from the native-looking browser text-selection toolbar.
 // Take the precise selection before clearing it; never use the page end here.
 const cursor=getSelectedCursor();
 if(!cursor){
  showReadSelectionFeedback('선택한 단어의 위치를 확인하지 못했습니다. 본문을 다시 선택해 주세요.',true);
  return false;
 }
 correctTo(cursor.end);
 window.getSelection()?.removeAllRanges?.();
 showReadSelectionFeedback('이 페이지까지 읽은 지점으로 지정됨 · 선택한 단어 끝 기준');
 return true;
}
let readSelectionFeedbackTimer=0;
function showReadSelectionFeedback(message,isError=false){
 const notice=el('readerInsightsSelectionNotice');if(!notice)return;
 notice.textContent=message;
 notice.classList.toggle('is-error',!!isError);
 notice.hidden=false;
 clearTimeout(readSelectionFeedbackTimer);
 readSelectionFeedbackTimer=setTimeout(()=>{notice.hidden=true;},4500);
}
function toggleMarkDialog(show){
 if(!markDialog)return;
 markDialog.classList.toggle('is-open',!!show);
 markDialog.setAttribute('aria-hidden',String(!show));
 if(show)el('insightsMarkCancel').focus({preventScroll:true});
}
function cancelCorrection(){toggleMarkDialog(false);document.body.classList.remove('insights-correcting');}
function finishCorrection(at){
 if(at===null||at===undefined)return;
 correctTo(at);
 cancelCorrection();
 window.getSelection()?.removeAllRanges?.();
 const n=bookCanonical().length,seen=D().getSeen(bookText());
 const pct=n?Math.min(100,Math.floor(seen/n*100)):0;
 const note=el('insightsMarkNotice');
 if(note){note.textContent='읽은 범위 '+pct+'%로 수정했어.';}
 if(panelOpen()){layoutKey='';paint();}
}
function openMarkDialog(){
 if(!readerOpen())return;
 selectedCursor=getSelectedCursor();
 const current=pageWindow();
 const before=D().getSeen(bookText()),n=bookCanonical().length;
 const pct=n?Math.min(100,Math.floor(before/n*100)):0;
 el('insightsMarkCurrent').textContent='현재 설정된 읽은 범위: '+pct+'%';
 el('insightsMarkSelected').disabled=!selectedCursor;
 el('insightsMarkSelected').textContent=selectedCursor?'선택한 구절 끝으로 지정':'선택한 구절 끝으로 지정 (본문 선택 필요)';
 el('insightsMarkPage').disabled=!current;
 el('insightsMarkTarget').textContent=current?
  '이 페이지의 마지막 문장까지: '+(n?Math.min(100,Math.floor(current.end/n*100)):0)+'%':'현재 페이지를 측정할 수 없어.';
 el('insightsMarkNotice').textContent=selectedCursor?'선택한 구절: '+selectedCursor.quote:'';
 toggleMarkDialog(true);
}
function init(){
 if(el('insightsOpen')||!el('openReaderSearch')||!D())return;
 const b=document.createElement('button');b.type='button';b.id='insightsOpen';b.className='secondary';b.textContent='독서 정보';
 el('openReaderSearch').before(b);b.onclick=()=>void open();
 const readButton=document.createElement('button');
 readButton.id='insightsMarkRead';readButton.type='button';readButton.className='secondary';readButton.textContent='이 지점 지정';
 el('openReaderSearch').before(readButton);readButton.onclick=openMarkDialog;
 markDialog=document.createElement('section');markDialog.id='insightsMarkDialog';markDialog.className='insights-mark-dialog';
 markDialog.setAttribute('role','dialog');markDialog.setAttribute('aria-label','읽은 위치 직접 지정');
 markDialog.setAttribute('aria-modal','true');markDialog.setAttribute('aria-hidden','true');
 markDialog.innerHTML='<div class="insights-mark-box"><h2>읽은 지점 직접 지정</h2>'+
 '<div id="insightsMarkCurrent"></div><div id="insightsMarkTarget"></div>'+
 '<p>실제로 읽은 페이지로 이동한 뒤 지정해. 마지막으로 읽은 문장 또는 구절을 선택하면 선택 끝까지 지정할 수 있어. 책 마지막에 잘못 갔다면 읽은 곳으로 돌아와 다시 지정해.</p>'+
 '<button id="insightsMarkSelected" type="button">선택한 구절 끝으로 지정</button>'+
 '<button id="insightsMarkPage" type="button">이 페이지 끝으로 지정</button>'+
 '<button id="insightsMarkZero" type="button">처음부터 다시 읽음 (0%)</button>'+
 '<button id="insightsMarkCancel" type="button">취소</button><div id="insightsMarkNotice" role="status"></div></div>';
 document.body.append(markDialog);
 const selectionNotice=document.createElement('div');
 selectionNotice.id='readerInsightsSelectionNotice';
 selectionNotice.setAttribute('role','status');
 selectionNotice.setAttribute('aria-live','polite');
 selectionNotice.hidden=true;
 document.body.append(selectionNotice);
 el('insightsMarkSelected').onclick=()=>{if(selectedCursor)finishCorrection(selectedCursor.end);};
 el('insightsMarkPage').onclick=()=>finishCorrection(pageWindow()?.end);
 el('insightsMarkZero').onclick=()=>finishCorrection(0);
 el('insightsMarkCancel').onclick=cancelCorrection;

 overlay=document.createElement('section');overlay.id='insightsPanel';overlay.className='insights-shell';
 overlay.setAttribute('role','dialog');overlay.setAttribute('aria-label','독서 정보');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-hidden','true');
 overlay.innerHTML='<header class="insights-head"><h2>독서 정보</h2><button id="insightsClose" type="button" aria-label="독서정보 닫기">독서정보 닫기</button></header>'+
 '<nav class="insights-tabs" aria-label="독서정보 종류">'+tabs.map(([k,v])=>'<button type="button" data-insight-tab="'+k+'" aria-pressed="false">'+v+'</button>').join('')+'</nav>'+
 '<div class="insights-toolbar"><span id="insightsSeen"></span><span id="insightsStatus"></span><button type="button" id="insightsGoMark">읽은 지점 수정</button><button type="button" id="insightsImportBtn">정보 불러오기</button><input type="file" id="insightsImportInput" accept=".json,application/json" hidden></div>'+
 '<main id="insightsPaper" class="insights-paper" tabindex="0" aria-label="독서정보 페이지"></main>'+
 '<footer class="insights-footer"><button id="insightsPrev" type="button">〈 이전</button><strong id="insightsPageCount">0 / 0</strong><button id="insightsNext" type="button">다음 〉</button></footer>';
 document.body.append(overlay);paper=el('insightsPaper');
 el('insightsClose').onclick=close;el('insightsPrev').onclick=()=>turn(-1);el('insightsNext').onclick=()=>turn(1);
 overlay.querySelectorAll('[data-insight-tab]').forEach(tab=>tab.onclick=()=>setTab(tab.dataset.insightTab));
 el('insightsImportBtn').onclick=()=>el('insightsImportInput').click();
 el('insightsGoMark').onclick=()=>{
  close();
  document.body.classList.add('insights-correcting');
  el('insightsMarkRead').focus({preventScroll:true});
 };
 el('insightsImportInput').onchange=e=>{void importJson(e.target.files[0]);e.target.value='';};
 window.addEventListener('keydown',e=>{
  if(markDialog?.classList.contains('is-open')){
   if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();cancelCorrection();}
   else if(['ArrowLeft','ArrowRight','PageUp','PageDown'].includes(e.key)){e.preventDefault();e.stopImmediatePropagation();}
   return;
  }
  if(!panelOpen())return;
  if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close();return;}
  const tag=e.target?.tagName||'';
  if(['ArrowLeft','ArrowRight','PageUp','PageDown'].includes(e.key)&&!['INPUT','TEXTAREA','SELECT'].includes(tag)){
   e.preventDefault();e.stopImmediatePropagation();turn(['ArrowLeft','PageUp'].includes(e.key)?-1:1);
  }else if(e.key===' '&&!['BUTTON','INPUT','TEXTAREA','SELECT'].includes(tag)){
   e.preventDefault();e.stopImmediatePropagation();turn(1);
  }
 },true);
 paper.addEventListener('pointerdown',e=>gesture={x:e.clientX,y:e.clientY},{passive:true});
 paper.addEventListener('pointerup',e=>{
  if(!gesture)return;
  if(e.target.closest?.('button,input,[data-nav-kind]')){gesture=null;return;}
  const dx=e.clientX-gesture.x,dy=e.clientY-gesture.y;gesture=null;
  if(Math.abs(dx)>40&&Math.abs(dx)>Math.abs(dy)*1.3){turn(dx<0?1:-1);return;}
  if(Math.abs(dx)<13&&Math.abs(dy)<13&&!String(window.getSelection()||'').trim()){
   const rect=paper.getBoundingClientRect();turn(e.clientX<rect.left+rect.width/2?-1:1);
  }
 });
 overlay.addEventListener('wheel',e=>e.preventDefault(),{passive:false});
 new MutationObserver(()=>{if(!readerOpen()){close();cancelCorrection();}else if(panelOpen()&&D().key(bookText())!==currentKey)close();})
  .observe(el('viewerOverlay'),{attributes:true,attributeFilter:['class']});
 if(typeof ResizeObserver==='function')new ResizeObserver(()=>{if(panelOpen()){layoutKey='';pageNumber=0;paint();}}).observe(paper);
 window.readerInsights={open,close,openForSelection,navigationSnapshot,cancelCorrection,observe,prepareAdvance,finishAdvance,correctTo,selectToRead,visibleEnd,pageWindow,isOpen:panelOpen,refresh:()=>{layoutKey='';paint();}};
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();