/* Supertonic 3 reader integration. Sentence positions use the existing canonical text. */
(function () {
'use strict';
const $ = id => document.getElementById(id);
const ORIGIN = 'http://127.0.0.1:18766';
const STORAGE = 'ebookViewerSpeechOptionsV1';
const defaults = {engine:'native',voice:'M1',language:'auto',highlight:'pastel',showNotes:true,
  mp3Model:'supertonic3',mp3Voice:'F1',mp3Bitrate:'128',mp3Split:false};
const voices = ['M','F'].flatMap(sex => [1,2,3,4,5].map(n =>
  `<option value="${sex}${n}">${sex==='M'?'남성':'여성'} ${n}</option>`)).join('');
const toolbar = document.createElement('section');
toolbar.id = 'speechToolbar';
toolbar.setAttribute('aria-label','오프라인 낭독');
toolbar.innerHTML = `
 <div class="speech-actions">
  <button id="speechPickSentence" type="button">시작 문장 선택</button>
  <button id="speechPrevious" type="button" aria-label="이전 문장">&lt;&lt;</button>
  <button id="speechListen" type="button">듣기</button>
  <button id="speechPause" type="button" disabled>일시중지</button>
  <button id="speechStop" type="button">중지</button>
  <button id="speechNext" type="button" aria-label="다음 문장">&gt;&gt;</button>
  <button id="readerMp3Open" type="button">MP3 만들기</button>
 </div>
 <div class="speech-options">
  <label>낭독 방식 <select id="speechEngine"><option value="native">Supertonic 3 · 오프라인 고속</option><option value="browser">Supertonic 3 · 오프라인 브라우저</option></select></label>
  <label>목소리 <select id="speechVoice">${voices}</select></label>
  <label>언어 <select id="speechLanguage"><option value="auto">자동</option><option value="ko">한국어</option><option value="en">영어</option><option value="ja">일본어</option></select></label>
  <label>강조 <select id="speechHighlight"><option value="pastel">파스텔</option><option value="inverse">흑백반전</option><option value="underline">밑줄</option></select></label>
 </div>
 <div id="speechStatus" role="status" aria-live="polite"></div>
 <div id="speechOptionsStatus" role="status"></div>`;
const localLink=document.createElement('a');
localLink.id='speechLocalOpen';localLink.href=ORIGIN;
localLink.target='_blank';localLink.rel='noopener';
localLink.textContent='로컬 실행 화면 열기';localLink.hidden=true;
toolbar.append(localLink);
$('chapterNav').before(toolbar);
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
let frame, connecting, serial = 0;
const requests = new Map();
let source = null, blockCache = new Map(), noteCache = new Map();
let selected = null, session = null, audioContext = null, generation = 0;
const status = text => { $('speechStatus').textContent = text; };
const optionStatus = text => { $('speechOptionsStatus').textContent = text; };
const settings = () => Object.fromEntries(Object.entries(defaults).map(([key,value]) =>
  [key, preferences[key]?.value ?? value]));
const controls = {engine:'speechEngine',voice:'speechVoice',language:'speechLanguage',highlight:'speechHighlight',
  showNotes:'viewerBracketNotes',mp3Model:'readerMp3Model',mp3Voice:'readerMp3Voice',
  mp3Bitrate:'readerMp3Bitrate',mp3Split:'readerMp3Split'};

function applyPreferences() {
  const value = settings();
  const notesChanged=viewerSettings.showBracketNotes!==value.showNotes;
  for (const [key,id] of Object.entries(controls)) {
    const control = $(id);
    if (control.type === 'checkbox') control.checked = value[key];
    else if ([...control.options].some(option => option.value === value[key])) control.value = value[key];
  }
  document.documentElement.dataset.speechHighlight = value.highlight;
  document.documentElement.classList.toggle('speech-hide-notes', !value.showNotes);
  viewerSettings.showBracketNotes = value.showNotes;
  paint();
  if(notesChanged&&viewerOverlay.classList.contains('active'))scheduleRepaginate();
}
function mergePreferences(value) {
  for (const [key,item] of Object.entries(value || {})) {
    if (key in defaults && item && Number.isFinite(item.revision) &&
        item.revision > (preferences[key]?.revision || 0)) preferences[key] = item;
  }
}
function saveLocal() {
  try {
    localStorage.setItem(STORAGE, JSON.stringify(preferences));
    return true;
  } catch (error) {
    optionStatus('옵션을 이 창에 저장하지 못했습니다. 로컬 도우미에 저장합니다. ' + error.message);
    return false;
  }
}
try { mergePreferences(JSON.parse(localStorage.getItem(STORAGE) || '{}')); }
catch (error) { optionStatus('듣기 옵션 불러오기 실패 · ' + error.message); }
applyPreferences();

function connect() {
  if (connecting) return connecting;
  connecting = new Promise((resolve,reject) => {
    frame = document.createElement('iframe');
    frame.hidden = true;
    frame.title = 'Supertonic 3 로컬 도우미';
    frame.allow = 'local-network-access; local-network; loopback-network';
    frame.src = ORIGIN + '/supertonic3/bridge.html';
    const timer = setTimeout(() => {
      removeEventListener('message',ready);
      frame.remove();frame = null;connecting = null;
      localLink.hidden=false;
      reject(Error('실행.bat로 도우미를 켜 주세요. 공개 웹에서는 사이트 설정의 로컬 네트워크 접근을 허용하거나 로컬 실행 화면을 여세요.'));
    }, 8000);
    const ready = event => {
      if (event.origin !== ORIGIN || event.source !== frame?.contentWindow ||
          event.data?.type !== 'ebook-speech' || event.data.action !== 'ready') return;
      clearTimeout(timer);removeEventListener('message',ready);resolve(frame);
      localLink.hidden=true;
    };
    addEventListener('message',ready);
    frame.onload = () => frame.contentWindow.postMessage({type:'ebook-speech',action:'connect'},ORIGIN);
    document.body.append(frame);
  });
  return connecting;
}
addEventListener('message', event => {
  if (event.origin !== ORIGIN || event.source !== frame?.contentWindow || event.data?.type !== 'ebook-speech') return;
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
  const connection = await connect();
  if(action==='synthesize'&&data.generation!==session?.generation)
    throw new DOMException('낭독 중지','AbortError');
  return new Promise((resolve,reject) => {
    const id = ++serial;
    const timer = setTimeout(() => {
      requests.delete(id);reject(Error('로컬 도우미 응답 시간이 초과됐습니다.'));
    }, action === 'synthesize' ? 180000 : 20000);
    requests.set(id,{resolve,reject,timer,action});
    connection.contentWindow.postMessage({type:'ebook-speech',action,id,...data},ORIGIN);
  });
}
const rpc = (path,body = {}) => request('rpc',{path,body});
let preferenceReady = rpc('/preferences').then(async remote => {
  mergePreferences(remote);applyPreferences();saveLocal();
  if (Object.keys(preferences).length) await rpc('/preferences',{patch:preferences});
}).catch(error => optionStatus('듣기 옵션은 이 브라우저에 저장됩니다. ' + error.message));
function remember(key,value) {
  revision = Math.max(Date.now()*1000,revision+1,...Object.values(preferences).map(item => item.revision+1));
  const patch = {[key]:{value,revision}};
  Object.assign(preferences,patch);
  const local = saveLocal();
  request('rpc',{path:'/preferences',body:{patch}}).then(() => {
    optionStatus(local ? '' : '듣기 옵션을 로컬 도우미에 저장했습니다.');
  }).catch(error => optionStatus((local ? '브라우저에는 저장됐습니다. 도우미 저장 실패 · ' : '옵션 저장 실패 · ') + error.message));
}
for (const [key,id] of Object.entries(controls)) {
  $(id).addEventListener('change', async () => {
    const previous = settings();
    remember(key,$(id).type === 'checkbox' ? $(id).checked : $(id).value);
    applyPreferences();
    if (key === 'showNotes') {
      noteCache.clear();blockCache.clear();saveViewerSettings();
      readerCloseNote();
      if (session) {
        const entry = session.entry, paused = session.paused;
        stop(false);await start(entry,paused);
      }
      if (previous.showNotes !== settings().showNotes) scheduleRepaginate();
    }
  });
}

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
  let text = cachedBlockTexts[block].slice(left,right);
  if (settings().showNotes) {
    for (const item of notesForBlock(block).filter(n => n.offset > left && n.offset <= right).reverse())
      text = text.slice(0,item.offset-left) + item.text + text.slice(item.offset-left);
  } else text = withoutNotes(text);
  return text.replace(/※/g,'').replace(/\s+/g,' ').trim();
}
function sentences(block) {
  if (blockCache.has(block)) return blockCache.get(block);
  const text = cachedBlockTexts[block] || '', base = cachedBlockStarts[block] || 0;
  let boundaryText=text;
  if(!settings().showNotes){
    for(const note of readerFindNoteRanges(text).reverse())
      boundaryText=boundaryText.slice(0,note.start)+' '.repeat(note.end-note.start)+boundaryText.slice(note.end);
  }
  const ends = readerSentenceEnds(boundaryText,cachedQuoteRoles,base);
  if (ends.at(-1) !== text.length) ends.push(text.length);
  const result = [];
  let left = 0;
  for (const end of ends) {
    let start = left, right = end;
    while (start < right && /\s/.test(boundaryText[start])) start++;
    while (right > start && /\s/.test(boundaryText[right-1])) right--;
    if (/[\p{L}\p{N}]/u.test(boundaryText.slice(start,right)))
      result.push({block,left:start,right,start:base+start,end:base+right});
    left = end;
  }
  if (blockCache.size >= 32) blockCache.delete(blockCache.keys().next().value);
  blockCache.set(block,result);
  return result;
}
function atAnchor(anchor) {
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
function paintNotes() {
  for (const root of [pageInnerLeft,pageInnerRight]) {
    for (const node of root.querySelectorAll('[data-reader-note]:not([data-reader-pronunciation])')) {
      node.classList.toggle('speech-note-hidden',!settings().showNotes);
      node.classList.toggle('speech-note-marker',node.textContent === '※');
      if (!settings().showNotes) { node.removeAttribute('tabindex');node.removeAttribute('role'); }
    }
  }
}
function paint() {
  clearHighlight();paintNotes();
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
  frame?.contentWindow?.postMessage({type:'ebook-speech',action:'cancel',generation:++generation},ORIGIN);
  for (const [id,item] of requests) if (item.action === 'synthesize') {
    clearTimeout(item.timer);item.reject(new DOMException('낭독 중지','AbortError'));requests.delete(id);
  }
}
function stop(clear = true) {
  const old = session;session = null;
  if (old) {
    old.source?.stop();old.finishAudio?.();notify(old);old.queue.length = 0;
  }
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
  const value = await request('synthesize',{generation:run.generation,engine:run.options.engine,
    voice:run.options.voice,text:item.text,lang:item.lang});
  if (session !== run) throw new DOMException('낭독 중지','AbortError');
  run.cache.set(key,value);
  while (run.cache.size > 8) run.cache.delete(run.cache.keys().next().value);
  return value;
}
async function fillQueue(run,startEntry) {
  try {
    for (let entry=startEntry;entry && session===run;entry=adjacent(entry,1)) {
      for (const text of chunks(spokenText(entry.block,entry.left,entry.right))) {
        while (session===run && (run.buffered >= 16 || run.queue.length >= 6)) await wait(run);
        if (session !== run) return;
        const item = {entry,text,lang:language(text)};
        const audio = await synthesize(run,item);
        if (session !== run) return;
        const duration = audio.samples.byteLength/4/audio.sampleRate;
        run.queue.push({...item,audio,duration});run.buffered += duration;notify(run);
      }
    }
  } catch (error) { if (session===run) run.error = error; }
  finally { run.done = true;notify(run); }
}
async function play(run,item) {
  const pcm = new Float32Array(item.audio.samples);
  const buffer = audioContext.createBuffer(1,pcm.length,item.audio.sampleRate);
  buffer.copyToChannel(pcm,0);
  await new Promise(resolve => {
    const source = audioContext.createBufferSource();
    source.buffer = buffer;source.connect(audioContext.destination);run.source = source;
    const finish=()=>{
      source.onended=null;
      if(run.source===source)run.source=null;
      run.finishAudio=null;source.disconnect();resolve();
    };
    run.finishAudio=finish;source.onended=finish;
    source.start();
  });
}
async function start(entry,paused = false,cache = new Map()) {
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
      status(run.paused ? '일시중지됨' : 'Supertonic 3 낭독 중');
      await play(run,item);
    }
  } catch (error) {
    if (session===run) {stop();status('낭독 실패 · ' + error.message);}
  }
}
async function move(direction) {
  refreshBook();
  const target = adjacent(session?.entry || selected || atAnchor(pageAnchors[pageIndex] || 0),direction);
  if (!target) { status(direction>0?'마지막 문장입니다.':'첫 문장입니다.');return; }
  if (session) {
    const paused = session.paused,cache = session.cache;
    stop(false);selected = target;await start(target,paused,cache);
  } else { selected = target;await showEntry(target);paint(); }
}
$('speechPrevious').onclick = () => void move(-1);
$('speechNext').onclick = () => void move(1);
$('speechListen').onclick = async () => {
  if (restoreInProgress || !pages.length || session) return;
  refreshBook();await start(selected || atAnchor(pageAnchors[pageIndex] || 0));
};
$('speechPause').onclick = async () => {
  const run = session;if (!run) return;
  try {
    if (run.paused) await audioContext.resume();else await audioContext.suspend();
    if (session!==run) return;
    run.paused = !run.paused;
    $('speechPause').textContent = run.paused ? '이어 듣기' : '일시중지';
    status(run.paused?'일시중지됨':'Supertonic 3 낭독 중');
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
  if (!session || event.ctrlKey || event.metaKey || event.altKey || event.isComposing || event.repeat ||
      settingsPanelIsOpen() || document.querySelector('dialog[open]') || readerGPTIsOpen() ||
      readerNoteIsOpen() || readerTimelineIsOpen() || readerSearchIsOpen() || readerChapterIsOpen() ||
      event.target.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) return;
  if (!['<','>',' '].includes(event.key)) return;
  event.preventDefault();event.stopImmediatePropagation();
  if (event.key===' ') void $('speechPause').onclick();else void move(event.key==='<'?-1:1);
},true);
addEventListener('pagehide',() => {
  frame?.contentWindow?.postMessage({type:'ebook-speech',action:'rpc',id:'last-options',
    path:'/preferences',body:{patch:preferences}},ORIGIN);
  stop();
});

let exportId = null, exportRunning = false, exportCancelling = false;
function sectionData() {
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
$('readerMp3Open').onclick = () => {
  if (!pages.length || restoreInProgress) return;
  const sections = sectionData();
  for (const id of ['readerMp3From','readerMp3To']) {
    const select = $(id);select.replaceChildren();
    for (const section of sections) {
      const option = document.createElement('option');option.value = section.index-1;
      option.textContent = `${section.index}. ${section.title}`;select.append(option);
    }
  }
  $('readerMp3To').value = sections.length-1;
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
  notesVisible:() => settings().showNotes,
  inspect:() => ({entry:session?.entry || selected,paused:session?.paused ?? false,
    generation:session?.generation,buffered:session?.buffered || 0,queued:session?.queue.length || 0,
    sourceActive:!!session?.source,audioTime:audioContext?.currentTime,settings:settings(),exportId}),
  atAnchor,adjacent,spokenText,sectionData,sectionText,ready:preferenceReady
};
void readerReady.then(() => {
  if (viewerOverlay.classList.contains('active')) {
    refreshBook();paint();scheduleRepaginate();
  }
});
})();
