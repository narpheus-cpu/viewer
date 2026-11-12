/* ReaderInsightsData v3: cumulative plot records, source validation and legacy v2 support. */
(function(){
'use strict';
const BEGIN='<<<READER_INSIGHTS_V3_BEGIN>>>';
const END='<<<READER_INSIGHTS_V3_END>>>';
const OLD_BEGIN='<<<READER_INSIGHTS_V2_BEGIN>>>';
const OLD_START='<<<READER_INSIGHTS_V2_START>>>'; // legacy generator typo
const OLD_END='<<<READER_INSIGHTS_V2_END>>>';
const CATEGORIES_V3=new Set(['plot','relation','character','clue']);
const LEGACY_PLOT_NO_EVIDENCE='legacy-v2-compressed-plot-no-evidence';
const CATEGORIES=new Set(['event','relation','character','clue']);
const CONFIDENCE=new Set(['fact','strong_inference','tentative']);
const MAX_RECORDS=3000, MAX_JSON_BYTES=2*1024*1024, MAX_TEXT=12000;
const DB_NAME='ebookViewerInsightsDBV2', STORE='books', PROGRESS='ebookViewerInsightsReadCursorV3:';
let dbPromise=null, lastText=null,lastKey=null;
const memory=new Map();
const MAX_CACHED_INSIGHT_BOOKS=12;
function rememberBook(id,metadata){
 memory.delete(id);memory.set(id,metadata);
 while(memory.size>MAX_CACHED_INSIGHT_BOOKS)memory.delete(memory.keys().next().value);
}
// Storage failures must never erase spoiler boundaries during the current session.
const volatileReadState=new Map();

function key(body){
 if(body===lastText&&lastKey!==null)return lastKey;
 let a=0x811c9dc5,b=0x9e3779b9;
 // Two full-text rolling hashes with independent mixing; no title dependence.
 for(let i=0;i<body.length;i++){const c=body.charCodeAt(i);a=Math.imul(a^c,0x01000193)>>>0;b=Math.imul(b^(c+i),0x85ebca6b)>>>0;}
 lastText=body;lastKey='v2-'+body.length+'-'+a.toString(16)+'-'+b.toString(16);
 return lastKey;
}
function validError(message){throw new Error('독서정보 검증 실패: '+message);}
/* Render-only evidence excerpt for both legacy tabs and the long-novel navigator.
   Keep the original evidence untouched for exact source validation/search. */
function evidenceSentences(source){
 const text=String(source??'');
 if(!text.trim())return [];
 // Intl.Segmenter understands Korean closing quotes, decimals, abbreviations,
 // and sentence punctuation more reliably than splitting at each dot.
 if(typeof Intl==='object'&&typeof Intl.Segmenter==='function'){
  try{
   const segmenter=new Intl.Segmenter('ko',{granularity:'sentence'});
   return [...segmenter.segment(text)].map(x=>x.segment.trim()).filter(Boolean);
  }catch{/* Older Android WebView: use the guarded fallback below. */}
 }
 const parts=[];let start=0;
 for(let i=0;i<text.length;i++){
  const ch=text[i];
  if(!/[.!?。！？]/.test(ch))continue;
  // Do not turn decimal numbers or initials/abbreviations into sentences.
  if(ch==='.'&&/\d/.test(text[i-1]||'')&&/\d/.test(text[i+1]||''))continue;
  if(ch==='.'&&/[A-Za-z]/.test(text[i-1]||'')&&/[A-Za-z]/.test(text[i+1]||''))continue;
  if(ch==='.'&&/[A-Za-z]/.test(text[i-1]||'')){
   const before=text.slice(Math.max(0,i-12),i+1);
   if(/(?:\b(?:Dr|Mr|Mrs|Ms|Prof|Jr|Sr|St|vs|etc|e\.g|i\.e)\.|\b[A-Z]\.)$/i.test(before))continue;
  }
  // Keep repeated punctuation and closing quotation marks with the sentence.
  let end=i+1;
  while(end<text.length&&/[.!?。！？"”’'」』)\]]/.test(text[end]))end++;
  if(end<text.length&&!/\s/.test(text[end])){i=end-1;continue;}
  const part=text.slice(start,end).trim();
  if(part)parts.push(part);
  start=end;i=end-1;
 }
 const tail=text.slice(start).trim();
 if(tail)parts.push(tail);
 return parts;
}
function formatEvidence(source){
 const text=String(source??'');
 const sentences=evidenceSentences(text);
 if(sentences.length<=6)return text;
 return sentences.slice(0,3).join(' ')+' (중략) '+sentences.slice(-3).join(' ');
}

function occurrenceEnd(text,phrase,occurrence){
 if(!phrase)return -1;
 let start=0,found=-1;
 for(let i=0;i<occurrence;i++){
  found=text.indexOf(phrase,start);
  if(found<0)return -1;
  start=found+phrase.length;
 }
 return start;
}

/* Every plot is a fully independent, source-verified cumulative snapshot.
   All refs resolve against the unmodified book body, not against displayed excerpts. */
function validateV3(meta,body){
 // Tagged transitional TXT may be displayed without per-bullet proof.
 // Native v3 remains strict; none of the missing evidence is synthesized.
 const allowUnverifiedPlot=meta?.compatibility_mode===LEGACY_PLOT_NO_EVIDENCE;
 if(!Array.isArray(meta.records))validError('schema_version=3의 records 배열이 필요합니다.');
 const out=[],seen=new Map(),occurrenceCache=new Map();let lastPlot=null,lastOffset=-1;
 // Cumulative plot snapshots cite many of the same source passages. A single
 // occurrence index avoids re-scanning 6M-character books for each bullet.
 function sourceEnd(phrase,occurrence){
  let ends=occurrenceCache.get(phrase);
  if(!ends){ends=[];occurrenceCache.set(phrase,ends);}
  let start=ends.length?ends[ends.length-1]:0;
  while(ends.length<occurrence){
   const at=body.indexOf(phrase,start);
   if(at<0)return -1;
   start=at+phrase.length;
   ends.push(start);
  }
  return ends[occurrence-1];
 }
 const str=(value,label,max)=>{if(typeof value!=='string'||!value.trim()||(max&&value.length>max))validError(label+' 문자열을 확인하세요.');return value;};
 const array=(value,label)=>{if(!Array.isArray(value))validError(label+' 배열이 필요합니다.');return value;};
 const aliases=(value,label)=>array(value,label).map((v,j)=>str(v,label+'['+j+']',160));
 const quote=(ref,label,min=1,max=0)=>{
  if(!ref||typeof ref!=='object'||Array.isArray(ref))validError(label+' 객체가 아닙니다.');
  str(ref.quote,label+'.quote',max);
  if(ref.quote.length<min)validError(label+'.quote의 길이가 맞지 않습니다.');
  if(!Number.isSafeInteger(ref.occurrence)||ref.occurrence<1)validError(label+'.occurrence가 잘못되었습니다.');
  const at=sourceEnd(ref.quote,ref.occurrence);
  if(at<0)validError(label+'의 원문 위치를 확인할 수 없습니다.');
  return {quote:ref.quote,occurrence:ref.occurrence,end:at};
 };
 for(const [i,r] of meta.records.entries()){
  if(!r||typeof r!=='object'||Array.isArray(r))validError((i+1)+'번 레코드가 객체가 아닙니다.');
  const id=str(r.id,(i+1)+'번 id',100);
  if(seen.has(id))validError(id+'가 중복되었습니다.');
  if(!CATEGORIES_V3.has(r.category))validError(id+'의 category가 허용되지 않습니다.');
  str(r.title,id+'.title',160);str(r.subject,id+'.subject',160);str(r.scene_id,id+'.scene_id',120);
  if(!Number.isInteger(r.importance)||r.importance<1||r.importance>5)validError(id+'.importance는 1~5 정수여야 합니다.');
  const reveal=quote(r.reveal,id+'.reveal',20,500);
  if(reveal.end<lastOffset)validError(id+'의 기록이 공개 위치 순서로 정렬되지 않았습니다.');
  lastOffset=reveal.end;
  const entities=array(r.entities,id+'.entities').map((e,j)=>{
   const label=id+'.entities['+j+']';
   if(!e||typeof e!=='object'||Array.isArray(e))validError(label+' 객체를 확인하세요.');
   if(!['person','place','object','concept','other'].includes(e.type))validError(label+'.type가 잘못되었습니다.');
   return {id:str(e.id,label+'.id',160),name:str(e.name,label+'.name',160),type:e.type,aliases:aliases(e.aliases,label+'.aliases')};
  });
  const base={id,category:r.category,subject:r.subject,title:r.title,scene_id:r.scene_id,
   reveal:{quote:reveal.quote,occurrence:reveal.occurrence},rawOffset:reveal.end,
   entities,aliases:aliases(r.aliases,id+'.aliases'),
   related_ids:aliases(r.related_ids,id+'.related_ids'),importance:r.importance};
  if(r.category==='plot'){
   if(r.subject!=='현재까지 줄거리')validError(id+'의 subject는 현재까지 줄거리여야 합니다.');
   if(r.previous_plot_id!==(lastPlot?.id??null))validError(id+'.previous_plot_id는 직전 줄거리 버전이어야 합니다.');
   if(lastPlot&&reveal.end<=lastPlot.rawOffset)validError(id+'의 공개 위치는 직전 줄거리보다 뒤여야 합니다.');
   if(r.replaces!=null)validError(id+'의 plot에 replaces를 지정할 수 없습니다.');
   const bullets=array(r.bullets,id+'.bullets');
   if(!bullets.length)validError(id+'의 줄거리 항목이 없습니다.');
   const checked=bullets.map((b,j)=>{
    const label=id+'.bullets['+j+']';
    if(!b||typeof b!=='object'||Array.isArray(b))validError(label+' 객체를 확인하세요.');
    const value=str(b.text,label+'.text');
    if(/^\s*\d+[.)]\s/.test(value))validError(label+'에는 번호를 직접 넣지 마세요.');
    if(!CONFIDENCE.has(b.confidence))validError(label+'.confidence가 잘못되었습니다.');
    const ev=array(b.evidence,label+'.evidence');
    if(!ev.length){
     if(!allowUnverifiedPlot||b.evidence_status!=='not_provided')
      validError(label+'의 원문 근거가 없습니다.');
     return {text:value,confidence:b.confidence,evidence:[],
      evidence_status:'not_provided'};
    }
    return {text:value,confidence:b.confidence,evidence:ev.map((e,k)=>{
     const q=quote(e,label+'.evidence['+k+']');
     if(q.end>reveal.end)validError(label+'의 근거가 줄거리 공개 시점보다 뒤입니다.');
     return {quote:q.quote,occurrence:q.occurrence};
    })};
   });
   const row={...base,previous_plot_id:r.previous_plot_id,bullets:checked};
   out.push(row);seen.set(id,row);lastPlot=row;
  }else{
   if(!('replaces' in r))validError(id+'.replaces 필드가 없습니다.');
   const evidence=str(r.evidence,id+'.evidence'),text=str(r.body,id+'.body');
   if(body.lastIndexOf(evidence,reveal.end-evidence.length)<0)validError(id+'의 근거가 공개 위치 이전 원문과 다릅니다.');
   if(!CONFIDENCE.has(r.confidence))validError(id+'.confidence가 잘못되었습니다.');
   if(r.replaces!==null){
    if(typeof r.replaces!=='string'||!seen.has(r.replaces))validError(id+'.replaces가 존재하는 이전 레코드를 가리키지 않습니다.');
    const prev=seen.get(r.replaces);
    if(prev.category!==r.category||prev.rawOffset>reveal.end)validError(id+'.replaces의 범주나 위치가 다릅니다.');
   }
   // Some source-only generators preserve multiple disconnected evidence quotes.
   // Keep each original passage, and validate it independently against the read cutoff.
   const evidence_passages=r.evidence_passages===undefined?[]:
    array(r.evidence_passages,id+'.evidence_passages').map((e,k)=>{
     const ref=quote(e,id+'.evidence_passages['+k+']');
     if(ref.end>reveal.end||!evidence.includes(ref.quote))
      validError(id+'.evidence_passages['+k+']가 근거 범위 또는 공개 시점을 벗어났습니다.');
     return {quote:ref.quote,occurrence:ref.occurrence};
    });
   const row={...base,body:text,text,confidence:r.confidence,evidence,
    evidence_passages,replaces:r.replaces,
    story_order:Number.isInteger(r.story_order)?r.story_order:null};
   out.push(row);seen.set(id,row);
  }
 }
 for(const row of out)for(const id of row.related_ids){
  const target=seen.get(id);
  if(!target||target.id===row.id||target.rawOffset>row.rawOffset)validError(row.id+'.related_ids가 잘못되었거나 아직 공개되지 않았습니다.');
 }
 return {schema_version:3,records:out,
  ...(allowUnverifiedPlot?{compatibility_mode:LEGACY_PLOT_NO_EVIDENCE}:{})};
}


/* Upgrade only the known mixed v2/plot generator format. All quotes must be
   exact source substrings within their respective spoiler reveal limits. */
function upgradeMixedV2(meta,body){
 const seen=new Map();
 const declaredUnverified=
  meta?.source_metadata?.plot_style==='compressed_reconstructed_full_report_no_evidence'||
  meta?.metadata?.plot_style==='full_rewritten_compressed_reports_without_evidence';
 let missingBulletEvidence=0;
 function matches(s,label){
  if(typeof s!=='string'||!s.trim())validError(label+'의 원문 인용이 비어 있습니다.');
  if(seen.has(s))return seen.get(s);
  const result=[];
  for(let at=0;(at=body.indexOf(s,at))>=0;at+=s.length)
   result.push({start:at,end:at+s.length,occurrence:result.length+1});
  if(!result.length)validError(label+' 원문 인용을 찾지 못했습니다.');
  seen.set(s,result);return result;
 }
 function exact(r,label){
  if(!r||!Number.isSafeInteger(r.occurrence)||r.occurrence<1)
   validError(label+'의 occurrence가 잘못되었습니다.');
  const seq=matches(r.quote,label);
  if(r.occurrence>seq.length)validError(label+'의 출현 횟수가 잘못되었습니다.');
  return {...seq[r.occurrence-1],quote:r.quote};
 }
 function reveal(r,label){
  const original=exact(r,label);
  if(r.quote.length>=20)return {...r,end:original.end};
  const quote=body.slice(Math.max(0,original.end-64),original.end);
  if(quote.length<20)validError(label+'의 공개 문장을 원문에서 확장할 수 없습니다.');
  const occurrence=matches(quote,label).find(x=>x.end===original.end)?.occurrence;
  if(!occurrence)validError(label+'의 공개 문장을 찾지 못했습니다.');
  return {quote,occurrence,end:original.end};
 }
 function evidence(e,label,end,hint){
  let found;
  if(e&&typeof e==='object'&&!Array.isArray(e))found=exact(e,label);
  else{
   const options=matches(e,label).filter(x=>x.end<=end);
   if(!options.length)validError(label+' 원문 근거가 공개 위치 이전에 없습니다.');
   const near=Number.isFinite(hint)?options.filter(x=>x.end<=hint):[];
   const chosen=near.length?near[near.length-1]:options[0];
   found={...chosen,quote:e};
  }
  if(found.end>end)validError(label+' 근거가 공개 위치 이후에 있습니다.');
  return found;
 }
 const records=meta.records.map((r,i)=>{
  const id=r?.id||String(i+1);
  if(!r||!CATEGORIES_V3.has(r.category))validError(id+'의 중간형 범주가 잘못되었습니다.');
  const v=reveal(r.reveal,id+'.reveal');
  const base={id:r.id,category:r.category,subject:r.subject,title:r.title,scene_id:r.scene_id,
   reveal:{quote:v.quote,occurrence:v.occurrence},entities:r.entities,aliases:r.aliases,
   related_ids:r.related_ids,importance:r.importance};
  if(r.category==='plot'){
   if(!Array.isArray(r.bullets)||!r.bullets.length)validError(id+'에 누적 줄거리가 없습니다.');
   const bullets=r.bullets.map((b,j)=>{
    const label=id+'.bullets['+j+']';
    if(!Array.isArray(b.evidence)||!b.evidence.length){
     if(!declaredUnverified)validError(label+' 원문 근거 배열이 없습니다.');
     missingBulletEvidence++;
     return {text:b.text,confidence:b.confidence,evidence:[],
      evidence_status:'not_provided'};
    }
    const at=b.reveal?Math.min(v.end,exact(b.reveal,label+'.reveal').end):v.end;
    return {text:b.text,confidence:b.confidence,evidence:b.evidence.map((item,k)=>{
     const ref=evidence(item,label+'.evidence['+k+']',v.end,at);
     return {quote:ref.quote,occurrence:ref.occurrence};
    })};
   });
   return {...base,bullets,previous_plot_id:r.previous_plot_id};
  }
  const pieces=Array.isArray(r.evidence)?r.evidence:[r.evidence];
  if(!pieces.length)validError(id+'의 근거가 없습니다.');
  const refs=pieces.map((item,j)=>evidence(item,id+'.evidence['+j+']',v.end));
  const start=Math.min(...refs.map(x=>x.start)),stop=Math.max(...refs.map(x=>x.end));
  const original=body.slice(start,stop);
  if(!original||!refs.every(ref=>original.includes(ref.quote)))validError(id+' 근거 원문 보존에 실패했습니다.');
  return {...base,body:r.body??r.text,confidence:r.confidence,evidence:original,replaces:r.replaces,
   ...(refs.length>1?{evidence_passages:refs.map(({quote,occurrence})=>({quote,occurrence}))}:{})};
 });
 return {schema_version:3,records,
  ...(missingBulletEvidence?{compatibility_mode:LEGACY_PLOT_NO_EVIDENCE}:{})};
}

function validate(meta,body){
 if(meta?.schema_version===3)return validateV3(meta,body);
 if(meta?.schema_version===2&&Array.isArray(meta.records)&&meta.records.some(r=>r?.category==='plot'))
  return validateV3(upgradeMixedV2(meta,body),body);
 if(!meta||meta.schema_version!==2||!Array.isArray(meta.records))validError('schema_version=2 및 records 배열이 필요합니다.');
 if(meta.records.length>MAX_RECORDS)validError('레코드는 최대 '+MAX_RECORDS+'건입니다.');
 const ids=new Map(),out=[];
 for(let i=0;i<meta.records.length;i++){
  const r=meta.records[i],n=i+1;
  if(!r||typeof r!=='object'||Array.isArray(r))validError(n+'번 레코드가 객체가 아닙니다.');
  const id=String(r.id||'').trim(),cat=r.category,confidence=r.confidence;
  if(!id||id.length>100||ids.has(id))validError(n+'번 ID가 없거나 중복되었습니다.');
  if(!CATEGORIES.has(cat))validError(id+'의 category가 잘못되었습니다.');
  if(!CONFIDENCE.has(confidence))validError(id+'의 confidence가 잘못되었습니다.');
  if(typeof r.title!=='string'||!r.title.trim()||r.title.length>160)validError(id+'의 title을 확인하세요.');
  if(typeof r.text!=='string'||!r.text.trim()||r.text.length>MAX_TEXT)validError(id+'의 text를 확인하세요.');
  if(typeof r.evidence!=='string'||!r.evidence.trim()||r.evidence.length>1500)validError(id+'의 evidence를 확인하세요.');
  if(!r.reveal||typeof r.reveal.quote!=='string'||r.reveal.quote.length<20||r.reveal.quote.length>500)validError(id+'의 reveal.quote는 20~500자 원문 인용문이어야 합니다.');
  if(!Number.isSafeInteger(r.reveal.occurrence)||r.reveal.occurrence<1||r.reveal.occurrence>100000)validError(id+'의 reveal.occurrence가 잘못되었습니다.');
  const at=occurrenceEnd(body,r.reveal.quote,r.reveal.occurrence);
  if(at<0)validError(id+'의 공개 구절이 본문에서 지정된 순서로 발견되지 않습니다.');
  if(body.lastIndexOf(r.evidence,at-r.evidence.length)<0)validError(id+'의 근거 문구가 공개 지점보다 뒤에 있거나 본문에 없습니다.');
  const replaces=r.replaces==null?null:String(r.replaces);
  if(replaces && !ids.has(replaces))validError(id+'의 replaces가 이전 레코드를 가리키지 않습니다.');
  if(replaces && ids.get(replaces).rawOffset>at)validError(id+'의 수정 이력이 과거보다 먼저 공개됩니다.');
  const order=r.story_order==null?null:Number(r.story_order);
  if(order!==null&&(!Number.isInteger(order)||order<1||order>1000000))validError(id+'의 story_order를 확인하세요.');
  // Optional navigation metadata belongs to the gated record; never to the book globally.
  const safe=(value,max=160)=>typeof value==='string'?value.trim().slice(0,max):'';
  const entities=Array.isArray(r.entities)?r.entities.slice(0,12).map(item=>{
   if(typeof item==='string'){const name=safe(item);return name?{id:name,name,type:'other',aliases:[]}:null;}
   if(!item||typeof item!=='object'||Array.isArray(item))return null;
   const name=safe(item.name),eid=safe(item.id)||name;
   if(!name||!eid)return null;
   const aliases=Array.isArray(item.aliases)?item.aliases.slice(0,12).map(a=>safe(a,80)).filter(Boolean):[];
   return {id:eid,name,type:['person','place','object','concept','other'].includes(item.type)?item.type:'other',aliases};
  }).filter(Boolean):[];
  const aliases=Array.isArray(r.aliases)?r.aliases.slice(0,12).map(a=>safe(a,80)).filter(Boolean):[];
  const related_ids=Array.isArray(r.related_ids)?r.related_ids.slice(0,30).map(a=>safe(a,100)).filter(Boolean):[];
  const importance=Number.isInteger(r.importance)&&r.importance>=1&&r.importance<=5?r.importance:3;
  const scene_id=safe(r.scene_id,120)||null;
  const obj={id,category:cat,title:r.title,text:r.text,confidence,evidence:r.evidence,
   subject:safe(r.subject),reveal:{quote:r.reveal.quote,occurrence:r.reveal.occurrence},
   replaces,story_order:order,rawOffset:at,entities,aliases,related_ids,importance,scene_id};
  out.push(obj);ids.set(id,obj);
 }
 for(const row of out)row.related_ids=row.related_ids.filter(other=>other!==row.id&&ids.has(other));
 return {schema_version:2,records:out};
}
function parse(raw){
 const text=String(raw||'');
 const v3=text.includes(BEGIN),v2=text.includes(OLD_BEGIN),mixed=text.includes(OLD_START);
 if(!v3&&!v2&&!mixed){
  if(text.includes(END)||text.includes(OLD_END))validError('통합 TXT의 시작 표식이 없습니다. V3_BEGIN/V3_END 또는 V2_BEGIN/V2_END 쌍을 확인하세요.');
  return {body:text,hasInsights:false,metadata:null};
 }
 if(Number(v3)+Number(v2)+Number(mixed)!==1)validError('서로 다른 독서정보 시작 표식을 함께 사용할 수 없습니다.');
 if(text.split(v3?BEGIN:v2?OLD_BEGIN:OLD_START).length!==2)validError('독서정보 시작 표식이 중복되었습니다.');
 const regex=v3?/(?:\r?\n){1,2}<<<READER_INSIGHTS_V3_BEGIN>>>\r?\n([\s\S]*?)\r?\n<<<READER_INSIGHTS_V3_END>>>\s*$/:
  v2?/(?:\r?\n){1,2}<<<READER_INSIGHTS_V2_BEGIN>>>\r?\n([\s\S]*?)\r?\n<<<READER_INSIGHTS_V2_END>>>\s*$/:
  /(?:\r?\n){1,2}<<<READER_INSIGHTS_V2_START>>>\r?\n([\s\S]*?)\r?\n<<<READER_INSIGHTS_V2_END>>>\s*$/;
 const m=regex.exec(text);
 if(!m)validError('통합 TXT 끝의 독서정보 표식이 행 단위로 정확히 닫혀 있는지 확인하세요.');
 const body=text.slice(0,m.index);
 if(m[1].length>(v3||mixed?32*1024*1024:MAX_JSON_BYTES))validError('독서정보 JSON이 허용 용량을 넘었습니다.');
 let meta;try{meta=JSON.parse(m[1]);}catch(e){validError('JSON 파싱 오류: '+e.message);}
 if(meta?.schema_version!==(v3?3:2))validError('독서정보 표식과 schema_version이 일치하지 않습니다.');
 return {body,hasInsights:true,metadata:validate(meta,body)};
}
function openDb(){
 if(dbPromise)return dbPromise;
 dbPromise=new Promise((resolve,reject)=>{
  if(!('indexedDB' in window)){reject(Error('IndexedDB가 지원되지 않습니다.'));return;}
  const request=indexedDB.open(DB_NAME,1);
  request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(STORE))request.result.createObjectStore(STORE);};
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error||Error('독서정보 DB를 열지 못했습니다.'));
  request.onblocked=()=>reject(Error('독서정보 DB 접근이 차단되었습니다.'));
 }).catch(e=>{dbPromise=null;throw e;});
 return dbPromise;
}
async function save(body,metadata){
 const validated=validate(metadata,body),id=key(body);
 const db=await openDb();
 await new Promise((resolve,reject)=>{
  const tx=db.transaction(STORE,'readwrite');
  tx.objectStore(STORE).put({schema_version:validated.schema_version,
   ...(validated.compatibility_mode?{compatibility_mode:validated.compatibility_mode}:{}),
   records:validated.records,updatedAt:Date.now()},id);
  tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||Error('독서정보 저장 취소'));
  tx.onerror=()=>reject(tx.error||Error('독서정보 저장 오류'));
 });
 rememberBook(id,validated);return validated;
}
async function load(body){
 const id=key(body);if(memory.has(id))return memory.get(id);
 try{
  const db=await openDb();
  const found=await new Promise((resolve,reject)=>{
   const tx=db.transaction(STORE,'readonly'),q=tx.objectStore(STORE).get(id);
   q.onsuccess=()=>resolve(q.result||null);q.onerror=()=>reject(q.error);
  });
  const parsed=(found?.schema_version===2||found?.schema_version===3)&&Array.isArray(found.records)?found:null;
  rememberBook(id,parsed);return parsed;
 }catch(e){return null;}
}
/* v3: the old v2 "furthest displayed anywhere" key is intentionally not migrated.
   It could be 100% after an accidental end-of-book jump. */
