/* App installation uses the reader's existing origin, databases and service worker. */
(() => {
  'use strict';
  const button=document.getElementById('readerInstallApp');
  const actions=button.closest('.reader-app-actions');
  const notice=document.getElementById('readerAppInstallNotice');
  const standalone=matchMedia('(display-mode: standalone)');
  let pendingPrompt=null,installed=false;
  const inApp=()=>standalone.matches||navigator.standalone===true;
  const message=text=>{notice.textContent=text;notice.hidden=!text;};
  function update(){
    actions.hidden=inApp()||!!window.AndroidReader;
    button.textContent=installed?'설치 완료':'앱으로 설치';
    button.disabled=installed;
    button.dataset.installReady=pendingPrompt?'true':'false';
  }
  const dialog=document.createElement('dialog');dialog.id='readerInstallDialog';
  dialog.setAttribute('aria-labelledby','readerInstallTitle');
  dialog.innerHTML=`<header><h2 id="readerInstallTitle">전자책 뷰어 앱 설치</h2><button type="button" id="readerInstallClose">닫기</button></header>
    <p>엣지에서 이 뷰어를 별도 앱 창으로 사용할 수 있습니다.</p>
    <ol><li>주소창 오른쪽에 있는 <strong>앱 설치 아이콘</strong>을 누르세요.</li>
    <li><strong>설치</strong>를 선택하세요. 아이콘이 보이지 않으면 엣지의 ⋯ 메뉴에서 앱 설치 항목을 선택하세요.</li></ol>
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
    if(!prompt){help();return;}
    pendingPrompt=null;button.disabled=true;
    try{
      await prompt.prompt();const choice=await prompt.userChoice;
      if(choice.outcome==='accepted'){installed=true;message('설치했습니다. 시작 메뉴에서 전자책 뷰어를 열 수 있습니다.');}
      else message('설치를 취소했습니다. 주소창의 앱 설치 아이콘으로 다시 설치할 수 있습니다.');
    }catch{message('주소창의 앱 설치 아이콘을 이용해 주세요.');help();}
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
