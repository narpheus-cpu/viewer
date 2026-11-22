/* BEGIN bundled reader-speech-audio.js */
/* Local PCM playback with native pitch-preserving time stretching. */
(function(){
'use strict';
function wav(samples,sampleRate){
  const pcm=samples instanceof Float32Array?samples:new Float32Array(samples);
  const bytes=new ArrayBuffer(44+pcm.length*2),view=new DataView(bytes);
  const text=(offset,value)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));};
  text(0,'RIFF');view.setUint32(4,36+pcm.length*2,true);text(8,'WAVE');text(12,'fmt ');
  view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
  view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*2,true);
  view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,pcm.length*2,true);
  for(let i=0;i<pcm.length;i++){
    const value=Math.max(-1,Math.min(1,pcm[i]));view.setInt16(44+i*2,Math.round(value*(value<0?32768:32767)),true);
  }
  return new Blob([bytes],{type:'audio/wav'});
}
class ReaderSpeechAudio{
  constructor(context){
    this.context=context;this.speed=1;this.active=null;this.clips=new Set();this.unlocking=null;
    this.players=Array.from({length:2},()=>{
      const media=document.createElement('audio');media.preload='auto';media.crossOrigin='anonymous';
      media.setAttribute('playsinline','');media.setAttribute('aria-hidden','true');media.hidden=true;
      if(!['preservesPitch','webkitPreservesPitch','mozPreservesPitch'].some(key=>key in media))
        throw Error('이 브라우저에서는 음높이를 유지하는 낭독을 지원하지 않습니다. 브라우저를 업데이트해 주세요.');
      for(const key of ['preservesPitch','webkitPreservesPitch','mozPreservesPitch'])if(key in media)media[key]=true;
      document.body.append(media);
      const output=context.createMediaElementSource(media);output.connect(context.destination);
      return{media,output,clip:null};
    });
  }
  unlock(){
    if(this.unlocking)return this.unlocking;
    const url=URL.createObjectURL(wav(new Float32Array(1600),16000));
    // Both reusable elements are primed by the actual Listen/Resume gesture.
    const plays=this.players.map(({media})=>{media.src=url;media.load();return media.play();});
    this.unlocking=Promise.all(plays).then(()=>{
      for(const{media}of this.players){media.pause();media.removeAttribute('src');media.load();}
    }).catch(error=>{this.unlocking=null;throw error;}).finally(()=>URL.revokeObjectURL(url));
    return this.unlocking;
  }
  setSpeed(value){
    this.speed=value;
    for(const{media}of this.players){media.defaultPlaybackRate=value;media.playbackRate=value;}
  }
  prepare(audio){
    const slot=this.players.find(player=>!player.clip);
    if(!slot)throw Error('낭독 재생 대기 한도를 초과했습니다.');
    const url=URL.createObjectURL(wav(audio.samples,audio.sampleRate));
    const clip={slot,media:slot.media,url,duration:audio.samples.byteLength/4/audio.sampleRate,finish:null,
      stop:()=>slot.media.pause()};
    slot.clip=clip;this.clips.add(clip);slot.media.src=url;slot.media.load();
    slot.media.defaultPlaybackRate=this.speed;slot.media.playbackRate=this.speed;
    return clip;
  }
  play(clip,paused=false){
    this.active=clip;
    return new Promise((resolve,reject)=>{
      const{media}=clip;
      const finish=error=>{
        if(!clip.finish)return;
        clip.finish=null;media.onended=null;media.onerror=null;
        if(this.active===clip)this.active=null;
        this.release(clip);error?reject(error):resolve();
      };
      clip.finish=finish;
      media.onended=()=>{if(media.currentSrc===clip.url&&media.ended)finish();};
      media.onerror=()=>{if(media.currentSrc===clip.url&&media.error)finish(Error('낭독 음성을 재생할 수 없습니다. '+media.error.message));};
      if(!paused)media.play().catch(error=>{
        if(clip.finish&&this.active===clip&&!(error.name==='AbortError'&&media.paused))finish(error);
      });
    });
  }
  pause(){this.active?.media.pause();}
  async resume(){if(this.active)await this.active.media.play();}
  release(clip){
    if(!this.clips.delete(clip))return;
    const{slot,media}=clip;
    if(slot.clip===clip){media.pause();media.removeAttribute('src');media.load();slot.clip=null;}
    URL.revokeObjectURL(clip.url);
  }
  stop(){
    for(const clip of [...this.clips]){
      if(clip.finish)clip.finish();else this.release(clip);
    }
    this.active=null;
  }
}
window.ReaderSpeechAudio=ReaderSpeechAudio;
})();
/* END bundled reader-speech-audio.js */

