/* Comparative timeline parsing. Historical years have no year zero. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.ReaderTimeline=factory();})(typeof window==='object'?window:this,function(){
'use strict';
const era='(?:기원\\s*전|서기\\s*전|서력\\s*기원\\s*전|주전|B\\.?\\s*C\\.?\\s*E\\.?|B\\.?\\s*C\\.?|公元前|西元前|紀元前|기원\\s*후|서기|서력|주후|A\\.?\\s*D\\.?|C\\.?\\s*E\\.?|公元|西元|紀元後)',num='(?:[1-9][0-9]{0,2}(?:,[0-9]{3}){1,2}|[1-9][0-9]{0,6})';
const pattern=new RegExp('('+era+')\\s*('+num+')(?:\\s*[년年](?:도)?)?|('+num+')\\s*(?:[년年]\\s*)?('+era+')|('+num+')\\s*[년年]|('+num+')(?=\\s*[~～∼–—−-]\\s*'+num+'\\s*[년年])','gi');
function bc(s){return /전|前|^b/i.test(s.replace(/\s/g,''));}
function year(n,e){const v=Number(String(n).replace(/,/g,''));return Number.isSafeInteger(v)&&v>0&&v<=9999999?(bc(e||'')?-v:v):null;}
function label(y){return (y<0?'기원전 ':'서기 ')+Math.abs(y).toLocaleString('ko-KR')+'년';}
function ordinal(y){return y>0?y-1:y;}
function isCenturyTail(text,end){
 // A century is never a year, including both endpoints of a century range.
 return /^\s*(?:[~～∼–—−-]\s*(?:(?:기원\s*전|기원\s*후|서기|B\.?\s*C\.?\s*E?\.?|A\.?\s*D\.?|C\.?\s*E\.?)\s*)?[0-9][0-9,]*\s*)?(?:세\s*기|世紀|centur(?:y|ies)\b|c(?!\s*\.?\s*e\b)\.?(?![a-z]))/i.test(text.slice(end));
}
function years(text){
 text=String(text);pattern.lastIndex=0;const out=[];let m;
 while((m=pattern.exec(text))){
  if(isCenturyTail(text,pattern.lastIndex))continue;
  const before=text[m.index-1]||'',after=text[pattern.lastIndex]||'';if(/[A-Za-z0-9_.,]/.test(before)||/[A-Za-z0-9_]/.test(after))continue;
  const e=m[1]||m[4]||'',n=m[2]||m[3]||m[5]||m[6];let y=year(n,e);if(!y)continue;
  if(!e&&/^(?:간|\s*(?:동안|전(?:\s|$)|후(?:\s|$)))/.test(text.slice(pattern.lastIndex)))continue;
  const prev=out[out.length-1];if(!e&&prev&&/^\s*[~～∼–—−-]\s*$/.test(text.slice(prev.end,m.index)))y=prev.year<0?-Math.abs(y):Math.abs(y);
  out.push({start:m.index,end:pattern.lastIndex,text:m[0],year:y});
 }
 return out;
}
function heading(line,identified){
 let m=line.match(/^\[(BCE|CE)-(Y|C)(\d+)\]\s*(.*)$/i);
 if(m){const n=Number(m[3]);if(!n)return null;const sign=m[1].toUpperCase()==='BCE'?-1:1;return {from:sign*(m[2].toUpperCase()==='C'?(sign<0?n*100:(n-1)*100+1):n),to:sign*(m[2].toUpperCase()==='C'?(sign<0?(n-1)*100+1:n*100):n),title:line.replace(/^\[[^\]]+\]\s*/,''),key:m[1].toUpperCase()+'-'+m[2].toUpperCase()+m[3]};}
 if(identified)return null;
 const plain=line.replace(/^#{1,6}\s*/,'').replace(/^\[|\]$/g,'').trim();const found=years(plain);if(!found.length||found[0].start!==0)return null;
 const tail=plain.slice(found[found.length-1].end);if(tail&&!/^\s*(?:[—–:]\s*[^\n]+)?$/.test(tail))return null;
 // Only isolated year headings, never dates embedded in a paragraph.
 if(found.length>2||found.some((x,i)=>i&& !/^\s*[~～∼–—−-]\s*$/.test(plain.slice(found[i-1].end,x.start))))return null;
 return {from:Math.min(...found.map(x=>x.year)),to:Math.max(...found.map(x=>x.year)),title:plain,key:'custom-'+found.map(x=>x.year).join('-')};
}
function parseText(text,source='연표'){
 text=String(text).replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');const lines=text.split('\n'),identified=lines.some(l=>/^\[(?:BCE|CE)-(?:Y|C)\d+\]/i.test(l.trim())),entries=[];let current=null,body=[];
 function flush(){if(!current)return;const raw=body.join('\n').replace(/\n{4,}/g,'\n\n\n').trim();if(raw)entries.push({...current,source,text:raw});current=null;body=[];}
 for(const raw of lines){const line=raw.trim(),h=heading(line,identified);if(h){flush();current=h;body=[h.title];}
 else if(current){if(/^\[(?:저장 경계|출처 검증|[^\]]*연표 끝)\]/.test(line)){flush();}else body.push(raw);}}
 flush();return entries;
}
function merge(entries){
 const map=new Map();for(const e of entries){if(!e||!e.from||!e.to||!Number.isSafeInteger(e.from)||!Number.isSafeInteger(e.to)||e.from>e.to||typeof e.text!=='string')continue;const key=e.from+':'+e.to;
  if(map.has(key)){const old=map.get(key);if(old.text!==e.text)old.text+='\n\n'+e.text;}else map.set(key,{...e});}
 return [...map.values()].sort((a,b)=>a.from-b.from||a.to-b.to).map((e,i)=>({...e,id:i}));
}
function nearest(entries,y){
 if(!entries.length||!y)return -1;let lo=0,hi=entries.length;
 while(lo<hi){const m=(lo+hi)>>>1;if(entries[m].from<=y)lo=m+1;else hi=m;}
 let best=-1,distance=Infinity,width=Infinity;
 // Metadata only. Overlapping custom century/year entries prefer the narrowest match.
 for(let i=0;i<entries.length;i++){const e=entries[i],d=y<e.from?ordinal(e.from)-ordinal(y):y>e.to?ordinal(y)-ordinal(e.to):0,w=e.to-e.from;
  if(d<distance||(d===distance&&w<width)){best=i;distance=d;width=w;}}
 return best;
}
return {version:1,years,year,label,ordinal,heading,parseText,merge,nearest};
});
