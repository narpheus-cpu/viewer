const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const base=path.resolve(__dirname,'..');
const data=fs.readFileSync(path.join(base,'reader-insights-data.js'),'utf8');
const panel=fs.readFileSync(path.join(base,'reader-insights.js'),'utf8');
const memory=new Map();
const localStorage={getItem:k=>memory.has(k)?memory.get(k):null,setItem:(k,v)=>memory.set(k,String(v)),removeItem:k=>memory.delete(k)};
const context={};new Function('window','localStorage',data)(context,localStorage);
const D=context.ReaderInsightsData;
let checks=0;
function check(message,ok){assert.ok(ok,message);checks++;}
const book='a'.repeat(5000);
check('Initially 0% with no stored observation',D.getSeen(book)===0&&!D.getReadState(book).hasRecord);
D.markSeen(book,250);check('Visible first page end',D.getSeen(uiBook)===250);
D.setSeen(book,125);check('Correction backwards is honored',D.getSeen(book)===125);
D.markSeen(book,100);check('Automatic observer cannot reduce progress',D.getSeen(book)===125);
D.setSeen(book,0);check('Manual reset to zero keeps a real record',D.getReadState(book).seen===0&&D.getReadState(book).hasRecord);
const oldKey=[...memory.keys()][0];
check('Uses isolated v3 key rather than legacy v2 key',oldKey.startsWith('ebookViewerInsightsReadCursorV3:'));
const final=panel.lastIndexOf("if(document.readyState==='loading')");
assert.ok(final>0);
const setup="let fullText='a'.repeat(5000),pageIndex=0,pages=Array.from({length:20},(_,i)=>'page-'+i),pageAnchors=Array.from({length:20},(_,i)=>i*250),restoreInProgress=false; function readerCanonical(){return fullText;} function readerAnchor(){return pageAnchors[pageIndex];} function visiblePageCount(){return 1;} function readerLazyActive(){return false;} function htmlToStableText(){return 'a'.repeat(250);}\n";
const modified=panel.slice(0,final)+
 "window.__test={pageWindow,observe,prepareAdvance,finishAdvance,correctTo,getSelectedCursor,setPage:n=>pageIndex=n,setText:s=>fullText=s};\n})();";
const pageEl={id:'pageInnerLeft'};
const fakeDom={
 getElementById:id=>id==='viewerOverlay'?{classList:{contains:()=>true}}:null,
 createRange:()=>({setStart(){},setEnd(){},toString:()=> 'a'.repeat(150)})
};
const fakeWindow={ReaderInsightsData:D,getSelection:()=>null};
new Function('window','document',setup+modified)(fakeWindow,fakeDom);
const UI=fakeWindow.__test;
const uiBook='z'.repeat(5000);UI.setText(uiBook);UI.observe();
check('First displayed page unlocks only its end',D.getSeen(uiBook)===250);
UI.setPage(19);UI.observe();
check('Jump to last page does not mark 100%',D.getSeen(uiBook)===250);
check('Jumped position cannot be treated as sequential reading',UI.prepareAdvance().permitted===false);
UI.correctTo(350);check('Explicit manual sentence cutoff persists',D.getSeen(uiBook)===350);
UI.setPage(1);let ticket=UI.prepareAdvance();UI.setPage(2);UI.finishAdvance(ticket);
check('Contiguous next page advances progress',D.getSeen(uiBook)===750);
UI.correctTo(100);UI.observe();check('Backward correction is not immediately overwritten',D.getSeen(uiBook)===100);
UI.setPage(19);UI.observe();check('After correction, accidental end-page jump stays locked',D.getSeen(uiBook)===100);
UI.setText('b'.repeat(5000));UI.observe();check('New book ending opens at zero',D.getSeen('b'.repeat(5000))===0);
const range={endContainer:{nodeType:3,parentElement:{closest:()=>pageEl}},endOffset:5,toString:()=> 'a'.repeat(20)};
fakeWindow.getSelection=()=>({isCollapsed:false,rangeCount:1,getRangeAt:()=>range});
UI.setText(book);UI.setPage(0);
const selection=UI.getSelectedCursor();
check('Selected text maps to a canonical sentence-end position',!!selection&&selection.end>=20&&selection.end<=250);
console.log(checks+' reading-cursor unit assertions passed.');
