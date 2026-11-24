/* App installation uses the reader's existing origin, databases and service worker. */
(() => {
  'use strict';
  const button=document.getElementById('readerInstallApp');
  const actions=button.closest('.reader-app-actions');
  const notice=document.getElementById('readerAppInstallNotice');
  const standalone=matchMedia('(display-mode: standalone)');
  let pendingPrompt=null,installed=false;
  const inApp=()=>standalone.matches||navigator.standalone===true;
  const nativeInstallAvailable=()=>typeof navigator.install==='function'&&isSecureContext&&/^https?:$/.test(location.protocol);
  const message=text=>{notice.textContent=text;notice.hidden=!text;};
  function update(){
    actions.hidden=inApp()||!!window.AndroidReader;
    button.textContent=installed?'설치 완료':'앱으로 설치';
    button.disabled=installed;
    button.dataset.installReady=pendingPrompt||nativeInstallAvailable()?'true':'false';
    button.dataset.installMethod=pendingPrompt?'prompt':nativeInstallAvailable()?'native':'menu';
  }
  const dialog=document.createElement('dialog');dialog.id='readerInstallDialog';
  dialog.setAttribute('aria-labelledby','readerInstallTitle');
  dialog.innerHTML=`<header><h2 id="readerInstallTitle">전자책 뷰어 앱 설치</h2><button type="button" id="readerInstallClose">닫기</button></header>
    <p>주소창에 설치 아이콘이 없어도 엣지 메뉴에서 설치할 수 있습니다.</p>
    <ol><li>엣지 창 오른쪽 위의 <strong>⋯</strong> 메뉴를 누르세요.</li>
    <li><strong>기타 도구 → 앱 → 이 사이트를 앱으로 설치</strong>를 선택하세요.</li>
    <li>이름을 확인한 뒤 <strong>설치</strong>를 누르세요.</li></ol>
    <p>엣지 버전에 따라 ⋯ 메뉴에 ‘앱’이 바로 표시될 수도 있습니다.</p>
    <p>같은 엣지 프로필에서는 기존 독서 기록과 설정을 이어서 사용합니다. 이미 설치했다면 시작 메뉴에서 ‘전자책 뷰어’를 열어 주세요.</p>
    <p id="readerInstallLocal" hidden>파일을 직접 연 화면에서는 설치할 수 없습니다. <a href="https://narpheus-cpu.github.io/viewer/">설치용 웹 주소 열기</a></p>`;
  document.body.append(dialog);
  document.getElementById('readerInstallClose').onclick=()=>dialog.close();
  dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
  const help=()=>{document.getElementById('readerInstallLocal').hidden=location.protocol!=='file:';if(!dialog.open)dialog.showModal();};
  addEventListener('beforeinstallprompt',event=>{event.preventDefault();pendingPrompt=event;update();});
  addEventListener('appinstalled',()=>{pendingPrompt=null;installed=true;message('설치했습니다. 시작 메뉴에서 전자책 뷰어를 열 수 있습니다.');update();});
  standalone.addEventListener('change',update);
  button.addEventListener('click',async()=>{
    const prompt=pendingPrompt;
    if(!prompt&&!nativeInstallAvailable()){help();return;}
    pendingPrompt=null;button.disabled=true;
    try{
      if(prompt){
        await prompt.prompt();const choice=await prompt.userChoice;
        if(choice.outcome!=='accepted'){message('설치를 취소했습니다. 앱으로 설치 버튼으로 다시 진행할 수 있습니다.');return;}
      }else{
        // Invoke during this click's user activation; no install-banner event or address-bar icon is required.
        await navigator.install();
      }
      installed=true;message('설치했습니다. 시작 메뉴에서 전자책 뷰어를 열 수 있습니다.');
    }catch(error){
      if(error.name==='AbortError')message('설치를 취소했습니다. 앱으로 설치 버튼으로 다시 진행할 수 있습니다.');
      else{message('설치 확인창을 열지 못했습니다. 아래의 엣지 메뉴 경로로 설치해 주세요.');help();}
    }
    finally{update();}
  });
  update();
  const supported=!!navigator.serviceWorker&&isSecureContext&&/^https?:$/.test(location.protocol)&&!window.AndroidReader;
  const registration=supported?navigator.serviceWorker.register('./reader-sw.js',{updateViaCache:'none'}).catch(async error=>{
    const existing=await navigator.serviceWorker.getRegistration('./');
    if(existing?.active)return existing;
    throw Error('앱 화면을 저장하지 못했습니다. 인터넷에 연결한 뒤 다시 열어 주세요.');
  }):Promise.resolve(null);
  window.readerAppReady=supported?registration.then(registration=>new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('오프라인 화면 저장이 아직 완료되지 않았습니다. 인터넷 연결을 확인한 뒤 다시 열어 주세요.')),25000);
    navigator.serviceWorker.ready.then(active=>{clearTimeout(timer);resolve(active);},error=>{clearTimeout(timer);reject(error);});
    const worker=registration.installing;
    if(worker)worker.addEventListener('statechange',()=>{if(worker.state==='redundant'&&!registration.active){clearTimeout(timer);reject(Error('오프라인 화면을 저장하지 못했습니다. 다시 열어 주세요.'));}});
  })):Promise.resolve(null);
  window.readerAppReady.catch(error=>message(error.message));
})();
