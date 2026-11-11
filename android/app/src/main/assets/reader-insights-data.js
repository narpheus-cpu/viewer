/* ReaderInsightsData v2 — source-only unified TXT parser and local book metadata. */
(function(){
'use strict';
const BEGIN='<<<READER_INSIGHTS_V2_BEGIN>>>';
const END='<<<READER_INSIGHTS_V2_END>>>';
const CATEGORIES=new Set(['event','relation','character','clue']);
const CONFIDENCE=new Set(['fact','strong_inference','tentative']);
const MAX_RECORDS=3000, MAX_JSON_BYTES=2*1024*1024, MAX_TEXT=12000;
const DB_NAME='ebookViewerInsightsDBV2', STORE='books', PROGRESS='ebookViewerInsightsReadCursorV3:';
let dbPromise=null, lastText=null,lastKey=null;
const memory=new Map();

function key(body){
 if(body===lastText&&lastKey!==null)return lastKey;
 let a=0x811c9dc5,b=0x9e3779b9;
 // Two full-text rolling hashes with independent mixing; no title dependence.
 for(let i=0;i<body.length;i++){const c=body.charCodeAt(i);a=Math.imul(a^c,0x01000193)>>>0;b=Math.imul(b^(c+i),0x85ebca6b)>>>0;}
 lastText=body;lastKey='v2-'+body.length+'-'+a.toString(16)+'-'+b.toString(16);
 return lastKey;
}
function validError(message){throw new Error('독서정보 검증 실패: '+message);}
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
function validate(meta,body){
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
 const hasBegin=text.includes(BEGIN);
 if(!hasBegin)return {body:text,hasInsights:false,metadata:null};
 // Strict tail and separate newline only; never leave a malformed metadata block in the book.
 const regex=/(?:\r?\n){2}<<<READER_INSIGHTS_V2_BEGIN>>>\r?\n([\s\S]*?)\r?\n<<<READER_INSIGHTS_V2_END>>>\s*$/;
 const m=regex.exec(text);
 if(!m)validError('통합 TXT 끝의 시작·종료 표식 및 빈 줄을 확인하세요.');
 const body=text.slice(0,m.index);
 if(m[1].length>MAX_JSON_BYTES)validError('JSON 정보 영역은 2MB 이하여야 합니다.');
 let meta;try{meta=JSON.parse(m[1]);}catch(e){validError('JSON 파싱 오류: '+e.message);}
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
  tx.objectStore(STORE).put({schema_version:2,records:validated.records,updatedAt:Date.now()},id);
  tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||Error('독서정보 저장 취소'));
  tx.onerror=()=>reject(tx.error||Error('독서정보 저장 오류'));
 });
 memory.set(id,validated);return validated;
}
async function load(body){
 const id=key(body);if(memory.has(id))return memory.get(id);
 try{
  const db=await openDb();
  const found=await new Promise((resolve,reject)=>{
   const tx=db.transaction(STORE,'readonly'),q=tx.objectStore(STORE).get(id);
   q.onsuccess=()=>resolve(q.result||null);q.onerror=()=>reject(q.error);
  });
  const parsed=found?.schema_version===2&&Array.isArray(found.records)?found:null;
  memory.set(id,parsed);return parsed;
 }catch(e){return null;}
}
/* v3: the old v2 "furthest displayed anywhere" key is intentionally not migrated.
   It could be 100% after an accidental end-of-book jump. */
function getReadState(body){
 const id=key(body);
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
 try{localStorage.setItem(PROGRESS+id,JSON.stringify({seen:n,mode,updatedAt:Date.now()}));}
 catch{/* Keep in-memory accuracy if storage is unavailable. */}
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
window.ReaderInsightsData={BEGIN,END,key,parse,validate,save,load,getReadState,getSeen,markSeen,setSeen,resetSeen,clearCache,occurrenceEnd};
})();