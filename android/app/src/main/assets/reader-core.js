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
function readerSetLoading(loading){
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
async function readerWaitForLayout(){
  await readerState.fontPromise;
  await chapterImagesReady;
  const family=getComputedStyle(pageInnerLeft).fontFamily;
  if(document.fonts){
    await document.fonts.load(viewerSettings.fontSize+'px '+family,'가나다라마바사 ABC abc 0123456789');
    await document.fonts.ready;
  }
  let previous='',stable=0;
  while(stable<3){
    await nextFrame();syncVisualViewport();
    const current=getLayoutSignature();
    stable=current===previous?stable+1:0;previous=current;
  }
  document.documentElement.style.setProperty('--reader-image-height',Math.max(1,pageInnerLeft.clientHeight-parseFloat(getComputedStyle(pageInnerLeft).lineHeight)*2)+'px');
}
async function readerDisplay(record={pageAnchor:0},generation=++readerState.generation){
  const started=performance.now(),source=fullText,id=activeRecentId;
  restoreInProgress=true;readerSetLoading(true);clearTimeout(repaginateTimer);
  readerStats.lastCacheReason='not-checked';
  try{
    // Read the stored layout before touching the book's paragraph DOM.
    const cached=id?await readerReadCache(id):null;
    if(generation!==readerState.generation)return;
    readerConfigureChapters(record,cached);readerRestoreCountCache(cached);updateViewerCharacterCount();
    if(readerCacheBodyValid(cached,source)){readerState.canonical=cached.canonical;readerState.canonicalSource=source;}
    let signature,used=null,built=null;
    while(generation===readerState.generation){
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
      await nextFrame();await nextFrame();
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
