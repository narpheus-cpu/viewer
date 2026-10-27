/* Durable layout cache and a logical text anchor independent of changing page boundaries. */
const readerState={initializing:true,logicalAnchor:null,context:null,layout:'',canonical:'',canonicalSource:null,
  generation:0,fontId:'',fontPromise:Promise.resolve(),memory:new Map(),pendingCache:Promise.resolve(),cancelled:false};
const readerStats={splits:0,cacheHits:0,visibleRenders:0,measurements:0,lastPaginationMs:0};
let resolveReaderReady;
const readerReady=new Promise(resolve=>{resolveReaderReady=resolve;});
const READER_CACHE_VERSION=8;
const READER_CACHE_DB='ebookViewerLayoutCacheV1';

function readerCanonical(){
  if(readerState.canonicalSource!==fullText){
    getPaginationBlocks(fullText);
    readerState.canonical=cachedBlockTexts.join('\n');
    readerState.canonicalSource=fullText;
  }
  return readerState.canonical;
}
function readerContext(anchor){
  const text=readerCanonical(),offset=Math.min(text.length,Math.max(0,Number(anchor)||0));
  return {before:text.slice(Math.max(0,offset-32),offset),after:text.slice(offset,offset+96)};
}
function readerAnchor(){
  return readerState.logicalAnchor===null ? Number(pageAnchors[pageIndex])||0 : readerState.logicalAnchor;
}
function readerChooseAnchor(anchor,context){
  readerState.logicalAnchor=Math.max(0,Number(anchor)||0);
  readerState.context=context||readerContext(readerState.logicalAnchor);
}
function readerResolveAnchor(record){
  const text=readerCanonical();
  const original=Math.min(text.length,Math.max(0,Number(record?.pageAnchor)||0));
  const context=record?.pageContext;
  if(!context||typeof context.before!=='string'||typeof context.after!=='string')return original;
  const needle=context.before+context.after;
  if(!needle||text.slice(Math.max(0,original-context.before.length),original+context.after.length)===needle)return original;
  let best=original,distance=Infinity;
  for(let hit=text.indexOf(needle);hit>=0;hit=text.indexOf(needle,hit+1)){
    const target=hit+context.before.length,delta=Math.abs(target-original);
    if(delta<distance){best=target;distance=delta;}
  }
  return best;
}
function readerSetLoading(loading,message){
  if(message)viewerOverlay.setAttribute('data-reader-progress',message);else if(loading)viewerOverlay.setAttribute('data-reader-progress','불러오는 중…');
  viewerOverlay.classList.toggle('reader-loading',loading);
  viewerOverlay.setAttribute('aria-busy',String(loading));
}
function readerOversizedParagraph(html,text,box){
  if(text.length<=4096||!/^<p(?:\s|>)/i.test(html))return false;
  // Shape only a DOM-preserving prefix. A paragraph whose prefix overflows cannot fit whole.
  const detached=document.createElement('div');detached.innerHTML=html;
  const paragraph=detached.firstElementChild;
  const walker=document.createTreeWalker(paragraph,NodeFilter.SHOW_TEXT);
  let node,left=4096;
  const range=document.createRange();range.selectNodeContents(paragraph);
  while((node=walker.nextNode())){
    if(node.length>=left){range.setEnd(node,left);break;}
    left-=node.length;
  }
  const prefix=paragraph.cloneNode(false);prefix.appendChild(range.cloneContents());
  box.replaceChildren(prefix);readerStats.measurements++;
  return box.scrollHeight>box.clientHeight+1;
}
function readerCacheDatabase(){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(READER_CACHE_DB,2);
    request.onupgradeneeded=()=>{
      const db=request.result;
      const store=db.objectStoreNames.contains('pages')?request.transaction.objectStore('pages'):db.createObjectStore('pages',{keyPath:'id'});
      if(!store.indexNames.contains('updatedAt'))store.createIndex('updatedAt','updatedAt');
    };
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
}
function readerRememberCache(record){
  readerState.memory.delete(record.id);readerState.memory.set(record.id,record);
  // Disk retains recent books; small-memory readers need only a few live layouts.
  while(readerState.memory.size>3)readerState.memory.delete(readerState.memory.keys().next().value);
}
async function readerReadCache(id){
  if(readerState.memory.has(id))return readerState.memory.get(id);
  try{
    const db=await readerCacheDatabase();
    try{return await new Promise((resolve,reject)=>{
      const request=db.transaction('pages').objectStore('pages').get(id);
      request.onsuccess=()=>{if(request.result)readerRememberCache(request.result);resolve(request.result);};request.onerror=()=>reject(request.error);
    });}finally{db.close();}
  }catch{return null;}
}
async function readerStoreCache(record){
  readerRememberCache(record);
  try{
    const db=await readerCacheDatabase();
    try{
      const tx=db.transaction('pages','readwrite'),store=tx.objectStore('pages');
      store.put(record);
      // Keys and timestamps are sufficient for pruning; never load every book's page HTML.
      let count=0;const cursor=store.index('updatedAt').openKeyCursor(null,'prev');
      cursor.onsuccess=()=>{const entry=cursor.result;if(!entry)return;if(++count>RECENT_LIMIT)store.delete(entry.primaryKey);entry.continue();};
      await transactionDone(tx);
    }finally{db.close();}
  }catch{/* A disposable cache failure never deletes or changes book/font data. */}
}
async function readerDeleteCache(id){
  await readerLazyDeleteCache(id);
  id ? readerState.memory.delete(id) : readerState.memory.clear();
  try{
    const db=await readerCacheDatabase();
    try{const tx=db.transaction('pages','readwrite');id?tx.objectStore('pages').delete(id):tx.objectStore('pages').clear();await transactionDone(tx);}finally{db.close();}
  }catch{}
}
function readerCacheBodyValid(cache,source){
  return !!(cache&&cache.version===READER_CACHE_VERSION&&cache.length===source.length&&typeof cache.canonical==='string'&&(!readerSourceHasNotes(source)||cache.noteVersion===1));
}
function readerSameLayout(cache,signature){
  if(cache.signature===signature)return true;
  try{
    const before=JSON.parse(cache.signature),after=JSON.parse(signature);
    if(!Array.isArray(before)||!Array.isArray(after)||before.length!==after.length)return false;
    // Only a small height change is compatible, and only when the original fit is safe.
    const required=Number.isFinite(cache.fitHeight)?cache.fitHeight:before[4];
    if(!Number.isFinite(before[4])||!Number.isFinite(after[4])||!Number.isFinite(required)||
      required<=0||required>before[4]||Math.abs(before[4]-after[4])>4||after[4]<required)return false;
    return before.every((value,index)=>index===4||value===after[index]);
  }catch{return false;}
}
function readerValidCache(cache,signature,source){
  return readerCacheBodyValid(cache,source)&&readerSameLayout(cache,signature)&&
    Array.isArray(cache.pages)&&cache.pages.length>0&&Array.isArray(cache.anchors)&&cache.anchors.length===cache.pages.length&&
    cache.anchors.every((x,i)=>Number.isFinite(x)&&x>=0&&(i===0||x>=cache.anchors[i-1]))&&cache.pages.every(x=>typeof x==='string');
}
function readerFindCachedLayout(cache,signature,source){
  if(!readerCacheBodyValid(cache,source))return null;
  const candidates=[cache,...(Array.isArray(cache.layouts)?cache.layouts.map(layout=>({...cache,...layout})):[])];
  // Prefer an exact layout over a compatible one retained for another window height.
  for(const exact of [true,false])for(const candidate of candidates){
    if((candidate.signature===signature)===exact&&readerValidCache(candidate,signature,source))return candidate;
  }
  return null;
}
function readerCacheStructureValid(cache){
  return readerCacheBodyValid(cache,fullText)&&cache.chapterSignature===chapterSignature&&
    Array.isArray(cache.chapterStarts)&&cache.chapterStarts.length===bookChapters.length&&
    cache.chapterStarts.every((x,i)=>Number.isFinite(x)&&x>=0&&(i===0?x===0:x>=cache.chapterStarts[i-1]));
}
function readerRestoreCountCache(cache){
  if(!readerCacheStructureValid(cache)||!Array.isArray(cache.chapterCounts)||cache.chapterCounts.length!==Math.max(1,bookChapters.length)||
    !cache.chapterCounts.every(Number.isSafeInteger)||cache.chapterCounts.some(x=>x<0)||
    !Number.isSafeInteger(cache.totalCount)||cache.chapterCounts.reduce((sum,x)=>sum+x,0)!==cache.totalCount)return;
  viewerCountSource=fullText;viewerCountSignature=chapterSignature;
  viewerChapterCounts=cache.chapterCounts.slice();viewerTotalCount=cache.totalCount;
}
function readerCreatePageCache(id,signature,previous,used){
  const layouts=[];
  if(readerCacheBodyValid(previous,fullText))for(const layout of [previous,...(Array.isArray(previous.layouts)?previous.layouts:[])]){
    if(layout.signature===signature||layouts.some(item=>item.signature===layout.signature))continue;
    layouts.push({signature:layout.signature,fitHeight:layout.fitHeight,pages:layout.pages,anchors:layout.anchors});
    if(layouts.length===1)break;
  }
  return {id,version:READER_CACHE_VERSION,noteVersion:1,signature,length:fullText.length,pages:pages.slice(),anchors:pageAnchors.slice(),
    fitHeight:used?(Number.isFinite(used.fitHeight)?used.fitHeight:JSON.parse(used.signature)[4]):paginationMeasureBox.clientHeight,
    canonical:readerCanonical(),chapterSignature,chapterStarts:chapterCanonicalStarts.slice(),
    chapterCounts:viewerChapterCounts.slice(),totalCount:viewerTotalCount,layouts,updatedAt:Date.now()};
}