function getReadState(body){
 const id=key(body);
 const volatile=volatileReadState.get(id);
 if(volatile)return {...volatile,hasRecord:true};
 try{
  const raw=localStorage.getItem(PROGRESS+id);
  if(raw===null)return {seen:0,hasRecord:false,mode:'none'};
  const value=JSON.parse(raw);
  if(!value||!Number.isSafeInteger(value.seen)||value.seen<0)return {seen:0,hasRecord:false,mode:'invalid'};
  return {seen:Math.max(0,value.seen),hasRecord:true,mode:value.mode==='manual'?'manual':'sequential'};
 }catch{return {seen:0,hasRecord:false,mode:'unavailable'};}
}
function getSeen(body){return getReadState(body).seen;}
function writeSeen(body,at,mode){
 const n=Math.max(0,Math.floor(Number(at)||0));
 const id=key(body);
 try{localStorage.setItem(PROGRESS+id,JSON.stringify({seen:n,mode,updatedAt:Date.now()}));volatileReadState.delete(id);}
 catch{volatileReadState.set(id,{seen:n,mode,updatedAt:Date.now()});}
 return n;
}
function markSeen(body,at){
 const prev=getReadState(body),n=Math.max(0,Math.floor(Number(at)||0));
 if(!prev.hasRecord||n>prev.seen)return writeSeen(body,n,'sequential');
 return prev.seen;
}
/* Explicit human correction may move the cursor backward as well as forward. */
function setSeen(body,at){return writeSeen(body,at,'manual');}
function resetSeen(body){return setSeen(body,0);}
function clearCache(body){memory.delete(key(body));}
window.ReaderInsightsData={BEGIN,END,OLD_BEGIN,OLD_START,OLD_END,key,parse,validate,save,load,getReadState,getSeen,markSeen,setSeen,resetSeen,clearCache,occurrenceEnd,evidenceSentences,formatEvidence};
})();