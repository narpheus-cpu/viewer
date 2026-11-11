const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const panel=fs.readFileSync(path.join(root,'reader-insights.js'),'utf8');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
const data=fs.readFileSync(path.join(root,'reader-insights-data.js'),'utf8');
const env={},storageItems=new Map();
const storage={getItem:k=>storageItems.has(k)?storageItems.get(k):null,setItem:(k,v)=>storageItems.set(k,String(v))};
new Function('window','localStorage',data)(env,storage);
const cutoff=panel.lastIndexOf("if(document.readyState==='loading')");
assert.ok(cutoff>0);
const modified=panel.slice(0,cutoff)+
 "window.__test={getSelectedCursor,selectToRead,prepareAdvance,finishAdvance,setPage:i=>pageIndex=i};\n})();";
const text='첫 번째 집에서 산 집은 오래된 집이었다. 민재는 그 집을 다시 찾아왔다.';
const pageEl={id:'pageInnerLeft'};
const node={nodeType:3,parentElement:{closest:()=>pageEl}};
let guessed=5,word='집',removed=false;
const range={startContainer:node,endContainer:node,endOffset:5,toString:()=>word};
const selection={isCollapsed:false,rangeCount:1,getRangeAt:()=>range,removeAllRanges:()=>{removed=true;}};
const notice={textContent:'',hidden:true,classList:{toggle(){}}};
const doc={
 getElementById:id=>id==='viewerOverlay'?{classList:{contains:()=>true}}:
  id==='readerInsightsSelectionNotice'?notice:null,
 createRange:()=>({setStart(){},setEnd(){},toString:()=>text.slice(0,guessed)})
};
const win={getSelection:()=>selection,ReaderInsightsData:env.ReaderInsightsData};
const setup="let fullText="+JSON.stringify(text)+",pageIndex=0,pages=['<p>text</p>','<p>text2</p>'],pageAnchors=[0,38],restoreInProgress=false;"+
 "function readerCanonical(){return fullText;}function readerAnchor(){return pageAnchors[pageIndex];}"+
 "function visiblePageCount(){return 1;}function readerLazyActive(){return false;}"+
 "function htmlToStableText(){return 'text';}\n";
new Function('window','document','setTimeout','clearTimeout',setup+modified)(win,doc,()=>1,()=>{});
let checks=0;
function check(msg,value){assert.ok(value,msg);checks++;}
const api=win.__test;
const first=api.getSelectedCursor();
check('One character maps to its first real occurrence',first?.end===text.indexOf('집')+1);
check('Clicking the action changes reading cutoff',api.selectToRead());
check('The selection is removed afterward',removed);
check('The requested success feedback is shown',notice.textContent.includes('이 페이지까지 읽은 지점으로 지정됨'));
check('Saved location is word-end, not page-end',env.ReaderInsightsData.getSeen(text)===first.end);
guessed=text.indexOf('집',text.indexOf('집')+1)+1;
const second=api.getSelectedCursor();
check('Repeated word picks the second occurrence',second?.end===guessed);
check('Repeated word overrides previous cutoff',api.selectToRead()&&env.ReaderInsightsData.getSeen(text)===second.end);
const ticket=api.prepareAdvance();check('A manual word cutoff permits next sequential page',ticket?.permitted);
api.setPage(1);api.finishAdvance(ticket);
check('Turning to the next page resumes automatic progress',env.ReaderInsightsData.getSeen(text)>second.end);
const start=index.indexOf('function readerGPTUpdateSelection(){'),end=index.indexOf('function readerGPTSetBusy(',start);
assert.ok(start>0&&end>start);
const fn=index.slice(start,end);
function evaluateMenu(android,native){
 const menu={hidden:true,offsetWidth:100,offsetHeight:40,style:{}};
 const action={hidden:true,offsetWidth:123,offsetHeight:40,style:{}};
 const run=new Function('window','readerGPTMenu','readerInsightsSelectionAction','readerGPTGetSelection','readerGPTAndroidWeb','viewerOverlay',
   'readerGPTIsOpen','readerTimelineIsOpen','readerNoteIsOpen','settingsPanelIsOpen','getSelection','visualViewport',
   "let readerGPTSelection='';"+fn+";readerGPTUpdateSelection();return {menu:readerGPTMenu,action:readerInsightsSelectionAction};");
 return run({AndroidChatGPT:{usesNativeSelectionMenu:()=>native}},menu,action,()=>word,()=>android,
  {classList:{contains:()=>true}},()=>false,()=>false,()=>false,()=>false,
  ()=>({getRangeAt:()=>({getBoundingClientRect:()=>({left:100,top:80,bottom:110})})}),
  {offsetLeft:0,offsetTop:0,width:390,height:700});
}
const desktop=evaluateMenu(false,false);
check('Desktop Web shows original ChatGPT and new read action',!desktop.menu.hidden&&!desktop.action.hidden);
const android=evaluateMenu(true,false);
check('Android browser shows read action without injecting into native menu',android.menu.hidden&&!android.action.hidden);
const native=evaluateMenu(false,true);
check('Native APK selection menu is left to Android',native.menu.hidden&&native.action.hidden);
console.log(checks+' reading selection action unit assertions passed.');