async function readerHydrateReading(record){
  if(record?.textRef){
    const book=await getRecentBook(record.textRef).catch(()=>null);
    if(book){readerState.hydratedBook={id:record.textRef,book};return {...record,text:book.text,chapters:book.meta?.chapters||[],fileName:record.fileName??book.meta?.fileName??''};}
  }
  return record;
}
async function readerFingerprintFont(record){
  if(record.fingerprint)return record.fingerprint;
  if(crypto?.subtle){
    const digest=await crypto.subtle.digest('SHA-256',record.data);
    record.fingerprint=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
  }else{
    const bytes=new Uint8Array(record.data);let hash=2166136261;
    for(const byte of bytes)hash=Math.imul(hash^byte,16777619)>>>0;
    record.fingerprint=bytes.length+':'+hash;
  }
  return record.fingerprint;
}
function readerBounded(promise,ms,label){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(label+' 시간이 초과됐습니다. 다시 열어 주세요.')),ms);Promise.resolve(promise).then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});});}
async function readerWaitForLayout(){
  await readerBounded(readerState.fontPromise,12000,'글꼴 준비');
  await readerBounded(chapterImagesReady,12000,'이미지 준비');
  const family=getComputedStyle(pageInnerLeft).fontFamily;
  if(document.fonts){
    await readerBounded(document.fonts.load(viewerSettings.fontSize+'px '+family,'가나다라마바사 ABC abc 0123456789'),12000,'본문 글꼴 준비');
  }
  let previous='',stable=0,frames=0;const waitStarted=performance.now();
  while(stable<3&&frames++<90&&performance.now()-waitStarted<2500){
    await readerBounded(nextFrame(),4000,'화면 준비');syncVisualViewport();
    const current=getLayoutSignature();
    stable=current===previous?stable+1:0;previous=current;
  }
  document.documentElement.style.setProperty('--reader-image-height',Math.max(1,pageInnerLeft.clientHeight-parseFloat(getComputedStyle(pageInnerLeft).lineHeight)*2)+'px');
}
async function readerDisplayFull(record={pageAnchor:0},generation=++readerState.generation){
  const started=performance.now(),source=fullText,id=activeRecentId;
  restoreInProgress=true;readerSetLoading(true);clearTimeout(repaginateTimer);
  readerStats.lastCacheReason='not-checked';
  try{
    // Read the stored layout before touching the book's paragraph DOM.
    const cached=id?await readerBounded(readerReadCache(id),2000,'페이지 캐시 읽기').catch(()=>null):null;
    if(generation!==readerState.generation)return;
    readerConfigureChapters(record,cached);readerRestoreCountCache(cached);updateViewerCharacterCount();
    if(readerCacheBodyValid(cached,source)){readerState.canonical=cached.canonical;readerState.canonicalSource=source;}
    let signature,used=null,built=null,passes=0;
    while(generation===readerState.generation){
      if(++passes>3)throw Error('화면 크기가 계속 바뀌어 페이지 계산을 중단했습니다. 다시 열어 주세요.');
      await readerWaitForLayout();
      if(generation!==readerState.generation||!viewerOverlay.classList.contains('active'))return;
      signature=getLayoutSignature();used=readerFindCachedLayout(built,signature,source)||readerFindCachedLayout(cached,signature,source);
      if(used){
        pages=used.pages.slice();pageAnchors=used.anchors.slice();
        readerState.canonical=used.canonical;readerState.canonicalSource=source;readerStats.cacheHits++;
        readerStats.lastCacheReason=used===built?'reflow-reused':used.signature===signature?'exact':'safe-height';
      }else{
        readerStats.lastCacheReason=!cached?'missing':!readerCacheBodyValid(cached,source)?'version-or-source':'layout-changed';
        await readerPrepareChapterImages();
        if(generation!==readerState.generation)return;
        signature=getLayoutSignature();pages=splitIntoPages(source);readerCanonical();
        built=readerCreatePageCache(id,signature,cached,null);
      }
      await readerBounded(nextFrame(),4000,'화면 표시');await readerBounded(nextFrame(),4000,'화면 표시');
      if(generation!==readerState.generation)return;
      if(signature!==getLayoutSignature())continue;
      break;
    }
    if(generation!==readerState.generation)return;
    readerState.layout=signature;
    record=readerMigrateNotePosition(record,cached);
    const hasAnchor=record.pageAnchor!==null&&record.pageAnchor!==undefined&&Number.isFinite(Number(record.pageAnchor));
    const target=hasAnchor?readerResolveAnchor(record):Number(pageAnchors[Math.min(pages.length-1,Math.max(0,Number(record.pageIndex)||0))])||0;
    readerChooseAnchor(target,readerContext(target));pageIndex=findPageIndexForAnchor(target);
    restoreInProgress=false;render();readerSetLoading(false);
    if(typeof readerPrepareSearchBook==='function')readerPrepareSearchBook();
    readerStats.lastPaginationMs=performance.now()-started;
    flushReadingSessionSave(true);flushActiveRecentPositionSave();
    // Upgrade old cache metadata without invalidating its already correct page breaks.
    if(id&&(built||!used||!readerCacheStructureValid(cached)||!Array.isArray(cached.chapterCounts))){
      const cache=readerCreatePageCache(id,signature,cached,used);
      readerState.pendingCache=readerStoreCache(cache);
    }
  }catch(error){
    if(generation===readerState.generation){restoreInProgress=false;readerSetLoading(false);setStatus(error.message||'전자책을 열지 못했습니다.',true);}
    throw error;
  }
}

