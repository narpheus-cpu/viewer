/* The book stores only year triggers. Timeline records are loaded separately. */
const READER_TIMELINE_DEFAULT_VERSION='aec6e6d4cc637a4a';
let readerTimelineRevision=0;
let readerTimelineLayer=null,readerTimelineMeta=null,readerTimelineInit=null,readerTimelineDatabase=null;
const readerTimelineCache=new Map(),readerTimelineChunks=new Map(),readerTimelineStats={recordsRead:0,chunkFetches:0,renderChars:0};
const readerTimelineView={epoch:0,index:0,full:'',start:0,end:0,page:0,total:1,signature:'',frame:0,loading:false,trigger:null,requested:0,gesture:null,pointers:new Set(),suppress:0};
function readerTimelineIsOpen(){return !!readerTimelineLayer&&!readerTimelineLayer.hidden;}
function readerTimelineDB(){
 if(readerTimelineDatabase)return readerTimelineDatabase;
 readerTimelineDatabase=new Promise((resolve,reject)=>{const r=indexedDB.open('reader-comparative-timeline',1);r.onupgradeneeded=()=>{r.result.createObjectStore('meta');r.result.createObjectStore('entries');};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(Error('연표 저장 공간을 열 수 없습니다.'));r.onblocked=()=>reject(Error('다른 뷰어를 닫은 뒤 연표를 다시 등록해 주세요.'));});return readerTimelineDatabase;
}
async function readerTimelineGet(store,key){const db=await readerTimelineDB();return new Promise((resolve,reject)=>{const tx=db.transaction(store),r=tx.objectStore(store).get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function readerTimelinePut(store,key,value){const db=await readerTimelineDB();return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(value,key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}
function readerTimelineStatus(message,error=false){const el=document.getElementById('readerTimelineImportStatus');if(el){el.textContent=message;el.style.color=error?'#b00020':'';}}
function readerTimelineSummary(){if(readerTimelineMeta)readerTimelineStatus(readerTimelineMeta.name+' · '+readerTimelineMeta.entries.length.toLocaleString('ko-KR')+'개 연도·구간');}
async function readerTimelineDefault(){
 const r=await fetch(new URL('timelines/default/index.json?v='+READER_TIMELINE_DEFAULT_VERSION,document.baseURI));if(!r.ok)throw Error('기본 연표를 불러올 수 없습니다. TXT 또는 ZIP을 등록해 주세요.');const meta=await r.json();
 if(meta.version!==READER_TIMELINE_DEFAULT_VERSION||meta.schema!==1||!Array.isArray(meta.entries)||!meta.entries.length)throw Error('기본 연표 형식이 맞지 않습니다.');meta.kind='default';return meta;
}
function readerTimelineEnsure(){
 if(readerTimelineInit)return readerTimelineInit;
 const revision=readerTimelineRevision;readerTimelineInit=(async()=>{let active;try{active=await readerTimelineGet('meta','active');}catch{}
  if(active?.kind==='default'&&active.version!==READER_TIMELINE_DEFAULT_VERSION)active=null;const meta=active?.entries?.length?active:await readerTimelineDefault();if(revision!==readerTimelineRevision)return readerTimelineMeta;readerTimelineMeta=meta;readerTimelineSummary();if(!active)void readerTimelinePut('meta','active',meta).catch(()=>{});return meta;
 })().catch(error=>{readerTimelineStatus(error.message,true);readerTimelineInit=null;throw error;});return readerTimelineInit;
}
function readerTimelineRemember(id,text){readerTimelineCache.delete(id);readerTimelineCache.set(id,text);let bytes=0;for(const t of readerTimelineCache.values())bytes+=t.length;while(readerTimelineCache.size>5||(bytes>120000&&readerTimelineCache.size>1)){const k=readerTimelineCache.keys().next().value;bytes-=readerTimelineCache.get(k).length;readerTimelineCache.delete(k);}return text;}
async function readerTimelineRead(index,meta=readerTimelineMeta){
 const e=meta?.entries[index];if(!e)throw Error('해당 연표 항목이 없습니다.');const key=meta.version+':'+e.id;
 if(readerTimelineCache.has(key)){const t=readerTimelineCache.get(key);return readerTimelineRemember(key,t);}
 readerTimelineStats.recordsRead++;let saved;try{saved=await readerTimelineGet('entries',key);}catch{}
 if(typeof saved==='string')return readerTimelineRemember(key,saved);
 if(meta.kind!=='default')throw Error('저장된 연표를 읽지 못했습니다. 파일을 다시 등록해 주세요.');
 const chunkKey=meta.version+':'+e.chunk;let promise=readerTimelineChunks.get(chunkKey);
 if(!promise){promise=(async()=>{readerTimelineStats.chunkFetches++;const r=await fetch(new URL('timelines/default/part-'+String(e.chunk).padStart(3,'0')+'.json?v='+encodeURIComponent(meta.version),document.baseURI));if(!r.ok)throw Error('연표 구간을 불러오지 못했습니다. 연결 후 다시 눌러 주세요.');const data=await r.json();if(!data.records||typeof data.records[e.id]!=='string')throw Error('연표 구간 형식이 맞지 않습니다.');
  try{const db=await readerTimelineDB();const tx=db.transaction('entries','readwrite');for(const [id,text] of Object.entries(data.records))tx.objectStore('entries').put(text,meta.version+':'+id);}catch{}return data.records;})();readerTimelineChunks.set(chunkKey,promise);promise.finally(()=>readerTimelineChunks.delete(chunkKey)).catch(()=>{});}
 const records=await promise;return readerTimelineRemember(key,records[e.id]);
}
async function readerTimelineImport(files){
 if(!files?.length)return;readerTimelineStatus('연표를 연도별로 등록하는 중…');const entries=[];let total=0;
 for(const file of files){if(file.size>50*1024*1024)throw Error('연표 파일이 너무 큽니다. 50MB 이하 파일로 나눠 주세요.');
  const texts=[];if(/\.zip$/i.test(file.name)){const zip=await JSZip.loadAsync(await file.arrayBuffer());const items=Object.values(zip.files).filter(e=>!e.dir&&/\.txt$/i.test(e.name));if(items.length>500)throw Error('한 번에 TXT 500개까지 등록할 수 있습니다.');for(const e of items){if(Number(e._data?.uncompressedSize)>16*1024*1024)throw Error('TXT 한 파일의 분량이 너무 큽니다.');const text=await e.async('string');total+=text.length;if(total>16000000)throw Error('연표의 압축 해제 분량이 너무 큽니다.');texts.push({name:e.name,text});}}
  else if(/\.txt$/i.test(file.name)){const text=await file.text();total+=text.length;texts.push({name:file.name,text});}else throw Error('TXT 또는 ZIP 파일을 선택해 주세요.');
  for(const t of texts){if(total>16000000)throw Error('연표 분량이 너무 큽니다.');entries.push(...ReaderTimeline.parseText(t.text,t.name));await new Promise(r=>setTimeout(r,0));}
 }
 const records=ReaderTimeline.merge(entries);if(!records.length)throw Error('연도 제목을 찾지 못했습니다. 각 연도는 별도 줄에 써 주세요.');
 const version='custom-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8),meta={schema:1,kind:'custom',version,name:Array.from(files).map(f=>f.name).join(', '),entries:records.map(({text,...e})=>e)};
 const db=await readerTimelineDB();await new Promise((resolve,reject)=>{const tx=db.transaction(['meta','entries'],'readwrite'),store=tx.objectStore('entries');store.clear();for(const e of records)store.put(e.text,version+':'+e.id);tx.objectStore('meta').put(meta,'active');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||Error('연표를 저장하지 못했습니다.'));tx.onabort=()=>reject(tx.error||Error('연표를 저장하지 못했습니다.'));});
 readerTimelineRevision++;readerTimelineMeta=meta;readerTimelineInit=Promise.resolve(meta);readerTimelineCache.clear();readerTimelineSummary();return meta;
}
function readerTimelineDecorate(host,contextOffset){
 if(!host)return;if(host===pageInnerLeft||host===pageInnerRight){
  const index=pageIndex+(host===pageInnerRight?1:0);let offset=Number(pageAnchors[index])||0;
  for(const block of Array.from(host.children)){const length=htmlToStableText(block.outerHTML).length;readerTimelineDecorate(block,offset);offset+=length+1;}return;
 }const walker=document.createTreeWalker(host,NodeFilter.SHOW_TEXT|NodeFilter.SHOW_ELEMENT),units=[];let node,text='';
 while((node=walker.nextNode())){if(node.nodeType===3){const skip=!!node.parentElement.closest('pre,code,a,[data-reader-year]');units.push({node,start:text.length,end:text.length+node.length,skip});text+=skip?' '.repeat(node.length):node.data;}else if(node.tagName==='BR'&&!node.hasAttribute('data-reader-break')){text+='\n';}}
 // Read only a small window of the already cached canonical text. If a page
 // ends at "기원전 10" and the next starts with "세기", never link it as 10 BCE.
 const canonical=Number.isFinite(contextOffset)?readerCanonical():'',before=canonical.slice(Math.max(0,contextOffset-128),contextOffset),after=canonical.slice(contextOffset+text.length,contextOffset+text.length+128);
 const blocked=ReaderTimeline.centuries(before+text+after);
 const matches=ReaderTimeline.years(text).filter(m=>!blocked.some(c=>c.start<before.length+m.end&&c.end>before.length+m.start));if(!matches.length)return;
 function point(offset,end){const e=units.find(u=>end?offset>u.start&&offset<=u.end:offset>=u.start&&offset<u.end);return e?[e.node,offset-e.start]:null;}
 for(const m of matches.reverse()){
  const a=point(m.start,false),b=point(m.end,true);if(!a||!b||!a[0].isConnected||!b[0].isConnected)continue;
  const range=document.createRange();range.setStart(...a);range.setEnd(...b);
  // The original footnote can sit inside OR outside the year wrapper after Range extraction.
  // Mark every overlapping visible footnote with the parsed era, so both touch and keyboard prefer the timeline.
  for(const unit of units){if(unit.end<=m.start||unit.start>=m.end)continue;const note=unit.node.parentElement?.closest('[data-reader-note]');if(note){note.dataset.readerYear=String(m.year);note.setAttribute('aria-label',m.text+' 길게 눌러 비교 연표 열기');}}
  const trigger=document.createElement('span');trigger.className='reader-year';trigger.dataset.readerYear=String(m.year);trigger.tabIndex=0;trigger.setAttribute('role','button');trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-label',m.text+' 길게 눌러 비교 연표 열기');trigger.appendChild(range.extractContents());range.insertNode(trigger);
 }
 host.querySelectorAll('[data-reader-note][data-reader-year]').forEach(note=>{if(!note.textContent.trim())note.remove();});
}
function readerTimelineViewport(){
 if(!readerTimelineLayer)return;const vv=window.visualViewport,w=vv?.width||innerWidth,h=vv?.height||innerHeight,s=readerTimelineLayer.style;s.left=Math.max(0,vv?.offsetLeft||0)+'px';s.top=Math.max(0,vv?.offsetTop||0)+'px';s.width=w+'px';s.height=h+'px';
 if(readerTimelineIsOpen())readerTimelineSchedule();
}
function readerTimelineColumn(offset){
 const f=document.getElementById('readerTimelineFlow'),v=document.getElementById('readerTimelineViewport'),n=f.firstChild;if(!n?.length)return 0;const at=Math.max(0,Math.min(n.length-1,offset)),r=document.createRange();r.setStart(n,at);r.setEnd(n,at+1);return Math.max(0,Math.floor((r.getBoundingClientRect().left-f.getBoundingClientRect().left+.5)/(v.getBoundingClientRect().width+24)));
}
function readerTimelineStart(column){const f=document.getElementById('readerTimelineFlow');if(column<=0||!f.firstChild)return 0;let lo=0,hi=f.firstChild.length;while(lo<hi){const m=(lo+hi)>>>1;if(readerTimelineColumn(m)<column)lo=m+1;else hi=m;}return lo;}
function readerTimelinePaint(){
 const s=readerTimelineView,v=document.getElementById('readerTimelineViewport'),f=document.getElementById('readerTimelineFlow');f.style.transform='translateX('+(-s.page*(v.getBoundingClientRect().width+24))+'px)';v.scrollLeft=0;v.scrollTop=0;
 document.getElementById('readerTimelineCounter').textContent='['+(s.page+1)+'/'+s.total+'] 페이지'+(s.start>0||s.end<s.full.length?' · 현재 구간':'');
 document.getElementById('readerTimelinePrev').disabled=s.loading||(s.index===0&&s.start===0&&s.page===0);document.getElementById('readerTimelineNext').disabled=s.loading||(s.index===readerTimelineMeta.entries.length-1&&s.end===s.full.length&&s.page===s.total-1);
}
function readerTimelineLayout(last=false){
 const s=readerTimelineView;if(!readerTimelineIsOpen()||!s.full)return;const v=document.getElementById('readerTimelineViewport'),f=document.getElementById('readerTimelineFlow'),r=v.getBoundingClientRect();if(r.width<1||r.height<1)return;
 const total=()=>Math.max(1,Math.ceil((f.scrollWidth+24-1)/(r.width+24)));f.textContent=s.full.slice(s.start,s.end);s.total=total();
 // At most 21 rendered pages. Older/later material is fetched on a boundary tap.
 if(s.total>21){if(last){const cut=readerTimelineStart(s.total-21);s.start+=cut;}else{const cut=readerTimelineStart(21);s.end=s.start+Math.max(1,cut);}f.textContent=s.full.slice(s.start,s.end);s.total=total();}
 s.page=last?s.total-1:0;s.signature=[r.width,r.height,getComputedStyle(f).font].join('|');readerTimelineStats.renderChars=f.textContent.length;readerTimelinePaint();
}
function readerTimelineSchedule(){const s=readerTimelineView;if(!readerTimelineIsOpen()||s.frame||s.loading||!s.full)return;s.frame=requestAnimationFrame(()=>{s.frame=0;const v=document.getElementById('readerTimelineViewport').getBoundingClientRect(),f=document.getElementById('readerTimelineFlow'),sig=[v.width,v.height,getComputedStyle(f).font].join('|');if(s.signature!==sig){const anchor=s.start+readerTimelineStart(s.page);s.start=anchor;s.end=Math.min(s.full.length,s.start+6000);readerTimelineLayout();}});}
function readerTimelineSegment(start,end,last=false){const s=readerTimelineView;s.start=Math.max(0,start);s.end=Math.min(s.full.length,end);if(s.start>0&&/[\uDC00-\uDFFF]/.test(s.full[s.start]))s.start--;if(s.end<s.full.length&&/[\uDC00-\uDFFF]/.test(s.full[s.end]))s.end--;readerTimelineLayout(last);}
async function readerTimelineLoad(index,last=false){
 const s=readerTimelineView,epoch=++s.epoch,meta=readerTimelineMeta;s.loading=true;document.getElementById('readerTimelineMessage').textContent='연표 항목을 여는 중…';
 try{const text=await readerTimelineRead(index,meta);if(epoch!==s.epoch||!readerTimelineIsOpen())return;s.index=index;s.full=text;s.loading=false;document.getElementById('readerTimelineTitle').textContent=meta.entries[index].title;
  const e=meta.entries[index],same=s.requested>=e.from&&s.requested<=e.to;document.getElementById('readerTimelineMessage').textContent=(same?'본문: ':'본문: ')+ReaderTimeline.label(s.requested)+(same?'':' · 가장 가까운 항목: '+ReaderTimeline.label(s.requested<e.from?e.from:e.to));
  readerTimelineSegment(last?Math.max(0,text.length-6000):0,last?text.length:Math.min(6000,text.length),last);
  // Cache only neighbouring records; they are never laid out in the background.
  for(const i of [index-1,index+1,index-2,index+2])if(meta.entries[i])void readerTimelineRead(i,meta).catch(()=>{});
 }catch(error){if(epoch===s.epoch&&readerTimelineIsOpen()){s.loading=false;document.getElementById('readerTimelineMessage').textContent=error.message;}}
}
async function readerTimelineTurn(delta){
 const s=readerTimelineView;if(s.loading||!s.full)return;getSelection()?.removeAllRanges();
 if(s.page+delta>=0&&s.page+delta<s.total){s.page+=delta;readerTimelinePaint();return;}
 if(delta>0){if(s.end<s.full.length){readerTimelineSegment(s.end,Math.min(s.full.length,s.end+6000));return;}if(s.index+1<readerTimelineMeta.entries.length)await readerTimelineLoad(s.index+1);}
 else{if(s.start>0){readerTimelineSegment(Math.max(0,s.start-6000),s.start,true);return;}if(s.index>0)await readerTimelineLoad(s.index-1,true);}
}
async function readerOpenTimeline(trigger){
 if(!readerTimelineLayer||!viewerOverlay.classList.contains('active'))return;
 const s=readerTimelineView;if(readerTimelineIsOpen())return;readerCloseNote();readerHideSearch();s.trigger=trigger;s.requested=Number(trigger.dataset.readerYear);s.full='';s.start=0;s.end=0;s.page=0;s.total=1;s.loading=true;resetPageGesture();getSelection()?.removeAllRanges();
 s.bodyOverflow=document.body.style.overflow;s.rootOverflow=document.documentElement.style.overflow;s.previousAria=viewerOverlay.getAttribute('aria-hidden');document.body.style.overflow='hidden';document.documentElement.style.overflow='hidden';viewerOverlay.setAttribute('aria-hidden','true');readerTimelineLayer.hidden=false;
 document.getElementById('readerTimelineFlow').textContent='';document.getElementById('readerTimelineTitle').textContent=ReaderTimeline.label(s.requested)+' · 비교 연표';document.getElementById('readerTimelineMessage').textContent='연도 색인을 여는 중…';document.getElementById('readerTimelineCounter').textContent='';document.getElementById('readerTimelinePrev').disabled=true;document.getElementById('readerTimelineNext').disabled=true;
 const style=getComputedStyle(pageInnerLeft),flow=document.getElementById('readerTimelineFlow');flow.style.fontFamily=style.fontFamily;flow.style.fontSize=Math.max(14,Math.min(24,parseFloat(style.fontSize)||18))+'px';flow.style.lineHeight='1.65';flow.style.letterSpacing=style.letterSpacing;
 readerTimelineViewport();document.getElementById('closeReaderTimeline').focus({preventScroll:true});const epoch=++s.epoch;
 try{const meta=await readerTimelineEnsure();if(epoch!==s.epoch||!readerTimelineIsOpen())return;const i=ReaderTimeline.nearest(meta.entries,s.requested);if(i<0)throw Error('등록된 연표 항목이 없습니다.');await readerTimelineLoad(i);}
 catch(error){if(epoch===s.epoch&&readerTimelineIsOpen()){s.loading=false;document.getElementById('readerTimelineMessage').textContent=error.message;}}
}
function readerCloseTimeline(){
 if(!readerTimelineIsOpen())return;const s=readerTimelineView;s.epoch++;s.loading=false;s.full='';s.gesture=null;s.pointers.clear();if(s.frame)cancelAnimationFrame(s.frame);s.frame=0;readerTimelineLayer.hidden=true;document.getElementById('readerTimelineFlow').textContent='';document.body.style.overflow=s.bodyOverflow;document.documentElement.style.overflow=s.rootOverflow;if(s.previousAria===null)viewerOverlay.removeAttribute('aria-hidden');else viewerOverlay.setAttribute('aria-hidden',s.previousAria);if(s.trigger?.isConnected)s.trigger.focus({preventScroll:true});s.trigger=null;resetPageGesture();pageGestureSuppressUntil=performance.now()+800;syncVisualViewport();scheduleRepaginate();
}
function setupReaderTimeline(){
 const settings=document.createElement('details');settings.className='reader-timeline-settings';settings.innerHTML='<summary>비교 연표</summary><p id="readerTimelineImportStatus" role="status">연표 색인 확인 중…</p><input id="readerTimelineFiles" type="file" accept=".txt,.zip,text/plain,application/zip" multiple hidden><button id="readerTimelineImport" type="button">연표 TXT / ZIP 등록</button> <button id="readerTimelineDefault" type="button">기본 연표 사용</button><small>회색 음영·점선이 있는 연도를 길게 누르면 연표가 열립니다. 짧게 누르면 책 페이지를 넘깁니다. 등록한 연표는 이 기기에서 다른 책에도 계속 적용됩니다.</small>';
 document.getElementById('viewerSettings').appendChild(settings);document.getElementById('readerTimelineImport').onclick=()=>document.getElementById('readerTimelineFiles').click();
 document.getElementById('readerTimelineFiles').onchange=async e=>{const buttons=[document.getElementById('readerTimelineImport'),document.getElementById('readerTimelineDefault')];buttons.forEach(b=>b.disabled=true);try{await readerTimelineImport(e.target.files);}catch(error){readerTimelineStatus(error.message,true);}finally{buttons.forEach(b=>b.disabled=false);e.target.value='';}};
 document.getElementById('readerTimelineDefault').onclick=async()=>{try{const meta=await readerTimelineDefault();await readerTimelinePut('meta','active',meta);readerTimelineRevision++;readerTimelineMeta=meta;readerTimelineInit=Promise.resolve(meta);readerTimelineCache.clear();readerTimelineSummary();}catch(error){readerTimelineStatus(error.message,true);}};
 readerTimelineLayer=document.createElement('div');readerTimelineLayer.id='readerTimelineLayer';readerTimelineLayer.className='reader-timeline-layer';readerTimelineLayer.hidden=true;readerTimelineLayer.innerHTML='<section class="reader-timeline-dialog" role="dialog" aria-modal="true" aria-labelledby="readerTimelineTitle"><header><h2 id="readerTimelineTitle"></h2><button id="closeReaderTimeline" type="button">닫기</button></header><p id="readerTimelineMessage" role="status" aria-live="polite"></p><div id="readerTimelineSurface" tabindex="0" aria-label="비교 연표, 왼쪽 터치 이전 페이지, 오른쪽 터치 다음 페이지"><div id="readerTimelineViewport"><div id="readerTimelineFlow"></div></div></div><footer><button id="readerTimelinePrev" type="button" aria-label="이전 연표 페이지">‹ 이전</button><span id="readerTimelineCounter"></span><button id="readerTimelineNext" type="button" aria-label="다음 연표 페이지">다음 ›</button></footer></section>';
 document.body.appendChild(readerTimelineLayer);document.getElementById('closeReaderTimeline').onclick=readerCloseTimeline;document.getElementById('readerTimelinePrev').onclick=()=>readerTimelineTurn(-1);document.getElementById('readerTimelineNext').onclick=()=>readerTimelineTurn(1);
 readerTimelineLayer.addEventListener('click',e=>{e.stopPropagation();if(e.target===readerTimelineLayer)readerCloseTimeline();});for(const type of ['pointerdown','pointermove','pointerup','touchstart','touchmove','touchend','wheel'])readerTimelineLayer.addEventListener(type,e=>e.stopPropagation(),{passive:true});
 document.addEventListener('click',e=>{if(readerTimelineIsOpen()&&!readerTimelineLayer.contains(e.target)){e.preventDefault();e.stopImmediatePropagation();}},true);
 document.addEventListener('contextmenu',e=>{if(e.target.closest?.('[data-reader-year]')||readerTimelineLayer.contains(e.target))e.preventDefault();},true);
 document.addEventListener('keydown',e=>{
  if(readerTimelineIsOpen()){e.stopImmediatePropagation();if(e.key==='Escape'){e.preventDefault();readerCloseTimeline();}else if(['ArrowLeft','PageUp','ArrowRight','PageDown'].includes(e.key)){e.preventDefault();void readerTimelineTurn(['ArrowLeft','PageUp'].includes(e.key)?-1:1);}else if(e.key==='Tab'){const items=Array.from(readerTimelineLayer.querySelectorAll('button:not(:disabled),[tabindex="0"]'));let i=items.indexOf(document.activeElement);i=(i+(e.shiftKey?-1:1)+items.length)%items.length;e.preventDefault();items[i].focus({preventScroll:true});}return;}
  const trigger=e.target.closest?.('[data-reader-year]');if(trigger&&(e.key==='Enter'||e.key===' ')){e.preventDefault();e.stopImmediatePropagation();void readerOpenTimeline(trigger);}
 },true);
 setupReaderTimelineTaps();addEventListener('resize',readerTimelineViewport);window.visualViewport?.addEventListener('resize',readerTimelineViewport);window.visualViewport?.addEventListener('scroll',readerTimelineViewport);if(window.ResizeObserver)new ResizeObserver(readerTimelineSchedule).observe(document.getElementById('readerTimelineSurface'));
 document.fonts?.addEventListener?.('loadingdone',()=>{readerTimelineView.signature='';readerTimelineSchedule();});void readerTimelineEnsure().catch(()=>{});
}
function setupReaderTimelineTaps(){
 const surface=document.getElementById('readerTimelineSurface'),s=readerTimelineView;
 function stop(){s.gesture=null;s.pointers.clear();}
 function down(id,x,y,e){if(e.button!==undefined&&e.button!==0)return;s.pointers.add(id);if(s.pointers.size!==1){s.gesture=null;return;}s.gesture={id,x,y,time:performance.now(),moved:0};}
 function move(id,x,y){const g=s.gesture;if(g?.id===id)g.moved=Math.max(g.moved,Math.hypot(x-g.x,y-g.y));}
 function up(id,x,y,e){const g=s.gesture;move(id,x,y);s.pointers.delete(id);s.gesture=null;if(!g||g.id!==id||g.moved>10||performance.now()-g.time>=550||s.pointers.size||String(getSelection()||'').trim())return;const r=surface.getBoundingClientRect();if(x<r.left||x>r.right||y<r.top||y>r.bottom)return;void readerTimelineTurn(x-r.left<r.width/2?-1:1);s.suppress=performance.now()+800;if(e.cancelable)e.preventDefault();}
 function cancel(id){s.pointers.delete(id);s.gesture=null;}
 if(window.PointerEvent){surface.addEventListener('pointerdown',e=>down(e.pointerId,e.clientX,e.clientY,e));surface.addEventListener('pointermove',e=>move(e.pointerId,e.clientX,e.clientY));surface.addEventListener('pointerup',e=>up(e.pointerId,e.clientX,e.clientY,e));surface.addEventListener('pointercancel',e=>cancel(e.pointerId));surface.addEventListener('pointerleave',e=>cancel(e.pointerId));}
 else{let until=0;surface.addEventListener('touchstart',e=>{until=performance.now()+800;for(const t of e.changedTouches)down(t.identifier,t.clientX,t.clientY,e);if(e.touches.length!==1)s.gesture=null;},{passive:true});surface.addEventListener('touchmove',e=>{for(const t of e.changedTouches)move(t.identifier,t.clientX,t.clientY);},{passive:true});surface.addEventListener('touchend',e=>{until=performance.now()+800;for(const t of e.changedTouches)up(t.identifier,t.clientX,t.clientY,e);},{passive:false});surface.addEventListener('touchcancel',e=>{for(const t of e.changedTouches)cancel(t.identifier);},{passive:true});surface.addEventListener('mousedown',e=>{if(performance.now()>=until)down('mouse',e.clientX,e.clientY,e);});surface.addEventListener('mousemove',e=>move('mouse',e.clientX,e.clientY));surface.addEventListener('mouseup',e=>up('mouse',e.clientX,e.clientY,e));surface.addEventListener('mouseleave',stop);}
 surface.addEventListener('click',e=>{e.stopPropagation();if(performance.now()<s.suppress)e.preventDefault();});surface.addEventListener('wheel',e=>{if(!e.ctrlKey)e.preventDefault();},{passive:false});addEventListener('blur',stop);document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
}