/* Supertonic 3 reader integration. Sentence positions use the existing canonical text. */
(function () {
'use strict';
const $ = id => document.getElementById(id);
const ORIGIN = 'http://127.0.0.1:18766';
const LIBRARY_ORIGIN = 'http://127.0.0.1:38479';
const STORAGE = 'ebookViewerSpeechOptionsV1';
const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const directBrowser = /^https?:$/.test(location.protocol) && isSecureContext && location.origin !== ORIGIN;
const defaults = {engine:mobile?'browser':'native',voice:'M1',language:'auto',highlight:'pastel',showNotes:true,skipBrackets:false,speed:1,viewMode:'book',
  mp3Model:'supertonic3',mp3Voice:'F1',mp3Bitrate:'128',mp3Split:false,
  panelOpen:false,mp3Scope:'all',mp3From:0,mp3To:null};
const voices = ['M','F'].flatMap(sex => [1,2,3,4,5].map(n =>
  `<option value="${sex}${n}">${sex==='M'?'남성':'여성'} ${n}</option>`)).join('');
const toolbar = document.createElement('section');
toolbar.id = 'speechToolbar';
toolbar.setAttribute('aria-label','오프라인 낭독');
toolbar.innerHTML = `
 <div class="speech-main-actions">
  <button id="speechPrevious" type="button" aria-label="이전 문장">&lt;&lt;</button>
  <button id="speechNext" type="button" aria-label="다음 문장">&gt;&gt;</button>
  <button id="speechListen" type="button">듣기</button>
  <button id="speechPause" type="button" disabled>일시중지</button>
  <button id="speechStop" type="button">중지</button>
 </div>
 <details id="speechSettings">
 <summary id="speechSettingsToggle">듣기 설정<span id="speechCompactStatus" role="status" aria-live="polite"></span></summary>
 <div class="speech-settings-body">
 <div class="speech-actions">
  <button id="speechPickSentence" type="button">시작 문장 선택</button>
  <button id="readerMp3Open" type="button">MP3 만들기</button>
  <button id="speechPrepare" type="button">낭독 파일 저장</button>
  <button id="speechPrepareCancel" type="button" hidden>파일 저장 취소</button>
 </div>
 <div class="speech-options">
  <label>낭독 방식 <select id="speechEngine"><option value="native">Supertonic 3 · 오프라인 고속</option><option value="browser">Supertonic 3 · 오프라인 브라우저</option></select></label>
  <label>목소리 <select id="speechVoice">${voices}</select></label>
  <label>언어 <select id="speechLanguage"><option value="auto">자동</option><option value="ko">한국어</option><option value="en">영어</option><option value="ja">일본어</option></select></label>
  <label>속도 <span class="speech-speed-control"><input id="speechSpeed" type="range" min="0.5" max="2" step="0.05" value="1" aria-label="낭독 속도"><output id="speechSpeedValue" for="speechSpeed">1.00배</output></span></label>
  <label>보기 <select id="speechViewMode"><option value="book">전자책</option><option value="sentence">한문장</option></select></label>
  <label>강조 <select id="speechHighlight"><option value="pastel">파스텔</option><option value="inverse">흑백반전</option><option value="underline">밑줄</option></select></label>
  <label class="speech-checkbox-option"><input id="speechSkipBrackets" type="checkbox"> ( )·〔 〕 안 내용 읽지 않기</label>
 </div>
 <p class="speech-option-help">선택하면 (… )·〔…〕 안의 내용을 낭독과 MP3에서 제외합니다. 본문 표시는 유지됩니다.</p>
 <div id="speechStatus" role="status" aria-live="polite"></div>
 <div id="speechAssetStatus" role="status"></div>
 <progress id="speechAssetProgress" max="100" hidden></progress>
 <div id="speechOptionsStatus" role="status"></div>
 </div></details>`;
const localLink=document.createElement('a');
localLink.id='speechLocalOpen';localLink.href=ORIGIN;
localLink.target='_blank';localLink.rel='noopener';
localLink.textContent='로컬 실행 화면 열기';localLink.hidden=true;
toolbar.querySelector('.speech-settings-body').append(localLink);
$('chapterNav').before(toolbar);
const singleButton=document.createElement('button');
singleButton.id='openSentenceViewerBtn';singleButton.type='button';singleButton.className='primary';
singleButton.textContent='한문장으로 보기';
$('openViewerBtn').after(singleButton);
singleButton.onclick=async()=>{remember('viewMode','sentence');applyPreferences();await openViewer();};
$('openViewerBtn').addEventListener('click',()=>{remember('viewMode','book');applyPreferences();},{capture:true});
const sentenceView=document.createElement('section');
sentenceView.id='sentenceReading';sentenceView.hidden=true;
sentenceView.innerHTML='<div id="sentenceText"></div><div class="sentence-navigation"><button type="button" id="sentencePrevious">이전 문장</button><button type="button" id="sentenceNext">다음 문장</button></div>';
$('pageSpread').append(sentenceView);
sentenceView.addEventListener('pointerdown',event=>event.stopPropagation());
sentenceView.addEventListener('click',event=>event.stopPropagation());
$('sentencePrevious').onclick=()=>void move(-1);
$('sentenceNext').onclick=()=>void move(1);
const noteLabel = document.createElement('label');
noteLabel.className = 'reader-spacing-option';
noteLabel.innerHTML = '<input id="viewerBracketNotes" type="checkbox" checked> 〔 〕 안의 주석 표시';
$('viewerSettings').querySelector('.settings-footer').before(noteLabel);
const picker = document.createElement('dialog');
picker.id = 'speechSentenceDialog';
picker.innerHTML = '<header><strong>시작 문장 선택</strong><button type="button" id="speechPickerClose">닫기</button></header><div id="speechSentenceList"></div>';
document.body.append(picker);
$('speechPickerClose').onclick = () => picker.close();
const mp3 = document.createElement('dialog');
mp3.id = 'readerMp3Dialog';
mp3.innerHTML = `
 <header><strong>선택 구간 MP3 만들기</strong><button id="readerMp3Close" type="button">닫기</button></header>
 <label>모델 <select id="readerMp3Model"><option value="supertonic3">Supertonic 3 · 오프라인 고속</option></select></label>
 <label>목소리 <select id="readerMp3Voice">${voices}</select></label>
 <label>비트레이트 <select id="readerMp3Bitrate"><option value="96">96 kbps</option><option value="128">128 kbps</option></select></label>
 <label>대상 <select id="readerMp3Scope"><option value="all">전체구간</option><option value="range">구간 선택</option></select></label>
 <div id="readerMp3Range" hidden><label>시작 <select id="readerMp3From"></select></label><label>끝 <select id="readerMp3To"></select></label></div>
 <label><input id="readerMp3Split" type="checkbox"> 구간별 MP3를 ZIP으로 받기</label>
 <p>체크를 해제하면 선택한 구간을 하나의 MP3로 만듭니다.</p>
 <progress id="readerMp3Progress" max="100" hidden></progress><span id="readerMp3Percent"></span>
 <div id="readerMp3Status" role="status" aria-live="polite"></div>
 <div class="speech-actions"><button id="readerMp3Start" type="button">만들기</button><button id="readerMp3Cancel" type="button" disabled>취소</button><a id="readerMp3Download" hidden download>다운로드</a></div>`;
document.body.append(mp3);

let preferences = {};
let revision = Date.now() * 1000;
let serial = 0, nativeHelperOrigin;
const helperConnections=new Map(),helperFrames=new Map();
const requests = new Map();
let source = null, blockCache = new Map(), noteCache = new Map();
let selected = null, session = null, audioContext = null, speechAudio = null, generation = 0, pendingListen = 0;
const status = text => { $('speechStatus').textContent = text; };
const optionStatus = text => { $('speechOptionsStatus').textContent = text; };
const settings = () => {
  const value=Object.fromEntries(Object.entries(defaults).map(([key,fallback]) =>
    [key, preferences[key]?.value ?? fallback]));
  if(mobile)value.engine='browser';
  value.speed=normalizeSpeed(value.speed);
  return value;
};
const controls = {engine:'speechEngine',voice:'speechVoice',language:'speechLanguage',highlight:'speechHighlight',speed:'speechSpeed',viewMode:'speechViewMode',
  showNotes:'viewerBracketNotes',skipBrackets:'speechSkipBrackets',mp3Model:'readerMp3Model',mp3Voice:'readerMp3Voice',
  mp3Bitrate:'readerMp3Bitrate',mp3Split:'readerMp3Split',mp3Scope:'readerMp3Scope',
  mp3From:'readerMp3From',mp3To:'readerMp3To'};
const speechSettings=$('speechSettings');
$('speechSettingsToggle').addEventListener('click',()=>{
  // Save the native summary's upcoming state before another option can apply
  // preferences; the details toggle event is dispatched asynchronously.
  remember('panelOpen',!speechSettings.open);
});
speechSettings.addEventListener('toggle',()=>{
  if(speechSettings.open!==settings().panelOpen)remember('panelOpen',speechSettings.open);
  updateCompactStatus();
});
document.addEventListener('pointerdown',event=>{
  if(speechSettings.open&&!toolbar.contains(event.target)){
    remember('panelOpen',false);speechSettings.open=false;
  }
});
function updateCompactStatus(){
  const message=$('speechStatus').textContent;
  const problem=[message,$('speechAssetStatus').textContent,$('speechOptionsStatus').textContent].some(text=>/실패|초과|못했/.test(text));
  const preparing=$('speechPrepare').disabled;
  $('speechCompactStatus').textContent=speechSettings.open?'':
    problem?' · 확인 필요':preparing?' · 파일 저장 중':message?' · '+message.replace(/^Supertonic 3 /,'').slice(0,22):'';
}
const speechStatusObserver=new MutationObserver(updateCompactStatus);
for(const id of ['speechStatus','speechAssetStatus','speechOptionsStatus'])
  speechStatusObserver.observe($(id),{childList:true,subtree:true,characterData:true});
speechStatusObserver.observe($('speechPrepare'),{attributes:true,attributeFilter:['disabled']});
if (mobile) {
  const option = $('speechEngine').querySelector('[value="native"]');
  option.disabled = true;option.textContent += ' (PC용)';
  $('readerMp3Open').textContent = 'MP3 만들기 (PC용)';
  $('readerMp3Open').disabled = true;
  $('readerMp3Open').title = 'PC의 오프라인 고속 도우미에서 사용할 수 있습니다.';
} else if (directBrowser) {
  $('speechEngine').querySelector('[value="native"]').textContent += ' (PC 도우미 필요)';
}
const appOfflineReady = directBrowser && 'serviceWorker' in navigator
  ? navigator.serviceWorker.register('./reader-sw.js').then(() => navigator.serviceWorker.ready)
  : Promise.resolve();
appOfflineReady.catch(error => optionStatus('오프라인 화면 저장 실패 · ' + error.message));

let browserWorker, browserAssetsReady=false;
const browserJobs = new Map();
function browserRequest(action, data = {}) {
  if (!directBrowser) return request(action,data);
  if (!browserWorker) {
    browserWorker = new Worker(new URL('./supertonic3/browser-worker.mjs?v=3', document.baseURI), {type:'module'});
    browserWorker.onmessage = ({data:message}) => {
      const job = browserJobs.get(message.id);
      if (!job) return;
      if (message.action === 'progress') {
        if(browserAssetsReady&&job.action==='synthesize')return;
        const percent = Math.min(99,Math.floor(message.loaded / message.total * 100));
        $('speechAssetProgress').hidden = false;$('speechAssetProgress').value = percent;
        $('speechAssetStatus').textContent = `낭독 파일 저장 ${percent}% · ${Math.floor(message.loaded/1048576)}/${Math.ceil(message.total/1048576)} MB`;
        return;
      }
      if (message.action === 'model-progress') {status(message.message);return;}
      clearTimeout(job.timer);browserJobs.delete(message.id);
      if (message.action === 'error') job.reject(Error(message.message));
      else {
        if (message.action === 'audio' || job.action === 'prepare') {
          browserAssetsReady=true;
          $('speechAssetProgress').hidden = true;
          $('speechAssetStatus').textContent = '브라우저용 낭독 파일 저장됨 · 브라우저 방식에서 사용';
        }
        job.resolve(message.action === 'result' ? message.result : message);
      }
    };
    browserWorker.onerror = event => {
      for (const job of browserJobs.values()) {clearTimeout(job.timer);job.reject(Error('이 브라우저에서 낭독을 시작하지 못했습니다. ' + event.message));}
      browserJobs.clear();browserWorker.terminate();browserWorker = null;
    };
  }
  return new Promise((resolve,reject) => {
    const id = ++serial;
    const timer = setTimeout(() => {
      browserJobs.delete(id);reject(Error('낭독 준비 시간이 초과됐습니다. 저장 공간과 연결 상태를 확인해 주세요.'));
    }, action === 'check' ? 30000 : 1800000);
    browserJobs.set(id,{resolve,reject,timer,action});
    browserWorker.postMessage({action,id,...data});
  });
}
$('speechPrepare').hidden = !directBrowser;
$('speechPrepare').title = '브라우저 낭독에 필요한 파일을 이 기기에 저장합니다. 고속 방식에서는 브라우저 방식으로 전환합니다.';
$('speechPrepare').onclick = async () => {
  if (settings().engine !== 'browser') {
    stop(false);remember('engine','browser');applyPreferences();
    status('오프라인 브라우저 방식으로 전환했습니다.');
  }
  localLink.hidden = true;
  $('speechPrepare').disabled = true;$('speechPrepareCancel').hidden = false;
  $('speechAssetStatus').textContent = '낭독 파일 확인 중… 처음에는 약 394 MB를 저장합니다. Wi-Fi 사용을 권장합니다.';
  try {
    await appOfflineReady;
    const persistent = await navigator.storage?.persist?.().catch(() => false);
    await browserRequest('prepare');
    if (persistent === false) $('speechAssetStatus').textContent += ' · 브라우저 데이터 삭제 시 다시 저장해야 합니다.';
  } catch (error) {
    $('speechAssetProgress').hidden = true;
    $('speechAssetStatus').textContent = '낭독 파일 저장 실패 · ' + error.message;
  } finally {$('speechPrepare').disabled = false;$('speechPrepareCancel').hidden = true;}
};
$('speechPrepareCancel').onclick = () => browserWorker?.postMessage({action:'cancel-prepare'});

function applyPreferences() {
  const value = settings();
  const notesChanged=viewerSettings.showBracketNotes!==value.showNotes;
  for (const [key,id] of Object.entries(controls)) {
    const control = $(id);
    if (control.type === 'checkbox') control.checked = value[key];
    else if (control.type === 'range') control.value = String(value[key]);
    else if ([...control.options].some(option => option.value === String(value[key]))) control.value = value[key];
  }
  speechSettings.open=value.panelOpen;
  $('readerMp3Range').hidden=value.mp3Scope!=='range';
  document.documentElement.dataset.speechHighlight = value.highlight;
  $('speechPrepare').hidden = !directBrowser;
  document.documentElement.classList.toggle('speech-hide-notes', !value.showNotes);
  viewerSettings.showBracketNotes = value.showNotes;
  applySpeechSpeed();
  paint();
  if(notesChanged&&viewerOverlay.classList.contains('active'))scheduleRepaginate();
}
function normalizeSpeed(value){
  const number=Number(value);
  return Number.isFinite(number)?Math.round(Math.min(2,Math.max(0.5,number))*20)/20:1;
}
function applySpeechSpeed(){
  const speed=settings().speed;
  $('speechSpeed').value=String(speed);
  $('speechSpeed').setAttribute('aria-valuetext',speed.toFixed(2)+'배');
  $('speechSpeedValue').value=speed.toFixed(2)+'배';
  if(session){
    session.options.speed=speed;
  }
  speechAudio?.setSpeed(session?.phase&&session.phase!=='speech'?1:speed);
}
function mergePreferences(value) {
  for (const [key,item] of Object.entries(value || {})) {
    if (key in defaults && item && Number.isFinite(item.revision) &&
        item.revision > (preferences[key]?.revision || 0)) preferences[key] = item;
  }
}
function saveLocal() {
  try {
    mergePreferences(JSON.parse(localStorage.getItem(STORAGE)||'{}'));
    localStorage.setItem(STORAGE, JSON.stringify(preferences));
    return true;
  } catch (error) {
    optionStatus('듣기 옵션을 보조 저장소에 저장하는 중…');
    return false;
  }
}
let preferenceDatabase;
const preferenceDatabaseReady=new Promise((resolve,reject)=>{
  try{
    const opening=indexedDB.open('ebookViewerSpeechPreferencesV1',1);
    opening.onupgradeneeded=()=>opening.result.createObjectStore('options');
    opening.onsuccess=()=>{preferenceDatabase=opening.result;resolve(preferenceDatabase);};
    opening.onerror=()=>reject(opening.error||Error('듣기 옵션 저장소 열기 실패'));
    opening.onblocked=()=>reject(Error('듣기 옵션 저장소가 다른 창에 의해 잠겨 있습니다.'));
  }catch(error){reject(error);}
});
preferenceDatabaseReady.catch(()=>{});
function writePreferenceDatabase(){
  if(!preferenceDatabase)return preferenceDatabaseReady.then(writePreferenceDatabase);
  return new Promise((resolve,reject)=>{
    try{
      let tx;
      try{tx=preferenceDatabase.transaction('options','readwrite',{durability:'strict'});}
      catch{tx=preferenceDatabase.transaction('options','readwrite');}
      tx.objectStore('options').put(JSON.parse(JSON.stringify(preferences)),'latest');
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('옵션 저장 취소'));
    }catch(error){reject(error);}
  });
}
const databasePreferences=preferenceDatabaseReady.then(db=>new Promise((resolve,reject)=>{
  const tx=db.transaction('options','readonly');const read=tx.objectStore('options').get('latest');
  read.onsuccess=()=>resolve(read.result);read.onerror=()=>reject(read.error);
}));
try { mergePreferences(JSON.parse(localStorage.getItem(STORAGE) || '{}')); }
catch (error) { optionStatus('듣기 옵션을 보조 저장소에서 불러오는 중…'); }
applyPreferences();
if (directBrowser && settings().engine === 'browser') {
  $('speechAssetStatus').textContent = '처음에는 [낭독 파일 저장]을 눌러 주세요. 약 395 MB · 본문은 이 기기 안에서 처리됩니다.';
  browserRequest('check').then(info => {
    if (info.ready) {browserAssetsReady=true;$('speechAssetStatus').textContent = '브라우저용 낭독 파일 저장됨 · 브라우저 방식에서 사용';}
  }).catch(error => {$('speechAssetStatus').textContent = '낭독 파일 확인 실패 · ' + error.message;});
}

function connectTo(origin) {
  if (helperConnections.has(origin)) return helperConnections.get(origin);
  const connecting = new Promise((resolve,reject) => {
    const frame = document.createElement('iframe');
    frame.hidden = true;
    frame.title = 'Supertonic 3 로컬 도우미';
    frame.allow = 'local-network-access; local-network; loopback-network';
    frame.src = origin + '/supertonic3/bridge.html?ebook=1';
    helperFrames.set(origin,frame);
    const timer = setTimeout(() => {
      removeEventListener('message',ready);
      frame.remove();helperFrames.delete(origin);helperConnections.delete(origin);
      reject(Error('PC 도우미 연결 실패: '+origin));
    }, 4000);
    const ready = event => {
      if (event.origin !== origin || event.source !== frame.contentWindow ||
          event.data?.type !== 'ebook-speech' || event.data.action !== 'ready') return;
      clearTimeout(timer);removeEventListener('message',ready);resolve({frame,origin});
      localLink.hidden=true;
    };
    addEventListener('message',ready);
    frame.onload = () => frame.contentWindow.postMessage({type:'ebook-speech',action:'connect'},origin);
    document.body.append(frame);
  });
  helperConnections.set(origin,connecting);
  return connecting;
}
async function connect(action,engine){
  if(action!=='synthesize'||engine!=='native')return connectTo(ORIGIN);
  // The library helper starts with Windows; reuse it before the optional host.
  for(const origin of [LIBRARY_ORIGIN,ORIGIN]){
    try{const connection=await connectTo(origin);nativeHelperOrigin=origin;return connection;}
    catch{}
  }
  localLink.hidden=settings().engine==='browser';
  throw Error('고속 도우미에 연결하지 못했습니다. 기존 도서관 도우미 실행 상태와 이 사이트의 로컬 네트워크 접근 허용을 확인해 주세요.');
}
addEventListener('message', event => {
  if (event.source !== helperFrames.get(event.origin)?.contentWindow || event.data?.type !== 'ebook-speech') return;
  const message = event.data, request = requests.get(message.id);
  if (!request) {
    if(message.action==='error'){
      for(const [id,item] of requests)if(item.action==='synthesize'){
        clearTimeout(item.timer);item.reject(Error(message.message));requests.delete(id);
      }
    }
    return;
  }
  if (message.action === 'progress') {
    if (session && !session.paused) status(`모델 준비 중 ${message.loaded}/${message.total}`);
    return;
  }
  clearTimeout(request.timer);requests.delete(message.id);
  if (message.action === 'error') request.reject(Error(message.message));
  else request.resolve(message.action === 'result' ? message.result : message);
});
async function request(action, data = {}) {
  const connection = await connect(action,data.engine);
  if(action==='synthesize'&&data.generation!==session?.generation)
    throw new DOMException('낭독 중지','AbortError');
  return new Promise((resolve,reject) => {
    const id = ++serial;
    const timer = setTimeout(() => {
      requests.delete(id);reject(Error('로컬 도우미 응답 시간이 초과됐습니다.'));
    }, action === 'synthesize' ? 180000 : 20000);
    requests.set(id,{resolve,reject,timer,action});
    connection.frame.contentWindow.postMessage({type:'ebook-speech',action,id,...data},connection.origin);
  });
}
const rpc = (path,body = {}) => request('rpc',{path,body});
const databasePreferenceReady=databasePreferences.then(saved=>{
  mergePreferences(saved);applyPreferences();
  const local=saveLocal();
  return writePreferenceDatabase().then(()=>{if(!local)optionStatus('듣기 옵션을 보조 저장소에 저장했습니다.');});
}).catch(error=>{
  if(!saveLocal())optionStatus('듣기 옵션 불러오기·저장 실패 · '+error.message);
});
let preferenceReady = Promise.all([databasePreferenceReady,(mobile || directBrowser ? Promise.resolve() : rpc('/preferences').then(async remote => {
  mergePreferences(remote);applyPreferences();saveLocal();
  if (Object.keys(preferences).length) await rpc('/preferences',{patch:preferences});
}).catch(error => optionStatus('듣기 옵션은 이 브라우저에 저장됩니다. ' + error.message)))]);
function remember(key,value) {
  try{mergePreferences(JSON.parse(localStorage.getItem(STORAGE)||'{}'));}catch{}
  revision = Math.max(Date.now()*1000,revision+1,...Object.values(preferences).map(item => item.revision+1));
  const patch = {[key]:{value,revision}};
  Object.assign(preferences,patch);
  const local = saveLocal();
  void writePreferenceDatabase().then(()=>{
    if(!local)optionStatus('듣기 옵션을 보조 저장소에 저장했습니다.');
  }).catch(error=>{if(!local)optionStatus('듣기 옵션 저장 실패 · '+error.message);});
  if (mobile || directBrowser) {
    if (local) optionStatus('');
    return;
  }
  request('rpc',{path:'/preferences',body:{patch}}).then(() => {
    optionStatus(local ? '' : '듣기 옵션을 로컬 도우미에 저장했습니다.');
  }).catch(error => optionStatus((local ? '브라우저에는 저장됐습니다. 도우미 저장 실패 · ' : '옵션 저장 실패 · ') + error.message));
}
for (const [key,id] of Object.entries(controls)) {
  $(id).addEventListener(key==='speed'?'input':'change', async () => {
    const previous = settings();
    remember(key,$(id).type === 'checkbox' ? $(id).checked : key==='speed'?normalizeSpeed($(id).value):['mp3From','mp3To'].includes(key)?Number($(id).value):$(id).value);
    if(key==='speed')applySpeechSpeed();else applyPreferences();
    if (key === 'showNotes' || key === 'skipBrackets') {
      noteCache.clear();blockCache.clear();
      if(key==='showNotes'){saveViewerSettings();readerCloseNote();}
      if (session) {
        const entry = session.entry, paused = session.paused;
        stop(false);await start(atAnchor(entry.start),paused);
      } else if(selected) {selected=atAnchor(selected.start);paint();}
      if (key==='showNotes' && previous.showNotes !== settings().showNotes) scheduleRepaginate();
    }
  });
}
addEventListener('storage',event=>{
  if(event.key!==STORAGE||!event.newValue)return;
  try{mergePreferences(JSON.parse(event.newValue));applyPreferences();void writePreferenceDatabase().catch(()=>{});}catch{}
});

function refreshBook() {
  if (source === fullText) return;
  stop(false);source = fullText;selected = null;blockCache.clear();noteCache.clear();
}
function language(text) {
  if (settings().language !== 'auto') return settings().language;
  if (/[가-힣ᄀ-ᇿ]/u.test(text)) return 'ko';
  if (/[ぁ-ヿ]/u.test(text)) return 'ja';
  return /[\u3400-\u9fff]/u.test(text) ? 'ko' : 'en';
}
function withoutNotes(text) {
  const ranges = readerFindNoteRanges(text);
  let result = '', at = 0;
  for (const item of ranges) { result += text.slice(at,item.start);at = item.end; }
  return result + text.slice(at);
}
// Match the two opt-in narration exclusions without changing source offsets.
const speechBracketPairs = new Map([['(',')'],['〔','〕']]);
const speechBracketClosers=new Set(speechBracketPairs.values());
let speechBracketSource=null,speechBracketRanges=[];
function findSpeechBracketRanges(text){
  const stack=[],ranges=[];
  for(let at=0;at<text.length;at++){
    const character=text[at];
    if(speechBracketPairs.has(character))stack.push({start:at,end:speechBracketPairs.get(character),count:ranges.length});
    else if(speechBracketClosers.has(character)&&stack.at(-1)?.end===character){
      const opening=stack.pop();
      ranges.length=opening.count;ranges.push({start:opening.start,end:at+1});
    }
  }
  return ranges;
}
function maskSpeechBrackets(text,base){
  if(!settings().skipBrackets)return text;
  const canonical=readerCanonical();
  if(speechBracketSource!==canonical){speechBracketSource=canonical;speechBracketRanges=findSpeechBracketRanges(canonical);}
  // Slice the full-book ranges, retaining exact source offsets across sentences,
  // pages, Markdown blocks and export sections. Unmatched brackets retain text.
  const ranges=speechBracketRanges,end=base+text.length;
  let lo=0,hi=ranges.length;
  while(lo<hi){const mid=(lo+hi)>>>1;if(ranges[mid].end<=base)lo=mid+1;else hi=mid;}
  const parts=[];let at=0;
  for(let index=lo;index<ranges.length&&ranges[index].start<end;index++){
    const left=Math.max(0,ranges[index].start-base),right=Math.min(text.length,ranges[index].end-base);
    parts.push(text.slice(at,left),' '.repeat(right-left));at=right;
  }
  if(!parts.length)return text;
  parts.push(text.slice(at));return parts.join('');
}
function notesForBlock(index) {
  if (noteCache.has(index)) return noteCache.get(index);
  const root = document.createElement('div');
  root.innerHTML = cachedOriginalBlocks[index] || '';
  const results = [];
  let offset = 0;
  function walk(node) {
    if (node.nodeType === 3) { offset += node.length;return; }
    if (node.nodeName === 'BR') { if (!node.hasAttribute('data-reader-break')) offset++;return; }
    for (const child of node.childNodes) walk(child);
    if (node.hasAttribute?.('data-reader-note') && !node.hasAttribute('data-reader-pronunciation'))
      results.push({offset,text:' ' + node.getAttribute('data-reader-note') + ' '});
  }
  walk(root);
  if (noteCache.size > 32) noteCache.delete(noteCache.keys().next().value);
  noteCache.set(index,results);
  return results;
}
function spokenText(block,left,right) {
  let text = maskSpeechBrackets(cachedBlockTexts[block].slice(left,right),(cachedBlockStarts[block]||0)+left);
  if (settings().showNotes && !settings().skipBrackets) {
    for (const item of notesForBlock(block).filter(n => n.offset > left && n.offset <= right).reverse())
      text = text.slice(0,item.offset-left) + item.text + text.slice(item.offset-left);
  } else text = withoutNotes(text);
  return text.replace(/※/g,'').replace(/\s+/g,' ').trim();
}
function titleType(block){
  const match=(cachedOriginalBlocks[block]||'').match(/data-reader-title="(plain|bracket)"/);
  return match?.[1]||null;
}
function sentences(block) {
  if (blockCache.has(block)) return blockCache.get(block);
  const text = cachedBlockTexts[block] || '', base = cachedBlockStarts[block] || 0;
  let boundaryText=maskSpeechBrackets(text,base);
  if(!settings().showNotes){
    for(const note of readerFindNoteRanges(text).reverse())
      boundaryText=boundaryText.slice(0,note.start)+' '.repeat(note.end-note.start)+boundaryText.slice(note.end);
  }
  const title=titleType(block);
  const boundaries = title ? [text.length] : readerSentenceEnds(boundaryText,cachedQuoteRoles,base);
  if(!title){
    // A speaker label and its quoted dialogue can share a paragraph.
    // Keep the canonical position of the opening quote as a sentence boundary.
    const labels=/(?:^|\n)[ \t]*[\p{L}\p{N}_ ·\-]{1,48}[:：][ \t]*(?:\n[ \t]*)+(?=["“])/gu;
    for(const match of boundaryText.matchAll(labels))boundaries.push(match.index+match[0].length);
  }
  const ends=[...new Set(boundaries)].sort((a,b)=>a-b);
  if (ends.at(-1) !== text.length) ends.push(text.length);
  const result = [];
  let left = 0;
  for (const end of ends) {
    let start = left, right = end;
    while (start < right && /\s/.test(boundaryText[start])) start++;
    while (right > start && /\s/.test(boundaryText[right-1])) right--;
    const summary=text.slice(left,end).indexOf('(3줄 요약)');
    if(summary>=0){start=Math.min(start,left+summary);right=Math.max(right,left+summary+'(3줄 요약)'.length);}
    if (/[\p{L}\p{N}]/u.test(boundaryText.slice(start,right)) || summary>=0)
      result.push({block,left:start,right,start:base+start,end:base+right,title});
    left = end;
  }
  if (blockCache.size >= 32) blockCache.delete(blockCache.keys().next().value);
  blockCache.set(block,result);
  return result;
}
function atAnchor(anchor) {
  if(cachedMarkdownSource!==fullText)getPaginationBlocks(fullText);
  let lo = 0, hi = cachedBlockStarts.length-1;
  while (lo < hi) {
    const mid = Math.ceil((lo+hi)/2);
    if (cachedBlockStarts[mid] <= anchor) lo = mid;else hi = mid-1;
  }
  for (let block=lo;block<cachedBlockTexts.length;block++) {
    const entry = sentences(block).find(item => item.end > anchor);
    if (entry) return entry;
  }
  return null;
}
function adjacent(entry,direction) {
  if (!entry) return atAnchor(pageAnchors[pageIndex] || 0);
  for (let block=entry.block;block>=0 && block<cachedBlockTexts.length;block+=direction) {
    const items = sentences(block).filter(item => block !== entry.block ||
      (direction > 0 ? item.start > entry.start : item.start < entry.start));
    const target = direction > 0 ? items[0] : items.at(-1);
    if (target) return target;
  }
  return null;
}
function* chunks(text) {
  let rest = text;
  while (rest) {
    let part = Array.from(rest).slice(0,115).join('');
    if (part.length < rest.length) {
      const boundary = Math.max(part.lastIndexOf(' '),part.lastIndexOf('。'),part.lastIndexOf('. '));
      if (boundary > part.length/2) part = part.slice(0,boundary+1);
    }
    if (/[\p{L}\p{N}]/u.test(part)) yield part.trim();
    rest = rest.slice(part.length).trimStart();
  }
}
function clearHighlight() {
  globalThis.CSS?.highlights?.delete('speech-current-sentence');
  for (const mark of document.querySelectorAll('mark.speech-sentence')) {
    const parent = mark.parentNode;mark.replaceWith(...mark.childNodes);parent.normalize();
  }
}
function renderSentenceView(){
  const enabled=settings().viewMode==='sentence';
  $('pageSpread').classList.toggle('sentence-mode',enabled);
  sentenceView.hidden=!enabled;
  if(!enabled||!pages.length||source!==fullText)return;
  const entry=session?.entry||selected||atAnchor(readerAnchor());
  if(!entry){$('sentenceText').replaceChildren();return;}
  const style=getComputedStyle(pageInnerLeft);
  for(const key of ['fontFamily','fontSize','lineHeight','letterSpacing'])
    $('sentenceText').style[key]=style[key];
  const pageStyle=getComputedStyle(pageInnerLeft.parentElement);
  for(const key of ['paddingTop','paddingBottom','paddingLeft','paddingRight'])$('sentenceText').style[key]=pageStyle[key];
  const html=readerBlockSlicer(cachedOriginalBlocks[entry.block])(entry.left,entry.right);
  $('sentenceText').innerHTML=html;
  if(entry.title)$('sentenceText').firstElementChild?.setAttribute('data-reader-title',entry.title);
  sentenceView.dataset.start=entry.start;
}
function saveStoppedSentence(entry){
  if(!entry||source!==fullText||restoreInProgress)return;
  const text=readerCanonical(),start=entry.start;
  readerChooseAnchor(start,{before:text.slice(Math.max(0,start-128),start),after:text.slice(start,entry.end+128)});
  flushReadingSessionSave(true);
  flushActiveRecentPositionSave();
}
function paintNotes() {
  for (const root of [pageInnerLeft,pageInnerRight,$('sentenceText')]) {
    for (const node of root.querySelectorAll('[data-reader-note]:not([data-reader-pronunciation])')) {
      node.classList.toggle('speech-note-hidden',!settings().showNotes);
      node.classList.toggle('speech-note-marker',node.textContent === '※');
      if (!settings().showNotes) { node.removeAttribute('tabindex');node.removeAttribute('role'); }
    }
  }
}
function paint() {
  clearHighlight();renderSentenceView();paintNotes();
  const entry = session?.entry || selected;
  if (!entry || source !== fullText) return;
  const ranges = [];
  for (const [page,root] of [[pageIndex,pageInnerLeft],[pageIndex+1,pageInnerRight]]) {
    if (page > pageIndex && visiblePageCount() < 2) continue;
    let base = pageAnchors[page] || 0;
    for (const block of root.children) {
      let offset = base;
      const textNodes = [];
      function walk(node) {
        if (node.nodeType === 3) {
          if (offset < entry.end && offset+node.length > entry.start)
            textNodes.push({node,start:Math.max(0,entry.start-offset),end:Math.min(node.length,entry.end-offset)});
          offset += node.length;
        } else if (node.nodeName === 'BR') {
          if (!node.hasAttribute('data-reader-break')) offset++;
        } else for (const child of node.childNodes) walk(child);
      }
      walk(block);
      for (const {node,start,end} of textNodes) {
        if (end <= start) continue;
        const range = new Range();range.setStart(node,start);range.setEnd(node,end);ranges.push(range);
      }
      base = offset+1;
    }
  }
  if(settings().viewMode==='sentence'&&Number(sentenceView.dataset.start)===entry.start){
    const range=document.createRange();range.selectNodeContents($('sentenceText'));ranges.push(range);
  }
  if (globalThis.CSS?.highlights && typeof Highlight === 'function') {
    CSS.highlights.set('speech-current-sentence',new Highlight(...ranges));
  } else for (const range of ranges.reverse()) {
    const mark = document.createElement('mark');mark.className = 'speech-sentence';range.surroundContents(mark);
  }
}
async function showEntry(entry) {
  if (!entry || source !== fullText) return;
  if (readerLazyActive()) await readerLazyNavigate(entry.start);
  else {
    pageIndex = findPageIndexForAnchor(entry.start);
    readerChooseAnchor(entry.start);render();
  }
  paint();
}
function cancelRequests() {
  ++generation;
  for(const [origin,frame] of helperFrames)
    frame.contentWindow?.postMessage({type:'ebook-speech',action:'cancel',generation},origin);
  for (const [id,item] of requests) if (item.action === 'synthesize') {
    clearTimeout(item.timer);item.reject(new DOMException('낭독 중지','AbortError'));requests.delete(id);
  }
  browserWorker?.postMessage({action:'cancel',generation});
  for (const [id,item] of browserJobs) if (item.action === 'synthesize') {
    clearTimeout(item.timer);item.reject(new DOMException('낭독 중지','AbortError'));browserJobs.delete(id);
  }
}
function stop(clear = true) {
  pendingListen++;
  const old = session;session = null;
  if (old) {
    saveStoppedSentence(old.entry);
    old.source?.stop();old.finishAudio?.();notify(old);old.queue.length = 0;
  }
  speechAudio?.stop();
  cancelRequests();
  if (clear) selected = null;
  clearHighlight();
  $('speechListen').disabled = false;$('speechPause').disabled = true;
  $('speechPause').textContent = '일시중지';
  $('speechEngine').disabled = $('speechVoice').disabled = $('speechLanguage').disabled = false;
}
const notify = run => { for (const wake of run.waiters) wake();run.waiters.clear(); };
const wait = run => new Promise(resolve => { run.waiters.add(resolve); });
async function synthesize(run,item) {
  const key = `${run.options.engine}|${run.options.voice}|${item.lang}|${item.text}`;
  const audio = run.cache.get(key);
  if (audio) return audio;
  const send = run.options.engine === 'browser' && directBrowser ? browserRequest : request;
  const value = await send('synthesize',{generation:run.generation,engine:run.options.engine,
    voice:run.options.voice,text:item.text,lang:item.lang});
  if (session !== run) throw new DOMException('낭독 중지','AbortError');
  run.cache.set(key,value);
  while (run.cache.size > 8) run.cache.delete(run.cache.keys().next().value);
  return value;
}
const cueFiles={plain:'standalone-title.mp3',bracket:'bracket-title.mp3',quote:'quote-revised.mp3',summary:'summary.mp3'};
const decodedCues=new Map();
const cueSilence={samples:new Float32Array(16000),sampleRate:16000};
async function cueAudio(kind){
  if(!decodedCues.has(kind))decodedCues.set(kind,(async()=>{
    const response=await fetch(new URL('./sounds/'+cueFiles[kind],document.baseURI));
    if(!response.ok)throw Error('효과음을 불러오지 못했습니다.');
    const audio=await audioContext.decodeAudioData(await response.arrayBuffer());
    const samples=new Float32Array(audio.length);
    for(let channel=0;channel<audio.numberOfChannels;channel++){
      const values=audio.getChannelData(channel);
      for(let n=0;n<values.length;n++)samples[n]+=0.8*values[n]/audio.numberOfChannels;
    }
    return {samples,sampleRate:audio.sampleRate};
  })().catch(error=>{decodedCues.delete(kind);throw error;}));
  return decodedCues.get(kind);
}
function* sentencePlan(entry){
  if(entry.title){yield {kind:'cue',cue:entry.title};yield {kind:'gap'};}
  const raw=cachedBlockTexts[entry.block].slice(entry.left,entry.right);
  if(/^\s*["“]/u.test(raw))yield {kind:'cue',cue:'quote'};
  let left=0;
  for(const marker of raw.matchAll(/\(3줄 요약\)/g)){
    const before=spokenText(entry.block,entry.left+left,entry.left+marker.index);
    for(const text of chunks(before))yield {kind:'speech',text};
    yield {kind:'cue',cue:'summary'};yield {kind:'gap'};
    left=marker.index;
    if(settings().skipBrackets)left+=marker[0].length;
    else{
      // Keep the marker after its cue without matching it a second time.
      const spoken=spokenText(entry.block,entry.left+left,entry.left+left+marker[0].length);
      for(const text of chunks(spoken))yield {kind:'speech',text};
      left+=marker[0].length;
    }
  }
  for(const text of chunks(spokenText(entry.block,entry.left+left,entry.right)))yield {kind:'speech',text};
}
async function fillQueue(run,startEntry) {
  try {
    for (let entry=startEntry;entry && session===run;entry=adjacent(entry,1)) {
      for (const part of sentencePlan(entry)) {
        while (session===run && (run.buffered >= 16 || run.queue.length >= 6)) await wait(run);
        if (session !== run) return;
        const item={...part,entry,lang:part.text?language(part.text):null};
        run.pendingLength=part.text?.length||0;
        const audio=part.kind==='speech'?await synthesize(run,item):part.kind==='gap'?cueSilence:await cueAudio(part.cue);
        if (session !== run) return;
        const duration = audio.samples.byteLength/4/audio.sampleRate;
        run.queue.push({...item,audio,duration});run.buffered += duration;preloadAudio(run);notify(run);
      }
    }
  } catch (error) { if (session===run) run.error = error; }
  finally { run.done = true;notify(run); }
}
function preloadAudio(run){
  if(session!==run||!run.source||!run.queue.length||run.queue[0].clip||speechAudio.clips.size>=2)return;
  run.queue[0].clip=speechAudio.prepare(run.queue[0].audio);
}
async function play(run,item) {
  run.phase=item.kind||'speech';run.cue=item.cue||null;
  speechAudio.setSpeed(run.phase==='speech'?run.options.speed:1);
  const clip=item.clip||speechAudio.prepare(item.audio);run.source=clip;
  const playing=speechAudio.play(clip,run.paused);
  run.finishAudio=()=>clip.finish?.();
  preloadAudio(run);
  try{await playing;}finally{
    if(run.source===clip)run.source=null;
    run.finishAudio=null;
  }
}
function playbackStatus(run){
  return run.options.engine==='native'
    ? 'Supertonic 3 고속 낭독 중 · '+(nativeHelperOrigin===LIBRARY_ORIGIN?'기존 도서관 도우미':'PC 도우미')
    : 'Supertonic 3 브라우저 낭독 중';
}
// A short first sentence can finish before a longer second one is ready.
async function bufferForContinuousStart(run) {
  if (run.done || run.paused || run.queue.length !== 1) return;
  const first = run.queue[0];
  if (!first.audio.synthesisMs || !run.pendingLength) return;
  const availableMs = 1000 * first.duration / run.options.speed;
  const nextMs = first.audio.synthesisMs * Math.max(8, run.pendingLength) / Math.max(8, first.text.length);
  const budget = Math.min(2500, Math.ceil(nextMs * 1.15 - availableMs));
  if (budget <= 0) return;
  status('기존 음질로 다음 문장을 미리 준비하는 중…');
  await new Promise(resolve => {
    const finish = () => {
      clearTimeout(timer);
      run.waiters.delete(finish);
      resolve();
    };
    const timer = setTimeout(finish, budget);
    run.waiters.add(finish);
  });
}
async function start(entry,paused = false,cache = new Map(),continuousStart = false) {
  if (!entry) { status('읽을 문장이 없습니다.');return; }
  const run = {generation:++generation,entry,paused,queue:[],buffered:0,done:false,error:null,
    source:null,waiters:new Set(),cache,options:settings()};
  session = run;selected = entry;
  $('speechListen').disabled = true;$('speechPause').disabled = false;
  $('speechPause').textContent = paused ? '이어 듣기' : '일시중지';
  $('speechEngine').disabled = $('speechVoice').disabled = $('speechLanguage').disabled = true;
  status(paused ? '일시중지됨' : '다음 문장을 미리 준비하는 중…');
  try {
    audioContext ||= new AudioContext();
    if (paused) await audioContext.suspend();else await audioContext.resume();
    await showEntry(entry);
    if (session !== run) return;
    void fillQueue(run,entry);
    let current = null;
    while (session === run) {
      while (session===run && !run.queue.length && !run.done) await wait(run);
      if (session !== run) return;
      if (continuousStart) {
        continuousStart = false;
        if (mobile && directBrowser && run.options.engine === 'browser') await bufferForContinuousStart(run);
        if (session !== run) return;
      }
      const item = run.queue.shift();
      if (!item) {
        if (run.error) throw run.error;
        stop();status('낭독 완료');return;
      }
      run.buffered -= item.duration;notify(run);
      run.entry = item.entry;selected = item.entry;
      if (current !== item.entry.start) await showEntry(item.entry);
      current = item.entry.start;
      if (session !== run) return;
      status(run.paused ? '일시중지됨' : playbackStatus(run));
      await play(run,item);
    }
  } catch (error) {
    if (session===run) {stop();status('낭독 실패 · ' + error.message);}
  }
}
async function move(direction) {
  refreshBook();
  const target = adjacent(session?.entry || selected || atAnchor(readerAnchor()),direction);
  if (!target) { status(direction>0?'마지막 문장입니다.':'첫 문장입니다.');return; }
  if (session) {
    const paused = session.paused,cache = session.cache;
    stop(false);selected = target;await start(target,paused,cache);
  } else { selected = target;await showEntry(target);paint(); }
}
$('speechPrevious').onclick = () => void move(-1);
$('speechNext').onclick = () => void move(1);
$('speechListen').onclick = async () => {
  if (!pages.length || session) return;
  refreshBook();
  const ticket=++pendingListen,book=fullText;
  $('speechListen').disabled=true;
  try{
    audioContext ||= new AudioContext();
    speechAudio ||= new ReaderSpeechAudio(audioContext);
    const unlocked=speechAudio.unlock();
    await audioContext.resume();await unlocked;
    await preferenceReady;
  }catch(error){$('speechListen').disabled=false;status(error.message);return;}
  if(restoreInProgress)status('페이지 계산이 끝나면 선택한 문장부터 읽습니다…');
  while(restoreInProgress&&ticket===pendingListen&&book===fullText&&viewerOverlay.classList.contains('active'))
    await new Promise(resolve=>setTimeout(resolve,40));
  if(ticket!==pendingListen||book!==fullText||!viewerOverlay.classList.contains('active'))return;
  await start(selected || atAnchor(pageAnchors[pageIndex] || 0),false,new Map(),true);
};
$('speechPause').onclick = async () => {
  const run = session;if (!run) return;
  try {
    if (run.paused) {
      await audioContext.resume();if(session!==run)return;
      run.paused=false;
      try{await speechAudio.resume();}catch(error){run.paused=true;await audioContext.suspend();throw error;}
    } else {
      run.paused=true;speechAudio.pause();notify(run);await audioContext.suspend();
    }
    if (session!==run) return;
    $('speechPause').textContent = run.paused ? '이어 듣기' : '일시중지';
    status(run.paused?'일시중지됨':playbackStatus(run));
  } catch (error) { status(error.message); }
};
$('speechStop').onclick = () => {stop();status('낭독 중지');};
$('speechPickSentence').onclick = () => {
  if (restoreInProgress || !pages.length) return;
  refreshBook();
  const first = pageAnchors[pageIndex] || 0;
  const end = pageAnchors[Math.min(pages.length,pageIndex+visiblePageCount())] ?? readerCanonical().length;
  const list = document.createDocumentFragment();
  let entry = atAnchor(first),count = 0;
  while (entry && entry.start < end && count++ < 1000) {
    const item = entry;
    const button = document.createElement('button');button.type='button';
    button.textContent = spokenText(item.block,item.left,item.right);
    button.dataset.start = item.start;
    button.onclick = () => {
      if (session) stop(false);
      selected = item;picker.close();paint();status('시작 문장을 선택했습니다.');
    };
    list.append(button);entry = adjacent(entry,1);
  }
  $('speechSentenceList').replaceChildren(list);
  picker.showModal();
};
document.addEventListener('keydown',event => {
  if(event.key==='Escape'&&speechSettings.open&&!document.querySelector('dialog[open]')&&
      !settingsPanelIsOpen()&&!readerChapterIsOpen()&&!readerSearchIsOpen()&&!readerGPTIsOpen()){
    event.preventDefault();event.stopImmediatePropagation();remember('panelOpen',false);speechSettings.open=false;
    $('speechSettingsToggle').focus();return;
  }
  if (!session || event.ctrlKey || event.metaKey || event.altKey || event.isComposing || event.repeat ||
      settingsPanelIsOpen() || document.querySelector('dialog[open]') || readerGPTIsOpen() ||
      readerNoteIsOpen() || readerTimelineIsOpen() || readerSearchIsOpen() || readerChapterIsOpen() ||
      event.target.closest?.('#speechSettings,input,textarea,select,[contenteditable]:not([contenteditable="false"])')) return;
  if (!['<','>',' '].includes(event.key)) return;
  event.preventDefault();event.stopImmediatePropagation();
  if (event.key===' ') void $('speechPause').onclick();else void move(event.key==='<'?-1:1);
},true);
addEventListener('pagehide',() => {
  helperFrames.get(ORIGIN)?.contentWindow?.postMessage({type:'ebook-speech',action:'rpc',id:'last-options',
    path:'/preferences',body:{patch:preferences}},ORIGIN);
  stop();
});

let exportId = null, exportRunning = false, exportCancelling = false;
function sectionData() {
  if(cachedMarkdownSource!==fullText)getPaginationBlocks(fullText);
  readerCanonical();
  const starts = bookChapters.length ? chapterCanonicalStarts : [0];
  return starts.map((start,index) => ({
    start,end:starts[index+1] ?? readerCanonical().length,
    title:bookChapters[index]?.title || inputFileName || '전체구간',index:index+1
  }));
}
function sectionText(section) {
  let text = '',first = true;
  for (let block=0;block<cachedBlockTexts.length;block++) {
    const base = cachedBlockStarts[block],end = base+cachedBlockTexts[block].length;
    if (end < section.start || base >= section.end) continue;
    if (!first) text += '\n';first = false;
    text += spokenText(block,Math.max(0,section.start-base),Math.min(end,section.end)-base);
  }
  return text;
}
async function exportSection(section) {
  const parts=[];
  let processed=0;
  for(let block=atAnchor(section.start)?.block??0;block<cachedBlockTexts.length;block++){
    const base=cachedBlockStarts[block],end=base+cachedBlockTexts[block].length;
    if(base>=section.end)break;
    if(exportCancelling)throw Error('MP3 만들기를 취소했습니다.');
    parts.push(spokenText(block,Math.max(0,section.start-base),Math.min(end,section.end)-base));
    if(++processed%128===0)await delay(0);
  }
  return parts.join('\n');
}
$('readerMp3Open').onclick = async () => {
  if (!pages.length) return;
  const book = fullText;
  while ((restoreInProgress || readerState.layout !== getLayoutSignature()) && book === fullText && viewerOverlay.classList.contains('active'))
    await delay(40);
  if (book !== fullText || !viewerOverlay.classList.contains('active')) return;
  const sections = sectionData();
  for (const id of ['readerMp3From','readerMp3To']) {
    const select = $(id);select.replaceChildren();
    for (const section of sections) {
      const option = document.createElement('option');option.value = section.index-1;
      option.textContent = `${section.index}. ${section.title}`;select.append(option);
    }
  }
  const value=settings();
  $('readerMp3From').value=Math.max(0,Math.min(sections.length-1,Number(value.mp3From)||0));
  $('readerMp3To').value=value.mp3To===null?sections.length-1:Math.max(0,Math.min(sections.length-1,Number(value.mp3To)||0));
  mp3.showModal();
};
$('readerMp3Close').onclick = () => mp3.close();
$('readerMp3Scope').onchange = () => { $('readerMp3Range').hidden = $('readerMp3Scope').value !== 'range'; };
const delay = ms => new Promise(resolve => setTimeout(resolve,ms));
$('readerMp3Start').onclick = async () => {
  if (exportRunning) return;
  exportRunning = true;exportCancelling = false;exportId = null;
  $('readerMp3Start').disabled = true;$('readerMp3Cancel').disabled = false;
  $('readerMp3Download').hidden = true;
  const bar = $('readerMp3Progress'),percent = $('readerMp3Percent'),message = $('readerMp3Status');
  bar.hidden = false;bar.removeAttribute('value');percent.textContent = '계산 중';
  message.textContent = '선택한 구간의 합성 분량을 계산하는 중…';
  try {
    const sections = sectionData();
    const first = $('readerMp3Scope').value==='all'?0:Number($('readerMp3From').value);
    const last = $('readerMp3Scope').value==='all'?sections.length-1:Number($('readerMp3To').value);
    if (first > last) throw Error('끝 구간은 시작 구간 뒤로 선택해 주세요.');
    const chosen = [];
    for (const section of sections.slice(first,last+1)) {
      if (exportCancelling) throw Error('MP3 만들기를 취소했습니다.');
      chosen.push({...section,text:await exportSection(section)});
      await delay(0);
    }
    const value = settings();
    const created = await rpc('/export/start',{sections:chosen,settings:{
      model:value.mp3Model,voice:value.mp3Voice,bitrate:Number(value.mp3Bitrate),
      split:value.mp3Split,lang:value.language,hideNotes:!value.showNotes
    }});
    exportId = created.id;
    if (exportCancelling) await rpc('/export/cancel',{id:exportId});
    let job;
    do {
      job = await rpc('/export/status',{id:exportId});
      const progress = job.progress;
      if (progress.charactersTotal > 0) {
        const number = Math.min(99,Math.floor(100*progress.charactersDone/progress.charactersTotal));
        bar.value = number;percent.textContent = number+'%';
        message.textContent = `${progress.completed}/${progress.total}구간 완료 · ${progress.charactersDone.toLocaleString()}/${progress.charactersTotal.toLocaleString()}자 처리`;
      }
      if (job.running) await delay(500);
    } while (job.running);
    if (job.error) throw Error(job.error);
    if (!job.result?.url || !job.result.bytes) throw Error('완성된 MP3를 찾을 수 없습니다.');
    bar.value = 100;percent.textContent = '100%';
    message.textContent = `${job.progress.completed}/${job.progress.total}구간 완료 · 인코딩과 파일 저장 완료`;
    const link = $('readerMp3Download');link.href = ORIGIN+job.result.url;
    link.download = job.result.filename;link.textContent = job.result.filename+' 다운로드';link.hidden = false;
  } catch (error) {
    message.textContent = 'MP3 만들기 실패 · ' + error.message;
    if (!bar.hasAttribute('value')) {bar.hidden = true;percent.textContent = '';}
  } finally {
    exportRunning = false;exportId = null;
    $('readerMp3Start').disabled = false;$('readerMp3Cancel').disabled = true;
  }
};
$('readerMp3Cancel').onclick = async () => {
  exportCancelling = true;$('readerMp3Cancel').disabled = true;
  $('readerMp3Status').textContent = '취소하는 중…';
  if (exportId) await rpc('/export/cancel',{id:exportId}).catch(error => {
    $('readerMp3Status').textContent = error.message;
  });
};
window.readerSpeech = {
  render() {refreshBook();paint();},
  close() {stop();picker.close();mp3.close();},
  sentenceMode:()=>settings().viewMode==='sentence',turnSentence:move,
  notesVisible:() => settings().showNotes,
  inspect:() => ({entry:session?.entry || selected,paused:session?.paused ?? false,
    generation:session?.generation,buffered:session?.buffered || 0,queued:session?.queue.length || 0,
    phase:session?.phase,cue:session?.cue,sourceActive:!!session?.source,audioTime:audioContext?.currentTime,playbackRate:session?.source?.media.playbackRate,
    mediaTime:session?.source?.media.currentTime,preservesPitch:session?.source?.media.preservesPitch,
    preparedAudio:speechAudio?.clips.size||0,
    settings:settings(),nativeHelperOrigin,exportId}),
  atAnchor,adjacent,spokenText,sectionData,sectionText,ready:preferenceReady
};
void readerReady.then(() => {
  applyPreferences();
  if (viewerOverlay.classList.contains('active')) {
    refreshBook();paint();scheduleRepaginate();
  }
});
})();