/* Display-only breaks. Offsets always refer to the original visible text. */
function readerBreakKey(){
  return ['breakSentence','breakQuotes','breakAdverbs','sentenceSpacing'].map(key=>viewerSettings[key]?1:0).join('');
}
function readerQuoteRoles(text){
  const roles=new Map(),stack=[];
  for(let i=0;i<text.length;i++){
    const quote=text[i];
    if(!/["“”＂]/.test(quote))continue;
    let slash=i-1;while(slash>=0&&text[slash]==='\\')slash--;
    if((i-1-slash)%2)continue;
    if(quote==='“'){roles.set(i,'open');stack.push('curly');continue;}
    if(quote==='”'){
      roles.set(i,'close');const match=stack.lastIndexOf('curly');if(match>=0)stack.splice(match,1);continue;
    }
    const match=stack.lastIndexOf(quote);
    if(match>=0){roles.set(i,'close');stack.splice(match,1);}
    else{roles.set(i,'open');stack.push(quote);}
  }
  return roles;
}
function readerBreakOffsets(text,settings=viewerSettings,quoteRoles=readerQuoteRoles(text),baseOffset=0){return readerBreakOffsetsV18(text,settings,quoteRoles,baseOffset);}
function readerApplyBreaks(html,quoteRoles=null,baseOffset=0){return readerApplyBreaksV18(html,quoteRoles,baseOffset);}
function readerSafeQuoteCut(text,cut,quoteRoles,baseOffset=0){
  let next=cut;
  while(next<text.length&&/[ \t]/.test(text[next]))next++;
  if(quoteRoles.get(baseOffset+next)!=='close')return cut;
  // Keep at least the preceding character with the closing quote when a page is full.
  while(cut>1&&/[ \t]/.test(text[cut-1]))cut--;
  if(cut>1)cut--;
  if(cut>1&&/[\uDC00-\uDFFF]/.test(text[cut]))cut--;
  while(cut>1&&quoteRoles.get(baseOffset+cut)==='close')cut--;
  return cut;
}
function readerBlockSlicer(html){
  const root=document.createElement('div');root.innerHTML=html;
  const units=[],walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT|NodeFilter.SHOW_ELEMENT);
  let node,length=0;
  while((node=walker.nextNode())){
    const size=node.nodeType===Node.TEXT_NODE?node.length:(node.tagName==='BR'&&!node.hasAttribute('data-reader-break')?1:0);
    if(size){units.push({node,start:length,end:length+size});length+=size;}
  }
  function point(offset,end){
    let lo=0,hi=units.length-1;
    while(lo<hi){const mid=(lo+hi)>>1;if(units[mid].end<offset||(!end&&units[mid].end===offset))lo=mid+1;else hi=mid;}
    const entry=units[lo];
    if(entry.node.nodeType===Node.TEXT_NODE)return [entry.node,Math.min(entry.node.length,Math.max(0,offset-entry.start))];
    const parent=entry.node.parentNode,index=Array.prototype.indexOf.call(parent.childNodes,entry.node);
    return [parent,index+(offset>entry.start?1:0)];
  }
  return (start,end)=>{
    if(!units.length)return html;
    const range=document.createRange();range.setStart(...point(start,false));range.setEnd(...point(end,true));
    let fragment=range.cloneContents(),ancestor=range.commonAncestorContainer;
    if(ancestor.nodeType===Node.TEXT_NODE)ancestor=ancestor.parentNode;
    while(ancestor!==root){const shell=ancestor.cloneNode(false);shell.appendChild(fragment);fragment=shell;ancestor=ancestor.parentNode;}
    const output=document.createElement('div');output.appendChild(fragment);return output.innerHTML;
  };
}
function readerSyncBreakButtons(){
  const spacing=document.getElementById('sentenceSpacing');if(spacing)spacing.checked=!!viewerSettings.sentenceSpacing;
  document.querySelectorAll('[data-break-option]').forEach(button=>button.setAttribute('aria-pressed',String(!!viewerSettings[button.dataset.breakOption])));
}

/* Large native books paginate the requested chapter first, then yield between small work batches. */
let readerLazySession=null,readerLazyPreparing=false,readerLazyDatabase=null;
const readerLazyStats={sessions:0,chapterBuilds:0,chapterCacheHits:0,firstVisibleMs:0,yields:0};
function readerLazyActive(){const s=readerLazySession;return !!s&&!s.cancelled&&!s.complete&&s.generation===readerState.generation&&s.source===fullText;}
function readerLazyAlive(s){return s===readerLazySession&&!s.cancelled&&s.generation===readerState.generation&&s.source===fullText&&viewerOverlay.classList.contains('active');}
function readerLazyCancel(){const s=readerLazySession;if(s){s.cancelled=true;for(const job of s.jobs.values())job.reject(Error('페이지 계산 취소'));}readerLazySession=null;}
function readerLazyHash(text){let n=2166136261;for(let i=0;i<text.length;i++)n=Math.imul(n^text.charCodeAt(i),16777619)>>>0;return n.toString(36);}
function readerLazyDB(){if(readerLazyDatabase)return readerLazyDatabase;readerLazyDatabase=new Promise((resolve,reject)=>{const q=indexedDB.open('ebookViewerChapterLayoutV1',1);q.onupgradeneeded=()=>{q.result.createObjectStore('chapters').createIndex('updatedAt','updatedAt');};q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);q.onblocked=()=>reject(Error('구간 캐시 사용 불가'));});return readerLazyDatabase;}
async function readerLazyDeleteCache(id){try{const db=await readerBounded(readerLazyDB(),1500,'구간 캐시 삭제'),tx=db.transaction('chapters','readwrite'),store=tx.objectStore('chapters');if(!id)store.clear();else{const q=store.openKeyCursor(IDBKeyRange.bound(id+':',id+':\uffff'));q.onsuccess=()=>{const e=q.result;if(e){store.delete(e.primaryKey);e.continue();}};}await transactionDone(tx);}catch{}}
function readerLazyKey(s,c){return s.id+':'+readerLazyHash(s.signature)+':'+c;}
async function readerLazyRead(s,c){try{const db=await readerBounded(readerLazyDB(),1500,'구간 캐시');return await readerBounded(new Promise((resolve,reject)=>{const q=db.transaction('chapters').objectStore('chapters').get(readerLazyKey(s,c));q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);}),1500,'구간 캐시');}catch{return null;}}
async function readerLazySave(s,c,result){if(!s.id)return;try{const db=await readerLazyDB(),tx=db.transaction('chapters','readwrite'),store=tx.objectStore('chapters');store.put({...result,signature:s.signature,length:s.source.length,version:READER_CACHE_VERSION,updatedAt:Date.now()},readerLazyKey(s,c));let n=0;const q=store.index('updatedAt').openKeyCursor(null,'prev');q.onsuccess=()=>{const e=q.result;if(e){if(++n>512)store.delete(e.primaryKey);e.continue();}};await transactionDone(tx);}catch{}}
async function readerLazyImages(chapter){const sources=new Set();for(const html of bookChapters[chapter]?.blocks||[]){if(!html.includes('<img'))continue;const root=document.createElement('div');root.innerHTML=html;root.querySelectorAll('img').forEach(image=>sources.add(image.src));}if(!sources.size)return;await readerBounded(Promise.all([...sources].map(src=>new Promise(resolve=>{const image=new Image();image.onload=resolve;image.onerror=resolve;image.src=src;if(image.complete)resolve();}))),12000,'구간 이미지 준비');}
function readerLazyBlock(s,index){if(!s.formatted.has(index))s.formatted.set(index,readerApplyBreaks(cachedOriginalBlocks[index],cachedQuoteRoles,cachedBlockStarts[index]));return s.formatted.get(index);}
function readerLazyChapter(anchor){let c=0;for(let i=1;i<chapterCanonicalStarts.length;i++){if(chapterCanonicalStarts[i]>anchor)break;c=i;}return c;}
function readerLazyAssemble(s,anchor=readerAnchor()){
 const next=[],starts=[];for(let c=0;c<s.results.length;c++){const result=s.results[c];if(result){next.push(...result.pages);starts.push(...result.anchors);}else{next.push('<div class="reader-chapter-pending" data-reader-pending="'+c+'"></div>');starts.push(chapterCanonicalStarts[c]);}}
 pages=next;pageAnchors=starts;readerChooseAnchor(anchor);pageIndex=findPageIndexForAnchor(anchor);
}
function readerLazyCounter(){const s=readerLazySession,c=readerLazyChapter(readerAnchor()),r=s.results[c],ordinal=r?Math.max(0,r.anchors.findIndex((a,i)=>a<=readerAnchor()&&(i+1===r.anchors.length||r.anchors[i+1]>readerAnchor()))):0;return '구간 '+(ordinal+1)+' / '+(r?.pages.length||'계산 중')+' · 전체 계산 '+s.done+'/'+s.results.length;}
function readerLazyUpdateUI(){if(!readerLazySession||!pages.length)return;counter.textContent=readerLazyActive()?readerLazyCounter():`${pageIndex+1} / ${pages.length}`;pageJumpInput.max=String(pages.length);pageJumpInput.disabled=readerLazyActive();document.getElementById('pageJumpBtn').disabled=readerLazyActive();pageJumpInput.title=readerLazyActive()?'전체 페이지 계산 후 번호로 이동할 수 있습니다. 차례 이동은 바로 사용할 수 있습니다.':'';readerUpdateChapterPageCount();}
function readerLazyEnsure(s,c,urgent=false){
 if(s.results[c])return Promise.resolve(s.results[c]);let job=s.jobs.get(c);
 if(!job){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});promise.catch(()=>{});job={c,promise,resolve,reject,generator:null,checked:false};s.jobs.set(c,job);s.queue.push(job);}
 if(urgent){s.priority=c;s.queue=s.queue.filter(j=>j!==job);s.queue.unshift(job);}void readerLazyPump(s);return job.promise;
}
async function readerLazyPump(s){
 if(s.running)return;s.running=true;
 try{while(readerLazyAlive(s)&&s.queue.length){
  if(document.visibilityState==='hidden'){await new Promise(resolve=>setTimeout(resolve,180));continue;}
  if(s.signature!==getLayoutSignature()){
   const anchor=readerAnchor(),context=readerState.context;s.cancelled=true;for(const job of s.jobs.values())job.reject(Error('화면 크기 변경'));readerLazySession=null;
   if(s.reflows>=3){restoreInProgress=false;readerSetLoading(false);viewerOverlay.classList.remove('active');setStatus('화면 크기가 계속 바뀌어 계산을 중단했습니다. 다시 열어 주세요.',true);break;}
   await new Promise(resolve=>setTimeout(resolve,120));if(s.generation===readerState.generation&&viewerOverlay.classList.contains('active'))void readerDisplay({pageAnchor:anchor,pageContext:context,_lazyReflows:s.reflows+1});break;
  }
  const job=s.queue.shift();if(s.results[job.c])continue;
  try{
   let result=null;if(!job.checked){job.checked=true;await readerLazyImages(job.c);if(!readerLazyAlive(s))break;const saved=await readerLazyRead(s,job.c);if(!readerLazyAlive(s))break;if(saved&&saved.signature===s.signature&&saved.version===READER_CACHE_VERSION&&saved.length===s.source.length&&Array.isArray(saved.pages)&&saved.pages.length&&saved.pages.length===saved.anchors?.length&&saved.anchors[0]===chapterCanonicalStarts[job.c]&&saved.pages.every(x=>typeof x==='string')&&saved.anchors.every((a,i)=>Number.isFinite(a)&&(!i||a>saved.anchors[i-1]))){result=saved;readerLazyStats.chapterCacheHits++;}else{job.generator=readerPaginateChapter(s.source,job.c,s);readerLazyStats.chapterBuilds++;}}
   if(!result){const until=performance.now()+12;let step;do{step=job.generator.next();if(step.done){result=step.value;break;}}while(performance.now()<until);}
   if(result){if(!readerLazyAlive(s))break;s.results[job.c]=result;s.done++;if(s.priority===job.c)s.priority=null;s.jobs.delete(job.c);for(let i=s.bounds[job.c];i<(s.bounds[job.c+1]??cachedOriginalBlocks.length);i++)s.formatted.delete(i);readerLazyAssemble(s);readerLazyUpdateUI();job.resolve(result);void readerLazySave(s,job.c,result);
    if(s.done===s.results.length){s.complete=true;cachedBreakKey='';readerLazyUpdateUI();s.cacheWrite=readerState.pendingCache=readerStoreCache(readerCreatePageCache(s.id,s.signature,s.previous,null));flushReadingSessionSave(true);flushActiveRecentPositionSave();}
   }else{s.queue=s.queue.filter(j=>j!==job);if(s.priority!==null&&s.priority!==job.c)s.queue.push(job);else s.queue.unshift(job);}
  }catch(error){job.reject(error);s.jobs.delete(job.c);s.error=error;setStatus('구간 '+(job.c+1)+' 계산 실패: '+error.message,true);}
  readerLazyStats.yields++;await new Promise(resolve=>setTimeout(resolve,0));
 }}finally{s.running=false;}
}
async function readerLazyNavigate(anchor,lastPage=false){
 const s=readerLazySession;if(!readerLazyAlive(s))return;const c=readerLazyChapter(anchor),ticket=++s.navigation;
 restoreInProgress=true;readerSetLoading(true,'구간 '+(c+1)+' / '+s.results.length+' 페이지를 계산하는 중…');
 try{const result=await readerLazyEnsure(s,c,true);if(!readerLazyAlive(s)||ticket!==s.navigation)return;if(lastPage)anchor=result.anchors[result.anchors.length-1];readerLazyAssemble(s,anchor);restoreInProgress=false;readerSetLoading(false);render();readerLazyUpdateUI();
  if(!s.opened){s.opened=true;readerLazyStats.firstVisibleMs=performance.now()-s.started;readerPrepareSearchBook?.();}
  if(!s.backgroundQueued){s.backgroundQueued=true;const order=[];for(let n=1;n<s.results.length;n++){if(c+n<s.results.length)order.push(c+n);if(c-n>=0)order.push(c-n);}for(const index of order)void readerLazyEnsure(s,index).catch(()=>{});}
 }catch(error){if(readerLazyAlive(s)&&ticket===s.navigation){restoreInProgress=false;readerSetLoading(false);if(!s.opened){viewerOverlay.classList.remove('active');readerLazyCancel();}setStatus(error.message,true);}}
}
function readerLazyPendingPage(){const html=pages[pageIndex]||'';if(!html.includes('data-reader-pending='))return false;void readerLazyNavigate(readerAnchor());return true;}
async function readerLazyTurn(direction){if(restoreInProgress)return;const target=pageIndex+direction;if(target<0||target>=pages.length)return;const html=pages[target],anchor=pageAnchors[target];if(html.includes('data-reader-pending=')){await readerLazyNavigate(anchor,direction<0);return;}pageIndex=target;readerChooseAnchor(anchor);render();}
async function readerDisplay(record={pageAnchor:0},generation=++readerState.generation){
 readerLazyCancel();if(fullText.length<100000)return readerDisplayFull(record,generation);
 const started=performance.now();restoreInProgress=true;readerSetLoading(true,'책 구조와 읽던 구간을 준비하는 중…');await new Promise(resolve=>setTimeout(resolve,0));
 try{
  const cached=activeRecentId?await readerBounded(readerReadCache(activeRecentId),2000,'페이지 캐시').catch(()=>null):null;if(generation!==readerState.generation)return;
  readerLazyPreparing=true;try{readerConfigureChapters(record,cached);readerRestoreCountCache(cached);updateViewerCharacterCount();if(readerCacheBodyValid(cached,fullText)){readerState.canonical=cached.canonical;readerState.canonicalSource=fullText;}else readerCanonical();}finally{readerLazyPreparing=false;}
  if(bookChapters.length<2){cachedBreakKey='';return readerDisplayFull(record,generation);}
  await readerWaitForLayout();if(generation!==readerState.generation||!viewerOverlay.classList.contains('active'))return;const signature=getLayoutSignature();
  if(readerFindCachedLayout(cached,signature,fullText))return readerDisplayFull(record,generation);
  readerLazyPreparing=true;try{getPaginationBlocks(fullText);readerCanonical();}finally{readerLazyPreparing=false;}
  readerStats.lastCacheReason='chapter-first';readerState.layout=signature;const bounds=[...chapterBlockBoundaries].sort((a,b)=>a-b);
  const s=readerLazySession={generation,source:fullText,id:activeRecentId,signature,previous:cached,bounds,results:Array(bookChapters.length).fill(null),queue:[],jobs:new Map(),formatted:new Map(),done:0,complete:false,cancelled:false,running:false,priority:null,navigation:0,started,reflows:record._lazyReflows||0};readerLazyStats.sessions++;
  record=readerMigrateNotePosition(record,cached);const anchor=readerResolveAnchor(record);readerLazyAssemble(s,anchor);await readerLazyNavigate(anchor);
 }catch(error){if(generation===readerState.generation){restoreInProgress=false;readerSetLoading(false);viewerOverlay.classList.remove('active');readerLazyCancel();setStatus(error.message,true);}}
}

