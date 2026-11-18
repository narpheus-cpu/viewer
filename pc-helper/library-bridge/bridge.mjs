// Preserve the library's reader-tts protocol. Public ebook access is TTS-only.
const reader=window.parent;
const localOrigins=new Set(['null','file://',location.origin]);
const publicReader='https://narpheus-cpu.github.io';
let worker,readerOrigin,protocol;
function reply(message,transfer=[]){
  reader.postMessage({type:protocol,...message},readerOrigin==='null'||readerOrigin==='file://'?'*':readerOrigin,transfer);
}
addEventListener('message',({source,origin,data})=>{
  if(reader===window||source!==reader||!data)return;
  const library=data.type==='reader-tts'&&localOrigins.has(origin);
  const ebook=data.type==='ebook-speech'&&(origin===publicReader||localOrigins.has(origin));
  if(!library&&!ebook)return;
  if(protocol&&(protocol!==data.type||readerOrigin!==origin))return;
  protocol=data.type;readerOrigin=origin;
  if(data.action==='connect'){
    reply({action:'ready',capabilities:{native:true,library:true,rpc:false}});return;
  }
  if(data.action==='rpc'){
    reply({id:data.id,action:'error',message:'이 연결은 고속 낭독 전용입니다. MP3는 별도 PC 도우미를 사용해 주세요.'});return;
  }
  if(!['synthesize','cancel'].includes(data.action))return;
  if(ebook&&data.action==='synthesize'&&data.engine!=='native'){
    reply({id:data.id,action:'error',message:'기존 도서관 연결에서는 고속 방식만 지원합니다.'});return;
  }
  if(!worker&&data.action==='cancel')return;
  if(!worker){
    worker=new Worker('./speech.mjs',{type:'module'});
    worker.onmessage=({data:result})=>reply(result,result.samples?[result.samples]:[]);
    worker.onerror=({message})=>{
      reply({action:ebook?'error':'unavailable',message:message||'고속 합성 엔진 시작 실패'});
      worker.terminate();worker=null;
    };
  }
  worker.postMessage(data);
});
