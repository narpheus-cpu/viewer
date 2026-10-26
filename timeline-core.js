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
// Recognize the full century token before attempting individual years. A century
// is an interval, never the number printed in its name (11th BCE = 1100..1001 BCE).
const centuryUnit='(?:세\\s*기|世紀|centur(?:y|ies)\\b|c(?!\\s*\\.?\\s*e\\b)\\.?(?![a-z]))';
const centuryPattern=new RegExp('(?:('+era+')\\s*)?('+num+')(?:st|nd|rd|th)?(?:\\s*[~～∼–—−-]\\s*(?:('+era+')\\s*)?('+num+')(?:st|nd|rd|th)?)?\\s*'+centuryUnit+'(?:\\s*('+era+')(?!\\s*[0-9]|[a-z]))?','gi');
function centuryRange(n,e){
 const c=Number(String(n).replace(/,/g,''));if(!Number.isSafeInteger(c)||c<1||c>99999)return null;
 return bc(e||'')?{from:-c*100,to:-(c-1)*100-1}:{from:(c-1)*100+1,to:c*100};
}
function centuries(text){
 text=String(text);centuryPattern.lastIndex=0;const out=[];let m;
 while((m=centuryPattern.exec(text))){
  if(/[A-Za-z0-9_.,]/.test(text[m.index-1]||''))continue;
  const e=m[1]||m[5]||'',first=centuryRange(m[2],e),last=m[4]?centuryRange(m[4],m[3]||e):first;if(!first||!last)continue;
  out.push({start:m.index,end:centuryPattern.lastIndex,text:m[0],from:Math.min(first.from,last.from),to:Math.max(first.to,last.to)});
 }
 return out;
}
function years(text){
 text=String(text);pattern.lastIndex=0;const out=[],blocked=centuries(text);let m;
 while((m=pattern.exec(text))){
  if(isCenturyTail(text,pattern.lastIndex)||blocked.some(c=>c.start<pattern.lastIndex&&c.end>m.index))continue;
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
 if(m){
  const n=Number(m[3]),type=m[2].toUpperCase(),e=m[1].toUpperCase(),title=m[4];
  const span=type==='C'?centuryRange(n,e):{from:year(n,e),to:year(n,e)};
  if(!span||!span.from||!span.to)throw Error('연표 제목의 연도/세기 번호가 올바르지 않습니다: '+line);
  const c=centuries(title).find(x=>x.start===0),y=years(title).find(x=>x.start===0);
  if((type==='Y'&&c)||(type==='C'&&y)||(c&&(c.from!==span.from||c.to!==span.to))||(y&&y.year!==span.from))throw Error('연표 제목의 표식과 연도/세기가 일치하지 않습니다: '+line);
  return {...span,title,key:e+'-'+type+m[3]};
 }
 if(identified)return null;
 const plain=line.replace(/^#{1,6}\s*/,'').replace(/^\[|\]$/g,'').trim();
 const c=centuries(plain).find(x=>x.start===0);
 if(c){const tail=plain.slice(c.end);if(tail&&!/^\s*(?:[|—–:]\s*[^\n]+)?$/.test(tail))return null;return {from:c.from,to:c.to,title:plain,key:'custom-century-'+c.from+'-'+c.to};}
 const found=years(plain.split(/\s+[—–:]\s*/)[0]);if(!found.length||found[0].start!==0)return null;
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
return {version:2,years,centuries,centuryRange,year,label,ordinal,heading,parseText,merge,nearest};
});