function* readerPaginateChapter(text,chapter,session){
  const box=ensurePaginationMeasureBox(),blocks=cachedOriginalBlocks,texts=cachedBlockTexts;
  const first=session.bounds[chapter],last=session.bounds[chapter+1]??blocks.length;
  if(box.clientHeight<Math.min(24,parseFloat(getComputedStyle(box).lineHeight))||box.clientWidth<8)throw Error('본문 공간이 너무 작습니다. 글자 크기나 여백을 줄여 주세요.');
  const result=[],anchors=[];let current=[],currentAnchor=0,base=cachedBlockStarts[first]||0;
  readerStats.splits++;
  const fits=items=>{readerStats.measurements++;box.innerHTML=items.join('');return box.scrollHeight<=box.clientHeight+1;};
  const flush=()=>{if(current.length){result.push(current.join(''));anchors.push(currentAnchor);current=[];}};
  for(let bi=first;bi<last;bi++){
    const html=readerLazyBlock(session,bi),plain=texts[bi]||'',nextBase=base+plain.length+1;
    const oversized=readerOversizedParagraph(html,plain,box);
    if(!oversized&&fits([...current,html])){
      if(!current.length)currentAnchor=base;current.push(html);base=nextBase;yield null;continue;
    }
    if(!oversized&&fits([html])){
      flush();yield null;current=[html];currentAnchor=base;base=nextBase;yield null;continue;
    }
    const slice=readerBlockSlicer(html);
    const sentenceEnds=readerSentenceEnds(plain,cachedQuoteRoles,base);
    if(sentenceEnds[sentenceEnds.length-1]!==plain.length)sentenceEnds.push(plain.length);
    if(!plain.length){flush();yield null;current=[html];currentAnchor=base;base=nextBase;yield null;continue;}
    let start=0,lastBest=512;
    while(start<plain.length){
      const length=plain.length-start;
      let lo=1,hi=Math.min(length,Math.max(64,Math.ceil(lastBest*1.4))),best=0;
      while(true){
        if(!fits([...current,slice(start,start+hi)]))break;
        best=hi;lo=hi+1;if(hi===length)break;hi=Math.min(length,hi*2);
      }
      while(lo<=hi){
        const mid=(lo+hi)>>1;
        if(fits([...current,slice(start,start+mid)])){best=mid;lo=mid+1;}else hi=mid-1;
      }
      if(!best&&current.length){flush();yield null;continue;}
      if(!best)best=1; // An extreme font/margin combination must still make progress.
      lastBest=best;
      // A complete fitting remainder stays whole, and its spare space remains available to the next paragraph.
      if(best===length){if(!current.length)currentAnchor=base+start;current.push(slice(start,plain.length));start=plain.length;break;}
      let cut=start+best;
      let previousEnd=0,followingEnd=plain.length;
      for(const end of sentenceEnds){if(end<=cut)previousEnd=end;else{followingEnd=end;break;}}
      let sentenceStart=previousEnd;while(sentenceStart<plain.length&&/\s/.test(plain[sentenceStart]))sentenceStart++;
      if(sentenceStart<=cut&&sentenceStart>=start&&followingEnd-sentenceStart<=Math.max(4096,best*2)&&fits([slice(sentenceStart,followingEnd)])){
        // Move an interrupted sentence intact to the next page when it fits a fresh page.
        if(sentenceStart===start&&current.length){flush();yield null;continue;}
        if(sentenceStart>start)cut=sentenceStart;
      }
      if(cut===start+best){
        if(previousEnd>start+best*.6)cut=previousEnd;
        else{
          const prefix=plain.slice(start,cut),space=prefix.search(/\s+\S*$/);
          if(space>best*.65)cut=start+space+1;
          // A sentence longer than a whole page can split, but should not leave a one-word final page.
          const minimumTail=Math.min(80,Math.max(24,Math.floor(best*.12)));
          if(plain.length-cut<minimumTail&&length>minimumTail*2){
            const target=Math.max(start+1,plain.length-minimumTail),part=plain.slice(start,target);
            const boundary=part.search(/\s+\S*$/);cut=boundary>best*.5?start+boundary+1:target;
          }
        }
      }
      cut=readerSafeQuoteCut(plain,cut,cachedQuoteRoles,base);
      if(cut>start&&/[\uDC00-\uDFFF]/.test(plain[cut]||''))cut--;
      if(cut<=start)cut=start+((/[\uD800-\uDBFF]/.test(plain[start])&&start+1<plain.length)?2:1);
      if(!current.length)currentAnchor=base+start;
      current.push(slice(start,cut));start=cut;flush();yield null;
    }
    base=nextBase;
  }
  flush();yield null;box.innerHTML='';return {pages:result,anchors};
}
